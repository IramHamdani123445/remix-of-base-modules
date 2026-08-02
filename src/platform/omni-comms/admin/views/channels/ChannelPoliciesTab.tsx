/**
 * Omni-Comms C4B — generic, provider-independent Channel Policies tab.
 *
 * Boundaries (permanent):
 *   - Administration records only. No delivery, dispatch, retry, rate-limit,
 *     quiet-hour, retention or cost behaviour is implemented or enforced.
 *   - No live-delivery switch and no pilot activation. Release Control owns
 *     activation and does not exist yet.
 *   - Reference policies are never requested by this production surface.
 *   - No raw JSON editor: channel-specific values use typed fields.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { toast } from 'sonner';
import type { useOmniCommsRpcClient } from '../../hooks/useOmniCommsRpcClient';
import {
  getChannelPolicySummary,
  upsertChannelPolicy,
} from '@/platform/omni-comms/application/channelPolicyService';
import {
  COST_NOTICE,
  NO_BASELINE_NOTICE,
  OPERATIONAL_STATES,
  OPERATIONAL_STATE_DESCRIPTION,
  OPERATIONAL_STATE_LABEL,
  POLICY_STATE_NOTICE,
  REFERENCE_POLICY_NOTICE,
  RELIABILITY_NOTICE,
  RETENTION_NOTICE,
  RETRY_PROFILES,
  RETRY_PROFILE_LABEL,
  effectiveSourceLabel,
  isPolicyChannel,
  isReferencePolicy,
  policyScopeLabel,
  validateCommonPolicy,
  type ChannelPolicyRow,
  type ChannelPolicySummary,
  type CommonPolicyInput,
  type OperationalState,
  type PolicyChannel,
  type RetryProfile,
} from '@/platform/omni-comms/application/channelPolicyTypes';
import { DeferredCapabilityCard, Detail, Field, SelectField, toastError } from './channelFormPrimitives';
import { ChannelPolicyConfigFields, type ConfigValue } from './channelPolicyForms';
import type { ChannelUiDefinition } from './channelUiRegistry';

type Client = ReturnType<typeof useOmniCommsRpcClient>;

export const POLICY_HELPER_TEXT = POLICY_STATE_NOTICE;

interface DraftState {
  operational_state: OperationalState;
  department_override_enabled: boolean;
  per_minute_limit: string;
  per_day_limit: string;
  max_recipients_per_request: string;
  quiet_hours_start: string;
  quiet_hours_end: string;
  quiet_hours_timezone: string;
  retry_profile: RetryProfile;
  request_timeout_seconds: string;
  retention_days: string;
  cost_currency: string;
  daily_cost_limit_minor: string;
  per_message_cost_limit_minor: string;
  config: ConfigValue;
}

const nstr = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
const nnum = (v: string): number | null => {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.trunc(n) : Number.NaN;
};

function toDraft(row: ChannelPolicyRow | null, isDepartment: boolean): DraftState {
  return {
    operational_state: row?.operational_state ?? 'disabled',
    department_override_enabled: isDepartment ? (row?.department_override_enabled ?? true) : true,
    per_minute_limit: nstr(row?.per_minute_limit),
    per_day_limit: nstr(row?.per_day_limit),
    max_recipients_per_request: nstr(row?.max_recipients_per_request),
    quiet_hours_start: row?.quiet_hours_start ?? '',
    quiet_hours_end: row?.quiet_hours_end ?? '',
    quiet_hours_timezone: row?.quiet_hours_timezone ?? 'America/St_Kitts',
    retry_profile: row?.retry_profile ?? 'none',
    request_timeout_seconds: nstr(row?.request_timeout_seconds),
    retention_days: nstr(row?.retention_days),
    cost_currency: row?.cost_currency ?? '',
    daily_cost_limit_minor: nstr(row?.daily_cost_limit_minor),
    per_message_cost_limit_minor: nstr(row?.per_message_cost_limit_minor),
    config: { ...(row?.channel_policy_config ?? {}) },
  };
}

function toCommonInput(d: DraftState): CommonPolicyInput {
  return {
    operational_state: d.operational_state,
    department_override_enabled: d.department_override_enabled,
    per_minute_limit: nnum(d.per_minute_limit),
    per_day_limit: nnum(d.per_day_limit),
    max_recipients_per_request: nnum(d.max_recipients_per_request),
    quiet_hours_start: d.quiet_hours_start.trim() || null,
    quiet_hours_end: d.quiet_hours_end.trim() || null,
    quiet_hours_timezone: d.quiet_hours_start.trim() ? d.quiet_hours_timezone.trim() || null : null,
    retry_profile: d.retry_profile,
    request_timeout_seconds: nnum(d.request_timeout_seconds),
    retention_days: nnum(d.retention_days),
    cost_currency: d.cost_currency.trim().toUpperCase() || null,
    daily_cost_limit_minor: nnum(d.daily_cost_limit_minor),
    per_message_cost_limit_minor: nnum(d.per_message_cost_limit_minor),
  };
}

// ─── Read-only policy summary card ─────────────────────────────────────
const PolicyReadOnly: React.FC<{
  title: string;
  description: string;
  policy: ChannelPolicyRow | null;
  testId?: string;
  emptyText?: string;
}> = ({ title, description, policy, testId, emptyText }) => (
  <Card data-testid={testId}>
    <CardHeader>
      <CardTitle>{title}</CardTitle>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      {!policy ? (
        <p className="text-sm text-muted-foreground">{emptyText ?? NO_BASELINE_NOTICE}</p>
      ) : (
        <>
          {isReferencePolicy(policy) ? (
            <Badge variant="secondary">Reference data</Badge>
          ) : null}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Detail label="Operational state" value={OPERATIONAL_STATE_LABEL[policy.operational_state]} />
            <Detail label="Scope" value={policyScopeLabel(policy)} />
            <Detail label="Per-minute limit" value={nstr(policy.per_minute_limit) || '—'} />
            <Detail label="Per-day limit" value={nstr(policy.per_day_limit) || '—'} />
            <Detail label="Max recipients / request" value={nstr(policy.max_recipients_per_request) || '—'} />
            <Detail
              label="Quiet hours"
              value={
                policy.quiet_hours_start
                  ? `${policy.quiet_hours_start}–${policy.quiet_hours_end} ${policy.quiet_hours_timezone ?? ''}`
                  : '—'
              }
            />
            <Detail label="Retry profile" value={RETRY_PROFILE_LABEL[policy.retry_profile]} />
            <Detail label="Request timeout (s)" value={nstr(policy.request_timeout_seconds) || '—'} />
            <Detail label="Retention (days)" value={nstr(policy.retention_days) || '—'} />
            <Detail label="Cost currency" value={policy.cost_currency ?? '—'} />
            <Detail label="Daily ceiling (minor)" value={nstr(policy.daily_cost_limit_minor) || '—'} />
            <Detail label="Per-message ceiling (minor)" value={nstr(policy.per_message_cost_limit_minor) || '—'} />
          </div>
          <Detail
            label="Channel-specific configuration"
            value={
              Object.keys(policy.channel_policy_config ?? {}).length === 0
                ? 'None configured'
                : Object.entries(policy.channel_policy_config)
                  .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('/') : String(v)}`)
                  .join(' · ')
            }
          />
        </>
      )}
    </CardContent>
  </Card>
);

// ─── Editor ────────────────────────────────────────────────────────────
const PolicyEditor: React.FC<{
  title: string;
  description: string;
  channel: PolicyChannel;
  policy: ChannelPolicyRow | null;
  isDepartment: boolean;
  busy: boolean;
  testId: string;
  onSave: (common: CommonPolicyInput, config: ConfigValue) => void;
}> = ({ title, description, channel, policy, isDepartment, busy, testId, onSave }) => {
  const [draft, setDraft] = useState<DraftState>(() => toDraft(policy, isDepartment));
  useEffect(() => { setDraft(toDraft(policy, isDepartment)); }, [policy?.id, policy?.updated_at, isDepartment, policy]);

  const common = useMemo(() => toCommonInput(draft), [draft]);
  const issues = useMemo(() => validateCommonPolicy(common), [common]);
  const set = <K extends keyof DraftState>(k: K, v: DraftState[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  const inactive = isDepartment && !draft.department_override_enabled;

  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* State and scope */}
        <section className="space-y-3">
          <h4 className="text-sm font-semibold">State and scope</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <SelectField
              label="Operational state"
              value={draft.operational_state}
              onChange={(v) => set('operational_state', (v || 'disabled') as OperationalState)}
              options={OPERATIONAL_STATES.map((s) => ({ value: s, label: OPERATIONAL_STATE_LABEL[s] }))}
            />
            <div className="text-xs text-muted-foreground self-end pb-2">
              {OPERATIONAL_STATE_DESCRIPTION[draft.operational_state]}
            </div>
          </div>
          {isDepartment ? (
            <div className="flex items-center gap-3">
              <Switch
                checked={draft.department_override_enabled}
                onCheckedChange={(c) => set('department_override_enabled', c)}
              />
              <Label>Use department override</Label>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">{POLICY_STATE_NOTICE}</p>
        </section>

        <Separator />

        {/* Progressive disclosure: advanced policy declarations */}
        <Accordion type="multiple" className="w-full" data-testid={`${testId}-advanced`}>
          <AccordionItem value="volume">
            <AccordionTrigger className="text-sm font-semibold">Volume limits</AccordionTrigger>
            <AccordionContent className="space-y-3 pt-1">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Per-minute limit" value={draft.per_minute_limit} onChange={(v) => set('per_minute_limit', v)} placeholder="1–100000" />
            <Field label="Per-day limit" value={draft.per_day_limit} onChange={(v) => set('per_day_limit', v)} placeholder="1–10000000" />
            <Field label="Maximum recipients per request" value={draft.max_recipients_per_request} onChange={(v) => set('max_recipients_per_request', v)} placeholder="1–100000" />
          </div>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="quiet">
            <AccordionTrigger className="text-sm font-semibold">Quiet hours</AccordionTrigger>
            <AccordionContent className="space-y-3 pt-1">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Start (HH:MM)" value={draft.quiet_hours_start} onChange={(v) => set('quiet_hours_start', v)} placeholder="22:00" />
            <Field label="End (HH:MM)" value={draft.quiet_hours_end} onChange={(v) => set('quiet_hours_end', v)} placeholder="06:00" />
            <Field label="Timezone" value={draft.quiet_hours_timezone} onChange={(v) => set('quiet_hours_timezone', v)} />
          </div>
          <p className="text-xs text-muted-foreground">
            Overnight windows are accepted. No quiet-hour suppression is implemented in C4B.
          </p>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="reliability">
            <AccordionTrigger className="text-sm font-semibold">Reliability declarations</AccordionTrigger>
            <AccordionContent className="space-y-3 pt-1">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <SelectField
              label="Retry profile"
              value={draft.retry_profile}
              onChange={(v) => set('retry_profile', (v || 'none') as RetryProfile)}
              options={RETRY_PROFILES.map((r) => ({ value: r, label: RETRY_PROFILE_LABEL[r] }))}
            />
            <Field label="Request timeout (seconds)" value={draft.request_timeout_seconds} onChange={(v) => set('request_timeout_seconds', v)} placeholder="1–300" />
          </div>
          <p className="text-xs text-muted-foreground">{RELIABILITY_NOTICE}</p>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="retention">
            <AccordionTrigger className="text-sm font-semibold">Retention</AccordionTrigger>
            <AccordionContent className="space-y-3 pt-1">
          <Field label="Retention days" value={draft.retention_days} onChange={(v) => set('retention_days', v)} placeholder="1–3650" />
          <p className="text-xs text-muted-foreground">{RETENTION_NOTICE}</p>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="cost">
            <AccordionTrigger className="text-sm font-semibold">Cost guardrails</AccordionTrigger>
            <AccordionContent className="space-y-3 pt-1">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Currency" value={draft.cost_currency} onChange={(v) => set('cost_currency', v.toUpperCase())} placeholder="XCD" />
            <Field label="Daily ceiling (minor units)" value={draft.daily_cost_limit_minor} onChange={(v) => set('daily_cost_limit_minor', v)} />
            <Field label="Per-message ceiling (minor units)" value={draft.per_message_cost_limit_minor} onChange={(v) => set('per_message_cost_limit_minor', v)} />
          </div>
          <p className="text-xs text-muted-foreground">{COST_NOTICE}</p>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="channel">
            <AccordionTrigger className="text-sm font-semibold">Channel-specific controls</AccordionTrigger>
            <AccordionContent className="space-y-3 pt-1">
          <ChannelPolicyConfigFields
            channel={channel}
            value={draft.config}
            onChange={(next) => set('config', next)}
          />
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {issues.length > 0 ? (
          <ul className="text-xs text-destructive list-disc pl-5" data-testid="omni-comms-policy-issues">
            {issues.map((i) => <li key={`${i.field}-${i.message}`}>{`${i.field}: ${i.message}`}</li>)}
          </ul>
        ) : null}

        {inactive ? (
          <p className="text-xs text-muted-foreground">
            The department override is turned off — the organisation baseline is effective.
            Values below are retained and will apply again when the override is re-enabled.
          </p>
        ) : null}

        <Button
          disabled={busy || issues.length > 0}
          onClick={() => onSave(common, draft.config)}
        >
          {policy
            ? (isDepartment ? 'Save department override' : 'Save organisation policy')
            : (isDepartment ? 'Create department override' : 'Create organisation policy')}
        </Button>
      </CardContent>
    </Card>
  );
};

// ─── Tab ───────────────────────────────────────────────────────────────
export const ChannelPoliciesTab: React.FC<{
  definition: ChannelUiDefinition;
  client: Client;
  orgId: string;
  departmentId?: string | null;
  departmentName?: string | null;
  onChanged: () => Promise<void> | void;
}> = ({ definition, client, orgId, departmentId, departmentName, onChanged }) => {
  const channelCode = definition.code;
  const supported = isPolicyChannel(channelCode);
  const [summary, setSummary] = useState<ChannelPolicySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!supported || !orgId) return;
    setLoading(true);
    try {
      // Production UI never requests reference policies.
      setSummary(
        await getChannelPolicySummary(client, {
          organizationId: orgId,
          departmentId: departmentId ?? null,
          channel: channelCode as PolicyChannel,
          includeReference: false,
        }),
      );
    } catch (e) {
      toastError(e, 'Unable to load channel policies');
    } finally {
      setLoading(false);
    }
  }, [client, orgId, departmentId, channelCode, supported]);

  useEffect(() => { void load(); }, [load]);

  if (!supported) {
    return (
      <DeferredCapabilityCard
        testId="omni-comms-policies-planned-state"
        title={`${definition.name} policies`}
        description={
          `${definition.name} is not supported by the database channel catalogue, `
          + 'so no policy record can exist and no policy action is offered.'
        }
        bullets={definition.policies}
        footer="The channel constraint is not extended in C4B."
      />
    );
  }

  const channel = channelCode as PolicyChannel;
  const isDepartmentScope = Boolean(departmentId);
  const effective = summary?.effective_policy ?? null;
  const orgPolicy = summary?.organization_policy ?? null;
  const deptPolicy = summary?.department_policy ?? null;

  const save = async (
    target: 'organisation' | 'department',
    common: CommonPolicyInput,
    config: ConfigValue,
  ) => {
    setBusy(true);
    try {
      const existing = target === 'organisation' ? orgPolicy : deptPolicy;
      await upsertChannelPolicy(client, {
        id: existing?.id ?? null,
        expectedUpdatedAt: existing?.updated_at ?? null,
        organizationId: orgId,
        departmentId: target === 'department' ? (departmentId ?? null) : null,
        channel,
        common: {
          ...common,
          department_override_enabled:
            target === 'organisation' ? true : (common.department_override_enabled ?? true),
        },
        channelPolicyConfig: config,
      });
      toast.success(
        target === 'organisation' ? 'Organisation policy saved' : 'Department override saved',
      );
      await load();
      await onChanged();
    } catch (e) {
      toastError(e, 'Save failed — refresh and retry');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="omni-comms-channel-policies">
      <Card>
        <CardHeader>
          <CardTitle>Effective policy</CardTitle>
          <CardDescription>{POLICY_STATE_NOTICE}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={effective ? 'default' : 'secondary'} data-testid="omni-comms-effective-source">
              {effectiveSourceLabel(summary?.effective_source ?? 'none')}
            </Badge>
            <span className="text-sm text-muted-foreground">
              Scope: {isDepartmentScope ? `Department — ${departmentName ?? summary?.department_name ?? 'selected'}` : 'Organisation'}
            </span>
            <Button variant="outline" size="sm" disabled={loading} onClick={() => void load()}>
              Refresh
            </Button>
          </div>
          {!effective ? (
            <p className="text-sm text-muted-foreground">
              {isDepartmentScope && !orgPolicy ? NO_BASELINE_NOTICE : 'No policy configured for this scope.'}
            </p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Detail label="Operational state" value={OPERATIONAL_STATE_LABEL[effective.operational_state]} />
              <Detail label="Source scope" value={policyScopeLabel(effective)} />
              <Detail label="Per-minute limit" value={nstr(effective.per_minute_limit) || '—'} />
              <Detail label="Retry profile" value={RETRY_PROFILE_LABEL[effective.retry_profile]} />
            </div>
          )}
          {!isDepartmentScope && (summary?.department_override_count ?? 0) > 0 ? (
            <p className="text-xs text-muted-foreground" data-testid="omni-comms-department-override-count">
              {summary?.department_override_count} department override record(s) exist for this channel.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {isDepartmentScope ? (
        <>
          <PolicyReadOnly
            testId="omni-comms-organisation-baseline"
            title="Organisation baseline (read-only)"
            description="Edit the organisation policy from the organisation scope."
            policy={orgPolicy}
          />
          <PolicyEditor
            testId="omni-comms-department-policy-editor"
            title="Department override"
            description={`Policy for ${departmentName ?? summary?.department_name ?? 'the selected department'}.`}
            channel={channel}
            policy={deptPolicy}
            isDepartment
            busy={busy}
            onSave={(c, cfg) => void save('department', c, cfg)}
          />
        </>
      ) : (
        <PolicyEditor
          testId="omni-comms-organisation-policy-editor"
          title="Organisation policy"
          description="The organisation baseline applies wherever no enabled department override exists."
          channel={channel}
          policy={orgPolicy}
          isDepartment={false}
          busy={busy}
          onSave={(c, cfg) => void save('organisation', c, cfg)}
        />
      )}

      {(summary?.reference_policies?.length ?? 0) > 0 ? (
        <Card data-testid="omni-comms-reference-policies">
          <CardHeader>
            <CardTitle>Reference policies</CardTitle>
            <CardDescription>{REFERENCE_POLICY_NOTICE}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(summary?.reference_policies ?? []).map((r) => (
              <PolicyReadOnly
                key={r.id}
                title={`Reference — ${policyScopeLabel(r)}`}
                description={REFERENCE_POLICY_NOTICE}
                policy={r}
              />
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};

export default ChannelPoliciesTab;
