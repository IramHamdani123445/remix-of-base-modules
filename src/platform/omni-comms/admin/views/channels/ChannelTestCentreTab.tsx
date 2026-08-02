/**
 * Omni-Comms C5A.1 — Channel Test Centre.
 *
 * HARD BOUNDARY: this screen NEVER sends a message. It runs a configuration
 * preflight only. No request, message, dispatch job or delivery attempt is
 * created, and no provider is contacted from this screen or from the RPC it
 * calls. Raw test targets and raw test content are never stored — the ledger
 * keeps a masked target, a payload summary and one-way hashes only.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ShieldCheck, AlertTriangle, RefreshCw, FilePlus2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import type { OmniCommsRpcClient } from '@/platform/omni-comms/application/omniCommsRpcErrors';
import {
  getChannelTestCentreSummary,
  runChannelTestPreflight,
} from '@/platform/omni-comms/application/channelTestCentreService';
import {
  CHANNEL_TEST_REPLAY_NOTICE,
  describeCandidateBinding,
  isDeliveryCheckCode,
  isTestCentreChannel,
  TEST_TARGET_LABEL_BY_CHANNEL,
  type ChannelTestCentreSummary,
  type ChannelTestCheck,
  type ChannelTestRun,
  type TestCentreChannel,
} from '@/platform/omni-comms/application/channelTestCentreTypes';
import type { ChannelTestDeliveryTransport } from '@/platform/omni-comms/application/channelTestDeliveryService';
import { DeferredCapabilityCard, Detail, Field, SelectField, toastError } from './channelFormPrimitives';
import { ChannelTestDeliveryCard } from './ChannelTestDeliveryCard';
import {
  buildTestPayload,
  defaultTestContentForm,
  TestContentFields,
  type TestContentForm,
} from './channelTestContentForms';
import type { ChannelUiDefinition } from './channelUiRegistry';

export const TEST_CENTRE_NOTICE =
  'This screen validates configuration only. Running a preflight never sends '
  + 'a message, never creates a request, message, dispatch job or delivery '
  + 'attempt, and never contacts a provider.';

const SAFETY_BULLETS = [
  'No message is sent.',
  'No request, message, dispatch job or delivery attempt is created.',
  'No provider is contacted.',
  'The test target is stored masked and hashed only.',
  'The test content is stored as a summary and hash only.',
] as const;

export function newIdempotencyKey(): string {
  const rand = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `preflight-${rand}`.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 128);
}

const STATE_VARIANT: Record<string, 'default' | 'destructive' | 'secondary' | 'outline'> = {
  passed: 'default',
  failed: 'destructive',
  warning: 'outline',
  not_applicable: 'secondary',
  not_implemented: 'secondary',
};

const CheckRow: React.FC<{ check: ChannelTestCheck }> = ({ check }) => (
  <li
    className="flex items-start gap-2 text-sm"
    data-testid={`omni-comms-check-${check.code}`}
    data-state={check.state}
  >
    <Badge variant={STATE_VARIANT[check.state] ?? 'secondary'}>{check.state}</Badge>
    <span className="flex-1">
      <span className="font-medium">{check.label}</span>
      <span className="ml-2 font-mono text-xs text-muted-foreground">{check.code}</span>
      <span className="block text-xs text-muted-foreground">{check.detail}</span>
    </span>
  </li>
);

const RunResult: React.FC<{
  run: ChannelTestRun;
  stale: boolean;
  replayed: boolean;
}> = ({ run, stale, replayed }) => {
  const configuration = run.checks.filter((c) => !isDeliveryCheckCode(c.code));
  const delivery = run.checks.filter((c) => isDeliveryCheckCode(c.code));
  return (
    <Card data-testid="omni-comms-test-centre-result">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Latest preflight
          <Badge variant={run.status === 'passed' ? 'default' : 'destructive'}>
            {run.result_code}
          </Badge>
          {stale ? <Badge variant="secondary">stale</Badge> : null}
          {replayed ? <Badge variant="outline">replayed</Badge> : null}
        </CardTitle>
        <CardDescription>
          {stale
            ? 'The configuration changed after this result was recorded. Re-run the preflight.'
            : 'This result matches the current configuration for the selected binding.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {replayed ? (
          <Alert data-testid="omni-comms-test-centre-replay">
            <AlertTitle>Replayed</AlertTitle>
            <AlertDescription>{CHANNEL_TEST_REPLAY_NOTICE}</AlertDescription>
          </Alert>
        ) : null}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Detail label="Recorded" value={new Date(run.requested_at).toLocaleString()} />
          <Detail
            label="Completed"
            value={run.completed_at ? new Date(run.completed_at).toLocaleString() : '—'}
          />
          <Detail label="Target" value={`${run.target_masked} (${run.target_type})`} />
          <Detail label="Blockers" value={String(run.blocker_codes.length)} />
          <Detail label="Binding" value={run.binding_id} mono />
          <Detail label="Provider account" value={run.provider_account_id ?? '—'} mono />
          <Detail label="Sender identity" value={run.sender_identity_id ?? '—'} mono />
          <Detail label="Channel endpoint" value={run.channel_endpoint_id ?? '—'} mono />
          <Detail label="Effective policy" value={run.policy_id ?? '—'} mono />
          <Detail
            label="Configuration fingerprint"
            value={run.configuration_fingerprint.slice(0, 16)}
            mono
          />
          <Detail label="Correlation ID" value={run.correlation_id ?? '—'} mono />
          <Detail label="Requested by" value={run.requested_by} mono />
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Payload summary (no raw content stored)</p>
          <pre className="rounded bg-muted p-2 text-xs overflow-x-auto">
            {JSON.stringify(run.payload_summary, null, 2)}
          </pre>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Configuration checks
          </p>
          <ul className="space-y-2">
            {configuration.map((c) => <CheckRow key={c.code} check={c} />)}
          </ul>
        </div>
        <div className="space-y-2" data-testid="omni-comms-test-centre-delivery-checks">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Delivery evidence — recorded by provider test delivery
          </p>
          <p className="text-xs text-muted-foreground">
            A passed configuration preflight is not proof of delivery. These
            points are proven only by an approved provider test delivery,
            recorded separately below.
          </p>
          <ul className="space-y-2">
            {delivery.map((c) => <CheckRow key={c.code} check={c} />)}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
};

export const ChannelTestCentreTab: React.FC<{
  definition: ChannelUiDefinition;
  client?: OmniCommsRpcClient;
  orgId?: string | null;
  departmentId?: string | null;
  departmentName?: string | null;
  /** Bound trusted-boundary transport for approved provider test delivery. */
  deliveryTransport?: ChannelTestDeliveryTransport;
  onChanged?: () => void;
}> = ({
  definition, client, orgId, departmentId, departmentName, deliveryTransport, onChanged,
}) => {
  const channel = definition.code;
  const supported = isTestCentreChannel(channel);

  const [summary, setSummary] = useState<ChannelTestCentreSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [bindingId, setBindingId] = useState('');
  const [target, setTarget] = useState('');
  const [content, setContent] = useState<TestContentForm>(() =>
    defaultTestContentForm((supported ? channel : 'email') as TestCentreChannel));
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => newIdempotencyKey());
  const [replayed, setReplayed] = useState(false);
  const [lastRun, setLastRun] = useState<ChannelTestRun | null>(null);

  /**
   * The key is regenerated only when the identity of the test changes
   * (organisation, department, channel, binding) or when the operator asks
   * for a new test. It is NEVER regenerated inside a submit handler, so a
   * retry after an uncertain response safely replays.
   */
  const scope = `${orgId ?? ''}|${departmentId ?? ''}|${channel}|${bindingId}`;
  const lastScope = useRef(scope);
  useEffect(() => {
    if (lastScope.current !== scope) {
      lastScope.current = scope;
      setIdempotencyKey(newIdempotencyKey());
      setReplayed(false);
      setLastRun(null);
    }
  }, [scope]);

  const refresh = useCallback(async () => {
    if (!client || !orgId || !supported) return;
    setLoading(true);
    try {
      const s = await getChannelTestCentreSummary(
        client,
        orgId,
        channel as TestCentreChannel,
        departmentId ?? null,
        bindingId || null,
      );
      setSummary(s);
      if (!bindingId && s.selected_binding_id) setBindingId(s.selected_binding_id);
    } catch (e) {
      toastError(e, 'Failed to load Test Centre');
    } finally {
      setLoading(false);
    }
  }, [client, orgId, departmentId, channel, supported, bindingId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const bindingOptions = useMemo(
    () => (summary?.candidate_bindings ?? []).map((b) => ({
      value: b.binding_id,
      label: describeCandidateBinding(b, departmentName),
    })),
    [summary, departmentName],
  );

  const onNewTest = useCallback(() => {
    setIdempotencyKey(newIdempotencyKey());
    setReplayed(false);
    setLastRun(null);
    toast.info('New test started. Previous history is unchanged.');
  }, []);

  const onRun = useCallback(async () => {
    if (!client || !orgId || !supported) return;
    if (!bindingId) { toast.error('Select a candidate binding first.'); return; }
    setRunning(true);
    try {
      const res = await runChannelTestPreflight(client, {
        organizationId: orgId,
        departmentId: departmentId ?? null,
        channel: channel as TestCentreChannel,
        bindingId,
        target,
        payload: buildTestPayload(channel as TestCentreChannel, content),
        idempotencyKey,
      });
      setReplayed(res.replayed);
      setLastRun(res.run);
      toast.success(
        res.replayed
          ? CHANNEL_TEST_REPLAY_NOTICE
          : res.run.status === 'passed'
            ? 'Configuration preflight passed. No message was sent.'
            : 'Configuration preflight failed. No message was sent.',
      );
      await refresh();
      onChanged?.();
    } catch (e) {
      toastError(e, 'Preflight could not be recorded');
    } finally {
      setRunning(false);
    }
  }, [
    client, orgId, departmentId, channel, supported, bindingId, target, content,
    idempotencyKey, refresh, onChanged,
  ]);

  if (!supported || !client || !orgId) {
    return (
      <DeferredCapabilityCard
        testId="omni-comms-test-centre"
        title={`${definition.name} Test Centre`}
        description={TEST_CENTRE_NOTICE}
        bullets={SAFETY_BULLETS}
        footer="Configuration preflight is unavailable for this channel or scope."
      />
    );
  }

  const canConfigure = summary?.can_configure ?? false;
  const currentRun = lastRun ?? summary?.latest_run ?? null;
  const currentStale = lastRun
    ? Boolean(summary?.configuration_fingerprint
      && lastRun.configuration_fingerprint !== summary.configuration_fingerprint)
    : Boolean(summary?.latest_run_is_stale);

  return (
    <div className="space-y-6" data-testid="omni-comms-test-centre">
      <Alert data-testid="omni-comms-test-centre-safety">
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>{definition.name} Test Centre — configuration preflight only</AlertTitle>
        <AlertDescription>
          {TEST_CENTRE_NOTICE}
          <ul className="list-disc pl-5 mt-2 space-y-1 text-xs">
            {SAFETY_BULLETS.map((b) => <li key={b}>{b}</li>)}
          </ul>
        </AlertDescription>
      </Alert>

      <Card data-testid="omni-comms-test-centre-form">
        <CardHeader>
          <CardTitle>Run a configuration preflight</CardTitle>
          <CardDescription>
            Select the candidate binding to validate, then supply a safe test
            target and temporary technical content.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SelectField
            label="Candidate binding"
            value={bindingId}
            onChange={setBindingId}
            options={bindingOptions}
          />
          <Field
            label={TEST_TARGET_LABEL_BY_CHANNEL[channel as TestCentreChannel]}
            value={target}
            onChange={setTarget}
            placeholder="Stored masked and hashed only"
          />
          <TestContentFields
            channel={channel as TestCentreChannel}
            value={content}
            onChange={setContent}
          />
          <p className="text-xs text-muted-foreground">
            Only a summary (counts and titles) and a one-way hash are stored.
          </p>
          <div className="text-xs text-muted-foreground" data-testid="omni-comms-test-centre-idempotency">
            Idempotency key: <span className="font-mono">{idempotencyKey}</span>
            {' — retrying the same test returns the existing immutable result.'}
          </div>
          {!canConfigure ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Read-only</AlertTitle>
              <AlertDescription>
                You do not have the Omni-Comms configure capability, so a
                preflight cannot be run from this screen.
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void onRun()} disabled={!canConfigure || running || loading}>
              {running ? 'Running preflight…' : 'Run configuration preflight'}
            </Button>
            <Button
              variant="secondary"
              onClick={onNewTest}
              disabled={running}
              data-testid="omni-comms-test-centre-new-test"
            >
              <FilePlus2 className="h-4 w-4 mr-1" /> New test
            </Button>
            <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {currentRun ? (
        <RunResult run={currentRun} stale={currentStale} replayed={replayed} />
      ) : (
        <Card data-testid="omni-comms-test-centre-result-empty">
          <CardHeader>
            <CardTitle>No preflight recorded</CardTitle>
            <CardDescription>
              No configuration preflight has been recorded for this binding and scope.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {channel === 'email' && bindingId && deliveryTransport ? (
        <ChannelTestDeliveryCard
          client={client}
          transport={deliveryTransport}
          orgId={orgId}
          departmentId={departmentId ?? null}
          channel="email"
          bindingId={bindingId}
          target={target}
          subject={content.subject}
          bodyText={content.body}
          run={currentRun}
          runIsCurrent={!currentStale}
          configurationFingerprint={summary?.configuration_fingerprint ?? null}
          onChanged={onChanged}
        />
      ) : null}


      <Card data-testid="omni-comms-test-centre-history">
        <CardHeader>
          <CardTitle>Preflight history</CardTitle>
          <CardDescription>
            Permanent, unchangeable record. Entries can never be edited or deleted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(summary?.history ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No history yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-muted-foreground">
                    <th className="p-2">Result</th>
                    <th className="p-2">Binding</th>
                    <th className="p-2">Target</th>
                    <th className="p-2">Configuration</th>
                    <th className="p-2">Replay</th>
                    <th className="p-2">Requested by</th>
                    <th className="p-2">Requested</th>
                    <th className="p-2">Completed</th>
                    <th className="p-2">Correlation</th>
                    <th className="p-2">Blockers</th>
                    <th className="p-2">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary?.history ?? []).map((r) => {
                    const rowStale = Boolean(summary?.configuration_fingerprint)
                      && r.configuration_fingerprint !== summary?.configuration_fingerprint;
                    const rowReplayed = replayed && lastRun?.id === r.id;
                    return (
                      <tr
                        key={r.id}
                        className="border-t align-top"
                        data-testid="omni-comms-test-centre-history-row"
                      >
                        <td className="p-2">
                          <Badge variant={r.status === 'passed' ? 'default' : 'destructive'}>
                            {r.status}
                          </Badge>
                        </td>
                        <td className="p-2 font-mono text-xs">{r.binding_id.slice(0, 8)}</td>
                        <td className="p-2 font-mono text-xs">{r.target_masked}</td>
                        <td className="p-2">
                          <Badge variant={rowStale ? 'secondary' : 'outline'}>
                            {rowStale ? 'stale' : 'current'}
                          </Badge>
                        </td>
                        <td className="p-2 text-xs">{rowReplayed ? 'replayed' : 'original'}</td>
                        <td className="p-2 font-mono text-xs">{r.requested_by.slice(0, 8)}</td>
                        <td className="p-2 text-xs">{new Date(r.requested_at).toLocaleString()}</td>
                        <td className="p-2 text-xs">
                          {r.completed_at ? new Date(r.completed_at).toLocaleString() : '—'}
                        </td>
                        <td className="p-2 font-mono text-xs">{r.correlation_id ?? '—'}</td>
                        <td className="p-2 text-xs">{r.blocker_codes.length}</td>
                        <td className="p-2 text-xs text-muted-foreground">
                          {r.blocker_codes.length > 0
                            ? r.blocker_codes.join(', ')
                            : 'No configuration blockers. Delivery remains unproven.'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ChannelTestCentreTab;
