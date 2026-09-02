import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Plus, Trash2, Save, ArrowUp, ArrowDown, Workflow, ShieldAlert } from 'lucide-react';
import { useBnWorkflowTemplates, useUpsertBnWorkflowTemplate } from '@/hooks/bn/useBnConfig';
import { useBnWorkbaskets } from '@/hooks/bn/useBnWorkbasket';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface StepConfig {
  step_code?: string;
  step_name?: string;
  step_type?: string;
  assigned_role?: string;
  workbasket_id?: string | null;
  sla_hours?: number | null;
  escalation_policy_id?: string | null;
  notify_template_code?: string | null;
  is_optional?: boolean;
  description?: string;
  /**
   * BUG-047 — claimWorkbasketResolver.ts (the code that actually routes a
   * submitted claim to a workbasket) reads `step`/`role` on the first step,
   * never `step_type`/`assigned_role`. This editor only ever wrote the
   * latter — every template built purely through this screen looked
   * complete but silently failed to route any claim. Every one of the 45
   * templates already in the database only works because it was seeded with
   * both shapes present; nothing authored through this editor alone has
   * ever produced a step the resolver could read. `step`/`role` are now
   * derived automatically from `step_type` (see `routingFieldsForStepType`)
   * whenever a step type is chosen, so the user never has to know this
   * second, internal vocabulary exists.
   */
  step?: string;
  role?: string;
}

const STEP_TYPES = ['INTAKE', 'REVIEW', 'ELIGIBILITY', 'CALCULATION', 'DECISION', 'APPROVAL', 'PAYMENT', 'NOTIFICATION', 'EXTERNAL_TASK', 'CUSTOM'];

/**
 * Maps a UI step type onto the short `step`/`role` codes
 * `claimWorkbasketResolver.ts`'s `STEP_NAME_TO_BASKET_ROLE` /
 * `STEP_ROLE_TO_BASKET_ROLE` tables actually recognise. `role` here is what
 * carries real routing in practice — `step` doubles as a fallback when a
 * role string doesn't match (as most legacy "CLAIMS_OFFICER"-style role text
 * in existing data doesn't). SYSTEM carries no basket by design (system-run
 * steps have no human queue), matching the resolver's own stated intent.
 */
const STEP_TYPE_TO_ROUTING: Record<string, { step: string; role: string }> = {
  INTAKE: { step: 'INTAKE', role: 'CLERK' },
  REVIEW: { step: 'REVIEW', role: 'OFFICER' },
  ELIGIBILITY: { step: 'ELIGIBILITY', role: 'OFFICER' },
  CALCULATION: { step: 'CALCULATION', role: 'OFFICER' },
  DECISION: { step: 'DECISION', role: 'SUPERVISOR' },
  APPROVAL: { step: 'APPROVAL', role: 'SUPERVISOR' },
  PAYMENT: { step: 'PAYMENT', role: 'FINANCE' },
  NOTIFICATION: { step: 'NOTIFICATION', role: 'SYSTEM' },
  EXTERNAL_TASK: { step: 'EXTERNAL_TASK', role: 'OFFICER' },
  CUSTOM: { step: 'CUSTOM', role: 'OFFICER' },
};

function routingFieldsForStepType(stepType: string | undefined): { step: string; role: string } {
  return STEP_TYPE_TO_ROUTING[stepType ?? ''] ?? { step: stepType || 'REVIEW', role: 'OFFICER' };
}

function useEscalationPolicies() {
  return useQuery({
    queryKey: ['bn', 'escalation-policies', 'editor'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('bn_escalation_policy')
        .select('id, policy_code, policy_name, is_active, severity, trigger_config, due_after_hours, breach_after_hours')
        .eq('is_active', true)
        .order('policy_name');
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * BUG-046 — the dropdown used to select a nonexistent `hours_overdue` column
 * and always came back empty. The real value lives in different places
 * depending on how the policy was authored: newer rows use the dedicated
 * `due_after_hours`/`breach_after_hours` columns, older seed data only ever
 * set it inside `trigger_config` (e.g. `{ hours_overdue: 17 }`).
 */
function policyHoursLabel(p: { due_after_hours?: number | null; breach_after_hours?: number | null; trigger_config?: { hours_overdue?: number } | null }): string | null {
  const hours = p.due_after_hours ?? p.breach_after_hours ?? p.trigger_config?.hours_overdue ?? null;
  return hours != null ? `${hours}h` : null;
}

function normalizeSteps(raw: unknown): StepConfig[] {
  if (Array.isArray(raw)) return raw.map((s: any) => ({ ...s }));
  return [];
}

function ChannelSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: channels = [] } = useQuery({
    queryKey: ['bn', 'ref', 'BN_APPLICATION_CHANNEL'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('core_reference_value')
        .select('value_code, value_label, sort_order, group:core_reference_group!inner(group_code)')
        .eq('group.group_code', 'BN_APPLICATION_CHANNEL')
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as Array<{ value_code: string; value_label: string }>;
    },
  });
  return (
    <Select value={value || '__none__'} onValueChange={(v) => onChange(v === '__none__' ? '' : v)}>
      <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">Any (channel-agnostic)</SelectItem>
        {channels.map((c) => <SelectItem key={c.value_code} value={c.value_code}>{c.value_label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function WorkflowDefinitionSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: defs = [] } = useQuery({
    queryKey: ['workflow_definitions', 'all'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('workflow_definitions')
        .select('id, definition_name, definition_code, is_active')
        .order('definition_name');
      if (error) throw error;
      return data ?? [];
    },
  });
  return (
    <Select value={value || '__none__'} onValueChange={(v) => onChange(v === '__none__' ? '' : v)}>
      <SelectTrigger><SelectValue placeholder="— Not linked —" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">— Not linked (config-only) —</SelectItem>
        {defs.map((d: any) => (
          <SelectItem key={d.id} value={d.id}>
            {d.definition_name} {d.is_active === false ? '(inactive)' : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function WorkflowDefinitionStepsPreview({ definitionId }: { definitionId: string }) {
  const { data: steps = [], isLoading } = useQuery({
    queryKey: ['workflow_steps', definitionId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('workflow_steps')
        .select('id, step_name, step_code, step_type, step_order, assigned_role')
        .eq('workflow_definition_id', definitionId)
        .order('step_order');
      if (error) throw error;
      return data ?? [];
    },
  });
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Linked Workflow Steps (read-only)</CardTitle>
        <CardDescription>Pulled from <code>workflow_steps</code> of the linked definition. Edit in the workflow engine.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {!isLoading && steps.length === 0 && <p className="text-xs text-muted-foreground">No steps defined on the linked workflow definition.</p>}
        <ol className="space-y-1">
          {steps.map((s: any, i: number) => (
            <li key={s.id} className="flex items-center gap-2 text-sm">
              <Badge variant="outline" className="w-6 justify-center">{i + 1}</Badge>
              <span className="font-medium">{s.step_name}</span>
              <span className="text-xs text-muted-foreground">{s.step_code} · {s.step_type} {s.assigned_role ? `· ${s.assigned_role}` : ''}</span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

export default function WorkflowTemplateEditor() {
  const { toast } = useToast();
  const { data: templates = [], isLoading } = useBnWorkflowTemplates();
  const { data: workbaskets = [] } = useBnWorkbaskets();
  const { data: policies = [] } = useEscalationPolicies();
  const upsert = useUpsertBnWorkflowTemplate();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<any>(null);
  const [steps, setSteps] = useState<StepConfig[]>([]);
  const [activeStep, setActiveStep] = useState<number>(0);
  // BUG-045 — "New Template" cleared selectedId to trigger a blank form, but
  // this same auto-select effect (meant only for the initial page load) saw
  // selectedId go null and immediately re-picked templates[0], silently
  // reverting both the highlight and the form back to the existing template
  // — including its real id, so a Save afterward would overwrite it instead
  // of creating a new row. This flag tells the effect a blank form is
  // deliberate, not "nothing loaded yet".
  const [isCreatingNew, setIsCreatingNew] = useState(false);

  const selected = useMemo(() => templates.find((t: any) => t.id === selectedId), [templates, selectedId]);

  useEffect(() => {
    if (!selectedId && !isCreatingNew && templates.length) setSelectedId((templates[0] as any).id);
  }, [templates, selectedId, isCreatingNew]);

  useEffect(() => {
    if (selected) {
      const v: any = selected;
      setForm({
        id: v.id,
        template_code: v.template_code || '',
        template_name: v.template_name || '',
        description: v.description || '',
        country_code: v.country_code || '',
        channel_code: v.channel_code || '',
        workflow_definition_id: v.workflow_definition_id || '',
        is_active: !!v.is_active,
      });
      setSteps(normalizeSteps(v.steps_config));
      setActiveStep(0);
    }
  }, [selected]);

  const updateStep = (i: number, patch: Partial<StepConfig>) => {
    setSteps((prev) => prev.map((s, idx) => {
      if (idx !== i) return s;
      const merged = { ...s, ...patch };
      // BUG-047 — keep the resolver-facing step/role in sync whenever the
      // user changes the step type, so the routing fields are always
      // consistent with what's actually displayed.
      return patch.step_type ? { ...merged, ...routingFieldsForStepType(patch.step_type) } : merged;
    }));
  };

  const addStep = () => {
    const stepType = 'REVIEW';
    setSteps((prev) => [...prev, {
      step_code: `STEP_${prev.length + 1}`,
      step_name: `Step ${prev.length + 1}`,
      step_type: stepType,
      ...routingFieldsForStepType(stepType),
    }]);
    setActiveStep(steps.length);
  };

  const removeStep = (i: number) => {
    setSteps((prev) => prev.filter((_, idx) => idx !== i));
    setActiveStep((a) => Math.max(0, Math.min(a, steps.length - 2)));
  };

  const move = (i: number, dir: -1 | 1) => {
    setSteps((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setActiveStep((a) => a + dir);
  };

  const handleNewTemplate = () => {
    setIsCreatingNew(true);
    setSelectedId(null);
    setForm({ template_code: '', template_name: '', description: '', country_code: '', channel_code: '', workflow_definition_id: '', is_active: true });
    setSteps([]);
    setActiveStep(0);
  };

  const handleSelectTemplate = (id: string) => {
    setIsCreatingNew(false);
    setSelectedId(id);
  };

  const handleSave = async () => {
    if (!form?.template_code || !form?.template_name) {
      toast({ title: 'Missing fields', description: 'Template code and name are required.', variant: 'destructive' });
      return;
    }
    try {
      const payload: any = {
        ...form,
        country_code: form.country_code || null,
        channel_code: form.channel_code || null,
        workflow_definition_id: form.workflow_definition_id || null,
        steps_config: steps,
      };
      // Defense in depth for BUG-045: a genuinely new template must never
      // carry another row's id into the upsert, whatever state got it here.
      if (isCreatingNew) delete payload.id;
      const saved = await upsert.mutateAsync(payload);
      setIsCreatingNew(false);
      setSelectedId((saved as any).id);
      toast({ title: 'Saved', description: `Template "${form.template_name}" saved with ${steps.length} step(s).` });
    } catch (err: any) {
      toast({ title: 'Save failed', description: err?.message, variant: 'destructive' });
    }
  };

  const step = steps[activeStep];

  return (
    <div className="container mx-auto py-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Workflow className="h-6 w-6" /> Workflow Templates</h1>
          <p className="text-sm text-muted-foreground">Build reusable workflow templates and assign per-step SLA escalation policies, workbaskets, and roles.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleNewTemplate}><Plus className="h-4 w-4 mr-1" /> New Template</Button>
          <Button onClick={handleSave} disabled={upsert.isPending || !form}><Save className="h-4 w-4 mr-1" /> Save</Button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Template list */}
        <Card className="col-span-3">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Templates</CardTitle></CardHeader>
          <CardContent className="p-2">
            <ScrollArea className="h-[70vh]">
              <div className="space-y-1">
                {isLoading && <p className="text-xs text-muted-foreground p-2">Loading…</p>}
                {!isLoading && templates.length === 0 && <p className="text-xs text-muted-foreground p-2">No templates yet.</p>}
                {templates.map((t: any) => (
                  <button
                    key={t.id}
                    onClick={() => handleSelectTemplate(t.id)}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm hover:bg-accent ${selectedId === t.id ? 'bg-accent' : ''}`}
                  >
                    <div className="font-medium truncate">{t.template_name}</div>
                    <div className="text-xs text-muted-foreground truncate">{t.template_code} · {(t.steps_config?.length ?? 0)} step(s)</div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Template detail */}
        <div className="col-span-9 space-y-4">
          {form && (
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-base">Template Details</CardTitle>
                <Badge variant={form.workflow_definition_id ? 'default' : 'secondary'}>
                  {form.workflow_definition_id ? 'Executable' : 'Config-only'}
                </Badge>
              </CardHeader>
              <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div><Label className="text-xs">Code *</Label><Input value={form.template_code} onChange={(e) => setForm({ ...form, template_code: e.target.value })} /></div>
                <div className="md:col-span-2"><Label className="text-xs">Name *</Label><Input value={form.template_name} onChange={(e) => setForm({ ...form, template_name: e.target.value })} /></div>
                <div><Label className="text-xs">Country</Label><Input placeholder="e.g. KN" value={form.country_code} onChange={(e) => setForm({ ...form, country_code: e.target.value })} /></div>
                <div>
                  <Label className="text-xs">Channel</Label>
                  <ChannelSelect value={form.channel_code} onChange={(v) => setForm({ ...form, channel_code: v })} />
                </div>
                <div className="md:col-span-3">
                  <Label className="text-xs">Linked Workflow Definition</Label>
                  <WorkflowDefinitionSelect
                    value={form.workflow_definition_id}
                    onChange={(v) => setForm({ ...form, workflow_definition_id: v })}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Required to make this template executable at runtime. BN-specific overrides (steps, SLAs, escalation) live below.
                  </p>
                </div>
                <div className="md:col-span-3"><Label className="text-xs">Description</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
                <div className="flex items-end gap-2"><Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} /><Label className="text-xs">Active</Label></div>
              </CardContent>
            </Card>
          )}

          {form?.workflow_definition_id && (
            <WorkflowDefinitionStepsPreview definitionId={form.workflow_definition_id} />
          )}


          {/* Steps editor */}
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Workflow Steps</CardTitle>
                <CardDescription>Edit the ordered list of steps. Per-step escalation policy overrides workbasket and product defaults.</CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={addStep}><Plus className="h-4 w-4 mr-1" /> Add Step</Button>
            </CardHeader>
            <CardContent>
              {steps.length === 0 ? (
                <p className="text-sm text-muted-foreground">No steps yet. Click "Add Step" to begin.</p>
              ) : (
                <div className="grid grid-cols-12 gap-3">
                  {/* Step list */}
                  <div className="col-span-4">
                    <ScrollArea className="h-[55vh]">
                      <ol className="space-y-1">
                        {steps.map((s, i) => (
                          <li key={i}>
                            <button
                              onClick={() => setActiveStep(i)}
                              className={`w-full text-left p-2 rounded-md border text-sm hover:bg-accent ${activeStep === i ? 'bg-accent border-primary' : ''}`}
                            >
                              <div className="flex items-center gap-2">
                                <Badge variant="outline">{i + 1}</Badge>
                                <div className="min-w-0 flex-1">
                                  <div className="font-medium truncate">{s.step_name || s.step_code || `Step ${i + 1}`}</div>
                                  <div className="text-xs text-muted-foreground truncate">
                                    {[s.step_type, s.assigned_role, s.sla_hours ? `${s.sla_hours}h SLA` : null].filter(Boolean).join(' · ')}
                                  </div>
                                </div>
                                {s.escalation_policy_id && <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />}
                              </div>
                            </button>
                          </li>
                        ))}
                      </ol>
                    </ScrollArea>
                  </div>

                  {/* Step detail editor */}
                  <div className="col-span-8">
                    {step && (
                      <div className="space-y-3 border rounded-md p-4">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-semibold">Step #{activeStep + 1}</h4>
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" disabled={activeStep === 0} onClick={() => move(activeStep, -1)}><ArrowUp className="h-4 w-4" /></Button>
                            <Button size="icon" variant="ghost" disabled={activeStep === steps.length - 1} onClick={() => move(activeStep, 1)}><ArrowDown className="h-4 w-4" /></Button>
                            <Button size="icon" variant="ghost" onClick={() => removeStep(activeStep)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div><Label className="text-xs">Step Code</Label><Input value={step.step_code || ''} onChange={(e) => updateStep(activeStep, { step_code: e.target.value })} /></div>
                          <div><Label className="text-xs">Step Name</Label><Input value={step.step_name || ''} onChange={(e) => updateStep(activeStep, { step_name: e.target.value })} /></div>
                          <div>
                            <Label className="text-xs">Step Type</Label>
                            <Select value={step.step_type || ''} onValueChange={(v) => updateStep(activeStep, { step_type: v })}>
                              <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                              <SelectContent>{STEP_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div><Label className="text-xs">Assigned Role</Label><Input value={step.assigned_role || ''} onChange={(e) => updateStep(activeStep, { assigned_role: e.target.value })} /></div>
                          <div>
                            <Label className="text-xs">Workbasket</Label>
                            <Select
                              value={step.workbasket_id || '__none__'}
                              onValueChange={(v) => updateStep(activeStep, { workbasket_id: v === '__none__' ? null : v })}
                            >
                              <SelectTrigger><SelectValue placeholder="Not assigned" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">Not assigned</SelectItem>
                                {workbaskets.map((b: any) => (
                                  <SelectItem key={b.id} value={b.id}>{b.basket_name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs">SLA (hours)</Label>
                            <Input
                              type="number"
                              min={0}
                              value={step.sla_hours ?? ''}
                              onChange={(e) => updateStep(activeStep, { sla_hours: e.target.value === '' ? null : Number(e.target.value) })}
                            />
                          </div>
                        </div>

                        <Separator />

                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <ShieldAlert className="h-4 w-4 text-amber-600" />
                            <Label className="text-sm font-semibold">Escalation Policy (overrides workbasket & product)</Label>
                          </div>
                          <Select
                            value={step.escalation_policy_id || '__none__'}
                            onValueChange={(v) => updateStep(activeStep, { escalation_policy_id: v === '__none__' ? null : v })}
                          >
                            <SelectTrigger><SelectValue placeholder="Inherit from workbasket / product" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">Inherit (workbasket → product → default)</SelectItem>
                              {policies.map((p: any) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.policy_name} ({p.policy_code}){policyHoursLabel(p) ? ` · ${policyHoursLabel(p)}` : ''} · {p.severity}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">
                            Resolution order at runtime: <span className="font-mono">step → workbasket → product → country/category → global</span>
                          </p>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div><Label className="text-xs">Notify Template Code</Label><Input value={step.notify_template_code || ''} onChange={(e) => updateStep(activeStep, { notify_template_code: e.target.value || null })} /></div>
                          <div className="flex items-end gap-2"><Switch checked={!!step.is_optional} onCheckedChange={(v) => updateStep(activeStep, { is_optional: v })} /><Label className="text-xs">Optional Step</Label></div>
                        </div>

                        <div>
                          <Label className="text-xs">Description</Label>
                          <Textarea rows={2} value={step.description || ''} onChange={(e) => updateStep(activeStep, { description: e.target.value })} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
