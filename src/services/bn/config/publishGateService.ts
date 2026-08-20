/**
 * BN Product Version — Publish Gate
 *
 * Single authoritative gate that MUST be called before flipping a
 * bn_product_version to ACTIVE (publish) or pushing a config change
 * that would affect a live product version.
 *
 * It composes the checks so callers don't have to remember to run them
 * individually:
 *
 *   0. Version substance — at least one active eligibility rule and one
 *      active formula binding. Blocks. (BUG-02)
 *   1. Cross-tab conflict detection  → ERROR-level conflicts block.
 *   2. Channel readiness (staff/public) → disabled channels are OK;
 *      mis-configured enabled channels block.
 *   3. Baseline configuration validation (when the version's product
 *      maps to a known SKN baseline) → FAIL items block, WARNING does not.
 *
 * Returns a structured report. `ok=false` means publish MUST be refused;
 * callers should surface `errors` to the user verbatim and offer a link
 * back to the relevant Product Catalog tab.
 */
import { hasBlockingConflicts, detectProductVersionConflicts } from './conflictDetectionService';
import { checkPublicReadiness, checkStaffReadiness } from '../productAcceptanceService';
import { checkLegalReadiness, type LegalIssue } from './legalReadinessService';
import { supabase } from '@/integrations/supabase/client';

const db = supabase as any;

export interface PublishGateReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  details: {
    conflicts?: { errors: number; warnings: number };
    publicChannel?: { ok: boolean; issues: string[] };
    staffChannel?: { ok: boolean; issues: string[] };
    baseline?: { status: string; failures: string[] };
    legal?: { ok: boolean; blocking: LegalIssue[]; warnings: LegalIssue[]; total_rules: number };
    substance?: { eligibilityRules: number; formulaBindings: number };
  };
}

/**
 * BUG-02 — a version must actually contain something before it can go live.
 *
 * Publishing a version with every eligibility rule deleted used to succeed.
 * The legal/coverage gate inspects each rule in turn, so with no rules it found
 * no problems and reported success; nothing else required rules to exist. The
 * baseline check would have caught it, but runs only for products whose code
 * matches a built-in SKN baseline — so for any product created in the
 * application it never ran at all. Deleting all the rules was therefore the
 * easiest way to get past the publish checks, which is exactly backwards.
 *
 * A version with no eligibility rules passes every claim without a single
 * check. A version with no formula binding cannot calculate an amount at all —
 * the Calculation screen already warns that every calculation will fail, so
 * publishing in that state must not be allowed either.
 *
 * Deliberately NOT wrapped in a try/catch that downgrades to a warning, as the
 * checks above are. If we cannot count the rules we cannot claim the version is
 * safe, and a gate that passes when it fails to run is not a gate.
 */
async function checkVersionHasSubstance(versionId: string): Promise<{
  errors: string[];
  eligibilityRules: number;
  formulaBindings: number;
}> {
  const errors: string[] = [];

  const { count: ruleCount, error: ruleError } = await db
    .from('bn_eligibility_rule')
    .select('id', { count: 'exact', head: true })
    .eq('product_version_id', versionId)
    .eq('is_active', true);
  if (ruleError) {
    throw new Error(`could not count eligibility rules — ${ruleError.message}`);
  }

  const { count: bindingCount, error: bindingError } = await db
    .from('bn_product_formula_binding')
    .select('id', { count: 'exact', head: true })
    .eq('product_version_id', versionId)
    .eq('is_active', true);
  if (bindingError) {
    throw new Error(`could not count formula bindings — ${bindingError.message}`);
  }

  const rules = ruleCount ?? 0;
  const bindings = bindingCount ?? 0;

  if (rules === 0) {
    errors.push(
      'This version has no active eligibility rules. Every claim would pass eligibility ' +
      'without any check. Add at least one rule on the Eligibility tab before publishing.',
    );
  }
  if (bindings === 0) {
    errors.push(
      'This version has no active formula binding, so no benefit amount can be calculated. ' +
      'Bind an ACTIVE formula version on the Calculation tab before publishing.',
    );
  }

  return { errors, eligibilityRules: rules, formulaBindings: bindings };
}


export async function assertSafeToPublish(versionId: string): Promise<PublishGateReport> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const details: PublishGateReport['details'] = {};

  // 0. The version must contain rules and a formula binding at all. Checked
  //    first: if there is nothing in the version, the more detailed checks
  //    below have nothing to inspect and would each report success.
  try {
    const substance = await checkVersionHasSubstance(versionId);
    details.substance = {
      eligibilityRules: substance.eligibilityRules,
      formulaBindings: substance.formulaBindings,
    };
    errors.push(...substance.errors);
  } catch (e) {
    // A check that could not run must block, not warn.
    errors.push(
      `Cannot confirm this version has eligibility rules and a formula binding: ${(e as Error).message}. ` +
      `Publishing is refused until the check can run.`,
    );
  }

  // 1. Cross-tab conflicts
  try {
    const report = await detectProductVersionConflicts(versionId);
    details.conflicts = { errors: report.errors, warnings: report.warnings };
    if (report.errors > 0) {
      errors.push(
        `Cross-tab conflict detection found ${report.errors} ERROR(s). Resolve them on the Product Editor before publishing.`,
      );
    }
    if (report.warnings > 0) {
      warnings.push(`${report.warnings} cross-tab warning(s) present (publish allowed).`);
    }
  } catch (e) {
    warnings.push(`Conflict detection skipped: ${(e as Error).message}`);
  }

  // 2. Channel readiness
  try {
    const pub = await checkPublicReadiness(versionId);
    details.publicChannel = { ok: pub.ok, issues: pub.issues };
    if (pub.config?.is_enabled && !pub.ok) {
      errors.push(`Public/online channel is enabled but not ready: ${pub.issues.join('; ')}`);
    }
  } catch (e) {
    warnings.push(`Public readiness check failed: ${(e as Error).message}`);
  }

  try {
    const staff = await checkStaffReadiness(versionId);
    details.staffChannel = { ok: staff.ok, issues: staff.issues };
    if (staff.config?.is_enabled && !staff.ok) {
      errors.push(`Staff/offline channel is enabled but not ready: ${staff.issues.join('; ')}`);
    }
  } catch (e) {
    warnings.push(`Staff readiness check failed: ${(e as Error).message}`);
  }

  // 3. Baseline validation (best-effort — only when product matches a SKN baseline code)
  try {
    const { data: ver } = await db
      .from('bn_product_version')
      .select('product_id, bn_product:product_id(benefit_code)')
      .eq('id', versionId)
      .maybeSingle();
    const code = ver?.bn_product?.benefit_code;
    if (code) {
      const { SKN_BENEFIT_BASELINE } = await import('../skn/sknBenefitCatalogueBaseline');
      const baseline = SKN_BENEFIT_BASELINE.find((b: any) => b.benefit_code === code);
      if (baseline) {
        const { validateProduct } = await import('../configurationValidationService');
        const report = await validateProduct(baseline, { productVersionId: versionId });
        const failures = Object.entries(report)
          .filter(([_, v]: any) => v && typeof v === 'object' && v.status === 'FAIL')
          .map(([k]) => k);
        details.baseline = { status: report.overall_status, failures };
        if (failures.length > 0) {
          errors.push(
            `Configuration Validation reported FAIL on the selected version: ${failures.join(', ')}. Fix the listed Product Editor tabs before approving/publishing.`,
          );
        }
      }
    }
  } catch (e) {
    warnings.push(`Baseline validation skipped: ${(e as Error).message}`);
  }

  // 4. Legal / legislative readiness — every active eligibility rule must be
  // backed by a legislative reference, CONFIRMED confidence, implemented fact,
  // threshold, complete derived snapshot metadata, and deceased-aware resolver
  // where applicable.
  try {
    const legal = await checkLegalReadiness(versionId);
    details.legal = legal;
    if (legal.blocking.length > 0) {
      const grouped = legal.blocking
        .slice(0, 5)
        .map((i) => `${i.rule_code}: ${i.message}`)
        .join('; ');
      const extra = legal.blocking.length > 5 ? ` (+${legal.blocking.length - 5} more)` : '';
      errors.push(
        `Legal/coverage gate found ${legal.blocking.length} blocking issue(s): ${grouped}${extra}. Open Rule Catalogue → Coverage to resolve.`,
      );
    }
    if (legal.warnings.length > 0) {
      warnings.push(`${legal.warnings.length} legal/coverage warning(s) present.`);
    }
  } catch (e) {
    warnings.push(`Legal readiness check skipped: ${(e as Error).message}`);
  }

  return { ok: errors.length === 0, errors, warnings, details };
}


/** Convenience: same gate but only the boolean answer. */
export async function isSafeToPublish(versionId: string): Promise<boolean> {
  if (await hasBlockingConflicts(versionId)) return false;
  const r = await assertSafeToPublish(versionId);
  return r.ok;
}
