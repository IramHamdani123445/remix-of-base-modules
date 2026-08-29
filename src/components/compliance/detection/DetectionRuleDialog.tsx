import React, { useState, useMemo, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Loader2, PlusCircle, X, Database, Settings2, Filter, Zap, BarChart3, Info, ChevronDown, ChevronRight, Lightbulb, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { resolveMany, buildSnapshot, type ResolvedVariable } from '@/services/compliance/policyResolver';
import { supabase } from '@/integrations/supabase/client';
import {
  DETECTION_PARAM_SPEC,
  validateRuleParameterDraft,
  type CeParamSpec,
} from '@/lib/compliance/detectionRuleParameterSpec';


// ── Types ──

export interface DetectionRule {
  id: string;
  rule_code: string;
  name: string;
  description: string | null;
  trigger_event: string;
  condition_expression: string | null;
  frequency: string | null;
  priority: string | null;
  auto_create_violation: boolean | null;
  is_enabled: boolean | null;
  violation_type_id: string | null;
  parameters: Record<string, any> | null;
}

export interface ViolationType {
  id: string;
  code: string;
  name: string;
}

export interface ConditionVar {
  value: string;
  label: string;
  type: string;
  description: string | null;
  sourceTable: string | null;
  sourceColumn: string | null;
  c3ConfigKey: string | null;
  groupName?: string;
}

// ── Trigger Categories ──

type TriggerCategory = 'filing' | 'payment' | 'reporting' | 'registration' | 'arrangement' | 'inspection' | 'pattern';

const TRIGGER_CATEGORIES: { value: TriggerCategory; label: string; icon: string }[] = [
  { value: 'filing', label: 'Filing', icon: '📄' },
  { value: 'payment', label: 'Payment', icon: '💰' },
  { value: 'reporting', label: 'Reporting & Discrepancy', icon: '📊' },
  { value: 'registration', label: 'Registration', icon: '📋' },
  { value: 'arrangement', label: 'Arrangement', icon: '🤝' },
  { value: 'inspection', label: 'Inspection & Audit', icon: '🔍' },
  { value: 'pattern', label: 'Pattern & Fraud', icon: '🔁' },
];

interface TriggerEventDef {
  value: string;
  label: string;
  description: string;
  category: TriggerCategory;
}

const TRIGGER_EVENTS: TriggerEventDef[] = [
  // Filing
  { value: 'c3_deadline_passed', label: 'C3 Filing Deadline Passed', description: 'Triggers when C3 submission deadline has elapsed (late filing)', category: 'filing' },
  { value: 'c3_missing_30_days', label: 'C3 Missing (30+ Days)', description: 'No C3 submission found 30+ days past deadline (non-filing)', category: 'filing' },
  { value: 'contribution_gap_detected', label: 'Contribution Gap Detected', description: 'Missing contribution periods for active employees', category: 'filing' },
  { value: 'late_registration', label: 'Late Employee Registration', description: 'Employee registered after statutory deadline', category: 'filing' },
  // Payment
  { value: 'payment_not_received', label: 'Payment Not Received', description: 'No payment received by the contribution due date', category: 'payment' },
  { value: 'payment_partial', label: 'Partial Payment Detected', description: 'Payment received but less than the amount owed', category: 'payment' },
  // Reporting
  { value: 'levy_omission_check', label: 'Levy Omission Check', description: 'Employer eligible for levy but no levy amount reported', category: 'reporting' },
  { value: 'severance_omission_check', label: 'Severance Omission Check', description: 'Employer eligible for severance but no severance amount reported', category: 'reporting' },
  { value: 'employee_underreporting', label: 'Employee Count Discrepancy', description: 'Reported employees differ from field verification', category: 'reporting' },
  { value: 'wage_underreporting', label: 'Wage Underreporting Detected', description: 'Declared wages below minimum or industry norms', category: 'reporting' },
  // Registration
  { value: 'registration_not_found', label: 'Unregistered Employer Detected', description: 'Business operating without SSB registration', category: 'registration' },
  { value: 'employer_cessation', label: 'Employer Cessation', description: 'Employer ceased operations without settling outstanding liabilities', category: 'registration' },
  // Arrangement
  { value: 'installment_overdue', label: 'Arrangement Installment Overdue', description: 'Missed installment on an active payment arrangement', category: 'arrangement' },
  // Inspection
  { value: 'audit_discrepancy_found', label: 'Audit Discrepancy Found', description: 'Field audit reveals compliance mismatch', category: 'inspection' },
  // Pattern
  { value: 'repeat_violation_check', label: 'Repeat Violation Check', description: 'Employer accumulates multiple violations within a rolling period', category: 'pattern' },
  { value: 'benefit_fraud_indicator', label: 'Benefit Fraud Indicator', description: 'Suspicious benefit claim patterns detected', category: 'pattern' },
];

// ── Parameter definitions: derived from the canonical runtime contract ──
//
// The scanner (ce-violation-scan) resolves rule parameters through
// DETECTION_PARAM_SPEC. This dialog renders exactly those fields, so an
// administrator can never configure a key the engine ignores, and can never
// leave a required threshold unset in the belief that "a default applies" —
// there are no code defaults, only configuration.

type ParamFieldDef = CeParamSpec;

/** Triggers listed in the picker but not yet implemented by the scanner. */
const TRIGGERS_WITHOUT_RUNTIME = TRIGGER_EVENTS.map((t) => t.value).filter(
  (t) => !DETECTION_PARAM_SPEC[t],
);

/** Read-only view of the statutory values owned by the active policy. */
function useActiveCompliancePolicy(enabled: boolean) {
  const [policy, setPolicy] = useState<Record<string, any> | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('ce_compliance_policies')
        .select('policy_code, c3_submission_deadline_day, payment_due_date_day, c3_grace_period_days')
        .eq('is_active', true)
        .order('effective_from', { ascending: false })
        .limit(1);
      if (!cancelled) setPolicy((data?.[0] as any) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return policy;
}


// ── Quick Condition Templates ──

interface ConditionTemplate {
  label: string;
  expression: string;
  category: TriggerCategory;
}

const CONDITION_TEMPLATES: ConditionTemplate[] = [
  { label: 'Days Late > Grace Period', expression: 'days_overdue > 14', category: 'filing' },
  { label: 'Missing Filings >= 2', expression: 'missing_periods >= 2', category: 'filing' },
  { label: 'Payment < Expected', expression: 'outstanding_balance > 0', category: 'payment' },
  { label: 'Amount Owed > $5,000', expression: 'total_owed > 5000', category: 'payment' },
  { label: 'Risk Score >= 70', expression: 'risk_score >= 70', category: 'pattern' },
  { label: 'Is Repeat Offender', expression: 'is_repeat_offender == true', category: 'pattern' },
  { label: 'Months Overdue >= 3', expression: 'months_overdue >= 3', category: 'filing' },
  { label: 'No Active Plan', expression: 'has_active_plan == false', category: 'arrangement' },
];

// ── Condition Builder ──

interface ConditionRow {
  variable: string;
  operator: string;
  value: string;
  conjunction: 'AND' | 'OR';
}

const CONDITION_OPERATORS = [
  { value: '>', label: '>' },
  { value: '>=', label: '>=' },
  { value: '<', label: '<' },
  { value: '<=', label: '<=' },
  { value: '==', label: '=' },
  { value: '!=', label: '≠' },
];

const BOOLEAN_OPERATORS = [
  { value: '==', label: 'is' },
  { value: '!=', label: 'is not' },
];

function parseConditionExpression(expr: string | null): ConditionRow[] {
  if (!expr || !expr.trim()) return [{ variable: '', operator: '>', value: '', conjunction: 'AND' }];
  const parts = expr.split(/\s+(AND|OR)\s+/i);
  const rows: ConditionRow[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const segment = parts[i].trim();
    const conjunction = (parts[i + 1]?.toUpperCase() as 'AND' | 'OR') || 'AND';
    const match = segment.match(/^(\w+)\s*(>=|<=|!=|==|>|<)\s*(.+)$/);
    if (match) {
      rows.push({ variable: match[1], operator: match[2], value: match[3].trim(), conjunction });
    } else {
      rows.push({ variable: '', operator: '>', value: segment, conjunction });
    }
  }
  return rows.length > 0 ? rows : [{ variable: '', operator: '>', value: '', conjunction: 'AND' }];
}

function buildConditionExpression(rows: ConditionRow[]): string {
  return rows
    .filter(r => r.variable && r.value)
    .map((r, i, arr) => {
      const cond = `${r.variable} ${r.operator} ${r.value}`;
      return i < arr.length - 1 ? `${cond} ${r.conjunction}` : cond;
    })
    .join(' ');
}

// ── Section Header Component ──

const SectionHeader = ({ icon: Icon, title, subtitle, step }: { icon: React.ElementType; title: string; subtitle: string; step: number }) => (
  <div className="flex items-start gap-3 pb-2">
    <div className="flex items-center justify-center h-7 w-7 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0 mt-0.5">
      {step}
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary shrink-0" />
        <h3 className="font-semibold text-sm text-foreground">{title}</h3>
      </div>
      <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>
    </div>
  </div>
);

// ── Enhanced Condition Builder ──

const EnhancedConditionBuilder = ({
  value,
  onChange,
  variables,
  triggerCategory,
}: {
  value: string;
  onChange: (v: string) => void;
  variables: ConditionVar[];
  triggerCategory: TriggerCategory | null;
}) => {
  const [rows, setRows] = useState<ConditionRow[]>(() => parseConditionExpression(value));
  const [showTemplates, setShowTemplates] = useState(false);

  const updateRow = (idx: number, field: keyof ConditionRow, val: string) => {
    const updated = [...rows];
    updated[idx] = { ...updated[idx], [field]: val };
    setRows(updated);
    onChange(buildConditionExpression(updated));
  };

  const addRow = () => {
    const updated = [...rows, { variable: '', operator: '>', value: '', conjunction: 'AND' as const }];
    setRows(updated);
  };

  const removeRow = (idx: number) => {
    if (rows.length <= 1) return;
    const updated = rows.filter((_, i) => i !== idx);
    setRows(updated);
    onChange(buildConditionExpression(updated));
  };

  const applyTemplate = (template: ConditionTemplate) => {
    const parsed = parseConditionExpression(template.expression);
    setRows(parsed);
    onChange(template.expression);
    setShowTemplates(false);
  };

  // Group variables by groupName
  const groupedVars = useMemo(() => {
    const groups: Record<string, ConditionVar[]> = {};
    variables.forEach(v => {
      const g = v.groupName || 'Other';
      if (!groups[g]) groups[g] = [];
      groups[g].push(v);
    });
    return groups;
  }, [variables]);

  const relevantTemplates = triggerCategory
    ? CONDITION_TEMPLATES.filter(t => t.category === triggerCategory || t.category === 'pattern')
    : CONDITION_TEMPLATES;

  return (
    <div className="space-y-3">
      {/* Quick Templates */}
      <Collapsible open={showTemplates} onOpenChange={setShowTemplates}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs h-7 text-muted-foreground hover:text-foreground">
            <Lightbulb className="h-3.5 w-3.5" />
            Quick Templates
            {showTemplates ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-wrap gap-1.5 pt-1 pb-2">
            {relevantTemplates.map((t, i) => (
              <Button key={i} variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={() => applyTemplate(t)}>
                {t.label}
              </Button>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {rows.map((row, idx) => {
        const selectedVar = variables.find(v => v.value === row.variable);
        const isBool = selectedVar?.type === 'boolean';
        return (
          <div key={idx} className="space-y-1">
            {idx > 0 && (
              <Select value={rows[idx - 1].conjunction} onValueChange={v => updateRow(idx - 1, 'conjunction', v)}>
                <SelectTrigger className="w-20 h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="AND">AND</SelectItem>
                  <SelectItem value="OR">OR</SelectItem>
                </SelectContent>
              </Select>
            )}
            <div className="flex items-center gap-2">
              <Select value={row.variable || '__pick__'} onValueChange={v => updateRow(idx, 'variable', v === '__pick__' ? '' : v)}>
                <SelectTrigger className="flex-1 h-9 text-sm"><SelectValue placeholder="Select field..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__pick__">Select field...</SelectItem>
                  {Object.entries(groupedVars).map(([group, vars]) => (
                    <React.Fragment key={group}>
                      <SelectItem value={`__g_${group}__`} disabled className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">
                        {group}
                      </SelectItem>
                      {vars.map(v => (
                        <SelectItem key={v.value} value={v.value}>
                          <span className="flex items-center gap-1.5">
                            {v.label}
                            {v.c3ConfigKey && (
                              <span className="inline-flex items-center px-1 py-0 rounded text-[9px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">C3</span>
                            )}
                            {!v.sourceTable && !v.c3ConfigKey && (
                              <span className="inline-flex items-center px-1 py-0 rounded text-[9px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">Derived</span>
                            )}
                          </span>
                        </SelectItem>
                      ))}
                    </React.Fragment>
                  ))}
                </SelectContent>
              </Select>
              <Select value={row.operator} onValueChange={v => updateRow(idx, 'operator', v)}>
                <SelectTrigger className="w-16 h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(isBool ? BOOLEAN_OPERATORS : CONDITION_OPERATORS).map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isBool ? (
                <Select value={row.value || 'true'} onValueChange={v => updateRow(idx, 'value', v)}>
                  <SelectTrigger className="w-24 h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">True</SelectItem>
                    <SelectItem value="false">False</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  className="w-28 h-9 text-sm"
                  type="number"
                  value={row.value}
                  onChange={e => updateRow(idx, 'value', e.target.value)}
                  placeholder="Value"
                />
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeRow(idx)} disabled={rows.length <= 1}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            {selectedVar && (
              <div className="ml-1 space-y-0.5">
                {selectedVar.description && (
                  <p className="text-[10px] text-muted-foreground">{selectedVar.description}</p>
                )}
                {selectedVar.c3ConfigKey && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <Settings2 className="h-2.5 w-2.5" />
                    Uses C3 Config: <span className="font-mono">{selectedVar.c3ConfigKey}</span>
                  </p>
                )}
                {selectedVar.sourceTable && (
                  <p className="text-[10px] text-muted-foreground italic">
                    Source: {selectedVar.sourceTable}.{selectedVar.sourceColumn}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
      <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={addRow}>
        <PlusCircle className="h-3.5 w-3.5" /> Add Condition
      </Button>
      {buildConditionExpression(rows) && (
        <div className="bg-muted/50 rounded px-3 py-1.5 mt-1">
          <p className="text-[11px] text-muted-foreground">Generated Expression:</p>
          <p className="text-xs font-mono text-primary">{buildConditionExpression(rows)}</p>
        </div>
      )}
    </div>
  );
};

// ── Dynamic Parameters Form ──

const DynamicParametersForm = ({
  triggerEvent,
  value,
  onChange,
  conditionVars,
}: {
  triggerEvent: string;
  value: Record<string, any>;
  onChange: (v: Record<string, any>) => void;
  conditionVars: ConditionVar[];
}) => {
  const paramDefs = TRIGGER_PARAM_DEFS[triggerEvent] || DEFAULT_PARAM_DEFS;

  // Find C3-linked variables relevant to this trigger
  const c3Vars = conditionVars.filter(v => v.c3ConfigKey);

  const updateParam = (key: string, val: any) => {
    onChange({ ...value, [key]: val });
  };

  // Check if a param has a C3 override toggle
  const isC3Override = (key: string) => value[`${key}_override`] === true;
  const toggleC3Override = (key: string) => {
    const updated = { ...value };
    updated[`${key}_override`] = !updated[`${key}_override`];
    if (!updated[`${key}_override`]) {
      delete updated[key]; // Remove custom value, revert to C3
    }
    onChange(updated);
  };

  if (!triggerEvent) {
    return (
      <div className="text-center py-4">
        <p className="text-xs text-muted-foreground">Select a trigger event to configure parameters</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {paramDefs.map(def => (
        <div key={def.key} className="space-y-1">
          {def.type === 'boolean' ? (
            <div className="flex items-center gap-2">
              <Checkbox
                checked={value[def.key] ?? def.defaultValue ?? false}
                onCheckedChange={c => updateParam(def.key, !!c)}
              />
              <Label className="font-normal text-sm">{def.label}</Label>
            </div>
          ) : (
            <>
              <Label className="text-sm">{def.label}</Label>
              <Input
                type={def.type}
                value={value[def.key] ?? def.defaultValue ?? ''}
                onChange={e => updateParam(def.key, def.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
                placeholder={def.placeholder}
                className="h-9"
              />
            </>
          )}
          {def.helpText && <p className="text-[10px] text-muted-foreground">{def.helpText}</p>}
        </div>
      ))}

      {/* C3 Config Awareness Section */}
      {c3Vars.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border">
          <div className="flex items-center gap-1.5 mb-2">
            <Settings2 className="h-3.5 w-3.5 text-amber-600" />
            <span className="text-xs font-medium text-amber-700 dark:text-amber-400">C3 Configuration Values</span>
          </div>
          <p className="text-[10px] text-muted-foreground mb-2">
            These values are automatically pulled from C3 Configuration. Toggle to override with a custom value.
          </p>
          {c3Vars.slice(0, 5).map(cv => (
            <div key={cv.value} className="flex items-center gap-2 py-1.5">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium">{cv.label}</span>
                  <Badge variant="outline" className="text-[9px] h-4 px-1 bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800">
                    C3 Config
                  </Badge>
                </div>
                <p className="text-[10px] text-muted-foreground font-mono">{cv.c3ConfigKey}</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground">Use C3</span>
                  <Switch
                    checked={isC3Override(cv.value)}
                    onCheckedChange={() => toggleC3Override(cv.value)}
                    className="h-4 w-7"
                  />
                  <span className="text-[10px] text-muted-foreground">Override</span>
                </div>
                {isC3Override(cv.value) && (
                  <Input
                    type="number"
                    className="w-24 h-7 text-xs"
                    value={value[cv.value] ?? ''}
                    onChange={e => updateParam(cv.value, e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="Custom"
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Data Sources Section ──

const DataSourcesSection = ({
  triggerEvent,
  conditionVars,
}: {
  triggerEvent: string;
  conditionVars: ConditionVar[];
}) => {
  const sources = useMemo(
    () =>
      conditionVars
        .filter(v => v.sourceTable)
        .map(v => ({
          variable: v.label,
          variableKey: v.value,
          table: v.sourceTable!,
          column: v.sourceColumn || '*',
          c3Key: v.c3ConfigKey,
        })),
    [conditionVars],
  );

  const c3VarKeys = useMemo(
    () => Array.from(new Set(sources.filter(s => s.c3Key).map(s => s.variableKey))),
    [sources],
  );

  const [resolved, setResolved] = useState<Record<string, ResolvedVariable>>({});

  useEffect(() => {
    let cancelled = false;
    if (!triggerEvent || c3VarKeys.length === 0) {
      setResolved({});
      return;
    }
    (async () => {
      try {
        const list = await resolveMany(c3VarKeys);
        if (cancelled) return;
        const map: Record<string, ResolvedVariable> = {};
        for (const r of list) map[r.variable_key] = r;
        setResolved(map);
      } catch {
        // resolver is informational only — silent fail
      }
    })();
    return () => { cancelled = true; };
  }, [triggerEvent, c3VarKeys.join('|')]);

  if (!triggerEvent) return null;
  const uniqueTables = Array.from(new Set(sources.map(s => s.table)));
  if (uniqueTables.length === 0) return null;

  return (
    <div className="bg-muted/30 border border-border rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <Database className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Data Sources Used by This Rule</span>
      </div>
      <div className="space-y-1.5">
        {uniqueTables.map(table => {
          const cols = sources.filter(s => s.table === table);
          return (
            <div key={table} className="flex items-start gap-2">
              <Badge variant="outline" className="text-[10px] shrink-0 font-mono bg-background">{table}</Badge>
              <div className="flex flex-wrap gap-1">
                {cols.map((col, i) => {
                  const r = resolved[col.variableKey];
                  return (
                    <span key={i} className="text-[10px] text-muted-foreground">
                      <span className="font-mono">.{col.column}</span>
                      <span className="text-foreground/60"> ({col.variable})</span>
                      {col.c3Key && (
                        <span className="text-amber-600 dark:text-amber-400 ml-0.5">
                          ← C3: {col.c3Key}
                          {r && (r.unresolved
                            ? <span className="text-destructive ml-1">[unresolved]</span>
                            : <span className="text-foreground/80"> = <span className="font-mono">{r.value}</span></span>
                          )}
                        </span>
                      )}
                      {i < cols.length - 1 && <span className="mx-0.5">·</span>}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground italic">
        Live values shown for reference. On save, the rule freezes a snapshot — historical detections never change when C3 Configuration is updated.
      </p>
    </div>
  );
};

// ── Main Detection Rule Dialog ──

export const EnhancedDetectionRuleDialog = ({
  open,
  onOpenChange,
  rule,
  violationTypes,
  onSave,
  saving,
  existingCodes,
  conditionVars,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rule: DetectionRule | null;
  violationTypes: ViolationType[];
  onSave: (data: any) => void;
  saving: boolean;
  existingCodes: string[];
  conditionVars: ConditionVar[];
}) => {
  const isEdit = !!rule;

  // Generate next code
  function generateNextCode(codes: string[], prefix: string): string {
    const nums = codes.filter(c => c.startsWith(prefix)).map(c => parseInt(c.replace(prefix, ''), 10)).filter(n => !isNaN(n));
    const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
    return `${prefix}${String(next).padStart(3, '0')}`;
  }

  const [form, setForm] = useState({
    rule_code: '',
    name: '',
    description: '',
    trigger_event: '',
    condition_expression: '',
    frequency: 'daily',
    priority: 'Medium',
    auto_create_violation: true,
    is_enabled: true,
    violation_type_id: '',
    parameters: {} as Record<string, any>,
  });

  const [triggerCategory, setTriggerCategory] = useState<TriggerCategory | null>(null);

  React.useEffect(() => {
    if (open) {
      const autoCode = isEdit ? (rule?.rule_code || '') : generateNextCode(existingCodes, 'DR-');
      const te = rule?.trigger_event || '';
      const cat = TRIGGER_EVENTS.find(e => e.value === te)?.category || null;
      setTriggerCategory(cat);
      setForm({
        rule_code: autoCode,
        name: rule?.name || '',
        description: rule?.description || '',
        trigger_event: te,
        condition_expression: rule?.condition_expression || '',
        frequency: rule?.frequency || 'daily',
        priority: rule?.priority || 'Medium',
        auto_create_violation: rule?.auto_create_violation ?? true,
        is_enabled: rule?.is_enabled ?? true,
        violation_type_id: rule?.violation_type_id || '',
        parameters: rule?.parameters || {},
      });
    }
  }, [open, rule]);

  const filteredTriggers = triggerCategory
    ? TRIGGER_EVENTS.filter(e => e.category === triggerCategory)
    : TRIGGER_EVENTS;

  const handleTriggerCategoryChange = (cat: string) => {
    if (cat === '__all__') {
      setTriggerCategory(null);
    } else {
      setTriggerCategory(cat as TriggerCategory);
    }
    // Clear trigger event if it doesn't belong to new category
    if (cat !== '__all__') {
      const currentTrigger = TRIGGER_EVENTS.find(e => e.value === form.trigger_event);
      if (currentTrigger && currentTrigger.category !== cat) {
        setForm(p => ({ ...p, trigger_event: '', description: '' }));
      }
    }
  };

  const handleTriggerChange = (val: string) => {
    const ev = TRIGGER_EVENTS.find(e => e.value === val);
    // Auto-set category from trigger
    if (ev) setTriggerCategory(ev.category);
    // Initialize default params for this trigger
    const defaultParams: Record<string, any> = {};
    const defs = TRIGGER_PARAM_DEFS[val] || [];
    defs.forEach(d => {
      if (d.defaultValue !== undefined) defaultParams[d.key] = d.defaultValue;
    });
    // Merge existing params with defaults (existing take precedence for edits)
    const mergedParams = isEdit ? { ...defaultParams, ...(rule?.trigger_event === val ? (rule?.parameters || {}) : {}) } : defaultParams;
    setForm(p => ({
      ...p,
      trigger_event: val === '__pick__' ? '' : val,
      description: ev ? ev.description : p.description,
      parameters: mergedParams,
    }));
  };

  const handleSave = async () => {
    if (!form.name || !form.trigger_event) {
      toast.error('Please check the form for valid information!', {
        description: 'Name and Trigger Event are required.',
        style: { backgroundColor: 'hsl(var(--destructive))', color: 'white', '--description-color': 'white' } as React.CSSProperties,
        classNames: { toast: '!bg-destructive', title: '!text-white', description: '!text-white !opacity-100' },
      });
      return;
    }
    // Clean parameters: remove empty values
    const cleanParams: Record<string, any> = {};
    Object.entries(form.parameters).forEach(([k, v]) => {
      if (k === '_snapshot') return; // recomputed below
      if (v !== '' && v !== undefined && v !== null) {
        cleanParams[k] = v;
      }
    });

    // Build / preserve the policy snapshot.
    // On EDIT: keep the existing snapshot frozen — never re-resolve from live config.
    // On CREATE: resolve current values for any c3-linked condition variables used
    // by this trigger and freeze them into parameters._snapshot.
    let snapshot = (rule?.parameters as any)?._snapshot ?? null;
    if (!isEdit) {
      const c3Keys = enrichedVars.filter(v => v.c3ConfigKey).map(v => v.value);
      if (c3Keys.length > 0) {
        try {
          const resolved = await resolveMany(c3Keys);
          snapshot = buildSnapshot(resolved);
        } catch {
          // resolver failure must not block rule creation
        }
      }
    }
    if (snapshot) cleanParams._snapshot = snapshot;

    onSave({
      ...form,
      violation_type_id: form.violation_type_id || null,
      condition_expression: form.condition_expression || null,
      parameters: Object.keys(cleanParams).length > 0 ? cleanParams : null,
    });
  };

  // Enrich conditionVars with groupName
  const enrichedVars = useMemo(() =>
    conditionVars.map(v => ({ ...v, groupName: v.groupName || (v.type === 'boolean' ? 'Boolean' : 'General') })),
    [conditionVars]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            {isEdit ? 'Edit Detection Rule' : 'Create Detection Rule'}
          </DialogTitle>
          <DialogDescription>
            Configure when a compliance violation should be automatically detected. Follow the guided sections below.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* ─── Section 1: Trigger ─── */}
          <div className="space-y-3">
            <SectionHeader icon={Zap} title="Trigger" subtitle="What compliance event should this rule respond to?" step={1} />
            <div className="grid grid-cols-2 gap-4 pl-10">
              <div className="space-y-1.5">
                <Label>Rule Code</Label>
                <Input value={form.rule_code} readOnly className="bg-muted text-muted-foreground cursor-not-allowed font-mono" />
                <p className="text-[10px] text-muted-foreground">Auto-generated identifier</p>
              </div>
              <div className="space-y-1.5">
                <Label>Rule Name <span className="text-destructive">*</span></Label>
                <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Late C3 Submission" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 pl-10">
              <div className="space-y-1.5">
                <Label>Trigger Category</Label>
                <Select value={triggerCategory || '__all__'} onValueChange={handleTriggerCategoryChange}>
                  <SelectTrigger><SelectValue placeholder="All Categories" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All Categories</SelectItem>
                    {TRIGGER_CATEGORIES.map(c => (
                      <SelectItem key={c.value} value={c.value}>
                        <span className="flex items-center gap-1.5">{c.icon} {c.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">Filter trigger events by category</p>
              </div>
              <div className="space-y-1.5">
                <Label>Trigger Event <span className="text-destructive">*</span></Label>
                <Select value={form.trigger_event || '__pick__'} onValueChange={handleTriggerChange}>
                  <SelectTrigger><SelectValue placeholder="Select trigger event..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__pick__">Select trigger event...</SelectItem>
                    {filteredTriggers.map(e => (
                      <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.trigger_event && (
                  <p className="text-[10px] text-muted-foreground">
                    {TRIGGER_EVENTS.find(e => e.value === form.trigger_event)?.description}
                  </p>
                )}
              </div>
            </div>
            <div className="pl-10 space-y-1.5">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Describe when this rule triggers..." rows={2} />
            </div>
          </div>

          <Separator />

          {/* ─── Section 2: Data Sources ─── */}
          <div className="space-y-3">
            <SectionHeader icon={Database} title="Data Sources" subtitle="Tables and configuration values this rule will read from (read-only)" step={2} />
            <div className="pl-10">
              <DataSourcesSection triggerEvent={form.trigger_event} conditionVars={enrichedVars} />
              {!form.trigger_event && (
                <p className="text-xs text-muted-foreground text-center py-3">Select a trigger event to see data sources</p>
              )}
            </div>
          </div>

          <Separator />

          {/* ─── Section 3: Conditions ─── */}
          <div className="space-y-3">
            <SectionHeader icon={Filter} title="Conditions" subtitle="Define when this rule should match — combine multiple conditions with AND/OR" step={3} />
            <div className="pl-10">
              <EnhancedConditionBuilder
                value={form.condition_expression}
                onChange={v => setForm(p => ({ ...p, condition_expression: v }))}
                variables={enrichedVars}
                triggerCategory={triggerCategory}
              />
            </div>
          </div>

          <Separator />

          {/* ─── Section 4: Thresholds / Parameters ─── */}
          <div className="space-y-3">
            <SectionHeader icon={Settings2} title="Thresholds & Parameters" subtitle="Configure detection sensitivity and behavior for this trigger type" step={4} />
            <div className="pl-10">
              <DynamicParametersForm
                triggerEvent={form.trigger_event}
                value={form.parameters}
                onChange={v => setForm(p => ({ ...p, parameters: v }))}
                conditionVars={enrichedVars}
              />
            </div>
          </div>

          <Separator />

          {/* ─── Section 5: Output ─── */}
          <div className="space-y-3">
            <SectionHeader icon={BarChart3} title="Output & Behavior" subtitle="What happens when this rule matches a violation?" step={5} />
            <div className="pl-10 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Linked Violation Type</Label>
                  <Select value={form.violation_type_id || '__none__'} onValueChange={v => setForm(p => ({ ...p, violation_type_id: v === '__none__' ? '' : v }))}>
                    <SelectTrigger><SelectValue placeholder="Select violation type..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {violationTypes.map(vt => <SelectItem key={vt.id} value={vt.id}>{vt.code} – {vt.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">The violation type created when this rule triggers</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Priority</Label>
                  <Select value={form.priority} onValueChange={v => setForm(p => ({ ...p, priority: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['Low', 'Medium', 'High', 'Critical'].map(p => (
                        <SelectItem key={p} value={p}>
                          <span className="flex items-center gap-1.5">
                            <span className={`h-2 w-2 rounded-full ${p === 'Critical' ? 'bg-destructive' : p === 'High' ? 'bg-orange-500' : p === 'Medium' ? 'bg-yellow-500' : 'bg-green-500'}`} />
                            {p}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Frequency</Label>
                  <Select value={form.frequency || 'daily'} onValueChange={v => setForm(p => ({ ...p, frequency: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[
                        { value: 'on_event', label: 'On Event (Real-time)' },
                        { value: 'hourly', label: 'Hourly' },
                        { value: 'daily', label: 'Daily' },
                        { value: 'weekly', label: 'Weekly' },
                        { value: 'monthly', label: 'Monthly' },
                      ].map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">How often this rule is evaluated</p>
                </div>
                <div className="space-y-3 pt-5">
                  <div className="flex items-center gap-2">
                    <Checkbox checked={form.auto_create_violation} onCheckedChange={c => setForm(p => ({ ...p, auto_create_violation: !!c }))} />
                    <Label className="font-normal text-sm">Auto-Create Violation</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox checked={form.is_enabled} onCheckedChange={c => setForm(p => ({ ...p, is_enabled: !!c }))} />
                    <Label className="font-normal text-sm">Rule Enabled</Label>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEdit ? 'Update Rule' : 'Create Rule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
