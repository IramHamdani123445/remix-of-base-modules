/**
 * BlockInspector — right rail. Renders controlled inputs per block kind.
 * Uses registries (no free-text for executable fields).
 */
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ELIGIBILITY_FIELDS } from '@/services/bn/registries/eligibilityFieldRegistry';
import { FORMULA_VARIABLES } from '@/services/bn/registries/formulaVariableRegistry';
import { SMART_FIELD_TYPES } from '@/services/bn/registries/smartFieldRegistry';
import { BN_ESCALATION_TRIGGERS, BN_ESCALATION_SEVERITIES } from '@/services/bn/registries/workflowRolesRegistry';
import { useWorkflowRoles } from '@/hooks/bn/useWorkflowRoles';
import { useBnDocumentProfiles } from '@/hooks/bn/useBnConfig';
import { BLOCK_REGISTRY } from './blockRegistry';
import type { BuilderBlock } from './types';

interface Props {
  block?: BuilderBlock;
  onChange: (next: BuilderBlock) => void;
  disabled?: boolean;
}

export function BlockInspector({ block, onChange, disabled }: Props) {
  // Hooks must run on every render regardless of whether a block is selected —
  // calling them after the early return below would change the hook count
  // between "nothing selected" and "block selected" renders.
  const { roles: workflowRoles } = useWorkflowRoles();
  const { data: documentProfiles = [] } = useBnDocumentProfiles();

  if (!block) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Inspector</CardTitle></CardHeader>
        <CardContent><p className="text-xs text-muted-foreground">Select a block to edit its properties.</p></CardContent>
      </Card>
    );
  }
  const def = BLOCK_REGISTRY[block.kind];
  const setProp = (k: string, v: any) => onChange({ ...block, props: { ...block.props, [k]: v } });

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          {def?.label}
          <Badge variant="outline" className="text-[9px]">{block.kind}</Badge>
        </CardTitle>
        {def?.description && <CardDescription className="text-xs">{def.description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-3">
        {renderEditor(block, setProp, workflowRoles, documentProfiles, disabled)}
      </CardContent>
    </Card>
  );
}

/** Document-code options sourced from the Document Library, plus the block's
 * current value if it was typed before this picker existed — so an old
 * free-text code doesn't just disappear from the dropdown. */
function documentCodeOptions(profiles: { profile_code: string; profile_name: string }[], current: unknown) {
  const opts = profiles.map((p) => ({ value: p.profile_code, label: `${p.profile_code} — ${p.profile_name}` }));
  if (current && !profiles.some((p) => p.profile_code === current)) {
    opts.push({ value: String(current), label: `${current} (not in Document Library)` });
  }
  return opts;
}

function renderEditor(
  block: BuilderBlock,
  setProp: (k: string, v: any) => void,
  workflowRoles: string[],
  documentProfiles: { profile_code: string; profile_name: string }[],
  disabled?: boolean,
) {
  const p = block.props;
  switch (block.kind) {
    // ---------------- Eligibility ----------------
    case 'eligibility.age':
      return (
        <>
          <NumberField label="Min age" value={p.min_age} onChange={(v) => setProp('min_age', v)} disabled={disabled} />
          <NumberField label="Max age" value={p.max_age} onChange={(v) => setProp('max_age', v)} disabled={disabled} />
          <SelectField label="Reference date" value={p.reference_date} onChange={(v) => setProp('reference_date', v)} options={['CLAIM_DATE', 'DOB', 'EFFECTIVE_DATE']} disabled={disabled} />
        </>
      );
    case 'eligibility.contribution':
      return (
        <>
          <NumberField label="Min contributions" value={p.min_contributions} onChange={(v) => setProp('min_contributions', v)} disabled={disabled} />
          <SelectField label="Window type" value={p.window_type} onChange={(v) => setProp('window_type', v)} options={['CONSECUTIVE_WEEKS', 'LIFETIME', 'RECENT_QUARTERS']} disabled={disabled} />
          <NumberField label="Window value" value={p.window_value} onChange={(v) => setProp('window_value', v)} disabled={disabled} />
        </>
      );
    case 'eligibility.document':
      return (
        <>
          <SelectField label="Document code" value={p.document_code} onChange={(v) => setProp('document_code', v)}
            options={documentCodeOptions(documentProfiles, p.document_code)} disabled={disabled} />
          <SwitchField label="Verification required" value={p.verification_required} onChange={(v) => setProp('verification_required', v)} disabled={disabled} />
        </>
      );
    case 'eligibility.medical_board':
      return (
        <>
          <SelectField label="Decision" value={p.decision} onChange={(v) => setProp('decision', v)} options={['APPROVED', 'PENDING', 'REJECTED']} disabled={disabled} />
          <NumberField label="Min disability %" value={p.min_disability_pct} onChange={(v) => setProp('min_disability_pct', v)} disabled={disabled} />
        </>
      );
    case 'eligibility.survivor_relationship':
      return <SelectField label="Relationship" value={p.relationship} onChange={(v) => setProp('relationship', v)} options={['SPOUSE', 'CHILD', 'PARENT', 'DEPENDENT']} disabled={disabled} />;
    case 'eligibility.duplicate_claim':
      return <NumberField label="Lookback days" value={p.lookback_days} onChange={(v) => setProp('lookback_days', v)} disabled={disabled} />;

    // ---------------- Calculation ----------------
    case 'formula.variable':
      return (
        <SelectField label="Variable" value={p.variable_key} onChange={(v) => setProp('variable_key', v)}
          options={FORMULA_VARIABLES.map((v) => ({ value: v.key, label: `${v.key} — ${v.label}` }))} disabled={disabled} />
      );
    case 'formula.operator':
      return <SelectField label="Operator" value={p.operator} onChange={(v) => setProp('operator', v)} options={['+', '-', '*', '/', '%']} disabled={disabled} />;
    case 'formula.constant':
      return <NumberField label="Value" value={p.value} onChange={(v) => setProp('value', v)} disabled={disabled} />;
    case 'formula.cap':
      return (
        <>
          <NumberField label="Cap" value={p.cap} onChange={(v) => setProp('cap', v)} disabled={disabled} />
          <SelectField label="Cap type" value={p.cap_type} onChange={(v) => setProp('cap_type', v)} options={['WEEKLY', 'MONTHLY', 'ANNUAL', 'LIFETIME']} disabled={disabled} />
        </>
      );
    case 'formula.minimum': return <NumberField label="Minimum" value={p.min} onChange={(v) => setProp('min', v)} disabled={disabled} />;
    case 'formula.maximum': return <NumberField label="Maximum" value={p.max} onChange={(v) => setProp('max', v)} disabled={disabled} />;
    case 'formula.share_percentage':
      return (
        <>
          <NumberField label="Percentage" value={p.percentage} onChange={(v) => setProp('percentage', v)} disabled={disabled} />
          <SelectField label="Applies to" value={p.applies_to} onChange={(v) => setProp('applies_to', v)} options={['BASE', 'AVERAGE', 'TOTAL']} disabled={disabled} />
        </>
      );

    // ---------------- Documents ----------------
    case 'document.required':
      return (
        <>
          <SelectField label="Document code" value={p.document_code} onChange={(v) => setProp('document_code', v)}
            options={documentCodeOptions(documentProfiles, p.document_code)} disabled={disabled} />
          <SelectField label="Requirement" value={p.requirement} onChange={(v) => setProp('requirement', v)} options={['REQUIRED', 'OPTIONAL', 'CONDITIONAL']} disabled={disabled} />
          <SelectField label="Stage" value={p.stage} onChange={(v) => setProp('stage', v)} options={['INTAKE', 'EVIDENCE_REVIEW', 'DECISION', 'POST_AWARD']} disabled={disabled} />
          <SwitchField label="Public upload allowed" value={p.public_upload} onChange={(v) => setProp('public_upload', v)} disabled={disabled} />
          <SwitchField label="Waiver allowed" value={p.waiver_allowed} onChange={(v) => setProp('waiver_allowed', v)} disabled={disabled} />
          <SwitchField label="Verification required" value={p.verification_required} onChange={(v) => setProp('verification_required', v)} disabled={disabled} />
        </>
      );

    // ---------------- Screen ----------------
    case 'screen.section':
      return (
        <>
          <TextField label="Title" value={p.title} onChange={(v) => setProp('title', v)} disabled={disabled} />
          <NumberField label="Columns" value={p.columns} onChange={(v) => setProp('columns', v)} disabled={disabled} />
        </>
      );
    case 'screen.field':
      return (
        <>
          <TextField label="Label" value={p.label} onChange={(v) => setProp('label', v)} disabled={disabled} />
          <SelectField label="Field type" value={p.field_type} onChange={(v) => setProp('field_type', v)}
            options={SMART_FIELD_TYPES.map((t) => ({ value: t.key, label: t.label }))} disabled={disabled} />
          <SelectField label="Required condition" value={p.required_condition} onChange={(v) => setProp('required_condition', v)} options={['ALWAYS', 'NEVER', 'CONDITIONAL']} disabled={disabled} />
          <TextField label="Data source" value={p.data_source} onChange={(v) => setProp('data_source', v)} disabled={disabled} />
          <TextField label="Help text" value={p.help_text} onChange={(v) => setProp('help_text', v)} disabled={disabled} />
        </>
      );

    // ---------------- Workflow ----------------
    case 'workflow.step':
      return (
        <>
          <TextField label="Step code" value={p.step_code} onChange={(v) => setProp('step_code', v)} disabled={disabled} />
          <SelectField label="Role" value={p.role} onChange={(v) => setProp('role', v)} options={workflowRoles} disabled={disabled} />
          <TextField label="Workbasket ID" value={p.workbasket_id} onChange={(v) => setProp('workbasket_id', v)} disabled={disabled} />
          <NumberField label="SLA (hours)" value={p.sla_hours} onChange={(v) => setProp('sla_hours', v)} disabled={disabled} />
          <TextField label="Escalation policy ID" value={p.escalation_policy_id} onChange={(v) => setProp('escalation_policy_id', v)} disabled={disabled} />
          <TextField label="Communication event" value={p.comm_event_code} onChange={(v) => setProp('comm_event_code', v)} disabled={disabled} />
        </>
      );
    case 'workflow.escalation':
      return (
        <>
          <TextField label="Policy code" value={p.policy_code} onChange={(v) => setProp('policy_code', v)} disabled={disabled} />
          <SelectField label="Target role" value={p.target_role} onChange={(v) => setProp('target_role', v)} options={workflowRoles} disabled={disabled} />
          <SelectField label="Trigger" value={p.trigger} onChange={(v) => setProp('trigger', v)} options={BN_ESCALATION_TRIGGERS.map((t) => ({ value: t.value, label: t.label }))} disabled={disabled} />
          <SelectField label="Severity" value={p.severity} onChange={(v) => setProp('severity', v)} options={BN_ESCALATION_SEVERITIES.map((t) => ({ value: t.value, label: t.label }))} disabled={disabled} />
        </>
      );
    case 'workflow.workbasket_routing':
      return (
        <>
          <TextField label="Step code" value={p.step_code} onChange={(v) => setProp('step_code', v)} disabled={disabled} />
          <TextField label="Workbasket ID" value={p.workbasket_id} onChange={(v) => setProp('workbasket_id', v)} disabled={disabled} />
        </>
      );

    // ---------------- Communications ----------------
    case 'comm.event':
      return (
        <>
          <TextField label="Event code" value={p.event_code} onChange={(v) => setProp('event_code', v)} disabled={disabled} />
          <SelectField label="Recipient" value={p.recipient_type} onChange={(v) => setProp('recipient_type', v)} options={['CLAIMANT', 'EMPLOYER', 'STAFF', 'BENEFICIARY']} disabled={disabled} />
          <SelectField label="Delivery method" value={p.delivery_method} onChange={(v) => setProp('delivery_method', v)} options={['EMAIL', 'SMS', 'POSTAL', 'IN_APP']} disabled={disabled} />
          <TextField label="Template code" value={p.template_code} onChange={(v) => setProp('template_code', v)} disabled={disabled} />
          <SelectField label="Fallback method" value={p.fallback_method} onChange={(v) => setProp('fallback_method', v)} options={['EMAIL', 'SMS', 'POSTAL', 'IN_APP', 'NONE']} disabled={disabled} />
          <SwitchField label="Mandatory" value={p.mandatory} onChange={(v) => setProp('mandatory', v)} disabled={disabled} />
          <SwitchField label="Approval required" value={p.approval_required} onChange={(v) => setProp('approval_required', v)} disabled={disabled} />
        </>
      );

    case 'reason_code':
      return <TextField label="Reason code" value={p.reason_code} onChange={(v) => setProp('reason_code', v)} disabled={disabled} />;

    default:
      return <p className="text-xs text-muted-foreground">No inspector for {block.kind} yet.</p>;
  }
}

function TextField({ label, value, onChange, placeholder, disabled }: { label: string; value: any; onChange: (v: string) => void; placeholder?: string; disabled?: boolean }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="h-8 text-xs" />
    </div>
  );
}
function NumberField({ label, value, onChange, disabled }: { label: string; value: any; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type="number" value={value ?? 0} onChange={(e) => onChange(Number(e.target.value))} disabled={disabled} className="h-8 text-xs" />
    </div>
  );
}
function SwitchField({ label, value, onChange, disabled }: { label: string; value: any; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <Label className="text-xs">{label}</Label>
      <Switch checked={!!value} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}
function SelectField({ label, value, onChange, options, disabled }: { label: string; value: any; onChange: (v: string) => void; options: (string | { value: string; label: string })[]; disabled?: boolean }) {
  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Select value={value ?? ''} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select…" /></SelectTrigger>
        <SelectContent>
          {opts.map((o) => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
