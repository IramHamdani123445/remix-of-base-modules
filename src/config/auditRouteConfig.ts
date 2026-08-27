/**
 * Single Source of Truth for Internal Audit Module Routes
 * Simplified for Department Function Audit System
 */

export interface AuditRouteEntry {
  moduleKey: string;
  label: string;
  path: string;
  permission: string;
  enabled: boolean;
  category: 'dashboard' | 'reference' | 'risk' | 'planning' | 'execution' | 'followup' | 'reports' | 'configuration';
  component: string;
}

export const AUDIT_FEATURE_FLAGS = {
  // Core simplified flags — only 10 modules enabled
  FEATURE_AUDIT_DASHBOARD: true,
  FEATURE_AUDIT_DEPARTMENT_MASTER: true,
  FEATURE_AUDIT_FUNCTION_MASTER: true,
  FEATURE_AUDIT_RISK_ASSESSMENT: true,
  FEATURE_AUDIT_RISK_MATRIX: true,
  FEATURE_AUDIT_PLANS: true,
  FEATURE_AUDIT_ENGAGEMENTS: true, // "Audits"
  FEATURE_AUDIT_FINDINGS: false,
  FEATURE_AUDIT_ACTION_TRACKING: true,
  FEATURE_AUDIT_REPORTS: true,

  // Disabled enterprise features
  FEATURE_AUDIT_AUDITOR_PROFILES: true,
  FEATURE_AUDIT_WORKLOAD_CAPACITY: true,
  FEATURE_AUDIT_LEAVE_MANAGEMENT: true,
  FEATURE_AUDIT_HOLIDAY_MANAGEMENT: false, // consolidated into Global Settings
  FEATURE_AUDIT_PLAN_APPROVAL: true,
  FEATURE_AUDIT_ACTIVITY_CALENDAR: false,
  FEATURE_AUDIT_ACTIVITY_WORKBENCH: false,
  FEATURE_AUDIT_EVIDENCE_MANAGEMENT: false,
  FEATURE_AUDIT_WORKING_PAPERS: false,
  FEATURE_AUDIT_MANAGEMENT_RESPONSES: false,
  FEATURE_AUDIT_FOLLOWUP_TRACKER: false,
  FEATURE_AUDIT_PLAN_CLOSEOUT: false,
  FEATURE_AUDIT_LETTER_GENERATION: false,
  FEATURE_AUDIT_REPORT_BUILDER: false,
  FEATURE_AUDIT_COMMUNICATION_CENTER: false,
  FEATURE_AUDIT_SYSTEM_CONFIG: true,
  FEATURE_AUDIT_TEMPLATES: false,
  FEATURE_AUDIT_PROGRAMS: false,
  FEATURE_AUDIT_RCM: false,
  FEATURE_AUDIT_CONTROL_TESTING: false,
  FEATURE_AUDIT_TIME_TRACKING: true,
  FEATURE_AUDIT_QUALITY_REVIEW: false,
  FEATURE_AUDIT_EXECUTIVE_DASHBOARD: false,
  FEATURE_AUDIT_COMMITTEE_REPORTS: false,
  FEATURE_AUDIT_SLA_RULES: false,
  FEATURE_AUDIT_PREPARATION: false,
} as const;

export type AuditFeatureFlag = keyof typeof AUDIT_FEATURE_FLAGS;

export function isAuditFeatureEnabled(flag: AuditFeatureFlag): boolean {
  return AUDIT_FEATURE_FLAGS[flag] ?? false;
}

export function getFeatureFlagForModule(moduleKey: string): AuditFeatureFlag | null {
  const entry = auditRouteConfig.find(r => r.moduleKey === moduleKey);
  if (!entry) return null;
  const flagKey = `FEATURE_AUDIT_${moduleKey.toUpperCase().replace(/-/g, '_')}` as AuditFeatureFlag;
  return flagKey in AUDIT_FEATURE_FLAGS ? flagKey : null;
}

export const auditRouteConfig: AuditRouteEntry[] = [
  // ===== Dashboard =====
  { moduleKey: 'dashboard', label: 'Dashboard', path: '/audit/dashboard', permission: 'view_audit_assignments', enabled: AUDIT_FEATURE_FLAGS.FEATURE_AUDIT_DASHBOARD, category: 'dashboard', component: 'AuditDashboard' },

  // ===== Reference Data =====
  { moduleKey: 'department-master', label: 'Departments', path: '/audit/departments', permission: 'configure_audit_system', enabled: AUDIT_FEATURE_FLAGS.FEATURE_AUDIT_DEPARTMENT_MASTER, category: 'reference', component: 'DepartmentMaster' },
  { moduleKey: 'function-master', label: 'Business Functions', path: '/audit/functions', permission: 'configure_audit_system', enabled: AUDIT_FEATURE_FLAGS.FEATURE_AUDIT_FUNCTION_MASTER, category: 'reference', component: 'FunctionMaster' },

  // ===== Risk =====
  { moduleKey: 'risk-assessment', label: 'Risk Assessment', path: '/audit/risk-assessment', permission: 'configure_audit_system', enabled: AUDIT_FEATURE_FLAGS.FEATURE_AUDIT_RISK_ASSESSMENT, category: 'risk', component: 'RiskAssessment' },
  { moduleKey: 'risk-matrix', label: 'Risk Matrix', path: '/audit/risk-matrix', permission: 'view_audit_assignments', enabled: AUDIT_FEATURE_FLAGS.FEATURE_AUDIT_RISK_MATRIX, category: 'risk', component: 'RiskMatrix' },

  // ===== Planning =====
  { moduleKey: 'plans', label: 'Audit Plans', path: '/audit/audit-plans', permission: 'create_audit_plans', enabled: AUDIT_FEATURE_FLAGS.FEATURE_AUDIT_PLANS, category: 'planning', component: 'AuditPlansNew' },
  { moduleKey: 'plan-approval', label: 'Plan Approval', path: '/audit/plan-approval', permission: 'approve_audit_plans', enabled: AUDIT_FEATURE_FLAGS.FEATURE_AUDIT_PLAN_APPROVAL, category: 'planning', component: 'PlanApproval' },

  // ===== Execution =====
  { moduleKey: 'engagements', label: 'Audits', path: '/audit/audits', permission: 'create_audit_plans', enabled: AUDIT_FEATURE_FLAGS.FEATURE_AUDIT_ENGAGEMENTS, category: 'execution', component: 'AuditEngagements' },

  // ===== Resources =====
  { moduleKey: 'auditor-profiles', label: 'Auditor Profiles', path: '/audit/auditors', permission: 'view_audit_assignments', enabled: AUDIT_FEATURE_FLAGS.FEATURE_AUDIT_AUDITOR_PROFILES, category: 'planning', component: 'AuditorProfiles' },
  { moduleKey: 'workload-capacity', label: 'Workload & Capacity', path: '/audit/workload', permission: 'view_audit_assignments', enabled: AUDIT_FEATURE_FLAGS.FEATURE_AUDIT_WORKLOAD_CAPACITY, category: 'planning', component: 'WorkloadCapacity' },
  { moduleKey: 'time-tracking', label: 'Time Tracking', path: '/audit/time-tracking', permission: 'view_audit_assignments', enabled: AUDIT_FEATURE_FLAGS.FEATURE_AUDIT_TIME_TRACKING, category: 'planning', component: 'TimeTracking' },
  { moduleKey: 'leave-management', label: 'Auditor Leave', path: '/audit/leave', permission: 'view_audit_assignments', enabled: AUDIT_FEATURE_FLAGS.FEATURE_AUDIT_LEAVE_MANAGEMENT, category: 'planning', component: 'AuditorLeaveManagement' },

  // ===== Reports =====
  { moduleKey: 'reports', label: 'Report Center', path: '/audit/audit-reports', permission: 'generate_reports', enabled: AUDIT_FEATURE_FLAGS.FEATURE_AUDIT_REPORTS, category: 'reports', component: 'AuditReports' },

  // ===== Configuration =====
  { moduleKey: 'system-config', label: 'Audit Configuration', path: '/audit/config', permission: 'configure_audit_system', enabled: AUDIT_FEATURE_FLAGS.FEATURE_AUDIT_SYSTEM_CONFIG, category: 'configuration', component: 'AuditConfig' },
  { moduleKey: 'risk-settings', label: 'Risk Configuration', path: '/audit/risk-settings', permission: 'configure_audit_system', enabled: true, category: 'configuration', component: 'RiskSettings' },
  { moduleKey: 'document-templates', label: 'Document & Output Settings', path: '/audit/document-templates', permission: 'configure_audit_system', enabled: AUDIT_FEATURE_FLAGS.FEATURE_AUDIT_SYSTEM_CONFIG, category: 'configuration', component: 'DocumentTemplateSettings' },

  // ===== Reference Data =====
  { moduleKey: 'communication-templates', label: 'Communication Templates', path: '/audit/templates', permission: 'configure_audit_system', enabled: AUDIT_FEATURE_FLAGS.FEATURE_AUDIT_SYSTEM_CONFIG, category: 'reference', component: 'TemplatesManagement' },
];

export function getAuditRouteByPath(path: string): AuditRouteEntry | undefined {
  return auditRouteConfig.find(r => r.path === path);
}

export function getAuditRouteByKey(key: string): AuditRouteEntry | undefined {
  return auditRouteConfig.find(r => r.moduleKey === key);
}

export function getEnabledAuditRoutes(): AuditRouteEntry[] {
  return auditRouteConfig.filter(r => r.enabled);
}

export function getDisabledAuditRoutes(): AuditRouteEntry[] {
  return auditRouteConfig.filter(r => !r.enabled);
}

export const AUDIT_MODULE_STATUS: Record<string, 'functional' | 'placeholder'> = Object.fromEntries(
  auditRouteConfig.map(r => [r.moduleKey, r.enabled ? 'functional' : 'placeholder'])
);
