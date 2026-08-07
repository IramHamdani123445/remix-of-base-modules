/**
 * BN Risk — information requests panel (EPIC 1).
 *
 * Requests are recorded here; they are never sent from this component.
 * Any outbound contact is handed to the Communication Hub by the governed
 * boundary, and its outcome is shown back as the communication status.
 */
import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatAuditDate } from '@/lib/dateFormat';
import { riskAssessmentService } from '@/services/bn/risk/riskAssessmentService';
import type {
  BnRiskAssessmentActionCode,
  BnRiskFactorRow,
  BnRiskInformationRequestRow,
} from '@/types/bn/risk/riskAssessment';
import { referenceItems, useRiskReferenceData } from './useRiskReference';

const NONE = '__NONE__';

interface Props {
  assessmentId: string;
  rowVersion: number;
  requests: readonly BnRiskInformationRequestRow[];
  factors: readonly BnRiskFactorRow[];
  isActionEnabled: (action: BnRiskAssessmentActionCode) => boolean;
  onChanged: () => void;
}

export const BnRiskInformationSection: React.FC<Props> = ({
  assessmentId, rowVersion, requests, factors, isActionEnabled, onChanged,
}) => {
  const queryClient = useQueryClient();
  const { data: reference } = useRiskReferenceData();

  const [requestOpen, setRequestOpen] = React.useState(false);
  const [typeCode, setTypeCode] = React.useState('');
  const [recipientKind, setRecipientKind] = React.useState('');
  const [recipientName, setRecipientName] = React.useState('');
  const [channel, setChannel] = React.useState('');
  const [required, setRequired] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [dueOn, setDueOn] = React.useState('');
  const [blocking, setBlocking] = React.useState(true);
  const [factorId, setFactorId] = React.useState(NONE);

  const [responseRow, setResponseRow] = React.useState<BnRiskInformationRequestRow | null>(null);
  const [outcome, setOutcome] = React.useState('');
  const [responseSummary, setResponseSummary] = React.useState('');

  const [closeRow, setCloseRow] = React.useState<BnRiskInformationRequestRow | null>(null);
  const [closeJustification, setCloseJustification] = React.useState('');

  const [error, setError] = React.useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['bn-risk-assessment-detail', assessmentId] });
    queryClient.invalidateQueries({ queryKey: ['bn-risk-assessment-actions', assessmentId] });
    queryClient.invalidateQueries({ queryKey: ['bn-risk-assessment-queue'] });
    onChanged();
  };

  const requestMutation = useMutation({
    mutationFn: async () => {
      const result = await riskAssessmentService.execute({
        command: 'BN_RISK_REQUEST_EVIDENCE',
        assessmentId,
        expectedRowVersion: rowVersion,
        payload: {
          request_type_code: typeCode,
          recipient_kind: recipientKind,
          recipient_name: recipientName.trim() || null,
          channel_code: channel || null,
          required_information: required.trim(),
          reason: reason.trim() || null,
          due_on: dueOn || null,
          is_blocking: blocking,
          factor_id: factorId === NONE ? null : factorId,
        },
      });
      if (result.status === 'FAILED') {
        throw new Error(result.errorMessage ?? 'The request could not be recorded.');
      }
      return result;
    },
    onSuccess: () => {
      setRequestOpen(false);
      setRequired(''); setReason(''); setDueOn(''); setRecipientName('');
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });

  const responseMutation = useMutation({
    mutationFn: async () => {
      const result = await riskAssessmentService.execute({
        command: 'BN_RISK_OP_RECORD_REQUEST_RESPONSE',
        assessmentId,
        expectedRowVersion: rowVersion,
        payload: {
          request_id: responseRow?.request_id,
          response_outcome_code: outcome,
          response_summary: responseSummary.trim() || null,
        },
      });
      if (result.status === 'FAILED') {
        throw new Error(result.errorMessage ?? 'The response could not be recorded.');
      }
      return result;
    },
    onSuccess: () => { setResponseRow(null); setOutcome(''); setResponseSummary(''); invalidate(); },
    onError: (e: Error) => setError(e.message),
  });

  const closeMutation = useMutation({
    mutationFn: async () => {
      const result = await riskAssessmentService.execute({
        command: 'BN_RISK_OP_CLOSE_REQUEST',
        assessmentId,
        expectedRowVersion: rowVersion,
        justification: closeJustification.trim(),
        payload: { request_id: closeRow?.request_id },
      });
      if (result.status === 'FAILED') {
        throw new Error(result.errorMessage ?? 'The request could not be closed.');
      }
      return result;
    },
    onSuccess: () => { setCloseRow(null); setCloseJustification(''); invalidate(); },
    onError: (e: Error) => setError(e.message),
  });

  const outstanding = requests.filter(
    (r) => r.status === 'REQUESTED' || r.status === 'SENT',
  ).length;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Information requests</CardTitle>
          <CardDescription>
            {outstanding === 0
              ? 'No outstanding requests.'
              : `${outstanding} request${outstanding === 1 ? '' : 's'} awaiting a response.`}
          </CardDescription>
        </div>
        <Button
          size="sm"
          disabled={!isActionEnabled('REQUEST_EVIDENCE')}
          onClick={() => { setError(null); setRequestOpen(true); }}
        >
          Request information
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>What was asked for</TableHead>
                <TableHead>Recipient</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No information has been requested.
                  </TableCell>
                </TableRow>
              )}
              {requests.map((r) => (
                <TableRow key={r.request_id}>
                  <TableCell className="font-medium">
                    {r.request_reference}
                    {r.is_blocking && <Badge variant="outline" className="ml-2">Blocking</Badge>}
                  </TableCell>
                  <TableCell>
                    {r.required_information}
                    <span className="block text-xs text-muted-foreground">{r.request_type_label}</span>
                  </TableCell>
                  <TableCell>{r.recipient_name ?? r.recipient_kind}</TableCell>
                  <TableCell>{r.due_on ? formatAuditDate(r.due_on, false) : '—'}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{r.status_label}</Badge>
                    {r.response_summary && (
                      <span className="block text-xs text-muted-foreground">{r.response_summary}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.communication_detail ?? r.communication_status}
                  </TableCell>
                  <TableCell className="space-x-2 text-right whitespace-nowrap">
                    <Button
                      size="sm" variant="outline"
                      disabled={
                        !isActionEnabled('RECORD_RESPONSE')
                        || (r.status !== 'REQUESTED' && r.status !== 'SENT')
                      }
                      onClick={() => {
                        setError(null); setResponseRow(r);
                        setOutcome(''); setResponseSummary('');
                      }}
                    >
                      Record response
                    </Button>
                    <Button
                      size="sm" variant="ghost"
                      disabled={
                        !isActionEnabled('CLOSE_REQUEST')
                        || r.status === 'RESOLVED' || r.status === 'CANCELLED'
                      }
                      onClick={() => { setError(null); setCloseRow(r); }}
                    >
                      Close
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Request information</DialogTitle>
            <DialogDescription>
              Recording a request does not contact anyone directly — the Communication
              Hub handles any letter, email or message.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Type of request</Label>
              <Select value={typeCode} onValueChange={setTypeCode}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {referenceItems(reference, 'REQUEST_TYPE').map((i) => (
                    <SelectItem key={i.code} value={i.code}>{i.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Who is being asked</Label>
                <Select value={recipientKind} onValueChange={setRecipientKind}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {referenceItems(reference, 'REQUEST_RECIPIENT_KIND').map((i) => (
                      <SelectItem key={i.code} value={i.code}>{i.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Name (optional)</Label>
                <Input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>What is needed</Label>
              <Textarea rows={3} value={required} onChange={(e) => setRequired(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Why it is needed (optional)</Label>
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>How it will be requested</Label>
                <Select value={channel} onValueChange={setChannel}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {referenceItems(reference, 'REQUEST_CHANNEL').map((i) => (
                      <SelectItem key={i.code} value={i.code}>{i.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Response due by (optional)</Label>
                <Input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Related factor (optional)</Label>
              <Select value={factorId} onValueChange={setFactorId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value={NONE}>Not factor specific</SelectItem>
                  {factors.filter((f) => f.status === 'ACTIVE').map((f) => (
                    <SelectItem key={f.factor_id} value={f.factor_id}>
                      {f.factor_reference} — {f.factor_type_label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="risk-request-blocking"
                checked={blocking}
                onCheckedChange={(v) => setBlocking(v === true)}
              />
              <Label htmlFor="risk-request-blocking" className="text-sm">
                The review cannot move on until this is answered
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRequestOpen(false)}>Cancel</Button>
            <Button
              disabled={
                !typeCode || !recipientKind || required.trim() === '' || requestMutation.isPending
              }
              onClick={() => requestMutation.mutate()}
            >
              {requestMutation.isPending ? 'Recording…' : 'Record request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!responseRow} onOpenChange={(o) => { if (!o) setResponseRow(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Record response to {responseRow?.request_reference}</DialogTitle>
            <DialogDescription>
              Record what came back. Link any document received on the evidence panel.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Outcome</Label>
              <Select value={outcome} onValueChange={setOutcome}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {referenceItems(reference, 'RESPONSE_OUTCOME').map((i) => (
                    <SelectItem key={i.code} value={i.code}>{i.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Summary</Label>
              <Textarea
                rows={3}
                value={responseSummary}
                onChange={(e) => setResponseSummary(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResponseRow(null)}>Cancel</Button>
            <Button
              disabled={!outcome || responseMutation.isPending}
              onClick={() => responseMutation.mutate()}
            >
              {responseMutation.isPending ? 'Saving…' : 'Record response'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!closeRow} onOpenChange={(o) => { if (!o) setCloseRow(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Close {closeRow?.request_reference}</DialogTitle>
            <DialogDescription>
              Closing a request without a response must be explained.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Reason for closing</Label>
            <Textarea
              rows={3}
              value={closeJustification}
              onChange={(e) => setCloseJustification(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseRow(null)}>Cancel</Button>
            <Button
              disabled={closeJustification.trim() === '' || closeMutation.isPending}
              onClick={() => closeMutation.mutate()}
            >
              {closeMutation.isPending ? 'Closing…' : 'Close request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};
