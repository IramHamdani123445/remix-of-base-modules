import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { PermissionWrapper } from '@/components/ui/permission-wrapper';
import { PermissionButton } from '@/components/ui/permission-button';
import { useUserCode } from '@/hooks/useUserCode';
import { toast } from 'sonner';
import { Pencil, Plus, BadgePercent, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import {
  listWaiverRules,
  upsertWaiverRule,
  toggleWaiverRule,
  type WaiverRule,
  type WaiverType,
} from '@/services/waiverService';
import { isComplianceFeatureEnabled } from '@/lib/compliance/featureToggles';

const PERMISSION = 'manage_compliance';
const WAIVER_TYPES: WaiverType[] = ['PENALTY', 'INTEREST', 'PRINCIPAL', 'FULL', 'PARTIAL'];
const FUND_CODES = ['SS', 'ST', 'HC', 'EC'];

function emptyRule(): Partial<WaiverRule> {
  return {
    code: '',
    name: '',
    description: '',
    enabled: true,
    waiver_type: 'PARTIAL',
    max_percentage: 100,
    amount_threshold: 0,
    applicable_violation_type_ids: [],
    applicable_funds: [],
    valid_reasons: [],
    required_documents: [],
    approval_workflow_required: true,
    audit_required: true,
    notes: '',
    sort_order: 0,
  };
}

export default function WaiverRulesPage() {
  if (!isComplianceFeatureEnabled('admin.waiverRules')) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <AlertCircle className="mx-auto h-8 w-8 mb-2" />
            Waiver feature is disabled. Enable it from Administration → Feature Toggles.
          </CardContent>
        </Card>
      </div>
    );
  }
  return (
    <PermissionWrapper moduleName={PERMISSION}>
      <Inner />
    </PermissionWrapper>
  );
}

function Inner() {
  const qc = useQueryClient();
  const { userCode } = useUserCode();
  const [editor, setEditor] = useState<{ open: boolean; rule: Partial<WaiverRule> | null }>({
    open: false,
    rule: null,
  });

  const rulesQ = useQuery({ queryKey: ['waiver-rules'], queryFn: listWaiverRules });

  const violationTypesQ = useQuery({
    queryKey: ['violation-types-min'],
    queryFn: async () => {
      const { data } = await supabase
        .from('ce_violation_types')
        .select('id, code, name, category')
        .eq('is_active', true)
        .order('name');
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: (r: Partial<WaiverRule>) => upsertWaiverRule(r, userCode || 'SYSTEM'),
    onSuccess: () => {
      toast.success('Waiver rule saved');
      qc.invalidateQueries({ queryKey: ['waiver-rules'] });
      setEditor({ open: false, rule: null });
    },
    onError: (e: any) => toast.error(e.message || 'Failed to save'),
  });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      toggleWaiverRule(id, enabled, userCode || 'SYSTEM'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['waiver-rules'] }),
  });

  const rules = rulesQ.data ?? [];

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <BadgePercent className="h-6 w-6" /> Waiver Rules
          </h1>
          <p className="text-muted-foreground text-sm">
            Configure waiver types, caps, eligibility, required documents and approval flow.
          </p>
        </div>
        <PermissionButton
          moduleName={PERMISSION}
          actionName="create"
          onClick={() => setEditor({ open: true, rule: emptyRule() })}
        >
          <Plus className="h-4 w-4 mr-1" /> New Waiver Rule
        </PermissionButton>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configured Rules</CardTitle>
          <CardDescription>
            Rules drive validation, eligibility and approval routing for every waiver request.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rulesQ.isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : rules.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4" /> No waiver rules configured.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Max %</TableHead>
                  <TableHead>Threshold</TableHead>
                  <TableHead>Approval WF</TableHead>
                  <TableHead>Audit</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.code}</TableCell>
                    <TableCell>
                      <div className="font-medium">{r.name}</div>
                      {r.description && (
                        <div className="text-xs text-muted-foreground line-clamp-1">
                          {r.description}
                        </div>
                      )}
                    </TableCell>
                    <TableCell><Badge variant="outline">{r.waiver_type}</Badge></TableCell>
                    <TableCell>{r.max_percentage ?? '—'}</TableCell>
                    <TableCell>{r.amount_threshold ?? '—'}</TableCell>
                    <TableCell>{r.approval_workflow_required ? 'Yes' : 'No'}</TableCell>
                    <TableCell>{r.audit_required ? 'Yes' : 'No'}</TableCell>
                    <TableCell>
                      <Switch
                        checked={r.enabled}
                        onCheckedChange={(v) => toggle.mutate({ id: r.id, enabled: v })}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <PermissionButton
                        moduleName={PERMISSION}
                        actionName="edit"
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditor({ open: true, rule: { ...r } })}
                      >
                        <Pencil className="h-4 w-4" />
                      </PermissionButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {editor.open && editor.rule && (
        <Editor
          key={(editor.rule as any).id ?? 'new'}
          rule={editor.rule}
          violationTypes={violationTypesQ.data ?? []}
          onClose={() => setEditor({ open: false, rule: null })}
          onSave={(r) => save.mutate(r)}
          saving={save.isPending}
        />
      )}
    </div>
  );
}

function Editor({
  rule,
  onClose,
  onSave,
  saving,
  violationTypes,
}: {
  rule: Partial<WaiverRule>;
  onClose: () => void;
  onSave: (r: Partial<WaiverRule>) => void;
  saving: boolean;
  violationTypes: any[];
}) {
  const [local, setLocal] = useState<Partial<WaiverRule>>(rule);
  const toggleArr = (arr: any[], val: any) =>
    arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];

  const update = <K extends keyof WaiverRule>(k: K, v: WaiverRule[K]) =>
    setLocal({ ...local, [k]: v });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{local.id ? 'Edit Waiver Rule' : 'New Waiver Rule'}</DialogTitle>
          <DialogDescription>
            Drives validation and approval routing — no code changes required.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="basics">
          <TabsList>
            <TabsTrigger value="basics">Basics</TabsTrigger>
            <TabsTrigger value="scope">Scope</TabsTrigger>
            <TabsTrigger value="reasons">Reasons & Docs</TabsTrigger>
            <TabsTrigger value="approval">Approval</TabsTrigger>
          </TabsList>

          <TabsContent value="basics" className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Code">
                <Input
                  value={local.code ?? ''}
                  onChange={(e) => update('code', e.target.value.toUpperCase() as any)}
                  placeholder="HARDSHIP_FULL"
                />
              </Field>
              <Field label="Name">
                <Input value={local.name ?? ''} onChange={(e) => update('name', e.target.value as any)} />
              </Field>
            </div>
            <Field label="Description">
              <Textarea rows={2} value={local.description ?? ''} onChange={(e) => update('description', e.target.value as any)} />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Waiver Type">
                <Select value={local.waiver_type} onValueChange={(v) => update('waiver_type', v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WAIVER_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Max Percentage (0-100)">
                <Input type="number" min={0} max={100}
                  value={local.max_percentage ?? 0}
                  onChange={(e) => update('max_percentage', Number(e.target.value) as any)} />
              </Field>
              <Field label="Amount Threshold (workflow trigger)">
                <Input type="number" min={0}
                  value={local.amount_threshold ?? 0}
                  onChange={(e) => update('amount_threshold', Number(e.target.value) as any)} />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Required Approval Role">
                <Select value={(local as any).required_approval_role ?? 'senior'}
                  onValueChange={(v) => update('required_approval_role' as any, v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {APPROVAL_ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Escalated Approval Role (above threshold)">
                <Select value={(local as any).escalated_approval_role ?? 'head'}
                  onValueChange={(v) => update('escalated_approval_role' as any, v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {APPROVAL_ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Sort Order">
                <Input type="number" value={local.sort_order ?? 0}
                  onChange={(e) => update('sort_order', Number(e.target.value) as any)} />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              Approval authority is enforced in the database: amounts above the threshold require the
              escalated role, and no rule means the highest authority is required.
            </p>

          </TabsContent>

          <TabsContent value="scope" className="space-y-3">
            <div>
              <Label className="mb-2 block">Applicable Funds (empty = all)</Label>
              <div className="flex flex-wrap gap-2">
                {FUND_CODES.map((f) => {
                  const checked = (local.applicable_funds ?? []).includes(f);
                  return (
                    <label key={f} className="flex items-center gap-1 text-xs border rounded px-2 py-1 cursor-pointer">
                      <input type="checkbox" checked={checked}
                        onChange={() => update('applicable_funds', toggleArr(local.applicable_funds ?? [], f) as any)} />
                      {f}
                    </label>
                  );
                })}
              </div>
            </div>
            <div>
              <Label className="mb-2 block">Applicable Violation Types (empty = all)</Label>
              <div className="border rounded-md p-2 max-h-56 overflow-y-auto space-y-1">
                {violationTypes.map((t) => {
                  const checked = (local.applicable_violation_type_ids ?? []).includes(t.id);
                  return (
                    <label key={t.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={checked}
                        onChange={() => update('applicable_violation_type_ids',
                          toggleArr(local.applicable_violation_type_ids ?? [], t.id) as any)} />
                      <span className="font-mono text-xs text-muted-foreground">{t.code}</span>
                      <span>{t.name}</span>
                    </label>
                  );
                })}
                {violationTypes.length === 0 && (
                  <p className="text-xs text-muted-foreground">No active violation types.</p>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="reasons" className="space-y-3">
            <Field label="Valid Reasons (one per line)">
              <Textarea rows={5}
                value={(local.valid_reasons ?? []).join('\n')}
                onChange={(e) => update('valid_reasons',
                  e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) as any)} />
            </Field>
            <Field label="Required Documents (one per line)">
              <Textarea rows={4}
                value={(local.required_documents ?? []).join('\n')}
                onChange={(e) => update('required_documents',
                  e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) as any)} />
            </Field>
          </TabsContent>

          <TabsContent value="approval" className="space-y-3">
            <BoolRow label="Approval workflow required"
              v={!!local.approval_workflow_required}
              onChange={(v) => update('approval_workflow_required', v as any)} />
            <BoolRow label="Audit trail required"
              v={!!local.audit_required}
              onChange={(v) => update('audit_required', v as any)} />
            <BoolRow label="Enabled"
              v={!!local.enabled}
              onChange={(v) => update('enabled', v as any)} />
            <Field label="Notes (visible to reviewers)">
              <Textarea rows={3} value={local.notes ?? ''}
                onChange={(e) => update('notes', e.target.value as any)} />
            </Field>
            <p className="text-xs text-muted-foreground">
              Workflow routing for this rule is controlled centrally under
              Administration → Workflow Mapping (event key <code>waiver.approval</code>).
            </p>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={saving || !local.code || !local.name} onClick={() => onSave(local)}>
            {saving ? 'Saving…' : 'Save Rule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
function BoolRow({ label, v, onChange }: { label: string; v: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between border rounded-md px-3 py-2">
      <span className="text-sm">{label}</span>
      <Switch checked={v} onCheckedChange={onChange} />
    </div>
  );
}
