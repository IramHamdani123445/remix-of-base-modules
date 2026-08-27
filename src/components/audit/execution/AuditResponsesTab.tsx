import { openAuditFile } from '@/lib/audit/auditFileAccess';
import React, { useState, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, MessageSquare, FileText, Loader2 } from 'lucide-react';
import { StatusBadge, DataTable } from '@/components/common';
import type { DataTableColumn } from '@/components/common';
import { AuditEmptyState } from '@/components/audit/workspace/AuditEmptyState';
import { formatDateForDisplay } from '@/lib/format-config';
import { useUserCode } from '@/hooks/useUserCode';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { notifyManagementResponseSubmitted } from '@/services/auditNotificationService';
import {
  useRecordManagementResponse,
  useReviewManagementResponse,
  type ManagementPosition,
} from '@/hooks/useAuditLifecycleCommands';

const POSITIONS: ManagementPosition[] = ['Accepted', 'Partially Accepted', 'Rejected'];


const ALLOWED_FILE_TYPES = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/png', 'image/jpeg'];
const MAX_FILE_SIZE = 20 * 1024 * 1024;

interface AuditResponsesTabProps {
  auditId: string;
  auditFindings: any[];
  auditResponses: any[];
  departmentId?: string;
  leadAuditorId?: string;
}

export function AuditResponsesTab({ auditId, auditFindings, auditResponses, departmentId, leadAuditorId }: AuditResponsesTabProps) {
  const recordResponse = useRecordManagementResponse();
  const reviewResponse = useReviewManagementResponse();
  const { userCode } = useUserCode();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    finding_id: '',
    management_position: 'Accepted' as ManagementPosition,
    response_text: '',
    action_plan: '',
    responsible_person: '',
    target_date: '',
    rejection_rationale: '',
  });
  const [uploading, setUploading] = useState(false);

  const findingsWithoutResponse = auditFindings.filter(f => !auditResponses.find((r: any) => r.finding_id === f.id));

  const handleSubmitResponse = async () => {
    if (!form.finding_id || !form.response_text) {
      toast({ title: 'Validation', description: 'Finding and response text are required', variant: 'destructive' });
      return;
    }
    if (form.management_position === 'Rejected' && !form.rejection_rationale.trim()) {
      toast({ title: 'Validation', description: 'A rejection rationale is required when the finding is rejected', variant: 'destructive' });
      return;
    }
    // Supporting documents are stored in the audit bucket; the response record
    // itself is written only by the governed command.
    const fileInput = fileInputRef.current;
    if (fileInput?.files?.[0]) {
      const file = fileInput.files[0];
      if (!ALLOWED_FILE_TYPES.includes(file.type) || file.size > MAX_FILE_SIZE) {
        toast({ title: 'Upload Failed', description: 'Invalid file type or size exceeds 20MB', variant: 'destructive' });
        return;
      }
      setUploading(true);
      const path = `responses/${auditId}/${Date.now()}_${file.name}`;
      const { error } = await supabase.storage.from('audit-attachments').upload(path, file);
      setUploading(false);
      if (error) { toast({ title: 'Upload Failed', variant: 'destructive' }); return; }
    }
    recordResponse.mutate(
      {
        findingId: form.finding_id,
        position: form.management_position,
        responseText: form.response_text,
        actionPlan: form.action_plan || null,
        responsiblePerson: form.responsible_person || userCode || null,
        targetDate: form.target_date || null,
        rejectionRationale: form.rejection_rationale || null,
      },
      {
        onSuccess: () => {
          const findingId = form.finding_id;
          setShowForm(false);
          setForm({ finding_id: '', management_position: 'Accepted', response_text: '', action_plan: '', responsible_person: '', target_date: '', rejection_rationale: '' });
          if (fileInputRef.current) fileInputRef.current.value = '';
          notifyManagementResponseSubmitted(findingId, leadAuditorId);
        },
      },
    );
  };

  const handleReview = (responseId: string, outcome: 'Accepted' | 'Escalated' | 'Revision Requested') => {
    reviewResponse.mutate({ responseId, outcome });
  };


  const columns: DataTableColumn<any>[] = [
    { key: 'finding', header: 'Finding', render: (r) => {
      const finding = auditFindings.find((f: any) => f.id === r.finding_id);
      return (
        <div>
          <span className="font-medium text-sm">{finding?.title || r.finding_id?.slice(0, 8)}</span>
          <div className="mt-0.5"><StatusBadge status={finding?.risk_rating || 'Medium'} /></div>
        </div>
      );
    }},
    { key: 'response_text', header: 'Response', render: (r) => <span className="text-xs max-w-[200px] truncate block">{r.response_text || '—'}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status || 'Pending'} /> },
    { key: 'submitted_by', header: 'By', render: (r) => <span className="text-xs">{r.submitted_by || '—'}</span> },
    { key: 'submitted_date', header: 'Date', render: (r) => r.submitted_date ? formatDateForDisplay(r.submitted_date) : '—' },
    { key: 'attachment', header: 'Docs', render: (r) => {
      const docs = r.supporting_docs as string[] | null;
      if (!docs?.length) return <span className="text-muted-foreground text-xs">—</span>;
      return <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => { void openAuditFile('audit-attachments', docs[0]); }}><FileText className="h-3 w-3 mr-1" />View</Button>;
    }},
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{auditResponses.length} response(s) · {findingsWithoutResponse.length} awaiting</p>
        {findingsWithoutResponse.length > 0 && (
          <Button size="sm" onClick={() => setShowForm(!showForm)}><Plus className="h-4 w-4 mr-1" />Submit Response</Button>
        )}
      </div>

      {showForm && (
        <Card className="border-primary/20">
          <CardContent className="p-4 space-y-3">
            <div><Label>Finding *</Label>
              <Select value={form.finding_id} onValueChange={v => setForm(f => ({ ...f, finding_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select finding" /></SelectTrigger>
                <SelectContent>
                  {findingsWithoutResponse.map((f: any) => (
                    <SelectItem key={f.id} value={f.id}>{f.title} ({f.risk_rating})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Management Response *</Label><Textarea value={form.response_text} onChange={e => setForm(f => ({ ...f, response_text: e.target.value }))} rows={3} /></div>
            <div><Label>Action Plan</Label><Textarea value={form.action_plan} onChange={e => setForm(f => ({ ...f, action_plan: e.target.value }))} rows={2} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Target Date</Label><Input type="date" value={form.target_date} onChange={e => setForm(f => ({ ...f, target_date: e.target.value }))} /></div>
              <div><Label>Supporting Document</Label>
                <Input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg" className="text-xs" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSubmitResponse} disabled={create.isPending || uploading}>
                {uploading ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Uploading...</> : 'Submit Response'}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {auditResponses.length === 0 && !showForm ? (
        <AuditEmptyState icon={MessageSquare} title="No management responses yet" description="Responses will appear here once submitted by auditees" />
      ) : (
        <Card><CardContent className="pt-4">
          <DataTable columns={columns} data={auditResponses} emptyMessage="No management responses submitted yet."
            renderActions={(row) => (
              <div className="flex gap-1">
                {row.status === 'Submitted' && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => handleUpdateStatus(row.id, 'Accepted')}>Accept</Button>
                    <Button size="sm" variant="outline" onClick={() => handleUpdateStatus(row.id, 'Rejected')}>Reject</Button>
                  </>
                )}
              </div>
            )}
          />
        </CardContent></Card>
      )}
    </div>
  );
}
