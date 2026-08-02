/**
 * Omni-Comms C5A — Channel Test Centre.
 *
 * HARD BOUNDARY: this screen NEVER sends a message. It runs a configuration
 * preflight only. No request, message, dispatch job or delivery attempt is
 * created, and no provider is contacted from this screen or from the RPC it
 * calls. Raw test targets and raw test content are never stored — the ledger
 * keeps a masked target, a payload summary and one-way hashes only.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldCheck, AlertTriangle, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import type { OmniCommsRpcClient } from '@/platform/omni-comms/application/omniCommsRpcErrors';
import {
  getChannelTestCentreSummary,
  runChannelTestPreflight,
} from '@/platform/omni-comms/application/channelTestCentreService';
import {
  isTestCentreChannel,
  TEST_TARGET_LABEL_BY_CHANNEL,
  type ChannelTestCentreSummary,
  type ChannelTestCheck,
  type ChannelTestRun,
  type TestCentreChannel,
} from '@/platform/omni-comms/application/channelTestCentreTypes';
import { DeferredCapabilityCard, Detail, Field, SelectField, toastError } from './channelFormPrimitives';
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

/** Per-channel default technical payloads (temporary, never persisted raw). */
function defaultPayloadText(channel: TestCentreChannel): string {
  const p: Record<TestCentreChannel, Record<string, unknown>> = {
    email: { subject: 'Configuration preflight', body: 'Technical configuration preflight only.' },
    sms: { text: 'Technical configuration preflight only.' },
    whatsapp: { template_code: 'preflight_check', language_code: 'en', variables: [] },
    push: { title: 'Configuration preflight', body: 'Technical configuration preflight only.' },
    in_app: { title: 'Configuration preflight', body: 'Technical configuration preflight only.' },
    print: { document_title: 'Configuration preflight', sample_text: 'Technical preflight only.' },
  };
  return JSON.stringify(p[channel], null, 2);
}

function newIdempotencyKey(): string {
  const rand = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `preflight-${rand}`.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 128);
}

const CheckRow: React.FC<{ check: ChannelTestCheck }> = ({ check }) => (
  <li className="flex items-start gap-2 text-sm" data-testid={`omni-comms-check-${check.code}`}>
    <Badge
      variant={
        check.status === 'passed' ? 'default' : check.status === 'failed' ? 'destructive' : 'secondary'
      }
    >
      {check.status}
    </Badge>
    <span className="flex-1">
      <span className="font-medium">{check.code}</span>
      <span className="block text-xs text-muted-foreground">{check.detail}</span>
    </span>
  </li>
);

const RunResult: React.FC<{ run: ChannelTestRun; stale: boolean }> = ({ run, stale }) => (
  <Card data-testid="omni-comms-test-centre-result">
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        Latest preflight
        <Badge variant={run.status === 'passed' ? 'default' : 'destructive'}>{run.result_code}</Badge>
        {stale ? <Badge variant="secondary">stale</Badge> : null}
      </CardTitle>
      <CardDescription>
        {stale
          ? 'The configuration changed after this result was recorded. Re-run the preflight.'
          : 'This result matches the current configuration for the selected binding.'}
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Detail label="Recorded" value={new Date(run.requested_at).toLocaleString()} />
        <Detail label="Target" value={`${run.target_masked} (${run.target_type})`} />
        <Detail label="Configuration fingerprint" value={run.configuration_fingerprint.slice(0, 16)} mono />
        <Detail label="Blockers" value={String(run.blocker_codes.length)} />
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-1">Payload summary (no raw content stored)</p>
        <pre className="rounded bg-muted p-2 text-xs overflow-x-auto">
          {JSON.stringify(run.payload_summary, null, 2)}
        </pre>
      </div>
      <ul className="space-y-2">
        {run.checks.map((c) => <CheckRow key={c.code} check={c} />)}
      </ul>
    </CardContent>
  </Card>
);

export const ChannelTestCentreTab: React.FC<{
  definition: ChannelUiDefinition;
  client?: OmniCommsRpcClient;
  orgId?: string | null;
  departmentId?: string | null;
  onChanged?: () => void;
}> = ({ definition, client, orgId, departmentId, onChanged }) => {
  const channel = definition.code;
  const supported = isTestCentreChannel(channel);

  const [summary, setSummary] = useState<ChannelTestCentreSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [bindingId, setBindingId] = useState('');
  const [target, setTarget] = useState('');
  const [payloadText, setPayloadText] = useState(
    supported ? defaultPayloadText(channel as TestCentreChannel) : '{}',
  );

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
      label: `${b.identity_code ?? 'identity'} → ${b.provider_account_code ?? 'account'}`
        + ` · ${b.status} · ${b.verification_status ?? 'unverified'}`,
    })),
    [summary],
  );

  const onRun = useCallback(async () => {
    if (!client || !orgId || !supported) return;
    if (!bindingId) { toast.error('Select a candidate binding first.'); return; }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(payloadText) as Record<string, unknown>;
    } catch {
      toast.error('Test content must be valid JSON.');
      return;
    }
    setRunning(true);
    try {
      const res = await runChannelTestPreflight(client, {
        organizationId: orgId,
        departmentId: departmentId ?? null,
        channel: channel as TestCentreChannel,
        bindingId,
        target,
        payload,
        idempotencyKey: newIdempotencyKey(),
      });
      toast.success(
        res.run.status === 'passed'
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
  }, [client, orgId, departmentId, channel, supported, bindingId, target, payloadText, refresh, onChanged]);

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
          <div className="space-y-1">
            <Label>Temporary technical content (JSON)</Label>
            <Textarea
              rows={8}
              className="font-mono text-xs"
              value={payloadText}
              onChange={(e) => setPayloadText(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Only a summary (counts and titles) and a one-way hash are stored.
            </p>
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
          <div className="flex gap-2">
            <Button onClick={() => void onRun()} disabled={!canConfigure || running || loading}>
              {running ? 'Running preflight…' : 'Run configuration preflight'}
            </Button>
            <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {summary?.latest_run ? (
        <RunResult run={summary.latest_run} stale={summary.latest_run_is_stale} />
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
            <ul className="space-y-2">
              {(summary?.history ?? []).map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between rounded border p-2 text-sm"
                  data-testid="omni-comms-test-centre-history-row"
                >
                  <span className="flex items-center gap-2">
                    <Badge variant={r.status === 'passed' ? 'default' : 'destructive'}>
                      {r.status}
                    </Badge>
                    <span className="font-mono text-xs">{r.target_masked}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(r.requested_at).toLocaleString()}
                    {' · '}
                    {r.configuration_fingerprint.slice(0, 12)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ChannelTestCentreTab;
