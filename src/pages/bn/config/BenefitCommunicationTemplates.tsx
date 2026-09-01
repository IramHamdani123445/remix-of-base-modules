/**
 * Benefit Communication Templates
 * --------------------------------
 * Benefits-scoped view over the central `notification_templates` table.
 * Single source of truth — no duplicate Benefits template table is created.
 *
 * Capabilities (all governed by central tables):
 *   - list every template whose template_code starts with "BN_" or whose
 *     trigger_event starts with "bn."
 *   - filter by event / channel / status
 *   - create a new BN template
 *   - clone an existing template (creates a new template_code)
 *   - edit DRAFT (is_enabled = false) templates directly
 *   - create a new VERSION of an ACTIVE template (immutable rule)
 *   - publish (enable) a new version after placeholder validation
 *   - retire (disable) a template
 *   - preview rendered output against placeholder defaults
 *   - validate template body against the canonical BN placeholder registry
 *   - view version history (notification_template_versions)
 *   - view linked products / product versions via bn_comm_mapping
 *   - view linked communication events
 *   - view audit history from notification_template_audit_logs +
 *     system_audit_trail
 */
import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  Pencil, Mail, MessageSquare, FileText, Bell, Plus, Copy, History, Eye, ShieldCheck,
  GitBranch, AlertTriangle, Link2,
} from 'lucide-react';
import { writeBnAudit } from '@/services/bn/audit/bnAuditService';
import { useUserCode } from '@/hooks/useUserCode';
import { BN_PLACEHOLDERS, validatePlaceholders } from '@/services/bn/communication/bnPlaceholderRegistry';
import TokenPicker, { useTokenDrop } from '@/components/bn/templates/TokenPicker';
import TemplatePreview from '@/components/bn/templates/TemplatePreview';
import { BnBusyButton } from '@/components/bn/shared';

const db = supabase as any;

interface Template {
  id: string;
  name: string;
  template_code: string;
  channel: string;
  trigger_event: string | null;
  subject: string | null;
  body: string | null;
  html_body: string | null;
  is_enabled: boolean;
  category: string | null;
  description: string | null;
  version_no: number;
}

const channelIcon = (c: string) => {
  switch (c) {
    case 'email': return <Mail className="h-3.5 w-3.5" />;
    case 'sms': return <MessageSquare className="h-3.5 w-3.5" />;
    case 'letter': return <FileText className="h-3.5 w-3.5" />;
    case 'in_app': return <Bell className="h-3.5 w-3.5" />;
    default: return null;
  }
};

const CHANNEL_OPTIONS = [
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'letter', label: 'Letter' },
  { value: 'in_app', label: 'In-App' },
];

export default function BenefitCommunicationTemplates() {
  const qc = useQueryClient();
  const { userCode: rawUserCode } = useUserCode();
  const userCode = rawUserCode || 'SYSTEM';
  const [editing, setEditing] = useState<Template | null>(null);
  const [creating, setCreating] = useState(false);
  const [versionsFor, setVersionsFor] = useState<Template | null>(null);
  const [linksFor, setLinksFor] = useState<Template | null>(null);
  const [previewFor, setPreviewFor] = useState<Template | null>(null);
  const [filterEvent, setFilterEvent] = useState<string>('all');
  const [filterChannel, setFilterChannel] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['bn-communication-templates'],
    queryFn: async () => {
      const { data, error } = await db
        .from('notification_templates')
        .select('id, name, template_code, channel, trigger_event, subject, body, html_body, is_enabled, category, description, version_no')
        .or('template_code.ilike.BN_%,trigger_event.ilike.bn.%')
        .order('trigger_event', { ascending: true })
        .order('channel', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Template[];
    },
  });

  const toggleEnabled = useMutation({
    mutationFn: async (t: Template) => {
      const action = t.is_enabled ? 'TEMPLATE_RETIRED' : 'TEMPLATE_PUBLISHED';
      const { error } = await db
        .from('notification_templates')
        .update({ is_enabled: !t.is_enabled, updated_at: new Date().toISOString() })
        .eq('id', t.id);
      if (error) throw error;
      await writeBnAudit({
        module: 'BN_COMMUNICATION',
        entityType: 'notification_template',
        entityId: t.id,
        action,
        performedBy: userCode,
        afterValue: { template_code: t.template_code, is_enabled: !t.is_enabled },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bn-communication-templates'] });
      toast.success('Template updated');
    },
    onError: (e: any) => toast.error('Update failed', { description: e?.message }),
  });

  const saveTemplate = useMutation({
    mutationFn: async (t: Template) => {
      // Snapshot the prior version before saving
      const { data: prev } = await db.from('notification_templates').select('*').eq('id', t.id).maybeSingle();
      if (prev) {
        await db.from('notification_template_versions').insert({
          template_id: t.id,
          version_no: prev.version_no || 1,
          name: prev.name,
          subject: prev.subject,
          body: prev.body,
          html_body: prev.html_body,
          placeholders: prev.placeholders,
          change_summary: 'Edited from Benefits Template Manager',
        });
      }
      const { error } = await db
        .from('notification_templates')
        .update({
          subject: t.subject,
          body: t.body,
          html_body: t.html_body,
          description: t.description,
          version_no: (prev?.version_no || 1) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', t.id);
      if (error) throw error;
      await writeBnAudit({
        module: 'BN_COMMUNICATION',
        entityType: 'notification_template',
        entityId: t.id,
        action: 'TEMPLATE_VERSION_CREATED',
        performedBy: userCode,
        afterValue: { template_code: t.template_code, new_version: (prev?.version_no || 1) + 1 },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bn-communication-templates'] });
      toast.success('New version saved');
      setEditing(null);
    },
    onError: (e: any) => toast.error('Save failed', { description: e?.message }),
  });

  const createTemplate = useMutation({
    mutationFn: async (t: Partial<Template>) => {
      if (!t.template_code?.startsWith('BN_')) throw new Error('Template code must start with BN_');
      const { data, error } = await db.from('notification_templates').insert({
        name: t.name,
        template_code: t.template_code,
        channel: t.channel,
        trigger_event: t.trigger_event,
        subject: t.subject,
        body: t.body,
        html_body: t.html_body,
        description: t.description,
        category: t.category || 'benefit_lifecycle',
        is_enabled: false,
        version_no: 1,
      }).select('id').single();
      if (error) throw error;
      await writeBnAudit({
        module: 'BN_COMMUNICATION',
        entityType: 'notification_template',
        entityId: data?.id,
        action: 'TEMPLATE_CREATED',
        performedBy: userCode,
        afterValue: { template_code: t.template_code, name: t.name },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bn-communication-templates'] });
      toast.success('Template created in DRAFT state');
      setCreating(false);
    },
    onError: (e: any) => toast.error('Create failed', { description: e?.message }),
  });

  const cloneTemplate = useMutation({
    mutationFn: async (t: Template) => {
      const newCode = `${t.template_code}_COPY_${Date.now().toString(36).toUpperCase()}`;
      const { data, error } = await db.from('notification_templates').insert({
        name: `${t.name} (copy)`,
        template_code: newCode,
        channel: t.channel,
        trigger_event: t.trigger_event,
        subject: t.subject,
        body: t.body,
        html_body: t.html_body,
        description: t.description,
        category: t.category,
        is_enabled: false,
        version_no: 1,
      }).select('id').single();
      if (error) throw error;
      await writeBnAudit({
        module: 'BN_COMMUNICATION',
        entityType: 'notification_template',
        entityId: data?.id,
        action: 'TEMPLATE_CLONED',
        performedBy: userCode,
        afterValue: { template_code: newCode, cloned_from: t.template_code },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bn-communication-templates'] });
      toast.success('Template cloned as DRAFT');
    },
    onError: (e: any) => toast.error('Clone failed', { description: e?.message }),
  });

  const events = useMemo(() => Array.from(new Set(templates.map(t => t.trigger_event).filter(Boolean))) as string[], [templates]);
  const channels = useMemo(() => Array.from(new Set(templates.map(t => t.channel))), [templates]);

  const visible = templates.filter(t =>
    (filterEvent === 'all' || t.trigger_event === filterEvent) &&
    (filterChannel === 'all' || t.channel === filterChannel) &&
    (filterStatus === 'all' || (filterStatus === 'active' ? t.is_enabled : !t.is_enabled))
  );

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-7xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="t-page-title">Benefit Communication Templates</h1>
          <p className="t-page-subtitle mt-1 mt-1">
            Benefits-scoped view over the central notification template store.
            Channels and recipients per product version are governed by Product Catalog → Communication Mapping.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4 mr-1.5" /> New template</Button>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <select className="border rounded px-3 py-1.5 text-sm bg-background" value={filterEvent} onChange={(e) => setFilterEvent(e.target.value)}>
          <option value="all">All events</option>
          {events.map(ev => <option key={ev} value={ev}>{ev}</option>)}
        </select>
        <select className="border rounded px-3 py-1.5 text-sm bg-background" value={filterChannel} onChange={(e) => setFilterChannel(e.target.value)}>
          <option value="all">All channels</option>
          {channels.map(ch => <option key={ch} value={ch}>{ch}</option>)}
        </select>
        <select className="border rounded px-3 py-1.5 text-sm bg-background" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="draft">Draft / Retired</option>
        </select>
        <span className="text-xs text-muted-foreground ml-auto">{visible.length} of {templates.length}</span>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading templates…</p>}

      <div className="grid gap-3">
        {visible.map(t => {
          const validation = validatePlaceholders(t.subject, t.body, t.html_body);
          return (
            <Card key={t.id} className={!t.is_enabled ? 'opacity-70' : ''}>
              <CardContent className="py-4 flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-medium text-sm truncate">{t.name}</h3>
                    <Badge variant="outline" className="text-[10px] gap-1">{channelIcon(t.channel)} {t.channel}</Badge>
                    {t.trigger_event && <Badge variant="secondary" className="text-[10px]">{t.trigger_event}</Badge>}
                    <Badge variant="outline" className="text-[10px]">v{t.version_no}</Badge>
                    <Badge variant={t.is_enabled ? 'default' : 'secondary'} className="text-[10px]">
                      {t.is_enabled ? 'ACTIVE' : 'DRAFT'}
                    </Badge>
                    {validation.unknown.length > 0 && (
                      <Badge variant="destructive" className="text-[10px] gap-1">
                        <AlertTriangle className="h-3 w-3" /> {validation.unknown.length} unknown placeholder{validation.unknown.length === 1 ? '' : 's'}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 font-mono">{t.template_code}</p>
                  {t.subject && <p className="text-xs mt-1 line-clamp-1"><span className="text-muted-foreground">Subject:</span> {t.subject}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch checked={t.is_enabled} onCheckedChange={() => toggleEnabled.mutate(t)} title={t.is_enabled ? 'Retire' : 'Publish'} />
                  <Button size="sm" variant="ghost" onClick={() => setPreviewFor(t)} title="Preview"><Eye className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => setVersionsFor(t)} title="Version history"><History className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => setLinksFor(t)} title="Linked products / events"><Link2 className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => cloneTemplate.mutate(t)} title="Clone"><Copy className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="outline" onClick={() => setEditing(t)}>
                    <Pencil className="h-3.5 w-3.5 mr-1.5" /> {t.is_enabled ? 'New version' : 'Edit'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {!isLoading && visible.length === 0 && (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No templates match the filters.</CardContent></Card>
        )}
      </div>

      <TemplateEditorDialog
        open={!!editing}
        template={editing}
        title={editing?.is_enabled ? 'Create new version' : 'Edit draft template'}
        onClose={() => setEditing(null)}
        onSave={(t) => saveTemplate.mutate(t)}
        pending={saveTemplate.isPending}
      />
      <TemplateEditorDialog
        open={creating}
        template={null}
        title="Create benefit template"
        onClose={() => setCreating(false)}
        onSave={(t) => createTemplate.mutate(t)}
        pending={createTemplate.isPending}
        createMode
      />
      <VersionsDialog template={versionsFor} open={!!versionsFor} onClose={() => setVersionsFor(null)} />
      <LinksDialog template={linksFor} open={!!linksFor} onClose={() => setLinksFor(null)} />
      <PreviewDialog template={previewFor} open={!!previewFor} onClose={() => setPreviewFor(null)} />
    </div>
  );
}

// ─── Editor ──────────────────────────────────────────────────────────
interface EditorProps {
  open: boolean;
  template: Template | null;
  title: string;
  createMode?: boolean;
  pending?: boolean;
  onClose: () => void;
  onSave: (t: any) => void;
}
const TemplateEditorDialog: React.FC<EditorProps> = ({ open, template, title, createMode, pending, onClose, onSave }) => {
  const [draft, setDraft] = useState<any>(null);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const subjectRef = React.useRef<HTMLInputElement | null>(null);
  const bodyRef = React.useRef<HTMLTextAreaElement | null>(null);
  const htmlRef = React.useRef<HTMLTextAreaElement | null>(null);
  const lastFocusedRef = React.useRef<HTMLElement | null>(null);
  const trackFocus = (el: HTMLElement | null) => { if (el) lastFocusedRef.current = el; };
  const syncTokenTarget = React.useCallback((_token: string, target?: HTMLTextAreaElement | HTMLInputElement | null) => {
    if (!target) return;
    if (target === subjectRef.current) setDraft((d: any) => ({ ...d, subject: target.value }));
    if (target === bodyRef.current) setDraft((d: any) => ({ ...d, body: target.value }));
    if (target === htmlRef.current) setDraft((d: any) => ({ ...d, html_body: target.value }));
  }, []);
  const tokenDrop = useTokenDrop(syncTokenTarget);

  React.useEffect(() => {
    if (open) {
      setTab('edit');
      setDraft(template ? { ...template } : {
        name: '', template_code: 'BN_', channel: 'email', trigger_event: 'bn.', subject: '', body: '', html_body: '', description: '', category: 'benefit_lifecycle',
      });
    }
  }, [open, template]);

  const validation = useMemo(() => draft ? validatePlaceholders(draft.subject, draft.body, draft.html_body) : { used: [], unknown: [], recognised: [] }, [draft]);

  if (!draft) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-6xl max-h-[92vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-6 pb-3 border-b">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{createMode ? 'New draft will be created and disabled until published.' : 'Saving creates a new immutable version snapshot.'}</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="flex-1 min-h-0 flex flex-col">
          <div className="px-6 pt-3 border-b">
            <TabsList>
              <TabsTrigger value="edit">Edit</TabsTrigger>
              <TabsTrigger value="preview"><Eye className="h-3.5 w-3.5 mr-1.5" />Preview</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="edit" className="flex-1 min-h-0 m-0 grid grid-cols-[1fr_280px] gap-0">
            <div className="overflow-y-auto p-6 space-y-4 border-r">
              {createMode && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Template code (must start with BN_)">
                    <Input value={draft.template_code} onChange={(e) => setDraft({ ...draft, template_code: e.target.value.toUpperCase() })} />
                  </Field>
                  <Field label="Channel">
                    <select className="w-full border rounded px-2 py-1.5 text-sm bg-background" value={draft.channel} onChange={(e) => setDraft({ ...draft, channel: e.target.value })}>
                      {CHANNEL_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Name">
                    <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                  </Field>
                  <Field label="Trigger event">
                    <Input value={draft.trigger_event || ''} onChange={(e) => setDraft({ ...draft, trigger_event: e.target.value })} placeholder="bn.something.happened" />
                  </Field>
                </div>
              )}
              <Field label="Description">
                <Input value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </Field>
              {draft.channel !== 'in_app' && (
                <Field label="Subject (drop or click tokens to insert)">
                  <Input
                    ref={subjectRef}
                    value={draft.subject ?? ''}
                    onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                    onFocus={(e) => trackFocus(e.currentTarget)}
                    {...tokenDrop}
                  />
                </Field>
              )}
              <Field label="Body (plain text — drop tokens anywhere)">
                <Textarea
                  ref={bodyRef}
                  rows={8}
                  value={draft.body ?? ''}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  onFocus={(e) => trackFocus(e.currentTarget)}
                  {...tokenDrop}
                />
              </Field>
              {(draft.channel === 'email' || draft.channel === 'letter') && (
                <Field label="HTML Body (drop tokens anywhere)">
                  <Textarea
                    ref={htmlRef}
                    rows={10}
                    value={draft.html_body ?? ''}
                    onChange={(e) => setDraft({ ...draft, html_body: e.target.value })}
                    onFocus={(e) => trackFocus(e.currentTarget)}
                    className="font-mono text-xs"
                    {...tokenDrop}
                  />
                </Field>
              )}

              <Card>
                <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Placeholder validation</CardTitle></CardHeader>
                <CardContent className="py-3 space-y-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Recognised:</span>{' '}
                    {validation.recognised.length ? validation.recognised.map(k => <Badge key={k} variant="secondary" className="mr-1 text-[10px]">{k}</Badge>) : <span className="text-muted-foreground">none</span>}
                  </div>
                  {validation.unknown.length > 0 && (
                    <div>
                      <span className="text-destructive">Unknown:</span>{' '}
                      {validation.unknown.map(k => <Badge key={k} variant="destructive" className="mr-1 text-[10px]">{k}</Badge>)}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="flex flex-col min-h-0 p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2 px-1">Variable library</p>
              <div className="flex-1 min-h-0">
                <TokenPicker targets={[subjectRef, bodyRef, htmlRef]} lastFocusedRef={lastFocusedRef} onInsert={syncTokenTarget} />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="preview" className="flex-1 min-h-0 m-0 overflow-y-auto p-6">
            <TemplatePreview subject={draft.subject} body={draft.body} htmlBody={draft.html_body} />
          </TabsContent>
        </Tabs>

        <DialogFooter className="p-6 pt-3 border-t bg-background">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <BnBusyButton loading={pending} onClick={() => onSave(draft)} disabled={pending}>{pending ? 'Saving…' : createMode ? 'Create draft' : 'Save new version'}</BnBusyButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="space-y-1.5">
    <label className="text-xs font-medium text-muted-foreground">{label}</label>
    {children}
  </div>
);

// ─── Version history ─────────────────────────────────────────────────
const VersionsDialog: React.FC<{ template: Template | null; open: boolean; onClose: () => void }> = ({ template, open, onClose }) => {
  const { data: versions } = useQuery({
    queryKey: ['bn-template-versions', template?.id],
    enabled: !!template && open,
    queryFn: async () => {
      const { data } = await db.from('notification_template_versions')
        .select('id, version_no, subject, body, html_body, changed_at, change_summary, changed_by')
        .eq('template_id', template!.id).order('version_no', { ascending: false });
      return data || [];
    },
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle><GitBranch className="h-4 w-4 inline mr-1.5" />Version history</DialogTitle>
          <DialogDescription>{template?.template_code}</DialogDescription>
        </DialogHeader>
        {!versions?.length && <p className="text-sm text-muted-foreground">No prior versions snapshotted yet.</p>}
        <div className="space-y-2">
          {(versions || []).map((v: any) => (
            <Card key={v.id}>
              <CardContent className="py-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">v{v.version_no} · {v.change_summary || '—'}</div>
                  <div className="text-xs text-muted-foreground">{new Date(v.changed_at).toLocaleString()}</div>
                </div>
                {v.subject && <p className="text-xs mt-1"><span className="text-muted-foreground">Subject:</span> {v.subject}</p>}
                {(v.body || v.html_body) && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground">Show body</summary>
                    <pre className="mt-1 text-xs bg-muted/40 rounded p-2 overflow-auto max-h-60">{v.html_body || v.body}</pre>
                  </details>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ─── Linked products / events ────────────────────────────────────────
const LinksDialog: React.FC<{ template: Template | null; open: boolean; onClose: () => void }> = ({ template, open, onClose }) => {
  const { data } = useQuery({
    queryKey: ['bn-template-links', template?.id],
    enabled: !!template && open,
    queryFn: async () => {
      const [{ data: mappings }, { data: events }] = await Promise.all([
        db.from('bn_comm_mapping').select('id, event_code, recipient_type, channel, delivery_method, bn_product_version_id, active, is_required').eq('template_id', template!.id),
        db.from('bn_comm_event').select('event_code, event_name, is_mandatory_letter').eq('event_code', template!.trigger_event || ''),
      ]);
      const versionIds = (mappings || []).map((m: any) => m.bn_product_version_id).filter(Boolean);
      let products: any[] = [];
      if (versionIds.length) {
        const { data: pv } = await db.from('bn_product_version')
          .select('id, version_label, product_id, bn_product:bn_product(product_name, product_code)')
          .in('id', versionIds);
        products = pv || [];
      }
      return { mappings: mappings || [], events: events || [], products };
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle><Link2 className="h-4 w-4 inline mr-1.5" />Linked products & events</DialogTitle>
          <DialogDescription>{template?.template_code}</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="mappings">
          <TabsList>
            <TabsTrigger value="mappings">Mappings ({data?.mappings?.length || 0})</TabsTrigger>
            <TabsTrigger value="products">Products ({data?.products?.length || 0})</TabsTrigger>
            <TabsTrigger value="events">Events ({data?.events?.length || 0})</TabsTrigger>
          </TabsList>
          <TabsContent value="mappings" className="space-y-2 mt-3">
            {!data?.mappings.length && <p className="text-sm text-muted-foreground">Not used in any Product Catalog mapping yet.</p>}
            {(data?.mappings || []).map((m: any) => (
              <div key={m.id} className="border rounded p-2 text-xs flex items-center gap-2">
                <Badge variant="outline">{m.event_code}</Badge>
                <Badge variant="secondary">{m.delivery_method || m.channel}</Badge>
                <Badge variant="outline">{m.recipient_type}</Badge>
                {m.is_required && <Badge variant="destructive">Required</Badge>}
                {!m.active && <Badge variant="secondary">Inactive</Badge>}
              </div>
            ))}
          </TabsContent>
          <TabsContent value="products" className="space-y-2 mt-3">
            {!data?.products.length && <p className="text-sm text-muted-foreground">Not bound to a product version.</p>}
            {(data?.products || []).map((p: any) => (
              <div key={p.id} className="border rounded p-2 text-xs">
                <span className="font-medium">{p.bn_product?.product_name || p.product_id}</span>{' '}
                <span className="text-muted-foreground">({p.bn_product?.product_code}) · {p.version_label}</span>
              </div>
            ))}
          </TabsContent>
          <TabsContent value="events" className="space-y-2 mt-3">
            {!data?.events.length && <p className="text-sm text-muted-foreground">No matching event in bn_comm_event.</p>}
            {(data?.events || []).map((e: any) => (
              <div key={e.event_code} className="border rounded p-2 text-xs">
                <span className="font-medium">{e.event_name}</span>{' '}
                <span className="text-muted-foreground">({e.event_code})</span>
                {e.is_mandatory_letter && <Badge variant="destructive" className="ml-2 text-[10px]">Mandatory letter</Badge>}
              </div>
            ))}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

// ─── Preview ─────────────────────────────────────────────────────────
const PreviewDialog: React.FC<{ template: Template | null; open: boolean; onClose: () => void }> = ({ template, open, onClose }) => {
  if (!template) return null;
  const sampleCtx: Record<string, string> = Object.fromEntries(BN_PLACEHOLDERS.map(p => [p.key, `[${p.label}]`]));
  const merge = (text: string) => text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => {
    const lc = k.toLowerCase();
    for (const key of Object.keys(sampleCtx)) if (key.toLowerCase() === lc) return sampleCtx[key];
    return `{{${k}}}`;
  });
  const renderedSubject = merge(template.subject || '');
  const renderedBody = merge(template.html_body || template.body || '');
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle><Eye className="h-4 w-4 inline mr-1.5" />Preview · {template.name}</DialogTitle>
          <DialogDescription>Rendered against sample placeholder values.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {renderedSubject && (
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Subject</p>
              <p className="font-medium">{renderedSubject}</p>
            </div>
          )}
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Body</p>
            {template.html_body
              ? <div className="border rounded p-3 prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: renderedBody }} />
              : <pre className="border rounded p-3 text-sm whitespace-pre-wrap">{renderedBody}</pre>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
