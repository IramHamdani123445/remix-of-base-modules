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
  buildCertifyDeploymentBody,
  buildConfirmEnvironmentBody,
  buildControlledSendBody,
  buildDeploymentStatusBody,
  buildHeldPilotCandidateBody,
  buildHeldJobReviewBody,
  buildRetireHeldJobBody,
  type ControlledSendResult,
  type DeploymentStatus,
  type HeldJobReview,
  type HeldPilotCandidate,

} from '@/platform/omni-comms/application/channelReleaseControlService';

import {
  applySingleMessagePilotPreset,
  SINGLE_MESSAGE_PILOT_LABEL,
} from '@/platform/omni-comms/application/releasePilotPresets';
import {
  buildReleaseWindow,
  RELEASE_WINDOW_PRESETS,
} from '@/platform/omni-comms/application/releaseWindowPresets';
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
import { listProducerEventBindings } from '@/platform/omni-comms/application/producerIntegrationsService';
import {
  buildModuleEnablementMatrix,
  sendingModules,
  type ModuleEnablementRow,
} from './moduleEnablementMatrix';
import { buildGoLiveWorkflow } from './goLiveWorkflow';
import { GoLiveWorkflowCard } from './GoLiveWorkflowCard';
import { LiveOperationsCard } from './LiveOperationsCard';
import { DeliveryToggleCard } from './DeliveryToggleCard';
import {
  buildDeliveryRequestBody,
  getDeliveryToggleSnapshot,
  type DeliveryToggleSnapshot,
} from '@/platform/omni-comms/application/deliveryToggleService';

import {
  buildApproveActivateLiveBody,
  getLiveOperationsSummary,
  proposeProductionLive,
  type LiveOperationsSummary,
} from '@/platform/omni-comms/application/liveOperationsService';
import { DeferredCapabilityCard, Detail, toastError } from './channelFormPrimitives';
import type { ChannelUiDefinition } from './channelUiRegistry';

const SAFETY_NOTICE =
  'Release Control governs whether business communications are ALLOWED. Configuring, '
  + 'proposing and approving a pilot sends nothing and contacts no provider. '
  + 'Unrestricted live delivery stays disabled at all times. Only the final '
  + '"Release one controlled message" action asks the canonical dispatcher to release '
  + 'the already-authorised held message — exactly one, inside the approved pilot limits.';

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
  const supported = channel === 'email' || channel === 'sms';

  const [summary, setSummary] = useState<ChannelReleaseControlSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<ConfigForm>(EMPTY_FORM);
  const [proposalReason, setProposalReason] = useState('');
  const [approvalNote, setApprovalNote] = useState('');
  const [suspendReason, setSuspendReason] = useState('');
  const [deployment, setDeployment] = useState<DeploymentStatus | null>(null);
  const [deploymentLoading, setDeploymentLoading] = useState(false);
  const [candidate, setCandidate] = useState<HeldPilotCandidate | null>(null);
  const [dispatchResult, setDispatchResult] = useState<string | null>(null);
  const [preSend, setPreSend] = useState<ControlledSendResult | null>(null);
  const [heldReview, setHeldReview] = useState<HeldJobReview | null>(null);
  const [liveOps, setLiveOps] = useState<LiveOperationsSummary | null>(null);
  const [delivery, setDelivery] = useState<DeliveryToggleSnapshot | null>(null);


  // Masked value -> one-way hash, so a pilot rule can be configured without a
  // raw recipient ever existing in the browser.
  const [recipientHashes, setRecipientHashes] = useState<Record<string, string>>({});
  const [moduleRows, setModuleRows] = useState<ModuleEnablementRow[]>([]);


  const release = summary?.release ?? null;
  const readOnlyReference = isReferenceRelease(release);
  const canConfigure = Boolean(summary?.capabilities.can_configure) && !readOnlyReference;
  // Second-person approval only — true solely while an approvable proposal exists.
  const canApprove = Boolean(summary?.capabilities.can_approve) && !readOnlyReference;
  // Operator rights on this scope. Governs the operator actions that exist
  // BEFORE a proposal (environment confirmation, deployment certification) as
  // well as suspension and the final controlled release. Falls back to the
  // approval capability for older servers that do not project it yet.
  const canOperate =
    (summary?.capabilities.can_operate ?? summary?.capabilities.can_approve ?? false)
    && !readOnlyReference;
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
        channel,
      });
      setSummary(next);
      try {
        setLiveOps(await getLiveOperationsSummary(client, {
          organizationId: orgId,
          departmentId: departmentId ?? null,
        }));
      } catch {
        setLiveOps(null);
      }
      try {
        setDelivery(await getDeliveryToggleSnapshot(client, {
          organizationId: orgId,
          departmentId: departmentId ?? null,
          channel,
        }));
      } catch {
        setDelivery(null);
      }

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

  /** Bounded, read-only deployment identity probe. Mutates nothing. */
  const loadDeployment = useCallback(async () => {
    if (!transport || !supported) return;
    setDeploymentLoading(true);
    try {
      const res = await transport.invoke(buildDeploymentStatusBody());
      if (res.error) throw new Error(res.error.message ?? 'Deployment status unavailable');
      setDeployment(res.data as DeploymentStatus);
    } catch (e) {
      toastError(e, 'Could not read the deployment identity.');
    } finally {
      setDeploymentLoading(false);
    }
  }, [transport, supported]);

  useEffect(() => { void loadDeployment(); }, [loadDeployment]);

  const confirmProduction = useCallback(() => {
    if (!transport) return;
    void run('Production environment confirmed', async () => {
      const res = await transport.invoke(
        buildConfirmEnvironmentBody({
          environment: 'production',
          reason: 'Administrator confirmed this deployment is the production runtime.',
        }),
      );
      if (res.error) throw new Error(res.error.message ?? 'Environment confirmation failed');
      await loadDeployment();
    });
  }, [transport, run, loadDeployment]);

  /**
   * Bounded, read-only held-message probe. Claims nothing, sends nothing.
   * The server revalidates the tenant scope and returns a masked recipient
   * plus a one-way hash only.
   */
  const loadCandidate = useCallback(async () => {
    if (!transport || !supported || !orgId) return;
    try {
      const res = await transport.invoke(
        buildHeldPilotCandidateBody(orgId, departmentId ?? null),
      );
      if (res.error) return;
      setCandidate(res.data as HeldPilotCandidate);
    } catch {
      setCandidate(null);
    }
  }, [transport, supported, orgId, departmentId]);

  useEffect(() => { void loadCandidate(); }, [loadCandidate]);

  /**
   * Bounded, read-only review of every held (never-attempted) business
   * message. Masked recipients only; mutates nothing.
   */
  const loadHeldReview = useCallback(async () => {
    if (!transport || !supported || !orgId) return;
    try {
      const res = await transport.invoke(
        buildHeldJobReviewBody(orgId, departmentId ?? null),
      );
      if (res.error) return;
      setHeldReview(res.data as HeldJobReview);
    } catch {
      setHeldReview(null);
    }
  }, [transport, supported, orgId, departmentId]);

  useEffect(() => { void loadHeldReview(); }, [loadHeldReview]);

  /**
   * Retire one obsolete held message. Nothing is deleted and no provider is
   * contacted: the trusted boundary refuses any job that was ever attempted.
   */
  const retireHeldJob = useCallback((jobId: string) => {
    if (!transport || !orgId) return;
    void run('Obsolete held message retired', async () => {
      const res = await transport.invoke(
        buildRetireHeldJobBody(orgId, jobId, {
          departmentId: departmentId ?? null,
          reason: 'superseded_pre_production_pilot_job',
        }),
      );
      if (res.error) throw new Error(res.error.message ?? 'Retirement refused');
      await loadHeldReview();
      await loadCandidate();
    });
  }, [transport, orgId, departmentId, run, loadHeldReview, loadCandidate]);



  /** Read-only module enablement truth. Changes nothing. */
  useEffect(() => {
    if (!client || !orgId || !supported) return;
    void (async () => {
      try {
        const bindings = await listProducerEventBindings(client, {
          organizationId: orgId,
          departmentId: departmentId ?? null,
        });
        setModuleRows(buildModuleEnablementMatrix(bindings));
      } catch {
        setModuleRows(buildModuleEnablementMatrix([]));
      }
    })();
  }, [client, orgId, departmentId, supported]);

  const certifyDeployment = useCallback(() => {
    if (!transport) return;
    void run('Deployment certified', async () => {
      const res = await transport.invoke(buildCertifyDeploymentBody());
      if (res.error) throw new Error(res.error.message ?? 'Certification failed');
      await loadDeployment();
    });
  }, [transport, run, loadDeployment]);

  /**
   * Server-derived pre-send confirmation. Renders the exact facts of the one
   * authorised message. `confirmOnly` dispatches nothing.
   */
  const confirmControlledSend = useCallback(async () => {
    if (!transport || !release) return;
    const res = await transport.invoke(
      buildControlledSendBody(release.id, { confirmOnly: true }),
    );
    setPreSend((res.data as ControlledSendResult) ?? null);
  }, [transport, release]);

  useEffect(() => { void confirmControlledSend(); }, [confirmControlledSend]);

  /**
   * FINAL controlled business send. The browser names only this Release
   * Control; the trusted boundary revalidates it and resolves the one exact
   * authorised held job.
   */
  const releaseOneMessage = useCallback(() => {
    if (!transport || !release) return;
    void run('Controlled release requested', async () => {
      const res = await transport.invoke(buildControlledSendBody(release.id));
      if (res.error) throw new Error(res.error.message ?? 'Controlled release failed');
      const result = res.data as ControlledSendResult;
      setPreSend(result);
      setDispatchResult(
        `${result.code}: claimed ${result.dispatch?.claimed_jobs ?? 0}`
        + `${result.dispatch?.blocker ? ` — ${result.dispatch.blocker}` : ''}`,
      );
      await loadCandidate();
    });
  }, [transport, release, run, loadCandidate]);

  const workflow = useMemo(
    () => buildGoLiveWorkflow({
      summary,
      deployment,
      candidate,
      blockers: blockers.map((b) => b.code),
      proposalActive,
      sameActorAsProposer,
      canConfigure,
      canApprove,
    }),
    [summary, deployment, candidate, blockers, proposalActive, sameActorAsProposer,
      canConfigure, canApprove],
  );

  const prefillFromHeldMessage = useCallback(() => {
    const held = candidate?.candidate;
    if (!held) return;
    // Only the masked value is ever shown; the hash configures the rule so no
    // raw recipient is required in the browser.
    if (held.recipient_masked && held.recipient_hash) {
      setRecipientHashes({ [held.recipient_masked]: held.recipient_hash });
    }
    setForm((f) => ({
      ...applySingleMessagePilotPreset(f),
      eventCodes: held.event_code ?? f.eventCodes,
      callerModules: held.caller_module_code ?? f.callerModules,
      recipients: held.recipient_masked ?? f.recipients,
      ...buildReleaseWindow(2),
    }));
    toast.success('Pilot prefilled from the held business message. Review, then save.');
  }, [candidate]);



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
        channel,
        permittedEventCodes: splitList(form.eventCodes),
        permittedCallerModules: splitList(form.callerModules),
        permittedModes: ['queued'],
        // A masked value prefilled from the held message is submitted as
        // masked + hash; a value typed by hand is normalised server-side.
        recipientInput: splitList(form.recipients).map((value) =>
          recipientHashes[value]
            ? { target_masked: value, target_hash: recipientHashes[value] }
            : { target: value }),
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
    if (expired) {
      toast.error(
        'The pilot window has expired. Cancel this proposal, save a new future window, and propose it again before approval.',
      );
      return;
    }
    if (blockers.length > 0) {
      toast.error(`Approval is blocked by: ${blockers.map((item) => item.code).join(', ')}.`);
      return;
    }
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

  /* Live is governed exclusively by the single delivery switch (DeliveryToggleCard).
     The legacy propose/approve live actions were removed to avoid a second,
     conflicting path that failed with release_transition_not_allowed once live. */


  // The plain switch. The browser sends scope and intent only; the trusted
  // Edge boundary performs the preflight, the proposal or the second-person
  // approval, and refuses to let one person do both.
  const requestDelivery = (intent: 'enable' | 'disable') => {
    if (!transport || !orgId) return;
    void run(
      intent === 'enable' ? 'Automatic delivery request recorded' : 'Automatic delivery turned off',
      async () => {
        const res = await transport.invoke(buildDeliveryRequestBody({
          organizationId: orgId,
          departmentId: departmentId ?? null,
          channel,
          intent,
        }));
        if (res.error) throw new Error(res.error.message ?? 'Delivery request failed');
      },
    );
  };

  return (
    <div className="space-y-4">
      <DeliveryToggleCard
        title={`${definition.name} delivery`}
        snapshot={delivery}
        busy={busy || loading}
        onEnable={() => requestDelivery('enable')}
        onDisable={() => requestDelivery('disable')}
      />

      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          Advanced — technical governance and evidence
        </summary>
        <div className="mt-4 space-y-4">
      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Governance first — only the final step contacts the provider</AlertTitle>
        <AlertDescription>{SAFETY_NOTICE}</AlertDescription>
      </Alert>

      <GoLiveWorkflowCard workflow={workflow} />

      <LiveOperationsCard live={liveOps} />






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
            <CardTitle>Deployment &amp; certification</CardTitle>
            <CardDescription>
              The environment and both deployed revisions are resolved server-side.
              Nothing on this card can be typed by an administrator.
            </CardDescription>
          </div>
          <Button
            variant="outline" size="sm"
            onClick={() => void loadDeployment()} disabled={deploymentLoading}
          >
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Detail
              label="Environment"
              value={
                deployment?.environment === 'production' ? 'Production'
                  : deployment?.environment === 'non_production' ? 'Non-production'
                    : 'Unknown'
              }
            />
            <Detail
              label="Certification"
              value={deployment?.certification?.certification_state ?? 'Unknown'}
            />
            <Detail
              label="Runtime revision"
              value={deployment?.runtime_revision?.slice(0, 12) ?? '—'}
            />
            <Detail
              label="Dispatcher revision"
              value={deployment?.dispatcher_revision?.slice(0, 12) ?? '—'}
            />
            <Detail
              label="Certified revision"
              value={deployment?.certification?.certified_commit?.slice(0, 12) ?? '—'}
            />
            <Detail
              label="Revision match"
              value={
                deployment?.certification?.certified_commit
                && deployment?.release_identity
                && deployment.certification.certified_commit.toLowerCase()
                  === deployment.release_identity.toLowerCase()
                  ? 'Yes' : 'No'
              }
            />
            <Detail
              label="Workflow evidence"
              value={deployment?.certification?.workflow_run_id ?? '—'}
            />
          </div>

          {deployment?.deployment_revision_mismatch && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>deployment_revision_mismatch</AlertTitle>
              <AlertDescription>
                The runtime and the dispatcher report different deployed revisions, so a
                single compatible release identity cannot be proven. Certification is
                refused until both report the same revision.
              </AlertDescription>
            </Alert>
          )}

          {deployment && deployment.environment !== 'production'
            && deployment.environment !== 'non_production' && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Deployment environment unresolved</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>
                  The protected runtime environment is unknown, so deployment
                  certification and the release prerequisites fail closed. Confirming
                  production records an audit event and writes the protected record.
                  It never enables delivery, never certifies a commit and never
                  contacts a provider. Non-production can only be established from
                  trusted deployment metadata — it cannot be selected here.
                </p>
                <Button
                  size="sm" variant="outline" disabled={busy || !canOperate}
                  onClick={confirmProduction}
                >
                  Confirm production environment
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {deployment
            && deployment.certification?.certification_state !== 'certified'
            && !deployment.deployment_revision_mismatch
            && Boolean(deployment.release_identity)
            && (deployment.environment === 'production'
              || deployment.environment === 'non_production') && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
              <Button size="sm" disabled={busy || !canOperate} onClick={certifyDeployment}>
                Certify this deployment
              </Button>
              <span className="text-xs text-muted-foreground">
                The Edge boundary re-reads both deployed revisions server-side and records
                the certification only on an exact full 40-character match. It enables no
                delivery and contacts no provider.
              </span>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Technical details — runtime {deployment?.runtime_revision ?? 'unavailable'};
            dispatcher {deployment?.dispatcher_revision ?? 'unavailable'}; certified{' '}
            {deployment?.certification?.certified_commit ?? 'none'}. Certification facts
            originate from the trusted certification workflow only.
          </p>

        </CardContent>
      </Card>


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
              <AlertTitle>Business dispatch is governed by Release Control</AlertTitle>
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
          {candidate?.candidate && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
              <Button
                type="button" size="sm"
                disabled={!canConfigure || busy}
                onClick={prefillFromHeldMessage}
              >
                Configure from held business message
              </Button>
              <span className="text-xs text-muted-foreground">
                Uses the governing facts of held message{' '}
                {String(candidate.candidate.job_id).slice(0, 8)} —{' '}
                {candidate.candidate.event_code ?? 'unknown event'} from{' '}
                {candidate.candidate.caller_module_code ?? 'unknown module'} — and applies the
                single-message preset with a 2-hour window. Nothing is saved until you choose
                Save configuration.
              </span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
            <Button
              type="button" size="sm" variant="secondary"
              disabled={!canConfigure || busy}
              onClick={() => setForm((f) => applySingleMessagePilotPreset(f))}
            >
              {SINGLE_MESSAGE_PILOT_LABEL}
            </Button>
            {RELEASE_WINDOW_PRESETS.map((preset) => (
              <Button
                key={preset.id} type="button" size="sm" variant="outline"
                title={preset.description}
                disabled={!canConfigure || busy}
                onClick={() => setForm((f) => ({ ...f, ...buildReleaseWindow(preset.hours) }))}
              >
                {preset.label}
              </Button>
            ))}
            <span className="text-xs text-muted-foreground">
              The single-message preset sets 1 recipient per request, 1 per hour, 1 per day and
              1 in total. A window preset starts the pilot now and closes it automatically. All
              values stay visible below and must be reviewed before proposal.
            </span>
          </div>

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
            <Alert variant={expired || blockers.length > 0 ? 'destructive' : 'default'}>
              <Info className="h-4 w-4" />
              <AlertTitle>
                {expired ? 'Pilot window expired' : blockers.length > 0
                  ? 'Proposal blocked by prerequisites' : 'Proposal awaiting approval'}
              </AlertTitle>
              <AlertDescription>
                Proposed state {release?.proposed_state}; expires {release?.proposal_expires_at}.
                {sameActorAsProposer
                  && ' You proposed this transition, so you cannot approve it.'}
                {expired
                  && ' The proposer must cancel this proposal, save a new future pilot window, and propose it again.'}
                {!expired && blockers.length > 0
                  && ` Resolve: ${blockers.map((item) => item.code).join(', ')}.`}
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
                  disabled={
                    !canApprove || busy || sameActorAsProposer || !transport
                    || expired || blockers.length > 0
                  }
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
              value={suspendReason} disabled={!canOperate || busy}
              onChange={(e) => setSuspendReason(e.target.value)}
            />
            <Button
              variant="destructive"
              disabled={!canOperate || busy || !release || !suspendReason.trim()}
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
          <CardTitle>Module enablement</CardTitle>
          <CardDescription>
            Read-only truth for every business module. Only a module with an ACTIVE
            binding that permits the queued mode can produce a controlled business
            Email; everything else is non-sending. Nothing here can be edited.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {moduleRows.map((row) => (
            <div
              key={`${row.moduleCode}:${row.eventCode}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
            >
              <div>
                <p className="font-medium">{row.moduleCode}</p>
                <p className="text-xs text-muted-foreground">
                  {row.eventCode} — {row.statement}
                </p>
              </div>
              <Badge variant={row.canSendBusinessEmail ? 'default' : 'secondary'}>
                {row.canSendBusinessEmail ? 'Sending' : row.modes}
              </Badge>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Authorised to send: {sendingModules(moduleRows).join(', ') || 'none'}.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Held business messages</CardTitle>
          <CardDescription>
            Unsent messages waiting on Release Control. The controlled release requires
            exactly one, so any superseded message must be retired first. Retiring
            cancels the message only — nothing is deleted, no provider is contacted and
            the full history is kept with an immutable cancellation event.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(heldReview?.held_job_count ?? 0) > 1 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{heldReview?.held_job_count} held messages</AlertTitle>
              <AlertDescription>
                The controlled release will refuse to run until exactly one held message
                remains. Retire the superseded ones below.
              </AlertDescription>
            </Alert>
          )}
          {(heldReview?.jobs ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No held business messages.</p>
          )}
          {(heldReview?.jobs ?? []).map((job) => (
            <div
              key={job.job_id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm"
            >
              <div className="space-y-1">
                <p className="font-medium">
                  {job.caller_module_code ?? '—'} · {job.event_code ?? '—'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Job {job.job_id.slice(0, 8)} · reference {job.claim_reference ?? '—'} ·{' '}
                  {new Date(job.created_at).toLocaleString()} · recipient{' '}
                  {job.recipient_masked ?? '—'} · attempts {job.attempt_count}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={job.provider_contacted ? 'destructive' : 'secondary'}>
                  {job.provider_contacted ? 'Provider contacted' : 'Never attempted'}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canOperate || busy || !job.retirable}
                  onClick={() => retireHeldJob(job.job_id)}
                >
                  Retire
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>



      <Card>
        <CardHeader>
          <CardTitle>Controlled business release</CardTitle>
          <CardDescription>
            The only action on this screen that contacts the Email provider. It asks the
            canonical dispatcher to release at most ONE already-authorised held message.
            It creates nothing, chooses no template and can never exceed the approved
            pilot limits — every check is re-evaluated server-side.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Detail
              label="Held business messages"
              value={String(candidate?.held_job_count ?? 0)}
            />
            <Detail
              label="Held message"
              value={candidate?.candidate?.job_id?.slice(0, 8) ?? '—'}
            />
            <Detail label="Hold reason" value={candidate?.candidate?.hold_reason ?? '—'} />
            <Detail
              label="Attempts so far"
              value={String(candidate?.candidate?.attempt_count ?? 0)}
            />
          </div>

          {preSend?.confirmation && (
            <div className="rounded-md border p-3">
              <p className="mb-2 text-sm font-medium">Final pre-send confirmation</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Detail label="Module" value={preSend.confirmation.module ?? '—'} />
                <Detail label="Event" value={preSend.confirmation.event_code ?? '—'} />
                <Detail label="Release state" value={preSend.confirmation.release_state ?? '—'} />
                <Detail
                  label="Held authorised messages"
                  value={String(preSend.confirmation.held_authorized_messages)}
                />
                <Detail
                  label="Recipient (masked)"
                  value={preSend.confirmation.recipient_masked ?? '—'}
                />
                <Detail label="Attempts" value={String(preSend.confirmation.attempts)} />
                <Detail
                  label="Provider calls so far"
                  value={String(preSend.confirmation.provider_calls)}
                />
                <Detail
                  label="Remaining total allowance"
                  value={String(preSend.confirmation.remaining_total_allowance)}
                />
                <Detail label="Certification" value={preSend.confirmation.certification} />
                <Detail label="Release snapshot" value={preSend.confirmation.release_snapshot} />
                <Detail label="Pilot safety" value={preSend.confirmation.pilot_safety} />
                <Detail label="Unrestricted live delivery" value="disabled" />
              </div>
            </div>
          )}

          {preSend && !preSend.ok && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Server refuses the controlled send</AlertTitle>
              <AlertDescription>{preSend.code}</AlertDescription>
            </Alert>
          )}

          {!workflow.readyForControlledSend && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Not releasable yet</AlertTitle>
              <AlertDescription>
                {workflow.currentStage?.nextAction
                  ?? 'Complete the Go-Live workflow steps above first.'}
              </AlertDescription>
            </Alert>
          )}

          <Button
            variant="destructive"
            disabled={busy || !canOperate || !workflow.readyForControlledSend || preSend?.ok !== true}
            onClick={releaseOneMessage}
          >
            Release one controlled message
          </Button>

          {dispatchResult && (
            <p className="break-all text-xs text-muted-foreground">
              Technical details — dispatcher response {dispatchResult}
            </p>
          )}
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
      </details>
    </div>

  );
};

export default ChannelReleaseControlTab;
