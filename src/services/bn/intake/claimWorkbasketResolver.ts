/**
 * Which workbasket does a newly submitted claim belong in? (BUG-33)
 *
 * A claim's routing is a property of its PRODUCT, not of the claim — the same
 * place its workflow comes from. So the workbasket is derived from the product
 * version's own workflow template rather than chosen here:
 *
 *   claim.product_version_id + channel
 *     → bn_product_version_workflow  (channel → default → legacy version-level)
 *     → bn_workflow_template.steps_config[0]      e.g. { step: "INTAKE", role: "CLERK" }
 *     → bn_workbasket WHERE assigned_role matches that step's role
 *
 * The template's first step is read even when the template is not executable
 * (`is_executable = false`, `workflow_definition_id = NULL`). Nothing here runs
 * a workflow — it only asks the product who should own the claim first, and the
 * template answers that correctly whether or not the engine can drive it.
 *
 * `steps_config[0].sla_days` also gives the assignment a `due_at`, without which
 * the escalation runner has nothing to watch.
 */
import { supabase } from '@/integrations/supabase/client';
import { resolveProductWorkflow } from '@/services/bn/workflow/resolveProductWorkflow';

const db = supabase as any;

export type WorkbasketResolutionSource =
  | 'WORKFLOW_FIRST_STEP'
  | 'NONE';

export interface ResolvedClaimWorkbasket {
  workbasketId: string | null;
  workbasketName: string | null;
  source: WorkbasketResolutionSource;
  /** First step of the product's workflow, e.g. "INTAKE". */
  stepName: string | null;
  /** Role named on that step, e.g. "CLERK". */
  stepRole: string | null;
  /** Basket role the step role mapped to, e.g. "BN_INTAKE_OFFICER". */
  basketRole: string | null;
  slaDays: number | null;
  /** assigned_at + slaDays, for the escalation runner. Null when no SLA. */
  dueAt: string | null;
  /** Why nothing was resolved. Null on success. */
  reason: string | null;
}

const NONE = (reason: string): ResolvedClaimWorkbasket => ({
  workbasketId: null,
  workbasketName: null,
  source: 'NONE',
  stepName: null,
  stepRole: null,
  basketRole: null,
  slaDays: null,
  dueAt: null,
  reason,
});

/**
 * Workflow steps name a generic role ("CLERK"); workbaskets name a BN role
 * ("BN_INTAKE_OFFICER"). The two vocabularies were authored separately, so the
 * link has to be stated explicitly.
 *
 * Deliberately narrow. A step role with no confident basket equivalent is left
 * unmapped and reported, rather than routed to an approximate basket — a claim
 * sitting in the wrong officer's queue is worse than one reported as unrouted.
 * `SYSTEM` steps have no human queue by definition; `INSPECTOR` and
 * `MEDICAL_BOARD` have no basket in the catalogue at all, which the resolver
 * reports as a configuration gap instead of substituting a nearby basket.
 *
 * In practice every seeded template starts at INTAKE / CLERK, so the first
 * entry carries almost all real traffic.
 */
export const STEP_ROLE_TO_BASKET_ROLE: Record<string, string> = {
  // The vocabulary the eight seeded templates use.
  CLERK: 'BN_INTAKE_OFFICER',
  OFFICER: 'BN_ELIGIBILITY_OFFICER',
  SUPERVISOR: 'BN_SUPERVISOR',
  MANAGER: 'BN_MANAGER',
  FINANCE: 'BN_PAYMENT_OFFICER',

  // BUG-56 — the vocabulary the other 36 templates use. Creating a product
  // generates a WF-SKN-* template whose first step is CLAIMS_CLERK, so this is
  // the common case, not the edge case: 36 of 45 templates open with it.
  //
  // Each target exists in bn_workbasket and in `roles`. CLAIMS_CLERK maps to
  // BN_INTAKE_OFFICER on the evidence of the roles table itself, which
  // describes BN_INTAKE_OFFICER as "Benefits intake clerk".
  CLAIMS_CLERK: 'BN_INTAKE_OFFICER',
  CLAIMS_OFFICER: 'BN_CLAIMS_OFFICER',
  CLAIMS_SUPERVISOR: 'BN_SUPERVISOR',
  PAYMENTS_OFFICER: 'BN_PAYMENT_OFFICER',
  INTAKE_OFFICER: 'BN_INTAKE_OFFICER',
};

/**
 * Fallback owner for a workflow STEP when the product's template does not
 * declare that step.
 *
 * Most seeded templates declare only INTAKE, yet a claim genuinely moves on to
 * eligibility, calculation, decision and payment. Without this the claim would
 * sit in the intake basket for its whole life, which is the behaviour the queue
 * screens showed. This says who owns each stage by role, and the basket lookup
 * is unchanged — so a step still routes to a real, configured basket or is
 * reported as a gap.
 */
export const STEP_NAME_TO_BASKET_ROLE: Record<string, string> = {
  INTAKE: 'BN_INTAKE_OFFICER',
  EMPLOYER_VERIFY: 'BN_INTAKE_OFFICER',
  ELIGIBILITY: 'BN_ELIGIBILITY_OFFICER',
  // These roles are the ones the live workbasket catalogue actually staffs —
  // an invented role would resolve to no basket and strand the claim.
  EVIDENCE_REVIEW: 'BN_DOCUMENT_OFFICER',
  MEANS_TEST: 'BN_ELIGIBILITY_OFFICER',
  CALCULATION: 'BN_CALCULATION_OFFICER',
  DECISION: 'BN_SUPERVISOR',
  AWARD_SETUP: 'BN_AWARD_OFFICER',
  PAYMENT: 'BN_PAYMENT_OFFICER',
};

/**
 * A step, in either of the two shapes the data contains.
 *
 * BUG-56 — templates seeded before the Workflow Template Editor existed store
 * `step` / `role` / `sla_days`. The editor writes `step_code` / `step_name` /
 * `assigned_role` / `sla_hours` / `workbasket_id`, and shares not one field
 * name with them. So a template built through the UI carried the right answer
 * in fields this resolver never read: a configurator set
 * assigned_role BN_INTAKE_OFFICER and picked the Intake Review basket, and the
 * claim was still reported as having no owner because `role` said CLAIMS_CLERK.
 *
 * Both shapes are live data. Both are read.
 */
interface StepConfig {
  // Seeded shape.
  step?: string;
  role?: string;
  sla_days?: number;
  // Editor shape.
  step_code?: string;
  step_name?: string;
  assigned_role?: string;
  sla_hours?: number;
  workbasket_id?: string | null;
}

/** The step's name, whichever field carries it. */
function stepNameOf(step: StepConfig | null | undefined): string | null {
  const v = step?.step ?? step?.step_code ?? step?.step_name ?? null;
  const t = String(v ?? '').trim();
  return t === '' ? null : t;
}

/** The step's role, whichever field carries it. */
function stepRoleOf(step: StepConfig | null | undefined): string | null {
  const v = step?.role ?? step?.assigned_role ?? null;
  const t = String(v ?? '').trim();
  return t === '' ? null : t;
}

/** The step's SLA in days. `sla_hours` is converted, rounding up. */
function stepSlaDays(step: StepConfig | null | undefined): number | null {
  const days = step?.sla_days;
  if (typeof days === 'number' && Number.isFinite(days)) return days;
  const hours = step?.sla_hours;
  if (typeof hours === 'number' && Number.isFinite(hours) && hours > 0) {
    return Math.ceil(hours / 24);
  }
  return null;
}

/** The basket the step names outright, if any. */
function stepWorkbasketId(step: StepConfig | null | undefined): string | null {
  const t = String(step?.workbasket_id ?? '').trim();
  return t === '' ? null : t;
}

/** All steps of a template's `steps_config`, tolerating the shapes seen in data. */
export function allSteps(stepsConfig: unknown): StepConfig[] {
  const asArray = (v: unknown): StepConfig[] =>
    Array.isArray(v)
      ? v.filter((s): s is StepConfig => !!s && typeof s === 'object')
      : [];
  if (Array.isArray(stepsConfig)) return asArray(stepsConfig);
  if (stepsConfig && typeof stepsConfig === 'object') {
    return asArray((stepsConfig as Record<string, unknown>).steps);
  }
  return [];
}

/** First step of a template's `steps_config`, tolerating the shapes seen in data. */
export function firstStep(stepsConfig: unknown): StepConfig | null {
  return allSteps(stepsConfig)[0] ?? null;
}

/**
 * The step with this name, if the template declares it.
 *
 * BUG-58 -- a step's name lives under two field names, and the two halves of
 * routing spoke different ones. `claimStatusStepMap` asks in the current
 * vocabulary (DECISION, MEANS_TEST, EVIDENCE_REVIEW, AWARD_SETUP); templates
 * built in the editor keep that in `step_code` while `step` holds the legacy
 * name (APPROVAL, VERIFICATION, PAYMENT_AUTH). Matching through stepNameOf()
 * consulted `step` first and stopped there, so a step the template plainly
 * declared was reported absent. The caller then synthesised a step from the
 * name alone, discarding the configurator's `assigned_role` AND their chosen
 * `workbasket_id`, and routed from the generic STEP_NAME_TO_BASKET_ROLE table
 * instead. Measured on live data: 10 steps across 3 templates, 7 wrong routes,
 * and WF-EIB-STAFF-01's MEDICAL_REVIEW step reached no basket at all.
 *
 * The passes are ORDERED, not merged. `step_code` is authoritative because it
 * is the vocabulary the caller speaks; `step` is the legacy fallback that keeps
 * the eight seeded templates working unchanged. Merging them would be
 * ambiguous -- WF-EIB-STAFF-01 carries ELIGIBILITY as one step's `step` and a
 * different step's `step_code`, and only the latter is the eligibility
 * assessment.
 *
 * stepNameOf() is deliberately left alone: it feeds display and audit text,
 * and BUG-02 settled that the screen shows what the administrator configured.
 */
export function stepByName(stepsConfig: unknown, stepName: string | null | undefined): StepConfig | null {
  const target = String(stepName ?? '').trim().toUpperCase();
  if (!target) return null;
  const steps = allSteps(stepsConfig);
  for (const field of ['step_code', 'step', 'step_name'] as const) {
    const hit = steps.find(
      (s) => String(s?.[field] ?? '').trim().toUpperCase() === target,
    );
    if (hit) return hit;
  }
  return null;
}

/**
 * Maps a workflow step role onto a workbasket role. A role that already looks
 * like a basket role is used as-is, so a template authored against the BN
 * vocabulary needs no table entry.
 */
export function basketRoleForStepRole(stepRole: string | null | undefined): string | null {
  const role = String(stepRole ?? '').trim().toUpperCase();
  if (!role) return null;
  if (role.startsWith('BN_')) return role;
  return STEP_ROLE_TO_BASKET_ROLE[role] ?? null;
}


function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export async function resolveClaimWorkbasket(params: {
  productVersionId: string | null;
  channelCode: string | null;
  /** Restricts the basket search to a product category when the product sets one. */
  productCategory?: string | null;
  assignedAt?: string;
  /**
   * Workflow step that owns the claim now (from its status). Omitted at intake,
   * where the template's first step is the answer.
   */
  targetStep?: string | null;
}): Promise<ResolvedClaimWorkbasket> {
  const { productVersionId, channelCode, targetStep } = params;
  if (!productVersionId) return NONE('claim has no product version');

  const resolved = await resolveProductWorkflow(productVersionId, channelCode);
  if (!resolved.workflowTemplateId) {
    return NONE(
      'no workflow template is mapped to this product version and channel, ' +
      'so the product does not say which queue this claim belongs in',
    );
  }

  const { data: template, error: templateError } = await db
    .from('bn_workflow_template')
    .select('id, template_code, steps_config, is_executable')
    .eq('id', resolved.workflowTemplateId)
    .maybeSingle();
  if (templateError) return NONE(`could not read workflow template — ${templateError.message}`);
  if (!template) return NONE('the mapped workflow template no longer exists');

  // A named target step is honoured even when the template omits it: the step
  // still has a known owning role, and routing a claim by the stage it has
  // actually reached beats leaving it in the intake basket for its whole life.
  const declaredStep = targetStep
    ? stepByName((template as any).steps_config, targetStep)
    : firstStep((template as any).steps_config);

  const step = declaredStep ?? (targetStep ? { step: targetStep } : null);
  if (!step) {
    return NONE(
      `workflow template ${(template as any).template_code} has no steps configured, ` +
      'so it does not name a first owner',
    );
  }

  const stepName = stepNameOf(step) ?? targetStep ?? null;
  const stepRole = stepRoleOf(step);

  // BUG-56 — a basket named on the step is a choice, not a hint. The
  // configurator picked it from the dropdown the editor offers; deriving one
  // from the role instead would overrule them.
  const namedBasketId = stepWorkbasketId(step);
  if (namedBasketId) {
    const { data: named, error: namedError } = await db
      .from('bn_workbasket')
      .select('id, basket_code, basket_name, assigned_role, is_active')
      .eq('id', namedBasketId)
      .maybeSingle();
    if (namedError) {
      return NONE(`could not read the workbasket named on this step — ${namedError.message}`);
    }
    if (named && (named as any).is_active !== false) {
      const slaFromStep = stepSlaDays(step);
      const at = params.assignedAt ?? new Date().toISOString();
      return {
        workbasketId: (named as any).id,
        workbasketName: (named as any).basket_name ?? (named as any).basket_code ?? null,
        source: 'WORKFLOW_FIRST_STEP',
        stepName,
        stepRole,
        basketRole: (named as any).assigned_role ?? null,
        slaDays: slaFromStep,
        dueAt: slaFromStep !== null ? addDays(at, slaFromStep) : null,
        reason: null,
      };
    }
    // Named but missing or inactive: say so rather than quietly falling back to
    // the role, which would hide a configuration fault behind a lucky guess.
    return {
      ...NONE(
        `workflow step "${stepName ?? 'unnamed'}" names workbasket ${namedBasketId}, ` +
        'which does not exist or is not active',
      ),
      stepName,
      stepRole,
    };
  }

  const basketRole =
    basketRoleForStepRole(stepRole) ??
    STEP_NAME_TO_BASKET_ROLE[String(stepName ?? '').trim().toUpperCase()] ??
    null;
  if (!basketRole) {
    return {
      ...NONE(
        `workflow step "${stepName ?? 'unnamed'}" is assigned to role ` +
        `"${stepRole ?? 'none'}", which has no matching workbasket role`,

      ),
      stepName,
      stepRole,
    };
  }

  // Prefer a basket restricted to this product's category, then a general one.
  const { data: baskets, error: basketError } = await db
    .from('bn_workbasket')
    .select('id, basket_code, basket_name, assigned_role, product_category')
    .eq('assigned_role', basketRole)
    .eq('is_active', true);
  if (basketError) return NONE(`could not read workbaskets — ${basketError.message}`);

  const candidates: any[] = Array.isArray(baskets) ? baskets : [];
  if (candidates.length === 0) {
    return {
      ...NONE(`no active workbasket is assigned to role "${basketRole}"`),
      stepName,
      stepRole,
      basketRole,
    };
  }

  const category = (params.productCategory ?? '').trim().toUpperCase();
  const byCategory = category
    ? candidates.filter((b) => String(b.product_category ?? '').toUpperCase() === category)
    : [];
  const general = candidates.filter((b) => !b.product_category);
  // Deterministic pick: category-specific first, then general, then lowest code.
  const pool = byCategory.length > 0 ? byCategory : general.length > 0 ? general : candidates;
  const basket = [...pool].sort((a, b) =>
    String(a.basket_code).localeCompare(String(b.basket_code)),
  )[0];

  const slaDays = stepSlaDays(step);
  const assignedAt = params.assignedAt ?? new Date().toISOString();

  return {
    workbasketId: basket.id,
    workbasketName: basket.basket_name ?? basket.basket_code ?? null,
    source: 'WORKFLOW_FIRST_STEP',
    stepName,
    stepRole,
    basketRole,
    slaDays,
    dueAt: slaDays !== null ? addDays(assignedAt, slaDays) : null,
    reason: null,
  };
}
