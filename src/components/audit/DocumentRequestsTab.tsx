import React, { useState, useEffect } from 'react';
import { Plus, Loader2, FileText, CheckCircle, AlertTriangle, Clock, Send, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge, DataTable } from '@/components/common';
import type { DataTableColumn } from '@/components/common';
import { useDocumentRequests, useDocumentRequestMutations } from '@/hooks/useEngagementExecution';
import { useIADepartments } from '@/hooks/useAuditData';
import { formatDateForDisplay } from '@/lib/format-config';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { emitInternalAuditCommunication } from '@/platform/omni-comms/integrations/business/internal-audit/internalAuditCommunicationProducer';
import { useToast } from '@/hooks/use-toast';
import { formatDepartmentLabel } from '@/lib/audit/departmentLabel';

interface Props {
  engagementId: string;
  departmentId?: string;
  engagementName?: string;
}

function buildDocListHtml(docs: any[]): string {
  const rows = docs.map((d, i) => `
    <tr style="border-bottom: 1px solid #e5e7eb;">
      <td style="padding: 8px 12px; text-align: center; font-size: 13px;">${i + 1}</td>
      <td style="padding: 8px 12px; font-size: 13px; font-weight: 500;">${d.document_title}</td>
      <td style="padding: 8px 12px; font-size: 13px;">${d.description || '—'}</td>
      <td style="padding: 8px 12px; font-size: 13px; text-align: center;">
        <span style="display:inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; background: ${d.priority === 'High' ? '#fef2f2' : d.priority === 'Low' ? '#f0fdf4' : '#fffbeb'}; color: ${d.priority === 'High' ? '#dc2626' : d.priority === 'Low' ? '#16a34a' : '#d97706'};">${d.priority || 'Medium'}</span>
      </td>
      <td style="padding: 8px 12px; font-size: 13px; text-align: center; color: ${d.due_date && new Date(d.due_date) < new Date() ? '#dc2626' : '#374151'};">${d.due_date ? formatDateForDisplay(d.due_date) : '—'}</td>
    </tr>`).join('');

  return `
    <table style="width: 100%; border-collapse: collapse; border: 1px solid #d1d5db; border-radius: 6px; margin: 16px 0;">
      <thead>
        <tr style="background-color: #f3f4f6;">
          <th style="padding: 8px 12px; text-align: center; font-size: 12px; font-weight: 600; color: #374151; border-bottom: 2px solid #d1d5db;">#</th>
          <th style="padding: 8px 12px; text-align: left; font-size: 12px; font-weight: 600; color: #374151; border-bottom: 2px solid #d1d5db;">Document</th>
          <th style="padding: 8px 12px; text-align: left; font-size: 12px; font-weight: 600; color: #374151; border-bottom: 2px solid #d1d5db;">Description</th>
          <th style="padding: 8px 12px; text-align: center; font-size: 12px; font-weight: 600; color: #374151; border-bottom: 2px solid #d1d5db;">Priority</th>
          <th style="padding: 8px 12px; text-align: center; font-size: 12px; font-weight: 600; color: #374151; border-bottom: 2px solid #d1d5db;">Due Date</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function buildEmailBody(docs: any[], engagementName: string, deptHead: string): string {
  const earliestDue = docs.filter(d => d.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date))[0]?.due_date;
  return `
    <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6;">
      <p>Dear ${deptHead || 'Department Head'},</p>
      <p>As part of the ongoing audit engagement — <strong>${engagementName || 'Internal Audit'}</strong> — we kindly request the following document(s) to be provided to the Internal Audit team:</p>
      ${buildDocListHtml(docs)}
      <p>Please ensure the above documents are submitted ${earliestDue ? `by <strong>${formatDateForDisplay(earliestDue)}</strong>` : 'at your earliest convenience'}. If any document is not available, please inform us with the reason and expected availability date.</p>
      <p>Should you require any clarification, please do not hesitate to contact the audit team.</p>
      <p style="margin-top: 24px;">Regards,<br/><strong>SSBM Internal Audit</strong></p>
    </div>`;
}

export function DocumentRequestsTab({ engagementId, departmentId, engagementName }: Props) {
  const { data: requests = [], isLoading } = useDocumentRequests(engagementId);
  const { data: departments = [] } = useIADepartments();
  const { create, update } = useDocumentRequestMutations();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [overrideRecipient, setOverrideRecipient] = useState(false);
  const [form, setForm] = useState({
    document_title: '', description: '', requested_from: '',
    requested_from_email: '', due_date: '', priority: 'Medium',
  });

  // Email dialog state
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [emailMode, setEmailMode] = useState<'consolidated' | 'individual'>('consolidated');
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [isSending, setIsSending] = useState(false);

  const dept = departments?.find((d: any) => d.id === departmentId);
  const defaultHead = dept?.head || '';
  const defaultEmail = dept?.email || '';

  useEffect(() => {
    if (showForm && !overrideRecipient) {
      setForm(f => ({
        ...f,
        requested_from: defaultHead,
        requested_from_email: defaultEmail,
      }));
    }
  }, [showForm, defaultHead, defaultEmail, overrideRecipient]);

  const handleCreate = () => {
    if (!form.document_title) return;
    create.mutate({ ...form, engagement_id: engagementId }, {
      onSuccess: () => {
        setShowForm(false);
        setOverrideRecipient(false);
        setForm({ document_title: '', description: '', requested_from: '', requested_from_email: '', due_date: '', priority: 'Medium' });
      },
    });
  };

  const handleStatusChange = (id: string, status: string) => {
    update.mutate({
      id, status,
      ...(status === 'Received' ? { received_date: new Date().toISOString().split('T')[0] } : {}),
    }, {
      onSuccess: () => {
        // Check if all documents are now received after this update
        const updatedRequests = requests.map((r: any) => r.id === id ? { ...r, status } : r);
        const allReceived = updatedRequests.length > 0 && updatedRequests.every((r: any) => r.status === 'Received');
        if (allReceived) {
          sendAllReceivedNotification();
        }
      },
    });
  };

  const sendAllReceivedNotification = async () => {
    if (!defaultEmail) return;
    const result = await emitInternalAuditCommunication({
      eventCode: 'INTERNAL_AUDIT.REQUEST.FULFILLED',
      entityId: engagementId,
      occurrence: `fulfilled:${new Date().toISOString().slice(0, 10)}`,
      recipientName: defaultHead || 'Department Head',
      recipientEmail: defaultEmail,
      reference: engagementName || engagementId,
      values: {
        engagementTitle: engagementName || '',
        requestSummary: 'All requested documents have been received by the Internal Audit team.',
      },
    });
    if (result.outcome === 'blocked') {
      console.error('Failed to raise completion communication:', result.blockers);
      return;
    }
    toast({ title: 'All Documents Received', description: 'Confirmation notification raised for the Department Head.' });
  };


  // Email send logic
  const openEmailDialog = () => {
    const pendingDocs = requests.filter((r: any) => r.status === 'Pending' || r.status === 'Partially Received');
    setSelectedDocIds(pendingDocs.map((r: any) => r.id));
    setEmailMode('consolidated');
    setShowEmailDialog(true);
  };

  const toggleDocSelection = (id: string) => {
    setSelectedDocIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const selectAllPending = () => {
    const pendingIds = requests.filter((r: any) => r.status === 'Pending' || r.status === 'Partially Received').map((r: any) => r.id);
    setSelectedDocIds(pendingIds);
  };

  const sendEmails = async () => {
    const selectedDocs = requests.filter((r: any) => selectedDocIds.includes(r.id));
    if (selectedDocs.length === 0) return;

    const recipientEmail = selectedDocs[0]?.requested_from_email || defaultEmail;
    const recipientName = selectedDocs[0]?.requested_from || defaultHead;

    if (!recipientEmail) {
      toast({ title: 'No Recipient', description: 'No recipient email found. Please set department head email.', variant: 'destructive' });
      return;
    }

    setIsSending(true);
    try {
      if (emailMode === 'consolidated') {
        // One consolidated obligation covering every selected document.
        const summary = selectedDocs
          .map((d: any) => `${d.document_title}${d.due_date ? ` (due ${formatDateForDisplay(d.due_date)})` : ''}`)
          .join('; ');
        // DEF-S1B-51 / §22: issuance is owned by the database when the request
        // row is created. An operator "send" is a governed reminder, never a
        // second issuance producer for the same business act.
        const result = await emitInternalAuditCommunication({
          eventCode: 'INTERNAL_AUDIT.REQUEST.REMINDER',
          entityId: engagementId,
          occurrence: `consolidated:${selectedDocIds.slice().sort().join(',')}`,
          recipientName: recipientName || 'Department Head',
          recipientEmail,
          reference: engagementName || engagementId,
          values: {
            engagementTitle: engagementName || '',
            requestSummary: summary,
            dueDate: selectedDocs[0]?.due_date || '',
          },
        });
        if (result.outcome === 'blocked') {
          throw new Error(result.blockers.join(', '));
        }
        toast({ title: 'Request Raised', description: `Consolidated request for ${selectedDocs.length} document(s) raised for ${recipientEmail}.` });
      } else {
        // One obligation per document.
        let successCount = 0;
        for (const doc of selectedDocs) {
          const docEmail = doc.requested_from_email || recipientEmail;
          const docName = doc.requested_from || recipientName;
          const result = await emitInternalAuditCommunication({
            eventCode: 'INTERNAL_AUDIT.REQUEST.REMINDER',
            entityId: String(doc.id),
            occurrence: `reminder:${new Date().toISOString().slice(0, 10)}`,
            recipientName: docName || 'Department Head',
            recipientEmail: docEmail,
            reference: engagementName || engagementId,
            values: {
              engagementTitle: engagementName || '',
              requestSummary: doc.document_title,
              dueDate: doc.due_date || '',
            },
          });
          if (result.outcome === 'blocked') {
            console.error(`Failed to raise request for ${doc.document_title}:`, result.blockers);
          } else {
            successCount++;
          }
        }
        toast({ title: 'Requests Raised', description: `${successCount}/${selectedDocs.length} individual document request(s) raised.` });
      }

      setShowEmailDialog(false);
    } catch (err: any) {
      toast({ title: 'Send Failed', description: err.message || 'Failed to send email.', variant: 'destructive' });
    } finally {
      setIsSending(false);
    }
  };

  const isOverdue = (r: any) => r.due_date && r.status === 'Pending' && new Date(r.due_date) < new Date();

  const columns: DataTableColumn<any>[] = [
    { key: 'document_title', header: 'Document', render: (r) => <span className="font-medium text-sm">{r.document_title}</span> },
    { key: 'requested_from', header: 'Requested From', render: (r) => (
      <div>
        <span className="text-sm">{r.requested_from || '—'}</span>
        {r.requested_from_email && <span className="text-xs text-muted-foreground block">{r.requested_from_email}</span>}
      </div>
    )},
    { key: 'due_date', header: 'Due Date', render: (r) => (
      <span className={`text-sm ${isOverdue(r) ? 'text-destructive font-medium' : ''}`}>
        {r.due_date ? formatDateForDisplay(r.due_date) : '—'}
      </span>
    )},
    { key: 'priority', header: 'Priority', render: (r) => <StatusBadge status={r.priority || 'Medium'} /> },
    {
      key: 'status', header: 'Status', render: (r) => (
        <div className="flex items-center gap-1">
          <StatusBadge status={r.status || 'Pending'} />
          {isOverdue(r) && <StatusBadge status="Overdue" />}
        </div>
      )
    },
    { key: 'received_date', header: 'Received', render: (r) => r.received_date ? formatDateForDisplay(r.received_date) : '—' },
  ];

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  const pendingCount = requests.filter((r: any) => r.status === 'Pending').length;
  const overdueCount = requests.filter(isOverdue).length;
  const receivedCount = requests.filter((r: any) => r.status === 'Received').length;
  const pendingOrPartial = requests.filter((r: any) => r.status === 'Pending' || r.status === 'Partially Received');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Total Requests</p><p className="text-xl font-bold">{requests.length}</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Pending</p><p className="text-xl font-bold text-amber-600">{pendingCount}</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Overdue</p><p className="text-xl font-bold text-destructive">{overdueCount}</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Received</p><p className="text-xl font-bold text-primary">{receivedCount}</p></CardContent></Card>
      </div>

      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{requests.length} document request(s)</p>
        <div className="flex gap-2">
          {pendingOrPartial.length > 0 && (
            <Button size="sm" variant="outline" onClick={openEmailDialog}>
              <Mail className="h-4 w-4 mr-1" />Send Request Email ({pendingOrPartial.length})
            </Button>
          )}
          <Button size="sm" onClick={() => { setShowForm(!showForm); setOverrideRecipient(false); }}><Plus className="h-4 w-4 mr-1" />New Request</Button>
        </div>
      </div>

      {showForm && (
        <Card className="border-primary/20">
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Document Title *</Label><Input value={form.document_title} onChange={e => setForm(f => ({ ...f, document_title: e.target.value }))} placeholder="e.g. Bank Reconciliation Q3" /></div>
              <div><Label>Priority</Label>
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['High', 'Medium', 'Low'].map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Details about the document needed..." rows={2} /></div>

            {/* Recipient Section - defaults to Department Head */}
            <div className="p-3 rounded-lg border border-border/50 bg-muted/30 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recipient (Department Head)</p>
                <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setOverrideRecipient(!overrideRecipient)}>
                  {overrideRecipient ? 'Reset to Default' : 'Override'}
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Name</Label>
                  <Input
                    value={form.requested_from}
                    onChange={e => setForm(f => ({ ...f, requested_from: e.target.value }))}
                    placeholder="Department Head Name"
                    disabled={!overrideRecipient}
                    className={!overrideRecipient ? 'bg-muted' : ''}
                  />
                </div>
                <div>
                  <Label className="text-xs">Email</Label>
                  <Input
                    value={form.requested_from_email}
                    onChange={e => setForm(f => ({ ...f, requested_from_email: e.target.value }))}
                    placeholder="Email"
                    disabled={!overrideRecipient}
                    className={!overrideRecipient ? 'bg-muted' : ''}
                  />
                </div>
              </div>
              {!overrideRecipient && dept && (
                <p className="text-xs text-muted-foreground">
                  Auto-populated from department: <span className="font-medium">{formatDepartmentLabel(dept)}</span>
                </p>
              )}
              {!dept && departmentId && (
                <p className="text-xs text-amber-600">Department head information not found. Please override manually.</p>
              )}
            </div>

            <div>
              <Label>Due Date</Label>
              <Input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCreate} disabled={create.isPending || !form.document_title}><FileText className="h-4 w-4 mr-1" />Create Request</Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-4">
          <DataTable
            columns={columns}
            data={requests}
            emptyMessage="No document requests yet. Click 'New Request' to request documents from the Department Head."
            rowClassName={(row) => isOverdue(row) ? 'bg-destructive/5 border-l-2 border-l-destructive' : ''}
            renderActions={(row) => (
              <div className="flex gap-1">
                {row.status === 'Pending' && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => handleStatusChange(row.id, 'Received')}>
                      <CheckCircle className="w-3 h-3 mr-1" />Received
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleStatusChange(row.id, 'Partially Received')}>
                      Partial
                    </Button>
                  </>
                )}
                {row.status === 'Partially Received' && (
                  <Button size="sm" variant="outline" onClick={() => handleStatusChange(row.id, 'Received')}>
                    <CheckCircle className="w-3 h-3 mr-1" />Complete
                  </Button>
                )}
              </div>
            )}
          />
        </CardContent>
      </Card>

      {/* Email Send Dialog */}
      <Dialog open={showEmailDialog} onOpenChange={setShowEmailDialog}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Send Document Request Email
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Email mode selection */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email Mode</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant={emailMode === 'consolidated' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setEmailMode('consolidated')}
                  className="justify-start"
                >
                  <FileText className="h-3.5 w-3.5 mr-1.5" />
                  Single Email (All Documents)
                </Button>
                <Button
                  variant={emailMode === 'individual' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setEmailMode('individual')}
                  className="justify-start"
                >
                  <Send className="h-3.5 w-3.5 mr-1.5" />
                  Separate Email Per Document
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {emailMode === 'consolidated'
                  ? 'All selected documents will be listed in a single email to the Department Head.'
                  : 'A separate email will be sent for each selected document.'}
              </p>
            </div>

            {/* Recipient info */}
            <div className="p-3 rounded-lg border border-border/50 bg-muted/30">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Recipient</p>
              <p className="text-sm font-medium">{defaultHead || 'Department Head'}</p>
              <p className="text-xs text-muted-foreground">{defaultEmail || 'No email configured'}</p>
            </div>

            {/* Document selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Select Documents ({selectedDocIds.length} selected)</Label>
                <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={selectAllPending}>Select All Pending</Button>
              </div>
              <div className="border rounded-md divide-y max-h-[250px] overflow-y-auto">
                {requests.map((r: any) => {
                  const isPending = r.status === 'Pending' || r.status === 'Partially Received';
                  const isSelected = selectedDocIds.includes(r.id);
                  return (
                    <div key={r.id} className={`flex items-center gap-3 p-2.5 ${!isPending ? 'opacity-50' : isSelected ? 'bg-primary/5' : ''}`}>
                      <Checkbox
                        checked={isSelected}
                        disabled={!isPending}
                        onCheckedChange={() => toggleDocSelection(r.id)}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{r.document_title}</p>
                        {r.description && <p className="text-xs text-muted-foreground truncate">{r.description}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <StatusBadge status={r.priority || 'Medium'} />
                        <span className="text-xs text-muted-foreground">{r.due_date ? formatDateForDisplay(r.due_date) : 'No due date'}</span>
                        <StatusBadge status={r.status || 'Pending'} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Preview */}
            {selectedDocIds.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email Preview</Label>
                <div className="border rounded-md p-3 bg-muted/20 max-h-[200px] overflow-y-auto">
                  <div
                    className="text-xs"
                    dangerouslySetInnerHTML={{
                      __html: buildEmailBody(
                        requests.filter((r: any) => selectedDocIds.includes(r.id)),
                        engagementName || '',
                        defaultHead
                      ),
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEmailDialog(false)} size="sm">Cancel</Button>
            <Button onClick={sendEmails} disabled={isSending || selectedDocIds.length === 0} size="sm">
              {isSending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
              {emailMode === 'consolidated'
                ? `Send 1 Email (${selectedDocIds.length} docs)`
                : `Send ${selectedDocIds.length} Email(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
