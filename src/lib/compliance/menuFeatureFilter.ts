/**
 * Compliance menu feature-flag filter (Phase 1 — runtime visibility).
 *
 * Hides Compliance menu items whose route is gated by a DB feature flag
 * that is OFF. Direct URL access is still protected by ComplianceFeatureGate
 * (renders <FeatureDisabled />) — this is purely sidebar visibility.
 *
 * Rules (Phase 1 only):
 *   - /compliance/violations/verification-queue → compliance.core.verification_queue
 *   - /compliance/arrangements (and any /compliance/arrangements/*) → compliance.payment.arrangement
 *   - /compliance/admin/automation/jobs → compliance.risk.automation_jobs
 *   - /compliance/reports/automation-jobs → compliance.risk.automation_jobs
 *
 * Setup control-plane pages (Feature Toggles, Feature Toggle Diagnostics,
 * automation history, employer-jobs reference, etc.) are NOT in the rule
 * list and remain visible.
 *
 * Fail-open: if the DB flag cache hasn't loaded yet we don't hide anything,
 * matching the helper behaviour in featureToggles.ts.
 */
import { hasComplianceDbFlagsLoaded, getComplianceDbFlag } from './featureFlagCache';

interface MenuItemLike {
  id?: string;
  title: string;
  url?: string;
  subItems?: MenuItemLike[];
}

export interface Rule {
  prefix: string;
  flag: string;
}

export const COMPLIANCE_FEATURE_FLAG_RULES: Rule[] = [
  // Phase 1
  { prefix: '/compliance/violations/verification-queue', flag: 'compliance.core.verification_queue' },
  { prefix: '/compliance/arrangements', flag: 'compliance.payment.arrangement' },
  { prefix: '/compliance/admin/automation/jobs', flag: 'compliance.risk.automation_jobs' },
  { prefix: '/compliance/reports/automation-jobs', flag: 'compliance.risk.automation_jobs' },
  // Phase 2 — Core Case Flow
  { prefix: '/compliance/cases/merge-review', flag: 'compliance.core.case_merge' },
  { prefix: '/compliance/cases/reopen-requests', flag: 'compliance.core.case_reopen' },
  { prefix: '/compliance/notices/pending-approval', flag: 'compliance.core.notice_approval' },
  { prefix: '/compliance/cases/closure', flag: 'compliance.core.case_closure_approval' },
  // Phase 2 — Payment & Recovery
  { prefix: '/compliance/enforcement/waivers', flag: 'compliance.payment.waiver_requests' },
  { prefix: '/compliance/waivers', flag: 'compliance.payment.waiver_requests' },
  // Phase 2 — Inspection
  { prefix: '/compliance/field/execution', flag: 'compliance.inspection.field' },
  { prefix: '/compliance/field/inspections', flag: 'compliance.inspection.field' },
  { prefix: '/compliance/field/operations', flag: 'compliance.inspection.field' },
  { prefix: '/compliance/field/employer-statements', flag: 'compliance.inspection.field' },
  { prefix: '/compliance/field/findings', flag: 'compliance.inspection.field' },
  { prefix: '/compliance/field/visit', flag: 'compliance.inspection.field' },
  { prefix: '/compliance/field/plan-builder', flag: 'compliance.inspection.planning' },
  { prefix: '/compliance/field/my-plans', flag: 'compliance.inspection.planning' },
  { prefix: '/compliance/field/approval-inbox', flag: 'compliance.inspection.planning' },
  { prefix: '/compliance/field/pending-review', flag: 'compliance.inspection.planning' },
  { prefix: '/compliance/field/revisions-pending', flag: 'compliance.inspection.planning' },
  { prefix: '/compliance/inspections/evidence', flag: 'compliance.inspection.evidence' },
  { prefix: '/compliance/inspections/convert-finding', flag: 'compliance.inspection.convert_finding' },
  // Phase 2 — Legal
  { prefix: '/compliance/enforcement/legal-referral', flag: 'compliance.legal.handoff' },
  { prefix: '/compliance/enforcement/recommendation-queue', flag: 'compliance.legal.handoff' },
  { prefix: '/compliance/legal/approved-escalations', flag: 'compliance.legal.handoff' },
  { prefix: '/compliance/legal/pack-preparation', flag: 'compliance.legal.pack_generation' },
  { prefix: '/compliance/enforcement/proceedings', flag: 'compliance.legal.court_monitoring' },
  { prefix: '/compliance/reports/legal/court-status', flag: 'compliance.legal.court_monitoring' },
  { prefix: '/compliance/legal/returned-from-legal', flag: 'compliance.legal.returned_handling' },
  // Phase 2 — Risk & Automation
  { prefix: '/compliance/risk', flag: 'compliance.risk.scoring' },
  { prefix: '/compliance/admin/tools/rule-simulator', flag: 'compliance.risk.rule_simulator' },
  { prefix: '/compliance/tools/rule-simulator', flag: 'compliance.risk.rule_simulator' },
  { prefix: '/compliance/admin/tools/risk-simulator', flag: 'compliance.risk.risk_simulator' },
  { prefix: '/compliance/tools/risk-simulator', flag: 'compliance.risk.risk_simulator' },
];

function normalizeRoute(url?: string): string {
  if (!url) return '';
  let p = url.trim();
  if (/^https?:\/\//i.test(p)) {
    try { p = new URL(p).pathname; } catch { /* noop */ }
  }
  return p.replace(/\/+$/, '');
}

/** Returns true when the URL is blocked by an OFF feature flag. */
function isUrlDisabledByFlag(url?: string): boolean {
  const norm = normalizeRoute(url);
  if (!norm) return false;
  for (const r of COMPLIANCE_FEATURE_FLAG_RULES) {
    if (norm === r.prefix || norm.startsWith(r.prefix + '/')) {
      const v = getComplianceDbFlag(r.flag);
      if (v === false) return true;
    }
  }
  return false;
}

export function filterComplianceMenuByFeatureFlags<T extends MenuItemLike>(items: T[]): T[] {
  if (!hasComplianceDbFlagsLoaded()) return items;

  const walk = (node: T): T | null => {
    if (isUrlDisabledByFlag(node.url)) return null;

    if (node.subItems && node.subItems.length > 0) {
      const kept = node.subItems
        .map((c) => walk(c as T))
        .filter((c): c is T => c !== null);

      // Drop empty groups (no surviving children AND no own destination URL)
      if (kept.length === 0 && !node.url) return null;

      return { ...node, subItems: kept };
    }

    return node;
  };

  return items.map(walk).filter((n): n is T => n !== null);
}
