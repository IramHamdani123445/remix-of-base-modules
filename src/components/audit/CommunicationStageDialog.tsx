import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Send, Loader2, AlertTriangle, Building2, User, FileText, Edit3, RefreshCw, Bell } from 'lucide-react';
import { useRecordCommunicationStage, useValidateTemplatePolicy, STAGE_LABELS } from '@/hooks/useAuditCommunicationStages';
import { useIADocumentTemplates } from '@/hooks/useAuditData';
import { useDocumentRequests } from '@/hooks/useEngagementExecution';
import { supabase } from '@/integrations/supabase/client';
import { emitInternalAuditStageCommunication } from '@/platform/omni-comms/integrations/business/internal-audit/internalAuditManualCommunication';
import { useToast } from '@/hooks/use-toast';
import { formatDateForDisplay } from '@/lib/format-config';

const STAGE_TO_CATEGORY: Record<string, string> = {
  PLAN_INTIMATION: 'Audit Notification',
  TEAM_AND_SCOPE_NOTICE: 'Team Disclosure',
  DOC_REQUEST: 'Document Request',
  ENTRANCE_MEETING: 'Meeting Notice',
  QUERY_CYCLE: 'Query Response',
  DRAFT_FINDING_DISCUSSION: 'Finding Discussion',
  EXIT_MEETING: 'Meeting Notice',
  FINAL_REPORT_ISSUE: 'Audit Report',
  ACTION_PLAN_REMINDER: 'Action Reminder',
};

export interface EngagementContext {
  engagement_name?: string;
  department_name?: string;
  department_head?: string;
  department_email?: string;
  lead_auditor_name?: string;
  planned_start_date?: string;
  planned_end_date?: string;
  objectives?: string;
  scope?: string;
  function_name?: string;
}

interface CommunicationStageDialogProps {
  engagementId: string;
  engagementName?: string;
  stageCode: string;
  open: boolean;
  onClose: () => void;
  engagementContext?: EngagementContext;
  mode?: 'send' | 'resend' | 'reminder';
}

function renderTemplate(content: string, data: Record<string, string>): string {
  return content.replace(/\{\{(\w+)\}\}/g, (match, key) => data[key] || match);
}

const REMINDER_PREFIX = `REMINDER: This is a follow-up to our earlier communication regarding the below. We kindly request your prompt attention to this matter.\n\n---\n\n`;

export function CommunicationStageDialog({ engagementId, engagementName, stageCode, open, onClose, engagementContext, mode = 'send' }: CommunicationStageDialogProps) {
  const { data: templates = [] } = useIADocumentTemplates();
  const { data: docRequests = [] } = useDocumentRequests(engagementId);
  const recordStage = useRecordCommunicationStage();
  const validatePolicy = useValidateTemplatePolicy();
  const { toast } = useToast();

  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [messageContent, setMessageContent] = useState('');
  const [notes, setNotes] = useState('');
  const [ackRequired, setAckRequired] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [policyValid, setPolicyValid] = useState<boolean | null>(null);
  const [isSendingEmail, setIsSendingEmail] = useState(false);

  // Build document request table for DOC_REQUEST stage
  const pendingDocs = (docRequests as any[]).filter(r => r.status === 'Pending' || r.status === 'Partially Received');

  const buildDocTable = (): string => {
    if (pendingDocs.length === 0) return '\n[No pending document requests found. Please add document requests first.]\n';
    const rows = pendingDocs.map((d, i) =>
      `${i + 1}. ${d.document_title}${d.description ? ` — ${d.description}` : ''}  |  Priority: ${d.priority || 'Medium'}  |  Due: ${d.due_date ? formatDateForDisplay(d.due_date) : 'TBD'}`
    ).join('\n');
    return `\nDocuments Requested:\n${'—'.repeat(60)}\n${rows}\n${'—'.repeat(60)}\n`;
  };

  const matchingTemplate = useMemo(() => {
    const requiredCategory = STAGE_TO_CATEGORY[stageCode];
    if (!requiredCategory) return null;
    const activeTemplates = (templates as any[]).filter(t => t.is_active && t.category === requiredCategory);
    if (activeTemplates.length === 0) return null;
    return activeTemplates.sort((a, b) => (b.version_number || 0) - (a.version_number || 0))[0];
  }, [templates, stageCode]);

  const mergeData = useMemo(() => {
    const ctx = engagementContext || {};
    return {
      engagement_name: ctx.engagement_name || engagementName || '',
      department_name: ctx.department_name || '',
      department_head: ctx.department_head || '',
      lead_auditor: ctx.lead_auditor_name || '',
      planned_start_date: ctx.planned_start_date || '',
      planned_end_date: ctx.planned_end_date || '',
      objectives: ctx.objectives || '',
      scope: ctx.scope || '',
      response_due_date: '[Please specify]',
      document_list: stageCode === 'DOC_REQUEST' ? buildDocTable() : '',
    };
  }, [engagementContext, engagementName, stageCode, pendingDocs.length]);

  useEffect(() => {
    if (!open) return;

    const ctx = engagementContext || {};
    setRecipientName(ctx.department_head || '');
    setRecipientEmail(ctx.department_email || '');
    setIsEditing(false);
    setNotes('');
    setAckRequired(mode === 'reminder');

    if (matchingTemplate) {
      setSelectedTemplateId(matchingTemplate.id);
      let rendered = renderTemplate(matchingTemplate.content || '', mergeData);

      // For DOC_REQUEST stage, auto-append the document request list if not already in template
      if (stageCode === 'DOC_REQUEST' && !rendered.includes('{{document_list}}') && pendingDocs.length > 0) {
        rendered += buildDocTable();
      }

      if (mode === 'reminder') {
        rendered = REMINDER_PREFIX + rendered;
      }

      setMessageContent(rendered);

      validatePolicy.mutateAsync({ stageCode, templateId: matchingTemplate.id }).then(result => {
        setPolicyValid(result?.valid ?? true);
      }).catch(() => setPolicyValid(null));
    } else {
      setSelectedTemplateId('');
      let defaultContent = mode === 'reminder' ? REMINDER_PREFIX : '';
      
      // If DOC_REQUEST with no template, generate a complete default message
      if (stageCode === 'DOC_REQUEST' && pendingDocs.length > 0) {
        const ctx = engagementContext || {};
        defaultContent += `Dear ${ctx.department_head || 'Department Head'},\n\nAs part of the ongoing audit engagement — ${ctx.engagement_name || engagementName || 'Internal Audit'} — we kindly request the following document(s) to be provided to the Internal Audit team:\n${buildDocTable()}\nPlease ensure the above documents are submitted by the indicated due dates. If any document is not available, please inform us with the reason and expected availability date.\n\nShould you require any clarification, please do not hesitate to contact the audit team.\n\nRegards,\nSSBM Internal Audit`;
      }
      
      setMessageContent(defaultContent);
      setPolicyValid(null);
    }
  }, [open, stageCode, matchingTemplate?.id, mergeData, mode]);

  /**
   * Wave 4 closure (DEF-2A): operator-initiated stage communications are
   * raised as Omni-Comms obligations. This surface never contacts a provider,
   * never chooses a template, sender or channel, and never sends directly.
   */
  const sendActualEmail = async (_subject: string, _htmlBody: string, toEmail: string) => {
    try {
      setIsSendingEmail(true);
      const result = await emitInternalAuditStageCommunication({
        stageCode,
        mode: mode === 'reminder' ? 'reminder' : mode === 'initial' ? 'initial' : 'reissue',

        entityId: engagementId,
        recipientName: recipientName || 'Department Head',
        recipientEmail: toEmail,
        reference: engagementContext?.engagement_name || engagementName || engagementId,
        values: {
          engagementTitle: engagementContext?.engagement_name || engagementName || '',
          requestSummary: messageContent,
          departmentName: engagementContext?.department_name || '',
          leadAuditor: engagementContext?.lead_auditor_name || '',
          dueDate: engagementContext?.planned_end_date || '',
        },
      });
      if (result.outcome === 'blocked') {
        return { success: false, message: result.blockers.join(', ') };
      }
      return { success: true, outcome: result.outcome, requestId: result.requestId };
    } finally {
      setIsSendingEmail(false);
    }
  };


  const handleSend = async () => {
    if (!recipientEmail) return;

    const stageLabel = STAGE_LABELS[stageCode] || stageCode;
    const subjectPrefix = mode === 'reminder' ? 'REMINDER: ' : mode === 'resend' ? 'Re: ' : '';
    const subject = `${subjectPrefix}${stageLabel} — ${engagementContext?.engagement_name || engagementName || 'Audit Engagement'}`;

    try {
      // Send actual email
      const emailResult = await sendActualEmail(subject, messageContent, recipientEmail);

      if (emailResult?.success === false) {
        toast({
          title: 'Email Delivery Failed',
          description: emailResult?.message || 'The email could not be sent. Please verify the recipient email and try again.',
          variant: 'destructive',
        });
        return;
      }

      // Record in communication stages
      const stageNotes = mode === 'reminder'
        ? `[REMINDER] ${notes || 'Follow-up reminder sent.'}`
        : mode === 'resend'
        ? `[RESENT] ${notes || 'Communication resent.'}`
        : notes || messageContent;

      recordStage.mutate({
        engagementId,
        stageCode,
        templateId: selectedTemplateId || undefined,
        recipientName,
        recipientEmail,
        notes: stageNotes,
        acknowledgmentRequired: ackRequired,
        mode,
      }, {
        onSuccess: () => {
          toast({
            title: mode === 'reminder' ? 'Reminder Sent' : mode === 'resend' ? 'Communication Resent' : 'Communication Sent',
            description: `Email sent to ${recipientEmail} successfully.`,
          });
          onClose();
        },
      });
    } catch (err: any) {
      toast({
        title: 'Send Failed',
        description: err.message || 'Failed to send communication.',
        variant: 'destructive',
      });
    }
  };

  const stageLabel = STAGE_LABELS[stageCode] || stageCode;
  const requiredCategory = STAGE_TO_CATEGORY[stageCode];
  const isPending = recordStage.isPending || isSendingEmail;

  const modeConfig = {
    send: { icon: Send, title: `Send: ${stageLabel}`, btnLabel: 'Send Communication', btnIcon: Send },
    resend: { icon: RefreshCw, title: `Resend: ${stageLabel}`, btnLabel: 'Resend Communication', btnIcon: RefreshCw },
    reminder: { icon: Bell, title: `Send Reminder: ${stageLabel}`, btnLabel: 'Send Reminder', btnIcon: Bell },
  }[mode];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <modeConfig.icon className="h-4 w-4" />
            {modeConfig.title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Mode indicator */}
          {mode !== 'send' && (
            <div className={`flex items-center gap-2 p-2 rounded-md text-xs ${
              mode === 'reminder' ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-blue-50 text-blue-800 border border-blue-200'
            }`}>
              {mode === 'reminder' ? (
                <><Bell className="h-3.5 w-3.5" /> This will send a follow-up reminder. The original communication content is included below for reference.</>
              ) : (
                <><RefreshCw className="h-3.5 w-3.5" /> This will resend the communication. A new entry will be recorded in the audit trail.</>
              )}
            </div>
          )}

          {/* Engagement Info */}
          {engagementContext && (
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="p-3">
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                  <div className="flex items-center gap-1.5">
                    <FileText className="h-3 w-3 text-primary shrink-0" />
                    <span className="text-muted-foreground">Engagement:</span>
                    <span className="font-medium truncate">{engagementContext.engagement_name || engagementName}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Building2 className="h-3 w-3 text-primary shrink-0" />
                    <span className="text-muted-foreground">Department:</span>
                    <span className="font-medium truncate">{engagementContext.department_name || '—'}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <User className="h-3 w-3 text-primary shrink-0" />
                    <span className="text-muted-foreground">Dept. Head:</span>
                    <span className="font-medium truncate">{engagementContext.department_head || '—'}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <User className="h-3 w-3 text-primary shrink-0" />
                    <span className="text-muted-foreground">Lead Auditor:</span>
                    <span className="font-medium truncate">{engagementContext.lead_auditor_name || '—'}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Template Info */}
          <div className="space-y-1">
            <Label className="text-xs">Template</Label>
            {matchingTemplate ? (
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className="bg-green-100 text-green-800 border-green-300 text-[10px]">
                  ✓ {matchingTemplate.name} (v{matchingTemplate.version_number || 1})
                </Badge>
                <Badge variant="outline" className="text-[10px]">{requiredCategory}</Badge>
                {policyValid === true && (
                  <Badge className="bg-blue-100 text-blue-800 text-[10px]">Policy Compliant</Badge>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1 text-xs text-destructive">
                <AlertTriangle className="h-3 w-3" />
                No active template found for category &quot;{requiredCategory}&quot;.
              </div>
            )}
          </div>

          {/* Recipient */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Recipient Name</Label>
              <Input value={recipientName} onChange={e => setRecipientName(e.target.value)} placeholder="Department Head" className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Recipient Email *</Label>
              <Input type="email" value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)} placeholder="email@example.com" className="h-8 text-sm" />
            </div>
          </div>

          {/* Communication Content */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Communication Content</Label>
              <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => setIsEditing(!isEditing)}>
                <Edit3 className="h-3 w-3" />
                {isEditing ? 'Preview' : 'Edit'}
              </Button>
            </div>
            {isEditing ? (
              <Textarea value={messageContent} onChange={e => setMessageContent(e.target.value)} rows={12} className="font-mono text-xs" />
            ) : (
              <div className="border rounded-md p-3 bg-muted/30 max-h-[250px] overflow-y-auto">
                <pre className="whitespace-pre-wrap text-xs font-sans leading-relaxed text-foreground">
                  {messageContent || 'No template content available. Click Edit to write custom content.'}
                </pre>
              </div>
            )}
          </div>

          {/* Additional Notes */}
          <div className="space-y-1">
            <Label className="text-xs">Additional Notes (optional)</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any additional notes..." rows={2} className="text-sm" />
          </div>

          <div className="flex items-center gap-2">
            <Switch checked={ackRequired} onCheckedChange={setAckRequired} />
            <Label className="text-xs">Require acknowledgment from recipient</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} size="sm">Cancel</Button>
          <Button onClick={handleSend} disabled={!recipientEmail || isPending || policyValid === false} size="sm">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <modeConfig.btnIcon className="h-4 w-4 mr-1" />}
            {modeConfig.btnLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
