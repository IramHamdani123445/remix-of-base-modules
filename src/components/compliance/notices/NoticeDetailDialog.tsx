/**
 * Notice Detail — canonical drill-down for a compliance notice.
 *
 * Read model comes from `ce_notice_detail_v1` (notice + delivery attempts +
 * employer responses + status audit trail). Lifecycle actions reuse the
 * existing governed services (noticeService / noticeWorkflowService) which
 * route through the CE workflow transition RPC — the dialog never writes
 * `ce_notices` directly and always records the authenticated user.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, AlertTriangle, Send, CheckCircle2, XCircle, Truck, MessageSquare, Ban, FileText, Building2 } from 'lucide-react';
import { toast } from 'sonner';
import { useUserCode } from '@/hooks/useUserCode';
import { sendNotice, markDelivered, recordAcknowledgment, cancelNotice } from '@/services/noticeService';
import { approveNotice, rejectNotice, recordEmployerResponse, RESPONSE_TYPES, type ResponseType } from '@/services/noticeWorkflowService';
import { labelFor } from '@/hooks/compliance/useNoticeRegister';

const sb = supabase as any;

interface Props {
  noticeId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  actor?: {
    can_approve?: boolean;
    can_send?: boolean;
    can_cancel?: boolean;
    can_record_response?: boolean;
  };
}

function fmt(v?: string | null) {
  if (!v) return '—';
  try { return new Date(v).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return v; }
}
function fmtDate(v?: string | null) {
  if (!v) return '—';
  try { return new Date(v).toLocaleDateString('en-GB'); } catch { return v; }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  );
}

export function NoticeDetailDialog({ noticeId, open, onOpenChange, actor }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { userCode } = useUserCode();
  const [cancelReason, setCancelReason] = useState('');
  const [cancelMode, setCancelMode] = useState(false);
  const [respMode, setRespMode] = useState(false);
  const [respType, setRespType] = useState<ResponseType>('ACKNOWLEDGEMENT');
  const [respDate, setRespDate] = useState(new Date().toISOString().slice(0, 10));
  const [respNotes, setRespNotes] = useState('');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['ce_notice_detail_v1', noticeId],
    enabled: open && !!noticeId,
    queryFn: async () => {
      const { data, error } = await sb.rpc('ce_notice_detail_v1', { p_notice_id: noticeId });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
  });

  const n = data?.notice;
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ce_notice_register_v1'] });
    qc.invalidateQueries({ queryKey: ['ce_notice_detail_v1', noticeId] });
    qc.invalidateQueries({ queryKey: ['ce_notices'] });
  };

  const action = useMutation({
    mutationFn: async (a: { kind: string }) => {
      if (!noticeId) return;
      if (!userCode) throw new Error('Your user profile could not be resolved — sign in again before acting on notices.');
      switch (a.kind) {
        case 'APPROVE': return approveNotice(noticeId, userCode);
        case 'REJECT': return rejectNotice(noticeId, userCode);
        case 'SEND': return sendNotice(noticeId, userCode);
        case 'DELIVERED': return markDelivered(noticeId, userCode);
        case 'ACK': return recordAcknowledgment(noticeId, userCode);
        case 'CANCEL': {
          if (cancelReason.trim().length < 10) throw new Error('A cancellation reason of at least 10 characters is required.');
          await cancelNotice(noticeId, cancelReason.trim(), userCode);
          setCancelMode(false); setCancelReason('');
          return;
        }
        case 'RESPONSE': {
          if (!respNotes.trim()) throw new Error('Response notes are required.');
          await recordEmployerResponse({
            noticeId,
            caseId: n?.case_id ?? null,
            violationId: n?.violation_id ?? null,
            employerId: n?.employer_id ?? '',
            responseType: respType,
            responseDate: respDate,
            notes: respNotes.trim(),
            nextAction: null,
            userCode,
          } as any);
          setRespMode(false); setRespNotes('');
          return;
        }
      }
    },
    onSuccess: () => { toast.success('Notice updated'); invalidate(); },
    onError: (e: any) => toast.error(e?.message || 'Action failed'),
  });

  const busy = action.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            {n?.notice_number || 'Notice'}
          </DialogTitle>
          <DialogDescription>
            Full notice lifecycle — approval, dispatch, delivery, acknowledgement and employer response.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="py-16 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></div>
        )}

        {isError && (
          <div className="py-12 text-center space-y-3">
            <AlertTriangle className="h-6 w-6 mx-auto text-destructive" />
            <p className="text-sm text-muted-foreground">Unable to load this notice.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </div>
        )}

        {n && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Field label="Status"><Badge variant="outline">{labelFor(n.status, n.status_label, 'Status')}</Badge></Field>
              <Field label="Notice Type">{labelFor(n.notice_type, n.notice_type_label, 'Notice Type')}</Field>
              <Field label="Delivery">
                <Badge variant="outline">{n.delivery_status === 'PENDING' ? 'Not Yet Dispatched' : n.delivery_status === 'SENT' ? 'Dispatched' : n.delivery_status === 'DELIVERED' ? 'Delivered' : 'Failed'}</Badge>
              </Field>
              <Field label="Employer Response">
                {n.response_state === 'RECEIVED' ? 'Response Received'
                  : n.response_state === 'OVERDUE' ? 'Response Overdue'
                  : n.response_state === 'AWAITING' ? 'Awaiting Response' : 'No Response Required'}
              </Field>

              <Field label="Employer">
                {n.employer_id ? (
                  <button className="text-primary hover:underline inline-flex items-center gap-1"
                    onClick={() => navigate(`/compliance/field/employer-360/${encodeURIComponent(n.employer_id)}`)}>
                    <Building2 className="h-3 w-3" />{n.employer_name || n.employer_id}
                  </button>
                ) : '—'}
              </Field>
              <Field label="Case">
                {n.case_id ? (
                  <button className="text-primary hover:underline font-mono text-xs"
                    onClick={() => navigate(`/compliance/cases/${n.case_id}`)}>{n.case_number || 'Open case'}</button>
                ) : '—'}
              </Field>
              <Field label="Violation">
                {n.violation_id ? (
                  <button className="text-primary hover:underline font-mono text-xs"
                    onClick={() => navigate(`/compliance/violations/${n.violation_id}`)}>{n.violation_number || 'Open violation'}</button>
                ) : '—'}
              </Field>
              <Field label="Template">{n.template_code ? `${n.template_code} — ${n.template_name}` : '—'}</Field>

              <Field label="Created">{fmt(n.created_at)}</Field>
              <Field label="Created By">{n.created_by || '—'}</Field>
              <Field label="Sent">{fmt(n.sent_at)}</Field>
              <Field label="Delivered">{fmt(n.delivered_at)}</Field>
              <Field label="Acknowledged">{fmt(n.acknowledged_at)}</Field>
              <Field label="Response Due">{fmtDate(n.due_response_date)}</Field>
              <Field label="Delivery Method">{n.delivery_method_label || n.delivery_method || '—'}</Field>
              <Field label="Generated Document">
                {n.dms_document_ref
                  ? <span className="font-mono text-xs">{n.dms_document_ref}</span>
                  : <span className="text-muted-foreground text-xs">No document archived</span>}
              </Field>
            </div>

            <Separator />

            <div>
              <p className="text-sm font-semibold mb-1">{n.subject || 'No subject'}</p>
              <div className="rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap max-h-64 overflow-y-auto">
                {n.body || 'No body content recorded.'}
              </div>
            </div>

            {/* Delivery attempts */}
            <div>
              <p className="text-sm font-semibold mb-2 flex items-center gap-2"><Truck className="h-4 w-4" /> Delivery Attempts</p>
              {(data.deliveries || []).length === 0 ? (
                <p className="text-xs text-muted-foreground">No delivery attempts recorded.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14">#</TableHead>
                      <TableHead>Channel</TableHead>
                      <TableHead>Recipient</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Sent</TableHead>
                      <TableHead>Delivered</TableHead>
                      <TableHead>Provider / Failure</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data.deliveries as any[]).map(d => (
                      <TableRow key={d.id}>
                        <TableCell>{d.attempt_number}</TableCell>
                        <TableCell>{d.channel}</TableCell>
                        <TableCell className="text-xs">{d.recipient_address || '—'}</TableCell>
                        <TableCell><Badge variant="outline">{d.status}</Badge></TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{fmt(d.sent_at)}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{fmt(d.delivered_at)}</TableCell>
                        <TableCell className="text-xs">{d.failure_reason || d.provider_message_id || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            {/* Employer responses */}
            <div>
              <p className="text-sm font-semibold mb-2 flex items-center gap-2"><MessageSquare className="h-4 w-4" /> Employer Responses</p>
              {(data.responses || []).length === 0 ? (
                <p className="text-xs text-muted-foreground">No substantive employer response recorded.</p>
              ) : (
                <div className="space-y-2">
                  {(data.responses as any[]).map(r => (
                    <div key={r.id} className="rounded-md border p-2 text-sm">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline">{r.response_type}</Badge>
                        <span>{fmtDate(r.response_date)}</span>
                        <span>· {r.recorded_by_name || r.recorded_by}</span>
                      </div>
                      <p className="mt-1">{r.notes || '—'}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Audit trail */}
            <div>
              <p className="text-sm font-semibold mb-2">Lifecycle Audit</p>
              {(data.audit || []).length === 0 ? (
                <p className="text-xs text-muted-foreground">No status transitions recorded yet.</p>
              ) : (
                <div className="space-y-1 text-xs">
                  {(data.audit as any[]).map((a, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-muted-foreground whitespace-nowrap">{fmt(a.at)}</span>
                      <Badge variant="outline">{a.action}</Badge>
                      <span>{a.from_status || '—'} → {a.to_status || '—'}</span>
                      <span className="text-muted-foreground">· {a.actor || 'SYSTEM'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            {/* Lifecycle actions */}
            <div className="flex flex-wrap gap-2">
              {actor?.can_approve && n.status === 'PENDING_APPROVAL' && (
                <>
                  <Button size="sm" disabled={busy} onClick={() => action.mutate({ kind: 'APPROVE' })}>
                    <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => action.mutate({ kind: 'REJECT' })}>
                    <XCircle className="h-4 w-4 mr-1" /> Reject
                  </Button>
                </>
              )}
              {actor?.can_send && (n.status === 'APPROVED' || n.status === 'DRAFT') && (
                <Button size="sm" disabled={busy} onClick={() => action.mutate({ kind: 'SEND' })}>
                  <Send className="h-4 w-4 mr-1" /> Send via Communication Hub
                </Button>
              )}
              {actor?.can_send && n.status === 'SENT' && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => action.mutate({ kind: 'DELIVERED' })}>
                  <Truck className="h-4 w-4 mr-1" /> Mark Delivered
                </Button>
              )}
              {actor?.can_record_response && ['SENT', 'DELIVERED'].includes(n.status) && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => action.mutate({ kind: 'ACK' })}>
                  <CheckCircle2 className="h-4 w-4 mr-1" /> Record Acknowledgement
                </Button>
              )}
              {actor?.can_record_response && (
                <Button size="sm" variant="outline" onClick={() => setRespMode(v => !v)}>
                  <MessageSquare className="h-4 w-4 mr-1" /> Record Employer Response
                </Button>
              )}
              {actor?.can_cancel && !['CANCELLED', 'WITHDRAWN', 'SUPERSEDED'].includes(n.status) && (
                <Button size="sm" variant="destructive" onClick={() => setCancelMode(v => !v)}>
                  <Ban className="h-4 w-4 mr-1" />
                  {['DELIVERED', 'ACKNOWLEDGED'].includes(n.status) ? 'Withdraw Notice' : 'Cancel Notice'}
                </Button>
              )}
            </div>

            {respMode && (
              <div className="rounded-md border p-3 space-y-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Response Type</Label>
                    <Select value={respType} onValueChange={v => setRespType(v as ResponseType)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {RESPONSE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Response Date</Label>
                    <Input type="date" value={respDate} onChange={e => setRespDate(e.target.value)} />
                  </div>
                </div>
                <div>
                  <Label>Notes *</Label>
                  <Textarea value={respNotes} onChange={e => setRespNotes(e.target.value)} rows={3} />
                </div>
                <Button size="sm" disabled={busy} onClick={() => action.mutate({ kind: 'RESPONSE' })}>Save Response</Button>
              </div>
            )}

            {cancelMode && (
              <div className="rounded-md border border-destructive/40 p-3 space-y-2">
                <Label>Justification * (minimum 10 characters — recorded against your user and timestamp)</Label>
                <Textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} rows={3}
                  placeholder="Explain why this notice is being cancelled or withdrawn…" />
                <Button size="sm" variant="destructive" disabled={busy} onClick={() => action.mutate({ kind: 'CANCEL' })}>
                  Confirm
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default NoticeDetailDialog;
