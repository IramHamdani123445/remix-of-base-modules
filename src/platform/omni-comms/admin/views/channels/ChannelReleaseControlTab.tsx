/**
 * Omni-Comms C6 — Channel Release Control.
 *
 * HARD BOUNDARY: this screen governs release state only. It NEVER sends a
 * message, never enqueues a runnable job, never contacts a provider and never
 * enables live delivery. Business provider dispatch is not implemented in C6.
 *
 * Segregation of duties is enforced by the database and by the trusted Edge
 * boundary: the proposer (configure) can never be the approver (operate).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, CircleSlash, Info, PauseOctagon, RefreshCw, ShieldCheck,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import type { OmniCommsRpcClient } from '@/platform/omni-comms/application/omniCommsRpcErrors';
import {
  cancelReleaseProposal,
  getChannelReleaseControlSummary,
  proposeControlledPilot,
  setChannelReleaseBasicState,
  suspendChannelRelease,
  upsertChannelReleaseConfiguration,
  buildApproveActivateBody,
} from '@/platform/omni-comms/application/channelReleaseControlService';
import {
  businessDispatchCheck,
  isControlledPilotGovernanceActive,
  isProposalActive,
  isReferenceRelease,
  isReleaseExpired,
  RELEASE_LIMITS,
  releaseBlockers,
  type ChannelReleaseControlSummary,
  type ReleaseCheckState,
} from '@/platform/omni-comms/application/channelReleaseControlTypes';
import type { ChannelReleaseControlTransport } from '@/platform/omni-comms/admin/hooks/useChannelReleaseControlTransport';
import { DeferredCapabilityCard, Detail, toastError } from './channelFormPrimitives';
import type { ChannelUiDefinition } from './channelUiRegistry';

const SAFETY_NOTICE =
  'Release Control governs whether business communications are ALLOWED. It does '
  + 'not send anything. No provider is contacted from this screen, live delivery '
  + 'stays disabled, and any job created under a controlled pilot remains held '
  + 'and non-runnable until business dispatch is implemented.';

const CHECK_TONE: Record<ReleaseCheckState, string> = {
  passed: 'text-emerald-600',
  failed: 'text-destructive',
  warning: 'text-amber-600',
  not_applicable: 'text-muted-foreground',
  not_implemented: 'text-muted-foreground',
};

const splitList = (raw: string): string[] =>
  raw.split(/[\n,]/).map((v) => v.trim()).filter(Boolean);

interface ConfigForm {
  eventCodes: string;
  callerModules: string;
  recipients: string;
  perRequest: string;
  perHour: string;
  perDay: string;
  total: string;
  startsAt: string;
  expiresAt: string;
}

const EMPTY_FORM: ConfigForm = {
  eventCodes: '',
  callerModules: '',
  recipients: '',
  perRequest: '1',
  perHour: '5',
  perDay: '20',
  total: '50',
  startsAt: '',
  expiresAt: '',
};

export const ChannelReleaseControlTab: React.FC<{
  definition: ChannelUiDefinition;
  client?: OmniCommsRpcClient;
  orgId?: string | null;
  departmentId?: string | null;
  departmentName?: string | null;
  transport?: ChannelReleaseControlTransport;
  onChanged?: () => void;
}> = ({ definition, client, orgId, departmentId, departmentName, transport, onChanged }) => {
  const channel = definition.code;
  const supported = channel === 'email';

  const [summary, setSummary] = useState<ChannelReleaseControlSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<ConfigForm>(EMPTY_FORM);
  const [proposalReason, setProposalReason] = useState('');
  const [approvalNote, setApprovalNote] = useState('');
  const [suspendReason, setSuspendReason] = useState('');

  const release = summary?.release ?? null;
  const readOnlyReference = isReferenceRelease(release);
  const canConfigure = Boolean(summary?.capabilities.can_configure) && !readOnlyReference;
  const canApprove = Boolean(summary?.capabilities.can_approve) && !readOnlyReference;
  const blockers = useMemo(() => releaseBlockers(summary?.prerequisites), [summary]);
  const dispatchCheck = businessDispatchCheck(summary?.prerequisites);
  const proposalActive = isProposalActive(release);
  const governanceActive = isControlledPilotGovernanceActive(summary);
  const expired = isReleaseExpired(release);
  const sameActorAsProposer =
    Boolean(release?.proposed_by) && release?.proposed_by === summary?.actor_id;

  const refresh = useCallback(async () => {
    if (!client || !orgId || !supported) return;
    setLoading(true);
    try {
      const next = await getChannelReleaseControlSummary(client, {
        organizationId: orgId,
        departmentId: departmentId ?? null,
        channel: 'email',
      });
      setSummary(next);
      const r = next.release;
      if (r) {
        setForm({
          eventCodes: r.permitted_event_codes.join('\n'),
          callerModules: r.permitted_caller_modules.join('\n'),
          recipients: r.pilot_recipient_rules.map((x) => x.target_masked).join('\n'),
          perRequest: String(r.max_recipients_per_request),
          perHour: String(r.max_messages_per_hour),
          perDay: String(r.max_messages_per_day),
          total: String(r.max_messages_total),
          startsAt: r.release_starts_at ? r.release_starts_at.slice(0, 16) : '',
          expiresAt: r.release_expires_at ? r.release_expires_at.slice(0, 16) : '',
        });
      }
    } catch (e) {
      toastError(e, 'Could not load Release Control.');
    } finally {
      setLoading(false);
    }
  }, [client, orgId, departmentId, supported]);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = useCallback(async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      toast.success(label);
      await refresh();
      onChanged?.();
    } catch (e) {
      toastError(e, 'Release Control action failed.');
    } finally {
      setBusy(false);
    }
  }, [refresh, onChanged]);

  if (!supported) {
    return (
      <DeferredCapabilityCard
        title="Release Control"
        description={`Release Control is implemented for Email only. ${definition.name} governance arrives with its own build.`}
      />
    );
  }

  const saveConfiguration = () => {
    if (!client || !orgId) return;
    void run('Release configuration saved', () =>
      upsertChannelReleaseConfiguration(client, {
        id: release?.id ?? null,
        expectedUpdatedAt: release?.updated_at ?? null,
        organizationId: orgId,
        departmentId: departmentId ?? null,
        channel: 'email',
        permittedEventCodes: splitList(form.eventCodes),
        permittedCallerModules: splitList(form.callerModules),
        permittedModes: ['queued'],
        recipientInput: splitList(form.recipients).map((target) => ({ target })),
        maxRecipientsPerRequest: Number(form.perRequest),
        maxMessagesPerHour: Number(form.perHour),
        maxMessagesPerDay: Number(form.perDay),
        maxMessagesTotal: Number(form.total),
        releaseStartsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
        releaseExpiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      }));
  };

  const approveActivate = () => {
    if (!transport || !release) return;
    void run('Controlled pilot activated', async () => {
      const res = await transport.invoke(buildApproveActivateBody({
        releaseControlId: release.id,
        expectedUpdatedAt: release.updated_at,
        expectedFingerprint: release.release_fingerprint,
        approvalNote: approvalNote || null,
      }));
      if (res.error) throw new Error(res.error.message ?? 'Activation failed');
      setApprovalNote('');
    });
  };

  return (
    <div className="space-y-4">
      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Governance only — nothing is sent from this screen</AlertTitle>
        <AlertDescription>{SAFETY_NOTICE}</AlertDescription>
      </Alert>

      {readOnlyReference && (
        <Alert variant="destructive">
          <CircleSlash className="h-4 w-4" />
          <AlertTitle>Reference record</AlertTitle>
          <AlertDescription>
            This scope holds a reference-seed release record. Reference records are
            read-only, never operational, and can never govern a pilot.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              Release state
              <Badge variant={governanceActive ? 'default' : 'secondary'}>
                {release?.release_state ?? 'not configured'}
              </Badge>
              {expired && <Badge variant="destructive">expired</Badge>}
            </CardTitle>
            <CardDescription>
              {departmentName ? `Department scope: ${departmentName}` : 'Organisation baseline scope'}
              {' · Live delivery: '}
              {summary?.live_delivery_enabled ? 'ENABLED' : 'disabled'}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Detail label="Release version" value={String(release?.release_version ?? '—')} />
          <Detail label="Fingerprint" value={release?.release_fingerprint?.slice(0, 16) ?? '—'} />
          <Detail label="Approved commit" value={release?.approved_commit?.slice(0, 12) ?? '—'} />
          <Detail
            label="Certified commit"
            value={summary?.certification?.certified_commit?.slice(0, 12) ?? '—'}
          />
          <Detail label="Pilot window start" value={release?.release_starts_at ?? '—'} />
          <Detail label="Pilot window end" value={release?.release_expires_at ?? '—'} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Prerequisites</CardTitle>
          <CardDescription>
            {blockers.length === 0
              ? 'All blocking prerequisites are satisfied.'
              : `${blockers.length} blocking prerequisite(s) outstanding.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm">
            {(summary?.prerequisites ?? []).map((c) => (
              <li key={c.code} className="flex items-start gap-2">
                <span className={CHECK_TONE[c.state]}>
                  {c.state === 'passed'
                    ? <CheckCircle2 className="h-4 w-4" />
                    : c.state === 'failed'
                      ? <AlertTriangle className="h-4 w-4" />
                      : <Info className="h-4 w-4" />}
                </span>
                <span className="flex-1">
                  <span className="font-medium">{c.sequence}. {c.code}</span>
                  <span className="block text-muted-foreground">{c.detail}</span>
                </span>
              </li>
            ))}
            {(summary?.prerequisites ?? []).length === 0 && (
              <li className="text-muted-foreground">No evaluation available for this scope yet.</li>
            )}
          </ul>
          {dispatchCheck && (
            <Alert className="mt-4">
              <Info className="h-4 w-4" />
              <AlertTitle>Business dispatch is not implemented</AlertTitle>
              <AlertDescription>{dispatchCheck.detail}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pilot restrictions</CardTitle>
          <CardDescription>
            Recipients are stored masked and hashed only — raw addresses are never
            persisted. Maximum {RELEASE_LIMITS.maxRecipientRules} approved recipients
            and a {RELEASE_LIMITS.maxPilotDays}-day maximum pilot window.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Permitted event codes (one per line)</Label>
              <Textarea
                value={form.eventCodes} disabled={!canConfigure || busy}
                onChange={(e) => setForm((f) => ({ ...f, eventCodes: e.target.value }))}
              />
            </div>
            <div>
              <Label>Permitted caller modules (one per line)</Label>
              <Textarea
                value={form.callerModules} disabled={!canConfigure || busy}
                onChange={(e) => setForm((f) => ({ ...f, callerModules: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Approved pilot recipients (one per line)</Label>
              <Textarea
                value={form.recipients} disabled={!canConfigure || busy}
                onChange={(e) => setForm((f) => ({ ...f, recipients: e.target.value }))}
              />
            </div>
            <div>
              <Label>Max recipients per request</Label>
              <Input
                value={form.perRequest} disabled={!canConfigure || busy}
                onChange={(e) => setForm((f) => ({ ...f, perRequest: e.target.value }))}
              />
            </div>
            <div>
              <Label>Max messages per hour</Label>
              <Input
                value={form.perHour} disabled={!canConfigure || busy}
                onChange={(e) => setForm((f) => ({ ...f, perHour: e.target.value }))}
              />
            </div>
            <div>
              <Label>Max messages per day</Label>
              <Input
                value={form.perDay} disabled={!canConfigure || busy}
                onChange={(e) => setForm((f) => ({ ...f, perDay: e.target.value }))}
              />
            </div>
            <div>
              <Label>Max messages total</Label>
              <Input
                value={form.total} disabled={!canConfigure || busy}
                onChange={(e) => setForm((f) => ({ ...f, total: e.target.value }))}
              />
            </div>
            <div>
              <Label>Pilot window start</Label>
              <Input
                type="datetime-local" value={form.startsAt} disabled={!canConfigure || busy}
                onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))}
              />
            </div>
            <div>
              <Label>Pilot window end</Label>
              <Input
                type="datetime-local" value={form.expiresAt} disabled={!canConfigure || busy}
                onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={saveConfiguration} disabled={!canConfigure || busy}>
              Save configuration
            </Button>
            {(['disabled', 'configuration', 'test_only'] as const).map((s) => (
              <Button
                key={s} variant="outline"
                disabled={!canConfigure || busy || !release}
                onClick={() => release && void run(`Release state set to ${s}`, () =>
                  setChannelReleaseBasicState(client!, {
                    id: release.id,
                    expectedUpdatedAt: release.updated_at,
                    targetState: s,
                  }))}
              >
                Set {s}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Controlled pilot approval</CardTitle>
          <CardDescription>
            Two different people are required: the proposer needs configure rights,
            the approver needs operate rights. Direct activation of live delivery is
            rejected by the database.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {proposalActive ? (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Proposal awaiting approval</AlertTitle>
              <AlertDescription>
                Proposed state {release?.proposed_state}; expires {release?.proposal_expires_at}.
                {sameActorAsProposer
                  && ' You proposed this transition, so you cannot approve it.'}
              </AlertDescription>
            </Alert>
          ) : (
            <div>
              <Label>Proposal reason</Label>
              <Textarea
                value={proposalReason} disabled={!canConfigure || busy}
                onChange={(e) => setProposalReason(e.target.value)}
              />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {!proposalActive && (
              <Button
                disabled={!canConfigure || busy || !release || blockers.length > 0}
                onClick={() => release && void run('Controlled pilot proposed', () =>
                  proposeControlledPilot(client!, {
                    id: release.id,
                    expectedUpdatedAt: release.updated_at,
                    reason: proposalReason,
                  }))}
              >
                Propose controlled pilot
              </Button>
            )}
            {proposalActive && (
              <>
                <Input
                  className="max-w-xs" placeholder="Approval note (optional)"
                  value={approvalNote} disabled={!canApprove || busy}
                  onChange={(e) => setApprovalNote(e.target.value)}
                />
                <Button
                  onClick={approveActivate}
                  disabled={!canApprove || busy || sameActorAsProposer || !transport}
                >
                  Approve and activate
                </Button>
                <Button
                  variant="outline" disabled={!canConfigure || busy}
                  onClick={() => release && void run('Proposal cancelled', () =>
                    cancelReleaseProposal(client!, {
                      id: release.id,
                      expectedUpdatedAt: release.updated_at,
                    }))}
                >
                  Cancel proposal
                </Button>
              </>
            )}
            <Input
              className="max-w-xs" placeholder="Suspension reason"
              value={suspendReason} disabled={!canApprove || busy}
              onChange={(e) => setSuspendReason(e.target.value)}
            />
            <Button
              variant="destructive"
              disabled={!canApprove || busy || !release || !suspendReason.trim()}
              onClick={() => release && void run('Release suspended', () =>
                suspendChannelRelease(client!, {
                  id: release.id,
                  expectedUpdatedAt: release.updated_at,
                  reason: suspendReason,
                }))}
            >
              <PauseOctagon className="mr-2 h-4 w-4" /> Suspend
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Release history</CardTitle>
          <CardDescription>Append-only governance ledger. Entries are never edited or deleted.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {(summary?.history ?? []).map((h) => (
              <li key={h.id} className="rounded border p-2">
                <div className="font-medium">
                  {h.event_type}
                  {h.from_state || h.to_state ? ` · ${h.from_state ?? '—'} → ${h.to_state ?? '—'}` : ''}
                </div>
                <div className="text-muted-foreground">
                  v{h.release_version} · {h.occurred_at}
                  {h.reason ? ` · ${h.reason}` : ''}
                </div>
              </li>
            ))}
            {(summary?.history ?? []).length === 0 && (
              <li className="text-muted-foreground">No release events recorded yet.</li>
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
};

export default ChannelReleaseControlTab;
