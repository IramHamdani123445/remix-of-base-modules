/**
 * Compliance & Enforcement — Capability Model
 *
 * Replaces the single `manage_compliance` permission gate with capability bundles
 * mapped to operational roles. During Phase 1 every capability falls back to
 * `manage_compliance` so existing users lose nothing while admins gradually
 * reassign users to the new roles.
 */

export type ComplianceOperationalRole = 'inspector' | 'senior' | 'head' | 'other';

export const COMPLIANCE_CAPABILITIES = {
  FIELD_EXECUTE: 'compliance.field.execute',
  FIELD_PLAN: 'compliance.field.plan',
  FIELD_APPROVE_PLANS: 'compliance.field.approve_plans',
  FIELD_REPORT: 'compliance.field.report',
  FIELD_APPROVE_REPORTS: 'compliance.field.approve_reports',
  FIELD_SAMPLING: 'compliance.field.sampling',
  VIOLATIONS_MANAGE: 'compliance.violations.manage',
  VIOLATIONS_LINK_TO_CASE: 'compliance.violations.link_to_case',
  CASES_MANAGE: 'compliance.cases.manage',
  ENFORCEMENT_NOTICES: 'compliance.enforcement.notices',
  ENFORCEMENT_ARRANGEMENTS: 'compliance.enforcement.arrangements',
  ENFORCEMENT_LEGAL: 'compliance.enforcement.legal',
  PARTIAL_PAYMENT_REQUEST: 'compliance.partial_payment.request',
  PARTIAL_PAYMENT_APPROVE: 'compliance.partial_payment.approve',
  WORKBENCH_TEAM: 'compliance.workbench.team',
  WORKBENCH_ENTERPRISE: 'compliance.workbench.enterprise',
  REPORTS_OPERATIONAL: 'compliance.reports.operational',
  REPORTS_ANALYTICS: 'compliance.reports.analytics',
} as const;

export type ComplianceCapability =
  (typeof COMPLIANCE_CAPABILITIES)[keyof typeof COMPLIANCE_CAPABILITIES];

/** Capability bundle granted to each operational role. */
export const ROLE_CAPABILITIES: Record<ComplianceOperationalRole, ComplianceCapability[]> = {
  inspector: [
    COMPLIANCE_CAPABILITIES.FIELD_EXECUTE,
    COMPLIANCE_CAPABILITIES.FIELD_PLAN,
    COMPLIANCE_CAPABILITIES.FIELD_REPORT,
    COMPLIANCE_CAPABILITIES.VIOLATIONS_MANAGE,
    COMPLIANCE_CAPABILITIES.CASES_MANAGE,
    COMPLIANCE_CAPABILITIES.ENFORCEMENT_NOTICES,
    COMPLIANCE_CAPABILITIES.PARTIAL_PAYMENT_REQUEST,
    COMPLIANCE_CAPABILITIES.REPORTS_OPERATIONAL,
  ],
  senior: [
    COMPLIANCE_CAPABILITIES.FIELD_EXECUTE,
    COMPLIANCE_CAPABILITIES.FIELD_PLAN,
    COMPLIANCE_CAPABILITIES.FIELD_APPROVE_PLANS,
    COMPLIANCE_CAPABILITIES.FIELD_REPORT,
    COMPLIANCE_CAPABILITIES.FIELD_APPROVE_REPORTS,
    COMPLIANCE_CAPABILITIES.FIELD_SAMPLING,
    COMPLIANCE_CAPABILITIES.VIOLATIONS_MANAGE,
    COMPLIANCE_CAPABILITIES.VIOLATIONS_LINK_TO_CASE,
    COMPLIANCE_CAPABILITIES.CASES_MANAGE,
    COMPLIANCE_CAPABILITIES.ENFORCEMENT_NOTICES,
    COMPLIANCE_CAPABILITIES.ENFORCEMENT_ARRANGEMENTS,
    COMPLIANCE_CAPABILITIES.ENFORCEMENT_LEGAL,
    COMPLIANCE_CAPABILITIES.PARTIAL_PAYMENT_REQUEST,
    COMPLIANCE_CAPABILITIES.PARTIAL_PAYMENT_APPROVE,
    COMPLIANCE_CAPABILITIES.WORKBENCH_TEAM,
    COMPLIANCE_CAPABILITIES.REPORTS_OPERATIONAL,
  ],
  head: Object.values(COMPLIANCE_CAPABILITIES),
  other: [],
};

/** Phase-1 fallback: every capability resolves to `manage_compliance` for now. */
export const LEGACY_PERMISSION_FALLBACK = 'manage_compliance';

export function hasCapability(
  role: ComplianceOperationalRole,
  capability: ComplianceCapability,
): boolean {
  return ROLE_CAPABILITIES[role]?.includes(capability) ?? false;
}
