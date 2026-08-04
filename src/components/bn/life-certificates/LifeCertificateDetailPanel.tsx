import React, { useCallback, useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { AlertTriangle, Lock, ShieldAlert, EyeOff } from 'lucide-react';
import { useActionPermissions } from '@/hooks/useActionPermission';
import { useLifeCertificateActionsEnabled } from '@/hooks/bn/useLifeCertificateActionsEnabled';
import {
  fetchDetail, fetchTimeline,
  type LifeCertificateDetail, type LifeCertificateTimeline,
} from '@/services/bn/lifeCertificateViewService';
import { LifeCertificateCommandError } from '@/services/bn/lifeCertificateCommandService';
import LifeCertificateActionDialogs, { type LifeCertificateAction } from './LifeCertificateActionDialogs';

interface Props {
  lifeCertificateId: string | null;
  onClose: () => void;
  onChanged: () => void;
}

const field = (label: string, value: React.ReactNode) => (
  <div className="space-y-0.5">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-sm font-medium">{value ?? '—'}</p>
  </div>
);

const LifeCertificateDetailPanel: React.FC<Props> = ({ lifeCertificateId, onClose, onChanged }) => {
  const { can, isAdmin } = useActionPermissions('bn_life_certificate');
  const actionsEnabled = useLifeCertificateActionsEnabled();

  const [detail, setDetail] = useState<LifeCertificateDetail | null>(null);
  const [timeline, setTimeline] = useState<LifeCertificateTimeline | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<{ code: string; message: string } | null>(null);
  const [action, setAction] = useState<LifeCertificateAction | null>(null);

  const load = useCallback(async () => {
    if (!lifeCertificateId) return;
    setLoading(true);
    setFailure(null);
    try {
      const [d, t] = await Promise.all([fetchDetail(lifeCertificateId), fetchTimeline(lifeCertificateId)]);
      setDetail(d);
      setTimeline(t);
    } catch (e) {
      const err = e as LifeCertificateCommandError;
      setFailure({ code: err.code ?? 'E_UNKNOWN', message: err.message });
      setDetail(null);
      setTimeline(null);
    } finally {
      setLoading(false);
    }
  }, [lifeCertificateId]);

  useEffect(() => { void load(); }, [load]);

  const o = detail?.obligation;
  const allow = (a: string) => isAdmin || can(a);
  const rowVersion = (o?.row_version as number) ?? 0;

  const actionButton = (key: LifeCertificateAction, label: string, permission: string, enabled: boolean) => {
    if (!allow(permission)) return null;
    const disabled = !actionsEnabled || !enabled;
    return (
      <Button
        key={key}
        size="sm"
        variant={key === 'escalate' ? 'destructive' : 'outline'}
        disabled={disabled}
        title={!actionsEnabled ? 'Dark launch: Life Certificate actions are disabled in this environment.' : undefined}
        onClick={() => setAction(key)}
      >
        {label}
      </Button>
    );
  };

  return (
    <>
      <Sheet open={!!lifeCertificateId} onOpenChange={(v) => { if (!v) onClose(); }}>
        <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Life certificate obligation</SheetTitle>
            <SheetDescription>
              Controlled servicing view — award status, payment holds and arrears remain owned by Award Suspension.
            </SheetDescription>
          </SheetHeader>

          {loading && <div className="space-y-3 mt-6"><Skeleton className="h-24 w-full" /><Skeleton className="h-48 w-full" /></div>}

          {failure && (
            <Alert variant="destructive" className="mt-6">
              {failure.code === 'E_FORBIDDEN' ? <Lock className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              <AlertTitle>{failure.code === 'E_FORBIDDEN' ? 'Permission denied' : 'Could not load obligation'}</AlertTitle>
              <AlertDescription>{failure.message}</AlertDescription>
            </Alert>
          )}

          {!loading && !failure && detail && o && (
            <div className="mt-6 space-y-5">
              {!actionsEnabled && (
                <Alert>
                  <ShieldAlert className="h-4 w-4" />
                  <AlertTitle>Read-only (dark launch)</AlertTitle>
                  <AlertDescription>Actions are visible for review but disabled until Test validation completes.</AlertDescription>
                </Alert>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {field('Award', detail.award.award_number ?? detail.award.id.slice(0, 8))}
                {field('SSN', detail.award.ssn)}
                {field('Benefit', detail.award.benefit_code)}
                {field('Award status', <Badge variant="outline">{detail.award.status}</Badge>)}
                {field('Obligation period', String(o.obligation_period ?? '—'))}
                {field('Due date', String(o.due_date ?? '—'))}
                {field('Grace ends', String(o.grace_end_date ?? '—'))}
                {field('Escalation date', String(o.escalation_date ?? '—'))}
                {field('Policy', `${o.policy_code ?? '—'} v${o.policy_version ?? '—'}`)}
                {field('Obligation status', <Badge variant="outline">{o.obligation_status}</Badge>)}
                {field('Evidence status', o.evidence_status)}
                {field('Verification status', o.verification_status)}
                {field('Escalation status', o.escalation_status)}
                {field('Communication status', o.communication_status)}
                {field('Reminders sent', String(o.reminder_count ?? 0))}
                {field('Row version', String(rowVersion))}
              </div>

              <Separator />

              <div className="flex flex-wrap gap-2">
                {actionButton('receive', 'Record receipt', 'receive', ['DUE', 'REMINDER_SENT', 'GRACE', 'OVERDUE', 'RESUBMISSION_REQUIRED'].includes(String(o.obligation_status)))}
                {actionButton('verify', 'Verify', 'verify', ['RECEIVED', 'UNDER_REVIEW'].includes(String(o.obligation_status)))}
                {actionButton('reject', 'Reject', 'reject', ['RECEIVED', 'UNDER_REVIEW'].includes(String(o.obligation_status)))}
                {actionButton('resubmission', 'Request resubmission', 'request_resubmission', ['RECEIVED', 'UNDER_REVIEW', 'REJECTED'].includes(String(o.obligation_status)))}
                {actionButton('waive', 'Waive', 'waive', ['DUE', 'REMINDER_SENT', 'GRACE'].includes(String(o.obligation_status)))}
                {actionButton('defer', 'Defer', 'defer', ['DUE', 'REMINDER_SENT', 'GRACE'].includes(String(o.obligation_status)))}
                {actionButton('escalate', 'Escalate for suspension', 'propose_suspension', String(o.obligation_status) === 'OVERDUE' && !detail.suspension)}
                {actionButton('reinstate', 'Propose reinstatement', 'propose_reinstatement', String(o.obligation_status) === 'VERIFIED' && detail.award.status === 'SUSPENDED')}
              </div>

              <Tabs defaultValue="evidence">
                <TabsList>
                  <TabsTrigger value="evidence">Evidence</TabsTrigger>
                  <TabsTrigger value="links">Suspension / reinstatement</TabsTrigger>
                  <TabsTrigger value="timeline">Audit timeline</TabsTrigger>
                  <TabsTrigger value="comms">Communications</TabsTrigger>
                </TabsList>

                <TabsContent value="evidence" className="pt-4">
                  {!o.evidence ? (
                    <p className="text-sm text-muted-foreground">No evidence linked yet.</p>
                  ) : o.evidence.masked ? (
                    <Alert>
                      <EyeOff className="h-4 w-4" />
                      <AlertTitle>Confidential evidence masked</AlertTitle>
                      <AlertDescription>
                        You need the <code>view_confidential_evidence</code> permission to see document metadata.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {field('Document', o.evidence.evidence_document?.file_name ?? o.evidence.document_name)}
                      {field('Evidence type', o.evidence.evidence_type)}
                      {field('Receipt revision', String(o.evidence.evidence_receipt_revision ?? '—'))}
                      {field('Document type', o.evidence.evidence_document?.document_type_code)}

                      {field(
                        'Integrity evidence',
                        o.evidence.evidence_integrity_status === 'VERIFIED'
                          ? 'Verified against the document store checksum'
                          : 'Unavailable — the document store provides no trustworthy checksum',
                      )}
                      {field('Issuing authority', o.evidence.issuing_authority)}
                      {field('Certificate date', o.evidence.certificate_date)}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="links" className="pt-4 space-y-4">
                  <div>
                    <p className="text-sm font-semibold mb-2">Linked suspension</p>
                    {detail.suspension ? (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {field('Status', detail.suspension.status)}
                        {field('Execution', detail.suspension.execution_status)}
                        {field('Suspended from', detail.suspension.suspended_from)}
                        {field('Reason', detail.suspension.reason_code)}
                      </div>
                    ) : <p className="text-sm text-muted-foreground">No suspension proposal linked.</p>}
                  </div>
                  <Separator />
                  <div>
                    <p className="text-sm font-semibold mb-2">Linked reinstatement</p>
                    {detail.reinstatement ? (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {field('Status', detail.reinstatement.status)}
                        {field('Execution', detail.reinstatement.execution_status)}
                        {field('Effective from', detail.reinstatement.suspended_from)}
                        {field('Reason', detail.reinstatement.reason_code)}
                      </div>
                    ) : <p className="text-sm text-muted-foreground">No reinstatement proposal linked.</p>}
                  </div>
                </TabsContent>

                <TabsContent value="timeline" className="pt-4">
                  {!timeline?.events?.length ? (
                    <p className="text-sm text-muted-foreground">No decision history recorded.</p>
                  ) : (
                    <ol className="space-y-3">
                      {timeline.events.map((ev) => (
                        <li key={ev.id} className="border-l-2 border-muted pl-3">
                          <p className="text-sm font-medium">{ev.event_type.replace(/_/g, ' ')}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(ev.created_at).toLocaleString()} · {ev.actor_user_code ?? 'SYSTEM'}
                            {ev.from_state || ev.to_state ? ` · ${ev.from_state ?? '—'} → ${ev.to_state ?? '—'}` : ''}
                          </p>
                          {ev.narrative && <p className="text-xs mt-1">{ev.narrative}</p>}
                        </li>
                      ))}
                    </ol>
                  )}
                </TabsContent>

                <TabsContent value="comms" className="pt-4">
                  {!timeline?.communications?.length ? (
                    <p className="text-sm text-muted-foreground">No communication intents recorded.</p>
                  ) : (
                    <ul className="space-y-2">
                      {timeline.communications.map((c) => (
                        <li key={c.id} className="flex items-center justify-between text-sm border-b pb-2">
                          <span className="font-mono text-xs">{c.event_code}</span>
                          <span className="flex items-center gap-2">
                            <Badge variant="outline">{c.delivery_status}</Badge>
                            <span className="text-xs text-muted-foreground">attempts {c.attempts}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <LifeCertificateActionDialogs
        action={action}
        lifeCertificateId={lifeCertificateId}
        awardId={detail?.award.id ?? null}
        rowVersion={rowVersion}
        onCancel={() => setAction(null)}
        onDone={() => { setAction(null); void load(); onChanged(); }}
      />
    </>
  );
};

export default LifeCertificateDetailPanel;
