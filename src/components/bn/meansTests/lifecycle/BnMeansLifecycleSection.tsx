/**
 * MEANS-TEST EPIC 12 — post-activation lifecycle section.
 *
 * Validity window, scheduled reassessments, reported changes of
 * circumstance, carried-forward confirmation, the predecessor/successor
 * chain and the lifecycle history — all read from
 * `bn_means_lifecycle_context_v1`.
 *
 * Availability of every action comes from the backend's
 * `available_actions`; React never infers what is allowed.
 */
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { AlertTriangle, CalendarClock, Loader2, ShieldAlert } from 'lucide-react';
import { meansQueryService } from '@/services/bn/meansTests/meansQueryService';
import { meansCommandService } from '@/services/bn/meansTests/meansCommandService';
import type { BnMeansCommandName } from '@/types/bn/meansTests/meansCommands';
import type {
  BnMeansLifecycleAction,
  BnMeansLifecycleCommand,
  BnMeansLifecycleContext,
} from '@/types/bn/meansTests/meansLifecycle';
import { humaniseMeansCode } from '@/types/bn/meansTests/meansFieldContract';

const COMMAND_LABEL: Record<BnMeansLifecycleCommand, string> = {
  BN_MEANS_SCHEDULE_REASSESSMENT: 'Schedule reassessment',
  BN_MEANS_CANCEL_REASSESSMENT: 'Cancel reassessment',
  BN_MEANS_RECORD_CHANGE_OF_CIRCUMSTANCE: 'Record change of circumstance',
  BN_MEANS_CREATE_SUCCESSOR: 'Start reassessment',
  BN_MEANS_CONFIRM_CARRIED_FORWARD: 'Confirm carried-forward information',
  BN_MEANS_SUPERSEDE: 'Supersede assessment',
  BN_MEANS_CLOSE: 'Close assessment',
};

export interface BnMeansLifecycleSectionProps {
  assessmentId: string;
  readOnly?: boolean;
  onOpenAssessment?: (assessmentId: string) => void;
}

export const BnMeansLifecycleSection: React.FC<BnMeansLifecycleSectionProps> = ({
  assessmentId, readOnly, onOpenAssessment,
}) => {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = React.useState<BnMeansLifecycleAction | null>(null);

  const context = useQuery({
    queryKey: ['bn-means-lifecycle', assessmentId],
    queryFn: () => meansQueryService.lifecycleContext(assessmentId),
  });

  if (context.isLoading) return <Skeleton className="h-64" data-testid="means-lifecycle-loading" />;

  if (context.data?.status === 'DENIED') {
    return (
      <Alert variant="destructive" data-testid="means-lifecycle-denied">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Access denied</AlertTitle>
        <AlertDescription>You do not hold permission to view the lifecycle of this assessment.</AlertDescription>
      </Alert>
    );
  }
  if (context.data?.status !== 'OK' || !context.data.data) {
    return (
      <Alert variant="destructive" data-testid="means-lifecycle-unavailable">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Lifecycle unavailable</AlertTitle>
        <AlertDescription>
          {context.data?.detail ?? 'The lifecycle of this assessment could not be read.'}
        </AlertDescription>
      </Alert>
    );
  }

  const ctx = context.data.data as BnMeansLifecycleContext;
  const actions = ctx.available_actions ?? [];

  return (
    <div className="space-y-5" data-testid="means-lifecycle-section">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="h-4 w-4" aria-hidden="true" /> Validity and review
          </CardTitle>
          <CardDescription>
            How long this assessment stands, and when it must next be reviewed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-2 rounded-md border p-3 text-sm sm:grid-cols-3">
            <Detail label="Effective from" value={ctx.validity.effective_from ?? '—'} />
            <Detail label="Valid until" value={ctx.validity.valid_until ?? 'open'} />
            <Detail label="Activated" value={ctx.validity.activated_at?.slice(0, 10) ?? '—'} />
            <Detail label="Reassessment due" value={ctx.validity.reassessment_due ?? '—'} />
            <Detail label="Days to expiry"
              value={ctx.validity.days_to_expiry === null ? '—' : String(ctx.validity.days_to_expiry)} />
            <Detail label="Days to reassessment"
              value={ctx.validity.days_to_reassessment === null ? '—' : String(ctx.validity.days_to_reassessment)} />
          </dl>

          {ctx.validity.is_expired && (
            <Alert variant="destructive" data-testid="means-lifecycle-expired">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>This assessment has expired</AlertTitle>
              <AlertDescription>Start a reassessment so entitlement continues to be supported.</AlertDescription>
            </Alert>
          )}

          {(ctx.predecessor || ctx.successor) && (
            <div className="flex flex-wrap gap-2 text-sm">
              {ctx.predecessor && (
                <Button variant="outline" size="sm" onClick={() => onOpenAssessment?.(ctx.predecessor!.assessment_id)}
                  data-testid="means-lifecycle-predecessor">
                  Previous: {ctx.predecessor.assessment_reference}
                </Button>
              )}
              {ctx.successor && (
                <Button variant="outline" size="sm" onClick={() => onOpenAssessment?.(ctx.successor!.assessment_id)}
                  data-testid="means-lifecycle-successor">
                  Reassessment: {ctx.successor.assessment_reference}
                </Button>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <Button
                key={action.command}
                size="sm"
                variant={action.command === 'BN_MEANS_CREATE_SUCCESSOR' ? 'default' : 'outline'}
                disabled={readOnly || !action.allowed}
                title={action.allowed ? undefined : action.reason ?? undefined}
                onClick={() => setDialog(action)}
                data-testid={`means-lifecycle-action-${action.command}`}
              >
                {COMMAND_LABEL[action.command] ?? humaniseMeansCode(action.command)}
              </Button>
            ))}
          </div>
          {actions.some((a) => !a.allowed) && (
            <ul className="space-y-1 text-xs text-muted-foreground" data-testid="means-lifecycle-reasons">
              {actions.filter((a) => !a.allowed && a.reason).map((a) => (
                <li key={a.command}>
                  {COMMAND_LABEL[a.command] ?? humaniseMeansCode(a.command)}: {humaniseMeansCode(a.reason ?? '')}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {ctx.carried_forward.is_successor && (
        <Card data-testid="means-lifecycle-carried-forward">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Carried-forward information</CardTitle>
            <CardDescription>
              Information reused from the previous assessment must be confirmed before submission.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-4">
              {ctx.carried_forward.sections.map((s) => (
                <div key={s.section_code} className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">{humaniseMeansCode(s.section_code)}</div>
                  <div className="text-sm font-medium">
                    {s.confirmed} confirmed · {s.pending} to confirm
                  </div>
                </div>
              ))}
            </div>
            {ctx.carried_forward.confirmed_at && (
              <p className="pt-2 text-xs text-muted-foreground">
                Confirmed on {ctx.carried_forward.confirmed_at.slice(0, 10)}.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Scheduled reassessments</CardTitle>
        </CardHeader>
        <CardContent>
          {ctx.schedules.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reassessment is scheduled.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Due</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Raised by</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ctx.schedules.map((s) => (
                  <TableRow key={s.schedule_id}>
                    <TableCell>{s.due_date}</TableCell>
                    <TableCell>{humaniseMeansCode(s.reason_code ?? '—')}</TableCell>
                    <TableCell>{humaniseMeansCode(s.source)}</TableCell>
                    <TableCell><Badge variant="secondary">{humaniseMeansCode(s.status)}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Reported changes of circumstance</CardTitle>
        </CardHeader>
        <CardContent>
          {ctx.circumstances.length === 0 ? (
            <p className="text-sm text-muted-foreground">No change has been reported.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reported</TableHead>
                  <TableHead>Change</TableHead>
                  <TableHead>Effective</TableHead>
                  <TableHead>Materiality</TableHead>
                  <TableHead>Outcome</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ctx.circumstances.map((c) => (
                  <TableRow key={c.circumstance_id}>
                    <TableCell>{c.reported_on}</TableCell>
                    <TableCell>{humaniseMeansCode(c.change_type)}</TableCell>
                    <TableCell>{c.effective_date}</TableCell>
                    <TableCell>
                      <Badge variant={c.materiality === 'MATERIAL' ? 'default' : 'secondary'}>
                        {humaniseMeansCode(c.materiality)}
                      </Badge>
                    </TableCell>
                    <TableCell>{humaniseMeansCode(c.outcome)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Lifecycle history</CardTitle>
        </CardHeader>
        <CardContent>
          {ctx.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No lifecycle events recorded.</p>
          ) : (
            <ol className="space-y-2 text-sm">
              {ctx.history.map((h) => (
                <li key={h.event_id} className="rounded-md border p-2">
                  <div className="font-medium">{humaniseMeansCode(h.event_code)}</div>
                  <div className="text-xs text-muted-foreground">
                    {h.created_at.slice(0, 16).replace('T', ' ')}
                    {h.from_status && h.to_status
                      ? ` · ${humaniseMeansCode(h.from_status)} → ${humaniseMeansCode(h.to_status)}`
                      : ''}
                  </div>
                  {h.justification && <div className="pt-1 text-xs">{h.justification}</div>}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <LifecycleCommandDialog
        action={dialog}
        context={ctx}
        onClose={() => setDialog(null)}
        onDone={() => {
          queryClient.invalidateQueries({ queryKey: ['bn-means-lifecycle', assessmentId] });
          queryClient.invalidateQueries({ queryKey: ['bn-means-assessment', assessmentId] });
          queryClient.invalidateQueries({ queryKey: ['bn-means-reassessment-queue'] });
        }}
      />
    </div>
  );
};

const LifecycleCommandDialog: React.FC<{
  action: BnMeansLifecycleAction | null;
  context: BnMeansLifecycleContext;
  onClose: () => void;
  onDone: () => void;
}> = ({ action, context, onClose, onDone }) => {
  const [dueDate, setDueDate] = React.useState('');
  const [reasonCode, setReasonCode] = React.useState('');
  const [changeType, setChangeType] = React.useState('');
  const [effectiveDate, setEffectiveDate] = React.useState('');
  const [channel, setChannel] = React.useState('');
  const [justification, setJustification] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDueDate(''); setReasonCode(''); setChangeType('');
    setEffectiveDate(''); setChannel(''); setJustification(''); setError(null);
  }, [action]);

  const run = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {};
      if (action?.command === 'BN_MEANS_SCHEDULE_REASSESSMENT') {
        payload.due_date = dueDate;
      }
      if (action?.command === 'BN_MEANS_RECORD_CHANGE_OF_CIRCUMSTANCE') {
        payload.change_type = changeType;
        payload.effective_date = effectiveDate;
        payload.reported_channel = channel || null;
      }
      return meansCommandService.execute({
        command: action!.command as BnMeansCommandName,
        assessmentId: context.assessment_id,
        expectedRowVersion: action!.row_version,
        reasonCode: reasonCode || null,
        justification: justification || null,
        payload,
      });
    },
    onSuccess: (result) => {
      if (result.status === 'FAILED') {
        setError(result.errorDetail ?? 'The action could not be completed.');
        return;
      }
      onDone();
      onClose();
    },
  });

  if (!action) return null;
  const ref = context.reference;

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent data-testid="means-lifecycle-dialog">
        <DialogHeader>
          <DialogTitle>{COMMAND_LABEL[action.command] ?? humaniseMeansCode(action.command)}</DialogTitle>
          <DialogDescription>
            The backend re-checks this action, its state and your permission before anything is recorded.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive" data-testid="means-lifecycle-dialog-error">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Action not completed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-3">
          {action.command === 'BN_MEANS_SCHEDULE_REASSESSMENT' && (
            <>
              <div className="space-y-1">
                <Label htmlFor="ml-due">Due date</Label>
                <Input id="ml-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <SelectField id="ml-reason" label="Reason" value={reasonCode} onChange={setReasonCode}
                options={ref.reassessment_reasons} />
            </>
          )}

          {action.command === 'BN_MEANS_RECORD_CHANGE_OF_CIRCUMSTANCE' && (
            <>
              <SelectField id="ml-change" label="What changed" value={changeType} onChange={setChangeType}
                options={ref.change_types} />
              <div className="space-y-1">
                <Label htmlFor="ml-effective">Effective date of the change</Label>
                <Input id="ml-effective" type="date" value={effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)} />
              </div>
              <SelectField id="ml-channel" label="How it was reported" value={channel} onChange={setChannel}
                options={ref.reported_channels} />
            </>
          )}

          {action.command === 'BN_MEANS_CLOSE' && (
            <SelectField id="ml-closure" label="Closure reason" value={reasonCode} onChange={setReasonCode}
              options={ref.closure_reasons} />
          )}

          <div className="space-y-1">
            <Label htmlFor="ml-justification">Justification</Label>
            <Textarea id="ml-justification" rows={3} value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Explain why this action is being taken." />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={run.isPending}>Cancel</Button>
          <Button onClick={() => run.mutate()} disabled={run.isPending} data-testid="means-lifecycle-dialog-confirm">
            {run.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const SelectField: React.FC<{
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly { code: string; label: string }[];
}> = ({ id, label, value, onChange, options }) => (
  <div className="space-y-1">
    <Label htmlFor={id}>{label}</Label>
    <select id={id} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
      value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select…</option>
      {(options ?? []).map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
    </select>
  </div>
);

const Detail: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="font-medium">{value}</dd>
  </div>
);

export default BnMeansLifecycleSection;
