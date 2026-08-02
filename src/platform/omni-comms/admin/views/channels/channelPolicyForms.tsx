/**
 * Omni-Comms C4B — typed channel-specific policy controls.
 *
 * Pure presentation. There is deliberately NO raw JSON editor: every allowed
 * key is rendered as a typed field mirroring the server-side normaliser.
 * Nothing here enforces a policy, contacts a provider, or sends anything.
 */
import React from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Field, SelectField } from './channelFormPrimitives';
import {
  ACKNOWLEDGEMENT_MODES,
  CHANNEL_POLICY_FIELD_LABEL,
  COUNTRY_MODES,
  type PolicyChannel,
} from '@/platform/omni-comms/application/channelPolicyTypes';

export type ConfigValue = Record<string, unknown>;

const num = (v: unknown): string =>
  v === null || v === undefined || v === '' ? '' : String(v);

const parseNum = (v: string): number | undefined => {
  const t = v.trim();
  if (t === '') return undefined;
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) ? n : undefined;
};

const NumberField: React.FC<{
  k: string;
  value: ConfigValue;
  onChange: (next: ConfigValue) => void;
  disabled?: boolean;
  hint?: string;
}> = ({ k, value, onChange, disabled, hint }) => (
  <div className="space-y-1">
    <Field
      label={CHANNEL_POLICY_FIELD_LABEL[k] ?? k}
      value={num(value[k])}
      onChange={(v) => {
        const next = { ...value };
        const parsed = parseNum(v);
        if (parsed === undefined) delete next[k];
        else next[k] = parsed;
        onChange(next);
      }}
      placeholder={hint}
    />
    {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
  </div>
);

const BooleanField: React.FC<{
  k: string;
  value: ConfigValue;
  onChange: (next: ConfigValue) => void;
  disabled?: boolean;
}> = ({ k, value, onChange, disabled }) => (
  <div className="flex items-center gap-3">
    <Switch
      checked={Boolean(value[k])}
      disabled={disabled}
      onCheckedChange={(c) => onChange({ ...value, [k]: c })}
    />
    <Label>{CHANNEL_POLICY_FIELD_LABEL[k] ?? k}</Label>
  </div>
);

const CsvField: React.FC<{
  k: string;
  value: ConfigValue;
  onChange: (next: ConfigValue) => void;
  hint: string;
}> = ({ k, value, onChange, hint }) => {
  const arr = Array.isArray(value[k]) ? (value[k] as string[]) : [];
  return (
    <div className="space-y-1">
      <Field
        label={CHANNEL_POLICY_FIELD_LABEL[k] ?? k}
        value={arr.join(', ')}
        onChange={(v) => {
          const parts = v
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          const next = { ...value };
          if (parts.length === 0) next[k] = [];
          else next[k] = parts;
          onChange(next);
        }}
        placeholder={hint}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
};

const CountryControls: React.FC<{
  value: ConfigValue;
  onChange: (next: ConfigValue) => void;
}> = ({ value, onChange }) => (
  <>
    <SelectField
      label={CHANNEL_POLICY_FIELD_LABEL.country_mode}
      value={String(value.country_mode ?? 'unrestricted')}
      onChange={(v) => onChange({ ...value, country_mode: v || 'unrestricted' })}
      options={COUNTRY_MODES.map((m) => ({ value: m, label: m }))}
    />
    <CsvField
      k="country_codes"
      value={value}
      onChange={onChange}
      hint="Two-letter uppercase codes, comma separated (max 50). Unrestricted requires an empty list."
    />
  </>
);

export const ChannelPolicyConfigFields: React.FC<{
  channel: PolicyChannel;
  value: ConfigValue;
  onChange: (next: ConfigValue) => void;
  disabled?: boolean;
}> = ({ channel, value, onChange, disabled }) => {
  const common = { value, onChange, disabled };
  if (channel === 'email') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="omni-comms-policy-config-email">
        <NumberField k="max_attachment_bytes" {...common} hint="0–26214400. Zero means attachments are not permitted." />
        <CsvField
          k="allowed_attachment_extensions"
          value={value}
          onChange={onChange}
          hint="Max 20 lowercase extensions without a dot, e.g. pdf, docx, xlsx, png."
        />
      </div>
    );
  }
  if (channel === 'sms') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="omni-comms-policy-config-sms">
        <CountryControls value={value} onChange={onChange} />
        <NumberField k="max_segments" {...common} hint="1–10. No segmentation is calculated." />
        <BooleanField k="unicode_allowed" {...common} />
      </div>
    );
  }
  if (channel === 'whatsapp') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="omni-comms-policy-config-whatsapp">
        <CountryControls value={value} onChange={onChange} />
        <NumberField k="max_media_bytes" {...common} hint="0–16777216. Zero means media is not permitted by policy." />
        <BooleanField k="inbound_enabled" {...common} />
      </div>
    );
  }
  if (channel === 'push') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="omni-comms-policy-config-push">
        <NumberField k="max_ttl_seconds" {...common} hint="0–2419200. No TTL is enforced." />
        <NumberField k="max_data_payload_bytes" {...common} hint="0–4096." />
      </div>
    );
  }
  if (channel === 'in_app') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="omni-comms-policy-config-in_app">
        <NumberField k="expiry_hours" {...common} hint="1–8760. No record is expired." />
        <SelectField
          label={CHANNEL_POLICY_FIELD_LABEL.acknowledgement_mode}
          value={String(value.acknowledgement_mode ?? '')}
          onChange={(v) => {
            const next = { ...value };
            if (!v) delete next.acknowledgement_mode;
            else next.acknowledgement_mode = v;
            onChange(next);
          }}
          options={ACKNOWLEDGEMENT_MODES.map((m) => ({ value: m, label: m }))}
        />
        <NumberField k="max_visible_per_user" {...common} hint="1–500." />
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="omni-comms-policy-config-print">
      <NumberField k="max_document_bytes" {...common} hint="1–52428800. No PDF is generated." />
      <NumberField k="batch_size_limit" {...common} hint="1–10000. No print job is created." />
      <NumberField k="archive_retention_days" {...common} hint="1–3650. Nothing is archived or deleted." />
    </div>
  );
};

export default ChannelPolicyConfigFields;
