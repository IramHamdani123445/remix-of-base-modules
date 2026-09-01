import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Send, Plus, Trash2, AlertTriangle, Loader2, Info, ShieldAlert, Zap, Users, UserPlus, Save, Mail } from 'lucide-react';
import { StatusBadge, DataTable } from '@/components/common';
import type { DataTableColumn } from '@/components/common';
import { useIAPlanArtifacts } from '@/hooks/useAuditPlanArtifacts';
import { useIAPlanDistributionLogs, useIAPlanDistributionLogMutations } from '@/hooks/useAuditPlanArtifacts';
import {
  useDistributionRecipients,
  useDistributionRecipientMutations,
  useDistributionTemplates,
  type DistributionRecipient,
  type DistributionTemplate,
} from '@/hooks/useDistributionRecipients';
import { formatDateForDisplay } from '@/lib/format-config';
import { useToast } from '@/hooks/use-toast';
import { useUserCode } from '@/hooks/useUserCode';
import { StandardModal } from '@/components/common/StandardModal';
import { distributeAuditPlan } from '@/services/audit/planDistributionCommunicationService';

interface PlanDistributionTabProps {
  planId: string;
  plan: any;
}

interface Recipient {
  name: string;
  email: string;
  type: string;
  savedId?: string; // if loaded from saved list
}

const MERGE_FIELDS = ['{{plan_title}}', '{{fiscal_year}}', '{{version_number}}', '{{approved_by}}', '{{approved_date}}', '{{board_committee_name}}', '{{recipient_name}}'];

type DistributionPurpose = 'board_review' | 'final_distribution';

export function PlanDistributionTab({ planId, plan }: PlanDistributionTabProps) {
  const { toast } = useToast();
  const { userCode } = useUserCode();
  const { data: artifacts = [] } = useIAPlanArtifacts(planId);
  const { data: logs = [], isLoading } = useIAPlanDistributionLogs(planId);
  const { create: createLog } = useIAPlanDistributionLogMutations();

  // Saved recipients
  const { data: savedRecipients = [] } = useDistributionRecipients();
  const recipientMutations = useDistributionRecipientMutations();

  // Templates
  const { data: templates = [] } = useDistributionTemplates();

  const isApproved = plan?.status === 'Approved';
  const isDraftOrSubmitted = ['Draft', 'Submitted', 'Under Review'].includes(plan?.status);

  const reviewArtifacts = artifacts.filter((a: any) => ['Draft', 'Generated'].includes(a.status));
  const finalArtifacts = artifacts.filter((a: any) => a.is_final);
  const allDistributableArtifacts = isApproved ? [...finalArtifacts, ...reviewArtifacts] : reviewArtifacts;
  const hasSuperseded = artifacts.some((a: any) => a.status === 'Superseded');

  const [purpose, setPurpose] = useState<DistributionPurpose>(isApproved ? 'final_distribution' : 'board_review');
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [newRecipient, setNewRecipient] = useState<Recipient>({ name: '', email: '', type: 'board' });
  const [subject, setSubject] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [selectedArtifactId, setSelectedArtifactId] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [activeTab, setActiveTab] = useState('compose');

  // Manage Recipients modal
  const [showManageRecipients, setShowManageRecipients] = useState(false);
  const [newSavedRecipient, setNewSavedRecipient] = useState({ name: '', email: '', recipient_type: 'board', designation: '', organization: '' });

  // Auto-select first artifact
  useEffect(() => {
    const selectable = purpose === 'final_distribution' ? finalArtifacts : allDistributableArtifacts;
    if (selectable.length > 0 && !selectedArtifactId) {
      setSelectedArtifactId((selectable[0] as any).id);
    }
  }, [artifacts, purpose]);

  // Load default template on mount
  useEffect(() => {
    const templateType = isDraftOrSubmitted ? 'board_review' : 'final_distribution';
    const defaultTemplate = templates.find((t) => t.template_type === templateType && t.is_default);
    if (defaultTemplate && !selectedTemplateId) {
      applyTemplate(defaultTemplate);
      setSelectedTemplateId(defaultTemplate.id);
    }
  }, [templates, isDraftOrSubmitted]);

  const applyTemplate = (template: DistributionTemplate) => {
    setSubject(template.subject);
    setMessageBody(template.body);
    setSelectedTemplateId(template.id);
  };

  const resolveMergeFields = (text: string, recipientName?: string) => {
    return text
      .replace(/\{\{plan_title\}\}/g, plan?.title || '')
      .replace(/\{\{fiscal_year\}\}/g, plan?.fiscal_year || '')
      .replace(/\{\{version_number\}\}/g, String(plan?.current_version_number || 1))
      .replace(/\{\{approved_by\}\}/g, plan?.approved_by || '')
      .replace(/\{\{approved_date\}\}/g, plan?.approved_date ? formatDateForDisplay(plan.approved_date) : '')
      .replace(/\{\{board_committee_name\}\}/g, plan?.board_committee_name || '')
      .replace(/\{\{recipient_name\}\}/g, recipientName || '');
  };

  // Load saved recipients by type
  const loadSavedRecipientsByType = (type: string) => {
    const filtered = savedRecipients.filter((r) => r.recipient_type === type);
    const newRecs: Recipient[] = filtered
      .filter((sr) => !recipients.some((r) => r.email === sr.email))
      .map((sr) => ({ name: sr.name, email: sr.email, type: sr.recipient_type, savedId: sr.id }));
    if (newRecs.length > 0) {
      setRecipients((prev) => [...prev, ...newRecs]);
      toast({ title: `${newRecs.length} Recipient(s) Added`, description: `Loaded ${type} recipients from saved list.` });
    } else {
      toast({ title: 'No New Recipients', description: `All saved ${type} recipients are already in the list.` });
    }
  };

  const addRecipient = () => {
    if (!newRecipient.email.trim()) return;
    if (recipients.some((r) => r.email === newRecipient.email)) {
      toast({ title: 'Duplicate', description: 'This email is already in the list.', variant: 'destructive' });
      return;
    }
    setRecipients((prev) => [...prev, { ...newRecipient }]);
    setNewRecipient({ name: '', email: '', type: purpose === 'board_review' ? 'board' : 'external' });
  };

  const removeRecipient = (idx: number) => {
    setRecipients((prev) => prev.filter((_, i) => i !== idx));
  };

  const insertMergeField = (field: string) => {
    setMessageBody((prev) => prev + ' ' + field);
  };

  // ===== GOVERNED OMNI-COMMS DISTRIBUTION (DEF-2B) =====
  // The module supplies facts + a governed attachment id only. Subject, body,
  // sender, provider, channel and delivery evidence belong to Omni-Comms.
  const handleSend = async () => {
    if (recipients.length === 0) {
      toast({ title: 'No Recipients', description: 'Add at least one recipient before sending.', variant: 'destructive' });
      return;
    }
    if (!selectedArtifactId) {
      toast({ title: 'No Artifact Selected', description: 'Select an artifact to attach.', variant: 'destructive' });
      return;
    }
    const selectedArtifact = (artifacts as any[]).find((a) => a.id === selectedArtifactId);
    if (selectedArtifact?.status === 'Superseded') {
      toast({ title: 'Outdated Artifact', description: 'This artifact has been superseded. Select a current version.', variant: 'destructive' });
      return;
    }

    setSending(true);

    try {
      const distribution = await distributeAuditPlan({
        planId,
        plan,
        artifact: selectedArtifact,
        recipients: recipients.map((r) => ({ name: r.name, email: r.email, type: r.type })),
        purpose,
      });

      if (!distribution.attachment.ok) {
        toast({
          title: 'Distribution Blocked',
          description: `The plan document could not be verified and registered (${distribution.attachment.code}). Nothing was sent.`,
          variant: 'destructive',
        });
      }

      // Distribution evidence: one log row per recipient, carrying the
      // Omni-Comms request id as the correlation reference.
      for (const result of distribution.results) {
        const sendStatus =
          result.outcome === 'sent'
            ? 'Sent'
            : result.outcome === 'queued'
              ? 'Queued'
              : result.outcome === 'skipped'
                ? 'Skipped'
                : 'Failed';
        await createLog.mutateAsync({
          plan_id: planId,
          artifact_id: selectedArtifactId || null,
          recipient_name: result.recipient.name,
          recipient_email: result.recipient.email,
          recipient_type: result.recipient.type,
          subject: resolveMergeFields(subject, result.recipient.name),
          message_body: [
            resolveMergeFields(messageBody, result.recipient.name),
            `— Omni-Comms request ${result.requestId ?? 'not issued'}`,
            `— Attachment ${distribution.attachment.fileName} (sha256 ${distribution.attachment.checksum ?? 'unverified'})`,
            result.blockers.length ? `— Blockers: ${result.blockers.join(', ')}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          send_status: sendStatus,
          provider_message_id: result.requestId,
          sent_at: result.outcome === 'sent' ? new Date().toISOString() : null,
          sent_by: userCode || 'system',
        });
      }

      if (distribution.acceptedCount > 0 && distribution.blockedCount === 0) {
        toast({
          title: 'Distribution Accepted',
          description: `${distribution.acceptedCount} recipient(s) accepted by Omni-Comms with the verified plan document attached.`,
        });
        setRecipients([]);
      } else if (distribution.acceptedCount > 0) {
        toast({
          title: 'Partially Accepted',
          description: `${distribution.acceptedCount} accepted, ${distribution.blockedCount} blocked. Check distribution history.`,
          variant: 'destructive',
        });
      } else if (distribution.attachment.ok) {
        toast({
          title: 'Distribution Blocked',
          description: 'Omni-Comms blocked every recipient. Check distribution history for the reason.',
          variant: 'destructive',
        });
      }
    } catch (err: any) {
      toast({ title: 'Send Error', description: err.message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };


  // ===== QUICK SEND: Load defaults and all board members in one click =====
  const handleQuickSend = () => {
    // Load appropriate template
    const templateType = isDraftOrSubmitted ? 'board_review' : 'final_distribution';
    const defaultTemplate = templates.find((t) => t.template_type === templateType && t.is_default);
    if (defaultTemplate) {
      applyTemplate(defaultTemplate);
    }
    // Load board recipients
    const boardRecipients = savedRecipients
      .filter((r) => r.recipient_type === 'board')
      .filter((sr) => !recipients.some((r) => r.email === sr.email))
      .map((sr) => ({ name: sr.name, email: sr.email, type: 'board', savedId: sr.id }));
    if (boardRecipients.length > 0) {
      setRecipients((prev) => [...prev, ...boardRecipients]);
    }
    // Auto-select first artifact
    const selectable = purpose === 'final_distribution' ? finalArtifacts : allDistributableArtifacts;
    if (selectable.length > 0) {
      setSelectedArtifactId((selectable[0] as any).id);
    }
    toast({ title: 'Quick Send Ready', description: `Template loaded with ${boardRecipients.length} board recipient(s). Review and click Send.` });
  };

  // Save recipient to permanent list
  const handleSaveRecipient = async () => {
    if (!newSavedRecipient.name || !newSavedRecipient.email) {
      toast({ title: 'Required', description: 'Name and email are required.', variant: 'destructive' });
      return;
    }
    await recipientMutations.create.mutateAsync({
      name: newSavedRecipient.name,
      email: newSavedRecipient.email,
      recipient_type: newSavedRecipient.recipient_type,
      designation: newSavedRecipient.designation || undefined,
      organization: newSavedRecipient.organization || undefined,
      created_by: userCode || 'system',
    });
    setNewSavedRecipient({ name: '', email: '', recipient_type: 'board', designation: '', organization: '' });
  };

  const selectableArtifacts = purpose === 'final_distribution' ? finalArtifacts : allDistributableArtifacts;

  const logColumns: DataTableColumn<any>[] = [
    { key: 'recipient_name', header: 'Recipient', render: (r) => r.recipient_name || r.recipient_email },
    { key: 'recipient_type', header: 'Type', render: (r) => <StatusBadge status={r.recipient_type || 'external'} /> },
    { key: 'subject', header: 'Subject', render: (r) => <span className="text-sm truncate max-w-[200px] block">{r.subject}</span> },
    { key: 'send_status', header: 'Status', render: (r) => <StatusBadge status={r.send_status || 'Pending'} /> },
    { key: 'sent_by', header: 'Sent By', render: (r) => r.sent_by || '—' },
    { key: 'created_at', header: 'Date', render: (r) => r.created_at ? formatDateForDisplay(r.created_at) : '—' },
  ];

  const savedRecipientColumns: DataTableColumn<DistributionRecipient>[] = [
    { key: 'name', header: 'Name' },
    { key: 'email', header: 'Email' },
    { key: 'recipient_type', header: 'Type', render: (r) => <StatusBadge status={r.recipient_type} /> },
    { key: 'designation', header: 'Designation', render: (r) => r.designation || '—' },
    { key: 'organization', header: 'Organization', render: (r) => r.organization || '—' },
    {
      key: 'actions', header: '', render: (r) => (
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => recipientMutations.remove.mutate(r.id)}>
          <Trash2 className="h-3 w-3 text-destructive" />
        </Button>
      )
    },
  ];

  return (
    <div className="space-y-4">
      {/* Contextual guidance banners */}
      {isDraftOrSubmitted && (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="flex items-center gap-3 pt-6">
            <Info className="h-5 w-5 text-blue-600 shrink-0" />
            <div className="text-sm text-blue-800">
              <p className="font-medium">Pre-Approval Distribution for Board Review</p>
              <p>Distribute draft board pack artifacts to board/committee members for review before formal approval.</p>
            </div>
          </CardContent>
        </Card>
      )}
      {isApproved && finalArtifacts.length === 0 && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="flex items-center gap-3 pt-6">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
            <div className="text-sm text-amber-800">
              <p className="font-medium">No Final Artifact Available</p>
              <p>The plan is approved, but no artifact has been marked as Final. Go to Board Pack tab to finalize an artifact.</p>
            </div>
          </CardContent>
        </Card>
      )}
      {hasSuperseded && (
        <Card className="border-red-200 bg-red-50/50">
          <CardContent className="flex items-center gap-3 pt-6">
            <ShieldAlert className="h-5 w-5 text-red-600 shrink-0" />
            <p className="text-sm text-red-800">Some artifacts have been superseded. Make sure to select a current artifact.</p>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="compose"><Mail className="h-4 w-4 mr-1" /> Compose & Send</TabsTrigger>
          <TabsTrigger value="recipients"><Users className="h-4 w-4 mr-1" /> Saved Recipients</TabsTrigger>
          <TabsTrigger value="history"><Send className="h-4 w-4 mr-1" /> History</TabsTrigger>
        </TabsList>

        {/* ===== COMPOSE TAB ===== */}
        <TabsContent value="compose" className="space-y-4">
          {/* Quick Actions */}
          <Card>
            <CardContent className="flex items-center gap-3 pt-6">
              <Button variant="default" onClick={handleQuickSend} disabled={selectableArtifacts.length === 0}>
                <Zap className="h-4 w-4 mr-2" />
                Quick Send to Board
              </Button>
              <span className="text-xs text-muted-foreground">
                Loads default template + all saved board members. Review and click Send.
              </span>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Compose Distribution</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {/* Distribution Purpose */}
              {isApproved && (
                <div className="space-y-2">
                  <Label>Distribution Purpose</Label>
                  <Select value={purpose} onValueChange={(v) => setPurpose(v as DistributionPurpose)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="board_review">Board Review (Draft / Pre-Approval)</SelectItem>
                      <SelectItem value="final_distribution">Official Final Distribution</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Template Selection */}
              <div className="space-y-2">
                <Label>Email Template</Label>
                <div className="flex gap-2">
                  <Select value={selectedTemplateId} onValueChange={(id) => {
                    const tmpl = templates.find((t) => t.id === id);
                    if (tmpl) applyTemplate(tmpl);
                  }}>
                    <SelectTrigger><SelectValue placeholder="Select a template..." /></SelectTrigger>
                    <SelectContent>
                      {templates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name} {t.is_default ? '(Default)' : ''} — {t.template_type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Recipients */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Recipients ({recipients.length})</Label>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" onClick={() => loadSavedRecipientsByType('board')}>
                      <Users className="h-3 w-3 mr-1" /> Load Board
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => loadSavedRecipientsByType('external')}>
                      <Users className="h-3 w-3 mr-1" /> Load External
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => loadSavedRecipientsByType('internal')}>
                      <Users className="h-3 w-3 mr-1" /> Load Internal
                    </Button>
                  </div>
                </div>
                {recipients.map((r, idx) => (
                  <div key={idx} className="flex items-center gap-2 p-2 border rounded text-sm bg-muted/30">
                    <span className="flex-1 font-medium">{r.name}</span>
                    <span className="text-muted-foreground">{r.email}</span>
                    <StatusBadge status={r.type} />
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeRecipient(idx)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Input placeholder="Name" value={newRecipient.name} onChange={(e) => setNewRecipient((p) => ({ ...p, name: e.target.value }))} className="flex-1" />
                  <Input placeholder="Email" value={newRecipient.email} onChange={(e) => setNewRecipient((p) => ({ ...p, email: e.target.value }))} className="flex-1" />
                  <Select value={newRecipient.type} onValueChange={(v) => setNewRecipient((p) => ({ ...p, type: v }))}>
                    <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="internal">Internal</SelectItem>
                      <SelectItem value="external">External</SelectItem>
                      <SelectItem value="board">Board</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="icon" onClick={addRecipient}><Plus className="h-4 w-4" /></Button>
                </div>
              </div>

              {/* Subject */}
              <div className="space-y-2">
                <Label>Subject</Label>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>

              {/* Merge Fields */}
              <div className="flex flex-wrap gap-1">
                {MERGE_FIELDS.map((f) => (
                  <Button key={f} variant="outline" size="sm" className="h-6 text-xs" onClick={() => insertMergeField(f)}>{f}</Button>
                ))}
              </div>

              {/* Message Body */}
              <div className="space-y-2">
                <Label>Message Body</Label>
                <Textarea value={messageBody} onChange={(e) => setMessageBody(e.target.value)} rows={8} placeholder="Dear {{recipient_name}},&#10;&#10;Please find attached the Annual Audit Plan..." className="font-mono text-sm" />
              </div>

              {/* Artifact Selection */}
              {selectableArtifacts.length > 0 ? (
                <div className="space-y-2">
                  <Label>Attach Artifact</Label>
                  <Select value={selectedArtifactId} onValueChange={setSelectedArtifactId}>
                    <SelectTrigger><SelectValue placeholder="Select artifact" /></SelectTrigger>
                    <SelectContent>
                      {selectableArtifacts.map((a: any) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.file_name} (v{a.version_number}) — {a.status}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No artifacts available. Generate one in the Board Pack tab first.</p>
              )}

              <div className="flex justify-end">
                <Button onClick={handleSend} disabled={recipients.length === 0 || !selectedArtifactId || sending} size="lg">
                  {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                  {isDraftOrSubmitted ? 'Send for Review' : 'Send Final Distribution'} ({recipients.length})
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== SAVED RECIPIENTS TAB ===== */}
        <TabsContent value="recipients" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <UserPlus className="h-4 w-4" /> Add New Saved Recipient
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Name *</Label>
                  <Input value={newSavedRecipient.name} onChange={(e) => setNewSavedRecipient((p) => ({ ...p, name: e.target.value }))} placeholder="Full name" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Email *</Label>
                  <Input type="email" value={newSavedRecipient.email} onChange={(e) => setNewSavedRecipient((p) => ({ ...p, email: e.target.value }))} placeholder="email@example.com" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Type</Label>
                  <Select value={newSavedRecipient.recipient_type} onValueChange={(v) => setNewSavedRecipient((p) => ({ ...p, recipient_type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="board">Board Member</SelectItem>
                      <SelectItem value="external">External Stakeholder</SelectItem>
                      <SelectItem value="internal">Internal Staff</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Designation</Label>
                  <Input value={newSavedRecipient.designation} onChange={(e) => setNewSavedRecipient((p) => ({ ...p, designation: e.target.value }))} placeholder="e.g. Chairperson" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Organization</Label>
                  <Input value={newSavedRecipient.organization} onChange={(e) => setNewSavedRecipient((p) => ({ ...p, organization: e.target.value }))} placeholder="e.g. Social Security Board" />
                </div>
                <div className="flex items-end">
                  <Button onClick={handleSaveRecipient} disabled={recipientMutations.create.isPending}>
                    <Save className="h-4 w-4 mr-2" /> Save Recipient
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Board Members</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={savedRecipientColumns}
                data={savedRecipients.filter((r) => r.recipient_type === 'board')}
                emptyMessage="No board members saved yet."
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">External Stakeholders</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={savedRecipientColumns}
                data={savedRecipients.filter((r) => r.recipient_type === 'external')}
                emptyMessage="No external stakeholders saved yet."
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Internal Staff</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={savedRecipientColumns}
                data={savedRecipients.filter((r) => r.recipient_type === 'internal')}
                emptyMessage="No internal staff saved yet."
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== HISTORY TAB ===== */}
        <TabsContent value="history">
          <Card>
            <CardHeader><CardTitle className="text-sm">Distribution History</CardTitle></CardHeader>
            <CardContent>
              <DataTable columns={logColumns} data={logs} emptyMessage="No distributions sent yet." />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
