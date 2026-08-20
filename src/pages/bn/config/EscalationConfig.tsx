import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Edit, Plus, Trash2, PlayCircle } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useUserCode } from '@/hooks/useUserCode';
import { PermissionWrapper } from '@/components/ui/permission-wrapper';
import { toast } from 'sonner';
import type { BnEscalationPolicy, BnEscalationPolicyLevel } from '@/types/bn';
import { BnScreenRoleBanner } from '@/components/bn/shared';
import { SmartSelect, CodeFieldWithAutoGenerate } from '@/components/bn/smart';
import {
  BN_ESCALATION_TRIGGERS,
  BN_ESCALATION_SEVERITIES,
  BN_ESCALATION_ACTION_TYPES,
  BN_ESCALATION_ENTITY_TYPES,
} from '@/services/bn/registries';
import { useReferenceValues } from '@/hooks/bn/useReferenceData';
import { BN_REF_GROUPS } from '@/services/bn/referenceDataService';
import { useWorkflowRoles } from '@/hooks/bn/useWorkflowRoles';
import { useBnConfigAudit } from '@/hooks/bn/useBnConfigAudit';
import { BNDataGrid, type BNColumnDef } from '@/components/bn/grid';

const db = supabase as any;

type LevelDraft = Partial<BnEscalationPolicyLevel> & { _key: string; _new?: boolean; _deleted?: boolean };

const emptyForm = () => ({
  policy_code: '',
  policy_name: '',
  description: '',
  trigger_type: 'SLA_BREACH',
  applies_to_entity_type: 'WORKFLOW_STEP',
  calendar_code: '',
  use_business_hours: true,
  warning_before_hours: '',
  due_after_hours: '24',
  breach_after_hours: '24',
  escalation_target_role: '',
  escalation_target_user: '',
  auto_reassign: false,
  create_escalation_task: false,
  notify_assignee: true,
  notify_supervisor: true,
  notify_target_role: true,
  notification_template_code: '',
  repeat_interval_hours: '',
  max_repeat_count: '',
  severity: 'MEDIUM',
  is_active: true,
  effective_from: '',
  effective_to: '',
});

export default function EscalationConfig() {
  const { userCode } = useUserCode();
  const { log } = useBnConfigAudit();
  const { roles: workflowRoles } = useWorkflowRoles();
  const qc = useQueryClient();
  const [editItem, setEditItem] = useState<BnEscalationPolicy | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [levels, setLevels] = useState<LevelDraft[]>([]);

  // Reference-data driven dropdowns (with hardcoded fallback for offline)
  const { options: triggerOptions } = useReferenceValues(
    BN_REF_GROUPS.ESCALATION_TRIGGER_TYPE,
    BN_ESCALATION_TRIGGERS.map(t => ({ value: t.value, label: t.label })),
  );
  const { options: severityOptions } = useReferenceValues(
    BN_REF_GROUPS.ESCALATION_SEVERITY,
    BN_ESCALATION_SEVERITIES.map(t => ({ value: t.value, label: t.label })),
  );
  const { options: actionOptions } = useReferenceValues(
    BN_REF_GROUPS.ESCALATION_ACTION_TYPE,
    BN_ESCALATION_ACTION_TYPES.map(t => ({ value: t.value, label: t.label })),
  );

  const { data: policies = [], isLoading, refetch } = useQuery({
    queryKey: ['bn', 'escalation-policies'],
    queryFn: async () => {
      const { data, error } = await db
        .from('bn_escalation_policy')
        .select('*')
        .order('policy_name');
      if (error) throw error;
      return data as BnEscalationPolicy[];
    },
  });

  // Load levels for the policy being edited
  useEffect(() => {
    if (!editItem || isNew || !editItem.id) {
      setLevels([]);
      return;
    }
    let active = true;
    (async () => {
      const { data } = await db
        .from('bn_escalation_policy_level')
        .select('*')
        .eq('policy_id', editItem.id)
        .order('level_no');
      if (active) {
        setLevels((data ?? []).map((r: BnEscalationPolicyLevel) => ({ ...r, _key: r.id })));
      }
    })();
    return () => { active = false; };
  }, [editItem, isNew]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        policy_code: form.policy_code,
        policy_name: form.policy_name,
        description: form.description || null,
        trigger_type: form.trigger_type,
        trigger_config: { hours_overdue: Number(form.breach_after_hours) || null },
        applies_to_entity_type: form.applies_to_entity_type,
        calendar_code: form.calendar_code || null,
        use_business_hours: form.use_business_hours,
        warning_before_hours: form.warning_before_hours ? Number(form.warning_before_hours) : null,
        due_after_hours: form.due_after_hours ? Number(form.due_after_hours) : null,
        breach_after_hours: form.breach_after_hours ? Number(form.breach_after_hours) : null,
        escalation_target_role: form.escalation_target_role,
        escalation_target_user: form.escalation_target_user || null,
        auto_reassign: form.auto_reassign,
        create_escalation_task: form.create_escalation_task,
        notify_assignee: form.notify_assignee,
        notify_supervisor: form.notify_supervisor,
        notify_target_role: form.notify_target_role,
        notification_template_code: form.notification_template_code || null,
        repeat_interval_hours: form.repeat_interval_hours ? Number(form.repeat_interval_hours) : null,
        max_repeat_count: form.max_repeat_count ? Number(form.max_repeat_count) : null,
        severity: form.severity,
        is_active: form.is_active,
        effective_from: form.effective_from || null,
        effective_to: form.effective_to || null,
      };

      let policyId = editItem?.id;
      if (isNew) {
        const { data, error } = await db
          .from('bn_escalation_policy')
          .insert({ ...payload, entered_by: userCode })
          .select()
          .single();
        if (error) throw error;
        policyId = data.id;
        log({ entityType: 'bn_escalation_policy', entityId: policyId, action: 'CREATE', after: payload });
      } else {
        const { error } = await db
          .from('bn_escalation_policy')
          .update({ ...payload, modified_by: userCode, modified_at: new Date().toISOString() })
          .eq('id', editItem!.id);
        if (error) throw error;
        log({ entityType: 'bn_escalation_policy', entityId: editItem!.id, action: 'UPDATE', before: editItem as any, after: payload });
      }

      // Persist levels (basic upsert/delete)
      for (const lvl of levels) {
        if (lvl._deleted && lvl.id) {
          await db.from('bn_escalation_policy_level').delete().eq('id', lvl.id);
          continue;
        }
        const row = {
          policy_id: policyId,
          level_no: Number(lvl.level_no) || 1,
          trigger_after_hours: Number(lvl.trigger_after_hours) || 0,
          target_role: lvl.target_role || form.escalation_target_role,
          target_user: lvl.target_user || null,
          severity: lvl.severity || 'MEDIUM',
          action_type: lvl.action_type || 'NOTIFY',
          notification_template_code: lvl.notification_template_code || null,
          auto_reassign: !!lvl.auto_reassign,
          repeat_interval_hours: lvl.repeat_interval_hours ?? null,
          max_repeat_count: lvl.max_repeat_count ?? null,
          is_active: lvl.is_active ?? true,
        };
        if (lvl._new || !lvl.id) {
          await db.from('bn_escalation_policy_level').insert({ ...row, entered_by: userCode });
        } else {
          await db
            .from('bn_escalation_policy_level')
            .update({ ...row, modified_by: userCode, modified_at: new Date().toISOString() })
            .eq('id', lvl.id);
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bn', 'escalation-policies'] });
      toast.success(isNew ? 'Policy created' : 'Policy updated');
      setEditItem(null);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const openNew = () => {
    setIsNew(true);
    setForm(emptyForm());
    setLevels([]);
    setEditItem({} as any);
  };

  const openEdit = (item: BnEscalationPolicy) => {
    setIsNew(false);
    setForm({
      policy_code: item.policy_code,
      policy_name: item.policy_name,
      description: item.description ?? '',
      trigger_type: item.trigger_type,
      applies_to_entity_type: item.applies_to_entity_type ?? 'WORKFLOW_STEP',
      calendar_code: item.calendar_code ?? '',
      use_business_hours: item.use_business_hours ?? true,
      warning_before_hours: item.warning_before_hours?.toString() ?? '',
      due_after_hours: item.due_after_hours?.toString() ?? '',
      breach_after_hours: item.breach_after_hours?.toString() ?? ((item.trigger_config as any)?.hours_overdue?.toString() ?? ''),
      escalation_target_role: item.escalation_target_role,
      escalation_target_user: item.escalation_target_user ?? '',
      auto_reassign: item.auto_reassign,
      create_escalation_task: item.create_escalation_task ?? false,
      notify_assignee: item.notify_assignee ?? true,
      notify_supervisor: item.notify_supervisor ?? true,
      notify_target_role: item.notify_target_role ?? true,
      notification_template_code: item.notification_template_code ?? '',
      repeat_interval_hours: item.repeat_interval_hours?.toString() ?? '',
      max_repeat_count: item.max_repeat_count?.toString() ?? '',
      severity: item.severity,
      is_active: item.is_active,
      effective_from: item.effective_from ?? '',
      effective_to: item.effective_to ?? '',
    });
    setEditItem(item);
  };

  const handleSave = () => {
    if (!form.policy_code.trim() || !form.policy_name.trim()) {
      toast.error('Code and Name are required'); return;
    }
    if (!form.escalation_target_role) { toast.error('Target Role is required'); return; }
    if (!form.breach_after_hours || Number(form.breach_after_hours) < 1) {
      toast.error('Breach After Hours must be a positive number'); return;
    }
    // Warning/Due/Breach are three checkpoints on the same clock (hours since the
    // task was created) — blank Warning/Due just means that checkpoint is skipped,
    // but whichever are set must not run later than the ones after them.
    const warnH = form.warning_before_hours ? Number(form.warning_before_hours) : null;
    const dueH = form.due_after_hours ? Number(form.due_after_hours) : null;
    const breachH = Number(form.breach_after_hours);
    if (dueH != null && dueH > breachH) {
      toast.error('Due After cannot be later than Breach After'); return;
    }
    if (warnH != null) {
      const ceiling = dueH ?? breachH;
      if (warnH > ceiling) {
        toast.error(dueH != null
          ? 'Warning Before cannot be later than Due After'
          : 'Warning Before cannot be later than Breach After'); return;
      }
    }
    if (form.effective_from && form.effective_to && form.effective_from > form.effective_to) {
      toast.error('Effective From must be on or before Effective To'); return;
    }
    if (isNew && policies.some(x => x.policy_code.toUpperCase() === form.policy_code.toUpperCase())) {
      toast.error('Policy code already exists'); return;
    }
    // Level validation: unique level_no, and trigger hours must increase with level number
    const visible = levels.filter(l => !l._deleted);
    const nums = visible.map(l => Number(l.level_no));
    if (new Set(nums).size !== nums.length) {
      toast.error('Escalation level numbers must be unique'); return;
    }
    const byLevel = visible.slice().sort((a, b) => Number(a.level_no) - Number(b.level_no));
    for (let i = 1; i < byLevel.length; i++) {
      if (Number(byLevel[i].trigger_after_hours) <= Number(byLevel[i - 1].trigger_after_hours)) {
        toast.error(`Escalation level ${byLevel[i].level_no}'s "After (h)" must be greater than level ${byLevel[i - 1].level_no}'s`);
        return;
      }
    }
    saveMutation.mutate();
  };

  const addLevel = () => {
    const nextNo = (levels.filter(l => !l._deleted).reduce((m, l) => Math.max(m, Number(l.level_no) || 0), 0) || 0) + 1;
    setLevels(prev => [...prev, {
      _key: `new-${Date.now()}-${Math.random()}`,
      _new: true,
      level_no: nextNo,
      trigger_after_hours: 24,
      target_role: form.escalation_target_role,
      severity: 'MEDIUM',
      action_type: 'NOTIFY',
      auto_reassign: false,
      is_active: true,
    }]);
  };

  const updateLevel = (key: string, patch: Partial<LevelDraft>) =>
    setLevels(prev => prev.map(l => (l._key === key ? { ...l, ...patch } : l)));

  const removeLevel = (key: string) =>
    setLevels(prev => prev.map(l => (l._key === key ? { ...l, _deleted: true } : l)));

  const roleOptions = workflowRoles.map(r => ({ value: r, label: r.replace(/_/g, ' ') }));

  return (
    <PermissionWrapper moduleName="benefits_management">
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <h1 className="t-page-title">Escalation Policies</h1>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const t = toast.loading('Running escalation scan...');
              try {
                const { data, error } = await supabase.functions.invoke('bn-escalation-runner', {
                  body: { performedBy: userCode || 'MANUAL' },
                });
                if (error) throw error;
                toast.success(
                  `Scan complete — scanned ${data?.scanned ?? 0}, escalated ${data?.escalated ?? 0}, skipped ${data?.skipped ?? 0}`,
                  { id: t },
                );
              } catch (e: any) {
                toast.error(`Escalation runner failed: ${e?.message || e}`, { id: t });
              }
            }}
          >
            <PlayCircle className="h-4 w-4 mr-1" /> Run Now
          </Button>
        </div>

        <BnScreenRoleBanner
          role="library"
          productAssemblyHint
          description="Reusable SLA escalation framework. Workflow steps, workbaskets, task types, claim stages, override and payment approvals all reference these policies. Multi-level rules and business calendars supported. Auto-runs every 15 minutes."
        />

        <BNDataGrid
          id="bn.escalation-policies"
          data={policies}
          isLoading={isLoading}
          searchPlaceholder="Search escalation policies..."
          onCreate={openNew}
          onRefresh={() => refetch()}
          defaultSort={[{ id: 'policy_name', desc: false }]}
          exportFilename="bn_escalation_policies"
          emptyMessage="No escalation policies configured"
          columns={[
            { accessorKey: 'policy_code', header: 'Code', meta: { label: 'Code', pinLeft: true, width: 160 }, cell: ({ getValue }) => <span className="font-mono text-sm">{String(getValue() ?? '')}</span> },
            { accessorKey: 'policy_name', header: 'Name', meta: { label: 'Name', width: 240 } },
            { accessorKey: 'applies_to_entity_type', header: 'Applies To', meta: { label: 'Applies To', width: 160 }, cell: ({ getValue }) => <Badge variant="outline">{String(getValue() ?? '')}</Badge> },
            { accessorKey: 'trigger_type', header: 'Trigger', meta: { label: 'Trigger', width: 160 }, cell: ({ getValue }) => <Badge variant="outline">{String(getValue() ?? '')}</Badge> },
            { accessorKey: 'breach_after_hours', header: 'Breach (h)', meta: { label: 'Breach (h)', width: 110 } },
            { accessorKey: 'escalation_target_role', header: 'Target Role', meta: { label: 'Target Role', width: 200 }, cell: ({ getValue }) => <Badge variant="secondary">{String(getValue() ?? '')}</Badge> },
            { accessorKey: 'severity', header: 'Severity', meta: { label: 'Severity', width: 120 }, cell: ({ getValue }) => {
              const s = String(getValue() ?? '');
              return <Badge variant={s === 'CRITICAL' || s === 'HIGH' ? 'destructive' : 'outline'}>{s}</Badge>;
            } },
            { accessorKey: 'use_business_hours', header: 'Biz Hours', meta: { label: 'Business Hours', width: 110 }, cell: ({ getValue }) => getValue() ? 'Yes' : '24x7' },
            { accessorKey: 'is_active', header: 'Active', meta: { label: 'Active', width: 100 }, cell: ({ getValue }) => <Badge variant={getValue() ? 'default' : 'outline'}>{getValue() ? 'Active' : 'Inactive'}</Badge> },
          ] as BNColumnDef<BnEscalationPolicy>[]}
          rowActions={[
            { key: 'edit', label: 'Edit', icon: <Edit className="h-3.5 w-3.5" />, onClick: openEdit },
          ]}
        />

        <Dialog open={!!editItem} onOpenChange={open => !open && setEditItem(null)}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{isNew ? 'Add Escalation Policy' : 'Edit Escalation Policy'}</DialogTitle></DialogHeader>

            <div className="space-y-4">
              {/* Identity */}
              <div className="grid grid-cols-2 gap-3">
                {isNew ? (
                  <CodeFieldWithAutoGenerate
                    label="Code"
                    value={form.policy_code}
                    onChange={(v) => setForm(p => ({ ...p, policy_code: v }))}
                    existingCodes={policies.map(x => x.policy_code)}
                    prefix="ESC"
                    required
                  />
                ) : (
                  <div className="space-y-1"><label className="text-sm font-medium">Code</label><Input value={form.policy_code} disabled /></div>
                )}
                <div className="space-y-1"><label className="text-sm font-medium">Name</label><Input value={form.policy_name} onChange={e => setForm(p => ({ ...p, policy_name: e.target.value }))} /></div>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Description</label>
                <Input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
              </div>

              {/* Scope */}
              <div className="grid grid-cols-3 gap-3">
                <SmartSelect
                  label="Applies To"
                  value={form.applies_to_entity_type}
                  onValueChange={(v) => setForm(p => ({ ...p, applies_to_entity_type: v }))}
                  options={BN_ESCALATION_ENTITY_TYPES.map(t => ({ value: t.value, label: t.label }))}
                  required
                />
                <SmartSelect
                  label="Trigger Type"
                  value={form.trigger_type}
                  onValueChange={(v) => setForm(p => ({ ...p, trigger_type: v }))}
                  options={triggerOptions}
                />
                <SmartSelect
                  label="Severity"
                  value={form.severity}
                  onValueChange={(v) => setForm(p => ({ ...p, severity: v }))}
                  options={severityOptions}
                />
              </div>

              {/* SLA timing */}
              <p className="text-xs text-muted-foreground">
                All three are hours counted from when the task is created. Due After and Breach After should increase in that order; Breach After alone is required — leave Warning Before and/or Due After blank to skip that checkpoint.
              </p>
              <div className="grid grid-cols-4 gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Warning Before (h)</label>
                  <Input type="number" min={0} value={form.warning_before_hours} onChange={e => setForm(p => ({ ...p, warning_before_hours: e.target.value }))} />
                  <p className="text-xs text-muted-foreground">Blank = no reminder sent before it's due.</p>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Due After (h)</label>
                  <Input type="number" min={0} value={form.due_after_hours} onChange={e => setForm(p => ({ ...p, due_after_hours: e.target.value }))} />
                  <p className="text-xs text-muted-foreground">Blank = no separate due date; only Breach After applies.</p>
                </div>
                <div className="space-y-1"><label className="text-sm font-medium">Breach After (h) *</label><Input type="number" min={1} value={form.breach_after_hours} onChange={e => setForm(p => ({ ...p, breach_after_hours: e.target.value }))} /></div>
                <div className="space-y-1"><label className="text-sm font-medium">Calendar Code</label><Input value={form.calendar_code} placeholder="e.g. SKN_OFFICE" onChange={e => setForm(p => ({ ...p, calendar_code: e.target.value }))} /></div>
              </div>
              <div className="flex items-center gap-2"><Switch checked={form.use_business_hours} onCheckedChange={v => setForm(p => ({ ...p, use_business_hours: v }))} /><label className="text-sm">Use business hours / calendar (off = 24x7 clock)</label></div>

              {/* Target */}
              <div className="grid grid-cols-2 gap-3">
                <SmartSelect
                  label="Target Role"
                  value={form.escalation_target_role}
                  onValueChange={(v) => setForm(p => ({ ...p, escalation_target_role: v }))}
                  options={roleOptions}
                  required
                />
                <div className="space-y-1"><label className="text-sm font-medium">Target User (optional)</label><Input value={form.escalation_target_user} onChange={e => setForm(p => ({ ...p, escalation_target_user: e.target.value }))} placeholder="User code" /></div>
              </div>

              {/* Notification */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><label className="text-sm font-medium">Notification Template Code</label><Input value={form.notification_template_code} onChange={e => setForm(p => ({ ...p, notification_template_code: e.target.value }))} placeholder="BN_COMM_TEMPLATE_CODE" /></div>
                <div className="grid grid-cols-3 gap-2 items-end">
                  <label className="flex items-center gap-2 text-sm"><Switch checked={form.notify_assignee} onCheckedChange={v => setForm(p => ({ ...p, notify_assignee: v }))} />Assignee</label>
                  <label className="flex items-center gap-2 text-sm"><Switch checked={form.notify_supervisor} onCheckedChange={v => setForm(p => ({ ...p, notify_supervisor: v }))} />Supervisor</label>
                  <label className="flex items-center gap-2 text-sm"><Switch checked={form.notify_target_role} onCheckedChange={v => setForm(p => ({ ...p, notify_target_role: v }))} />Target Role</label>
                </div>
              </div>

              {/* Behavior */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><label className="text-sm font-medium">Repeat Interval (h)</label><Input type="number" min={0} value={form.repeat_interval_hours} onChange={e => setForm(p => ({ ...p, repeat_interval_hours: e.target.value }))} /></div>
                <div className="space-y-1"><label className="text-sm font-medium">Max Repeat Count</label><Input type="number" min={0} value={form.max_repeat_count} onChange={e => setForm(p => ({ ...p, max_repeat_count: e.target.value }))} /></div>
              </div>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm"><Switch checked={form.auto_reassign} onCheckedChange={v => setForm(p => ({ ...p, auto_reassign: v }))} />Auto-Reassign</label>
                <label className="flex items-center gap-2 text-sm"><Switch checked={form.create_escalation_task} onCheckedChange={v => setForm(p => ({ ...p, create_escalation_task: v }))} />Create Escalation Task</label>
                <label className="flex items-center gap-2 text-sm"><Switch checked={form.is_active} onCheckedChange={v => setForm(p => ({ ...p, is_active: v }))} />Active</label>
              </div>

              {/* Effective dates */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><label className="text-sm font-medium">Effective From</label><Input type="date" value={form.effective_from} onChange={e => setForm(p => ({ ...p, effective_from: e.target.value }))} /></div>
                <div className="space-y-1"><label className="text-sm font-medium">Effective To</label><Input type="date" value={form.effective_to} onChange={e => setForm(p => ({ ...p, effective_to: e.target.value }))} /></div>
              </div>

              {/* Multi-level escalation */}
              <div className="border rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Escalation Levels</h3>
                  <Button size="sm" variant="outline" onClick={addLevel} disabled={isNew}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Level
                  </Button>
                </div>
                {isNew && (
                  <p className="text-xs text-muted-foreground">Save the policy first, then add escalation levels.</p>
                )}
                {levels.filter(l => !l._deleted).length > 0 && (
                  <p className="text-xs text-muted-foreground">Each level's "After (h)" must be greater than the previous level's — they fire in sequence, not in parallel.</p>
                )}
                {levels.filter(l => !l._deleted).length === 0 && !isNew && (
                  <p className="text-xs text-muted-foreground">No levels configured. Add one or more to define multi-stage escalation.</p>
                )}
                <div className="space-y-2">
                  {levels.filter(l => !l._deleted).sort((a, b) => Number(a.level_no) - Number(b.level_no)).map(lvl => (
                    <div key={lvl._key} className="grid grid-cols-12 gap-2 items-end border rounded p-2">
                      <div className="col-span-1">
                        <label className="text-xs">Level</label>
                        <Input type="number" min={1} value={lvl.level_no ?? 1} onChange={e => updateLevel(lvl._key, { level_no: Number(e.target.value) })} />
                      </div>
                      <div className="col-span-2">
                        <label className="text-xs">After (h)</label>
                        <Input type="number" min={0} value={lvl.trigger_after_hours ?? 0} onChange={e => updateLevel(lvl._key, { trigger_after_hours: Number(e.target.value) })} />
                      </div>
                      <div className="col-span-3">
                        <SmartSelect
                          label="Target Role"
                          value={lvl.target_role ?? ''}
                          onValueChange={(v) => updateLevel(lvl._key, { target_role: v })}
                          options={roleOptions}
                        />
                      </div>
                      <div className="col-span-2">
                        <SmartSelect
                          label="Severity"
                          value={lvl.severity ?? 'MEDIUM'}
                          onValueChange={(v) => updateLevel(lvl._key, { severity: v })}
                          options={severityOptions}
                        />
                      </div>
                      <div className="col-span-2">
                        <SmartSelect
                          label="Action"
                          value={lvl.action_type ?? 'NOTIFY'}
                          onValueChange={(v) => updateLevel(lvl._key, { action_type: v })}
                          options={actionOptions}
                        />
                      </div>
                      <div className="col-span-1 flex items-center gap-1">
                        <Switch checked={!!lvl.auto_reassign} onCheckedChange={v => updateLevel(lvl._key, { auto_reassign: v })} />
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <Button size="icon" variant="ghost" onClick={() => removeLevel(lvl._key)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setEditItem(null)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saveMutation.isPending}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </PermissionWrapper>
  );
}
