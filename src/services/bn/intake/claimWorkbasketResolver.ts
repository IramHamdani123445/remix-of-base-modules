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
  /** The step names its own workbasket_id — the most explicit configuration. */
  | 'STEP_WORKBASKET'
  /** The step names an assigned_role that a live basket carries. */
  | 'STEP_ASSIGNED_ROLE'
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
  CLERK: 'BN_INTAKE_OFFICER',
  OFFICER: 'BN_ELIGIBILITY_OFFICER',
  SUPERVISOR: 'BN_SUPERVISOR',
  MANAGER: 'BN_MANAGER',
  FINANCE: 'BN_PAYMENT_OFFICER',
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

interface StepConfig {
  step?: string;
  /** Alias spellings seen in authored templates. */
  step_code?: string;
  step_name?: string;
  role?: string;
  /** BN_* role authored directly on the step; preferred over `role`. */
  assigned_role?: string;
  /** Basket chosen explicitly for this step in the workflow designer. */
  workbasket_id?: string;
  sla_days?: number;
  sla_hours?: number;
}

/** Every name a step answers to: `step`, `step_code`, `step_name`. */
function stepAliases(s: StepConfig): string[] {
  return [s.step, s.step_code, s.step_name]
    .map((v) => String(v ?? '').trim().toUpperCase())
    .filter(Boolean);
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
 * The step with this name, if the template declares it. Templates authored in
 * the designer put the routing vocabulary under `step_code`/`step_name` and a
 * human label under `step`, so all three are matched.
 */
export function stepByName(stepsConfig: unknown, stepName: string | null | undefined): StepConfig | null {
  const target = String(stepName ?? '').trim().toUpperCase();
  if (!target) return null;
  return allSteps(stepsConfig).find((s) => stepAliases(s).includes(target)) ?? null;
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

function addHours(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * 3_600_000).toISOString();
}

/**
 * A step's SLA. Templates authored in the designer carry `sla_hours` only, so
 * reading `sla_days` alone left those assignments with no deadline at all.
 */
function slaFromStep(step: StepConfig): {
  slaDays: number | null;
  dueAt: (assignedAt: string) => string | null;
} {
  const days = typeof step.sla_days === 'number' && Number.isFinite(step.sla_days) ? step.sla_days : null;
  const hours = typeof step.sla_hours === 'number' && Number.isFinite(step.sla_hours) ? step.sla_hours : null;
  if (days !== null) {
    return { slaDays: days, dueAt: (at) => addDays(at, days) };
  }
  if (hours !== null) {
    return { slaDays: hours / 24, dueAt: (at) => addHours(at, hours) };
  }
  return { slaDays: null, dueAt: () => null };
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

  const stepName = step.step ?? targetStep ?? null;
  const stepRole = step.assigned_role ?? step.role ?? null;
  const assignedAtIso = params.assignedAt ?? new Date().toISOString();
  const sla = slaFromStep(step);

  // 1. The step names its own basket — the most explicit configuration there is.
  const explicitBasketId = String(step.workbasket_id ?? '').trim();
  if (explicitBasketId) {
    const { data: explicit, error: explicitError } = await db
      .from('bn_workbasket')
      .select('id, basket_code, basket_name, assigned_role, is_active')
      .eq('id', explicitBasketId)
      .maybeSingle();
    if (explicitError) return NONE(`could not read workbaskets — ${explicitError.message}`);
    if (explicit && explicit.is_active !== false) {
      return {
        workbasketId: explicit.id,
        workbasketName: explicit.basket_name ?? explicit.basket_code ?? null,
        source: 'STEP_WORKBASKET',
        stepName,
        stepRole,
        basketRole: explicit.assigned_role ?? null,
        slaDays: sla.slaDays,
        dueAt: sla.dueAt(assignedAtIso),
        reason: null,
      };
    }
    // Falls through to role-based resolution when the basket is gone or inactive.
  }

  // 2. assigned_role / role, then the step-name fallback table.
  const basketRole =
    basketRoleForStepRole(stepRole) ??
    STEP_NAME_TO_BASKET_ROLE[String(stepName ?? '').trim().toUpperCase()] ??
    STEP_NAME_TO_BASKET_ROLE[String(step.step_code ?? '').trim().toUpperCase()] ??
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

  return {
    workbasketId: basket.id,
    workbasketName: basket.basket_name ?? basket.basket_code ?? null,
    source: stepRole && basketRoleForStepRole(stepRole) ? 'STEP_ASSIGNED_ROLE' : 'WORKFLOW_FIRST_STEP',
    stepName,
    stepRole,
    basketRole,
    slaDays: sla.slaDays,
    dueAt: sla.dueAt(assignedAtIso),
    reason: null,
  };
}
