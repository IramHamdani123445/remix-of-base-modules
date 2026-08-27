/**
 * Unified Field Schema Definitions for Internal Audit Modules
 * 
 * Single source of truth for:
 * - Import template generation
 * - Import validation
 * - Table columns
 * - Export columns
 * - Form field labels
 * 
 * Each module schema defines fields with consistent naming across all surfaces.
 */

export interface ModuleFieldDef {
  /** Database column / data key */
  key: string;
  /** Consistent display label across form, table, import, and export */
  label: string;
  /** Whether this field is required for import and form submission */
  required?: boolean;
  /** Data type for validation */
  type?: 'string' | 'number' | 'date' | 'boolean';
  /** Show in listing table */
  showInTable?: boolean;
  /** Show in export */
  showInExport?: boolean;
  /** Show in import template */
  showInImport?: boolean;
  /** Allowed values for dropdown / validation */
  allowedValues?: string[];
  /** Column width hint for export */
  exportWidth?: number;
  /** Sort order for consistent field ordering */
  sortOrder: number;
  /** Custom render hint (not used in schema, but documents intent) */
  renderHint?: 'badge' | 'date' | 'truncate' | 'mono';
}

export interface ModuleSchema {
  moduleKey: string;
  moduleLabel: string;
  templateFileName: string;
  exportFileName: string;
  exportTitle: string;
  fields: ModuleFieldDef[];
}

// Helper to extract subsets
export const getImportFields = (schema: ModuleSchema) =>
  schema.fields.filter(f => f.showInImport !== false).sort((a, b) => a.sortOrder - b.sortOrder);

export const getTableFields = (schema: ModuleSchema) =>
  schema.fields.filter(f => f.showInTable).sort((a, b) => a.sortOrder - b.sortOrder);

export const getExportFields = (schema: ModuleSchema) =>
  schema.fields.filter(f => f.showInExport !== false).sort((a, b) => a.sortOrder - b.sortOrder);

/** Convert schema fields to BulkUploadField[] format */
export const toBulkUploadFields = (schema: ModuleSchema) =>
  getImportFields(schema).map(f => ({
    key: f.key,
    label: f.label,
    required: f.required,
    type: f.type === 'boolean' ? 'string' as const : f.type,
    allowedValues: f.allowedValues,
  }));

/** Convert schema fields to ExportColumn[] format */
export const toExportColumns = (schema: ModuleSchema) =>
  getExportFields(schema).map(f => ({
    key: f.key,
    header: f.label,
    width: f.exportWidth,
  }));

/** Convert schema fields to DataTableColumn-compatible key/header pairs */
export const toTableColumnDefs = (schema: ModuleSchema) =>
  getTableFields(schema).map(f => ({
    key: f.key,
    header: f.label,
  }));

// ═══════════════════════════════════════════════════════════════
// 1. AUDITOR PROFILES
// ═══════════════════════════════════════════════════════════════
export const AUDITOR_SCHEMA: ModuleSchema = {
  moduleKey: 'auditor_profiles',
  moduleLabel: 'Auditor Profiles',
  templateFileName: 'auditor-profiles-template',
  exportFileName: 'auditor-profiles',
  exportTitle: 'Auditor Profiles',
  fields: [
    { key: 'employee_no', label: 'Employee Number', required: true, type: 'string', showInTable: true, showInImport: true, showInExport: true, sortOrder: 1, renderHint: 'mono' },
    { key: 'name', label: 'Auditor Name', required: true, type: 'string', showInTable: true, showInImport: true, showInExport: true, sortOrder: 2 },
    { key: 'email', label: 'Email', required: true, type: 'string', showInTable: true, showInImport: true, showInExport: true, sortOrder: 3 },
    { key: 'phone', label: 'Phone', type: 'string', showInTable: false, showInImport: true, showInExport: true, sortOrder: 4 },
    { key: 'role', label: 'Role', type: 'string', showInTable: true, showInImport: true, showInExport: true, sortOrder: 5, allowedValues: ['Auditor', 'Audit Manager', 'Audit Director'], renderHint: 'badge' },
    { key: 'seniority_level', label: 'Seniority Level', type: 'string', showInTable: true, showInImport: true, showInExport: true, sortOrder: 6, allowedValues: ['Junior', 'Mid', 'Senior', 'Lead'] },
    { key: 'work_location', label: 'Work Location', type: 'string', showInTable: false, showInImport: true, showInExport: true, sortOrder: 7 },
    { key: 'employment_status', label: 'Status', type: 'string', showInTable: true, showInImport: false, showInExport: true, sortOrder: 8, renderHint: 'badge' },
  ],
};

// ═══════════════════════════════════════════════════════════════
// 2. DEPARTMENT MASTER
// ═══════════════════════════════════════════════════════════════
export const DEPARTMENT_SCHEMA: ModuleSchema = {
  moduleKey: 'departments',
  moduleLabel: 'Department Master',
  templateFileName: 'departments-template',
  exportFileName: 'departments',
  exportTitle: 'Department Register',
  fields: [
    { key: 'office_code', label: 'Office Location', required: true, type: 'string', showInTable: false, showInImport: true, showInExport: true, sortOrder: 0 },
    { key: 'name', label: 'Department Name', required: true, type: 'string', showInTable: true, showInImport: true, showInExport: true, sortOrder: 1 },
    { key: 'head', label: 'Department Head', required: true, type: 'string', showInTable: true, showInImport: true, showInExport: true, sortOrder: 2 },
    { key: 'email', label: 'Email', type: 'string', showInTable: true, showInImport: true, showInExport: true, sortOrder: 3 },
    { key: 'phone', label: 'Phone', type: 'string', showInTable: false, showInImport: true, showInExport: true, sortOrder: 4 },
    { key: 'risk_rating', label: 'Risk Rating', type: 'string', showInTable: true, showInImport: true, showInExport: true, sortOrder: 5, allowedValues: ['High', 'Medium', 'Low'], renderHint: 'badge' },
  ],
};

// ═══════════════════════════════════════════════════════════════
// 3. FUNCTION MASTER
// ═══════════════════════════════════════════════════════════════
export const FUNCTION_SCHEMA: ModuleSchema = {
  moduleKey: 'functions',
  moduleLabel: 'Function Master',
  templateFileName: 'functions-template',
  exportFileName: 'functions',
  exportTitle: 'Functions List',
  fields: [
    { key: 'function_name', label: 'Function Name', required: true, type: 'string', showInTable: true, showInImport: true, showInExport: true, sortOrder: 1 },
    { key: 'department_name', label: 'Department', required: true, type: 'string', showInTable: true, showInImport: true, showInExport: true, sortOrder: 2 },
    { key: 'description', label: 'Description', type: 'string', showInTable: true, showInImport: true, showInExport: true, sortOrder: 3, renderHint: 'truncate' },
    { key: 'likelihood', label: 'Likelihood', type: 'string', showInTable: true, showInImport: true, showInExport: true, sortOrder: 4, allowedValues: ['Low', 'Medium', 'High'], renderHint: 'badge' },
    { key: 'impact', label: 'Impact', type: 'string', showInTable: true, showInImport: true, showInExport: true, sortOrder: 5, allowedValues: ['Low', 'Medium', 'High'], renderHint: 'badge' },
    { key: 'risk_rating', label: 'Risk Rating', type: 'string', showInTable: true, showInImport: false, showInExport: true, sortOrder: 6, renderHint: 'badge' },
    { key: 'control_effectiveness', label: 'Control Effectiveness', type: 'string', showInTable: true, showInImport: true, showInExport: true, sortOrder: 7, allowedValues: ['Effective', 'Partially Effective', 'Ineffective'], renderHint: 'badge' },
    { key: 'responsible_person', label: 'Responsible Person', type: 'string', showInTable: true, showInImport: true, showInExport: true, sortOrder: 8 },
    { key: 'notes', label: 'Notes', type: 'string', showInTable: false, showInImport: true, showInExport: false, sortOrder: 9 },
  ],
};

// ═══════════════════════════════════════════════════════════════
// 4. HOLIDAY MANAGEMENT
// ═══════════════════════════════════════════════════════════════
export const HOLIDAY_SCHEMA: ModuleSchema = {
  moduleKey: 'holidays',
  moduleLabel: 'Holiday Management',
  templateFileName: 'holidays-template',
  exportFileName: 'holidays',
  exportTitle: 'Holiday Calendar',
  fields: [
    { key: 'name', label: 'Holiday Name', required: true, type: 'string', showInTable: true, showInImport: true, showInExport: true, sortOrder: 1 },
    { key: 'date', label: 'Date', required: true, type: 'date', showInTable: true, showInImport: true, showInExport: true, sortOrder: 2, renderHint: 'date' },
    { key: 'country', label: 'Country/Region', type: 'string', showInTable: true, showInImport: true, showInExport: true, sortOrder: 3 },
    { key: 'holiday_type', label: 'Holiday Type', type: 'string', showInTable: true, showInImport: true, showInExport: true, sortOrder: 4 },
  ],
};

// ═══════════════════════════════════════════════════════════════
// 5. AUDIT UNIVERSE — REMOVED (replaced by Function Master)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// 6. FINDINGS & RECOMMENDATIONS
// ═══════════════════════════════════════════════════════════════
export const FINDINGS_SCHEMA: ModuleSchema = {
  moduleKey: 'findings',
  moduleLabel: 'Findings & Recommendations',
  templateFileName: 'findings-template',
  exportFileName: 'findings-register',
  exportTitle: 'Findings Register',
  fields: [
    { key: 'finding_id', label: 'Finding ID', type: 'string', showInTable: true, showInImport: false, showInExport: true, sortOrder: 1, renderHint: 'mono' },
    { key: 'title', label: 'Finding Title', required: true, type: 'string', showInTable: true, showInImport: true, showInExport: true, sortOrder: 2 },
    { key: 'risk_rating', label: 'Risk Level', type: 'string', showInTable: true, showInImport: true, showInExport: true, sortOrder: 3, allowedValues: ['High', 'Medium', 'Low'], renderHint: 'badge' },
    { key: 'department_name', label: 'Department', type: 'string', showInTable: false, showInImport: true, showInExport: true, sortOrder: 4 },
    { key: 'plan_name', label: 'Audit Plan', type: 'string', showInTable: true, showInImport: false, showInExport: true, sortOrder: 5 },
    { key: 'impact_area', label: 'Impact Area', type: 'string', showInTable: false, showInImport: true, showInExport: true, sortOrder: 6 },
    { key: 'condition', label: 'Condition', required: true, type: 'string', showInTable: false, showInImport: true, showInExport: true, sortOrder: 7 },
    { key: 'criteria', label: 'Criteria', type: 'string', showInTable: false, showInImport: true, showInExport: false, sortOrder: 8 },
    { key: 'cause', label: 'Cause', type: 'string', showInTable: false, showInImport: true, showInExport: false, sortOrder: 9 },
    { key: 'effect', label: 'Effect', type: 'string', showInTable: false, showInImport: true, showInExport: false, sortOrder: 10 },
    { key: 'status', label: 'Status', type: 'string', showInTable: true, showInImport: true, showInExport: true, sortOrder: 11, allowedValues: ['Draft', 'Under Review', 'For Mgmt Response', 'Closed'], renderHint: 'badge' },
  ],
};

// ═══════════════════════════════════════════════════════════════
// 7. ACTION TRACKING
// ═══════════════════════════════════════════════════════════════
export const ACTION_TRACKING_SCHEMA: ModuleSchema = {
  moduleKey: 'action_tracking',
  moduleLabel: 'Action Tracking',
  templateFileName: 'actions-template',
  exportFileName: 'action-tracking',
  exportTitle: 'Action Tracking Register',
  fields: [
    { key: 'finding_title', label: 'Finding', required: true, type: 'string', showInTable: true, showInImport: true, showInExport: true, sortOrder: 1 },
    { key: 'action_description', label: 'Action Description', required: true, type: 'string', showInTable: true, showInImport: true, showInExport: true, sortOrder: 2, renderHint: 'truncate' },
    { key: 'responsible_person', label: 'Responsible Person', type: 'string', showInTable: true, showInImport: true, showInExport: true, sortOrder: 3 },
    { key: 'target_date', label: 'Target Date', type: 'date', showInTable: true, showInImport: true, showInExport: true, sortOrder: 4, renderHint: 'date' },
    { key: 'notes', label: 'Notes', type: 'string', showInTable: false, showInImport: true, showInExport: false, sortOrder: 5 },
    { key: 'status', label: 'Status', type: 'string', showInTable: true, showInImport: true, showInExport: true, sortOrder: 6, allowedValues: ['Not Started', 'In Progress', 'Implemented', 'Verified', 'Closed'], renderHint: 'badge' },
  ],
};

// ═══════════════════════════════════════════════════════════════
// 8. RISK ASSESSMENT
// ═══════════════════════════════════════════════════════════════
export const RISK_ASSESSMENT_SCHEMA: ModuleSchema = {
  moduleKey: 'risk_assessments',
  moduleLabel: 'Risk Assessment',
  templateFileName: 'risk-assessments-template',
  exportFileName: 'risk-assessments',
  exportTitle: 'Risk Assessment Register',
  fields: [
    { key: 'entity_name', label: 'Entity', type: 'string', showInTable: true, showInImport: true, showInExport: true, sortOrder: 1 },
    { key: 'department_name', label: 'Department', type: 'string', showInTable: true, showInImport: false, showInExport: true, sortOrder: 2 },
    { key: 'assessment_date', label: 'Assessment Date', type: 'date', showInTable: true, showInImport: true, showInExport: true, sortOrder: 3, renderHint: 'date' },
    { key: 'assessed_by', label: 'Assessed By', type: 'string', showInTable: true, showInImport: true, showInExport: true, sortOrder: 4 },
    { key: 'impact_score', label: 'Impact Score', type: 'number', showInTable: true, showInImport: true, showInExport: true, sortOrder: 5 },
    { key: 'likelihood_score', label: 'Likelihood Score', type: 'number', showInTable: true, showInImport: true, showInExport: true, sortOrder: 6 },
    { key: 'control_effectiveness_score', label: 'Control Effectiveness Score', type: 'number', showInTable: false, showInImport: true, showInExport: true, sortOrder: 7 },
    { key: 'velocity_score', label: 'Velocity Score', type: 'number', showInTable: false, showInImport: true, showInExport: true, sortOrder: 8 },
    { key: 'regulatory_score', label: 'Regulatory Score', type: 'number', showInTable: false, showInImport: true, showInExport: true, sortOrder: 9 },
    { key: 'reputational_score', label: 'Reputational Score', type: 'number', showInTable: false, showInImport: true, showInExport: true, sortOrder: 10 },
    { key: 'overall_risk_score', label: 'Overall Risk Score', type: 'number', showInTable: true, showInImport: false, showInExport: true, sortOrder: 11 },
    { key: 'risk_level', label: 'Risk Level', type: 'string', showInTable: true, showInImport: false, showInExport: true, sortOrder: 12, allowedValues: ['Critical', 'High', 'Medium', 'Low'], renderHint: 'badge' },
    { key: 'notes', label: 'Notes', type: 'string', showInTable: false, showInImport: true, showInExport: false, sortOrder: 13 },
  ],
};

// ═══════════════════════════════════════════════════════════════
// 9. EVIDENCE MANAGEMENT
// ═══════════════════════════════════════════════════════════════
export const EVIDENCE_SCHEMA: ModuleSchema = {
  moduleKey: 'evidence',
  moduleLabel: 'Evidence Management',
  templateFileName: 'evidence-template',
  exportFileName: 'evidence-list',
  exportTitle: 'Evidence List',
  fields: [
    { key: 'title', label: 'Evidence Title', required: true, type: 'string', showInTable: true, showInImport: false, showInExport: true, sortOrder: 1 },
    { key: 'evidence_type', label: 'Evidence Type', type: 'string', showInTable: true, showInImport: false, showInExport: true, sortOrder: 2, allowedValues: ['Document', 'Photo', 'Interview'], renderHint: 'badge' },
    { key: 'plan_name', label: 'Audit Plan', type: 'string', showInTable: true, showInImport: false, showInExport: true, sortOrder: 3 },
    { key: 'activity_name', label: 'Activity', type: 'string', showInTable: false, showInImport: false, showInExport: true, sortOrder: 4 },
    { key: 'description', label: 'Description', type: 'string', showInTable: false, showInImport: false, showInExport: true, sortOrder: 5 },
    { key: 'file_name', label: 'File Name', type: 'string', showInTable: true, showInImport: false, showInExport: true, sortOrder: 6 },
    { key: 'created_at', label: 'Date', type: 'date', showInTable: true, showInImport: false, showInExport: true, sortOrder: 7, renderHint: 'date' },
  ],
};

// ═══════════════════════════════════════════════════════════════
// 10. AUDIT PLANS
// ═══════════════════════════════════════════════════════════════
export const AUDIT_PLANS_SCHEMA: ModuleSchema = {
  moduleKey: 'audit_plans',
  moduleLabel: 'Audit Plans',
  templateFileName: 'audit-plans-template',
  exportFileName: 'audit-plans',
  exportTitle: 'Audit Plan Register',
  fields: [
    { key: 'fiscal_year', label: 'Fiscal Year', required: true, type: 'string', showInTable: true, showInImport: false, showInExport: true, sortOrder: 1 },
    { key: 'title', label: 'Plan Title', required: true, type: 'string', showInTable: true, showInImport: false, showInExport: true, sortOrder: 2 },
    { key: 'objective', label: 'Objective', type: 'string', showInTable: true, showInImport: false, showInExport: true, sortOrder: 3, renderHint: 'truncate' },
    { key: 'status', label: 'Status', type: 'string', showInTable: true, showInImport: false, showInExport: true, sortOrder: 4, allowedValues: ['Draft', 'Submitted', 'Approved', 'In Progress', 'Completed', 'Rejected'], renderHint: 'badge' },
  ],
};

// ═══════════════════════════════════════════════════════════════
// AUDIT UNIVERSE
// ═══════════════════════════════════════════════════════════════
export const AUDIT_UNIVERSE_SCHEMA: ModuleSchema = {
  moduleKey: 'audit_universe',
  moduleLabel: 'Audit Universe',
  templateFileName: 'audit-universe-template',
  exportFileName: 'audit-universe',
  exportTitle: 'Audit Universe Register',
  fields: [
    { key: 'entity_name', label: 'Entity Name', required: true, type: 'string', showInTable: true, showInExport: true, sortOrder: 1 },
    { key: 'entity_type', label: 'Entity Type', required: true, type: 'string', showInTable: true, showInExport: true, sortOrder: 2 },
    { key: 'entity_code', label: 'Entity Code', type: 'string', showInTable: true, showInExport: true, sortOrder: 3 },
    { key: 'process_owner', label: 'Process Owner', type: 'string', showInTable: true, showInExport: true, sortOrder: 4 },
    { key: 'risk_category', label: 'Risk Category', type: 'string', showInTable: true, showInExport: true, sortOrder: 5 },
    { key: 'materiality', label: 'Materiality', type: 'string', showInTable: true, showInExport: true, sortOrder: 6, allowedValues: ['High', 'Medium', 'Low'] },
    { key: 'audit_frequency', label: 'Audit Frequency', type: 'string', showInTable: true, showInExport: true, sortOrder: 7 },
    { key: 'status', label: 'Status', type: 'string', showInTable: true, showInExport: true, sortOrder: 8 },
    { key: 'regulatory_impact', label: 'Regulatory Impact', type: 'string', showInTable: false, showInExport: true, sortOrder: 9 },
    { key: 'inherent_risk_score', label: 'Inherent Risk Score', type: 'number', showInTable: false, showInExport: true, sortOrder: 10 },
    { key: 'residual_risk_score', label: 'Residual Risk Score', type: 'number', showInTable: false, showInExport: true, sortOrder: 11 },
  ],
};

// ═══════════════════════════════════════════════════════════════
// RISK REGISTER
// ═══════════════════════════════════════════════════════════════
export const RISK_REGISTER_SCHEMA: ModuleSchema = {
  moduleKey: 'risk_register',
  moduleLabel: 'Risk Register',
  templateFileName: 'risk-register-template',
  exportFileName: 'risk-register',
  exportTitle: 'Risk Register',
  fields: [
    { key: 'risk_title', label: 'Risk Title', required: true, type: 'string', showInTable: true, showInExport: true, sortOrder: 1 },
    { key: 'entity_name', label: 'Department', type: 'string', showInTable: true, showInExport: true, sortOrder: 2 },
    { key: 'risk_category', label: 'Category', type: 'string', showInTable: true, showInExport: true, sortOrder: 3 },
    { key: 'inherent_risk_score', label: 'Inherent Score', type: 'number', showInTable: true, showInExport: true, sortOrder: 4 },
    { key: 'inherent_risk_level', label: 'Inherent Level', type: 'string', showInTable: true, showInExport: true, sortOrder: 5 },
    { key: 'residual_risk_score', label: 'Residual Score', type: 'number', showInTable: true, showInExport: true, sortOrder: 6 },
    { key: 'residual_risk_level', label: 'Residual Level', type: 'string', showInTable: true, showInExport: true, sortOrder: 7 },
    { key: 'control_effectiveness', label: 'Control Effectiveness', type: 'string', showInTable: false, showInExport: true, sortOrder: 8 },
    { key: 'risk_owner', label: 'Risk Owner', type: 'string', showInTable: true, showInExport: true, sortOrder: 9 },
    { key: 'status', label: 'Status', type: 'string', showInTable: true, showInExport: true, sortOrder: 10, allowedValues: ['Open', 'Mitigating', 'Under Review', 'Closed', 'Accepted'] },
    { key: 'fiscal_year', label: 'Fiscal Year', type: 'string', showInTable: false, showInExport: true, sortOrder: 11 },
    { key: 'review_date', label: 'Review Date', type: 'date', showInTable: false, showInExport: true, sortOrder: 12 },
    { key: 'due_date', label: 'Due Date', type: 'date', showInTable: false, showInExport: true, sortOrder: 13 },
    { key: 'risk_source', label: 'Risk Source', type: 'string', showInTable: false, showInExport: true, sortOrder: 14 },
    { key: 'notes', label: 'Notes', type: 'string', showInTable: false, showInExport: true, sortOrder: 15 },
  ],
};
