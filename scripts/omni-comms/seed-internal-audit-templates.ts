/**
 * Generates the idempotent seed payloads registering EVERY Internal Audit
 * communication in the Omni-Comms registries:
 *
 *   caller module → event definition → published event contract →
 *   event-scoped template family → published Email / In-App template
 *   versions → enabled routes → active INTERNAL_AUDIT producer binding.
 *
 * The registry tables are governed (draft-only inserts, no direct UPDATE for
 * application roles), so the payloads are applied through the governed helper
 * `public.omni_comms_priv_seed_internal_audit_event(jsonb)`. That helper is
 * idempotent: published rows are content-addressed by checksum, so re-running
 * with unchanged content is a no-op.
 *
 * Usage:
 *   bun run scripts/omni-comms/seed-internal-audit-templates.ts > /tmp/ia-seed.sql
 */
import './_browser-globals-shim';
import { createHash } from 'node:crypto';
import { INTERNAL_AUDIT_TEMPLATE_ENTRIES } from '../../src/platform/omni-comms/integrations/business/internal-audit/templates/internalAuditTemplateRegistry';

const ORG_ID = '69afc88b-da5c-4f41-a1e7-199e1ee1d416';
const DEPT_ID = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
const ACTOR_ID = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85';
const LOCALE = 'en-US';

const CHANNELS = ['email', 'in_app'] as const;
type SeededChannel = (typeof CHANNELS)[number];

/** Channel → pinned reference layout and sender identity (existing rows). */
const CHANNEL_CONFIG: Record<
  SeededChannel,
  { layoutId: string; layoutVersionId: string; senderIdentityId: string; priority: number }
> = {
  email: {
    layoutId: 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2',
    layoutVersionId: 'cce3a2af-288a-4a60-b6fe-b0369c8084d7',
    senderIdentityId: 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b',
    priority: 100,
  },
  in_app: {
    layoutId: 'bbd4d714-ffb4-411d-8b6c-2ccf16f9270f',
    layoutVersionId: '3c14453d-b1eb-49dd-9180-ed2b09f6b881',
    senderIdentityId: '0657bcdc-50d8-44cb-a860-47fdbcade4df',
    priority: 200,
  },
};

function q(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(',')}}`;
}

const lines: string[] = [
  '-- Internal Audit → Omni-Comms catalogue seed (generated).',
  '-- Source of truth: src/platform/omni-comms/integrations/business/internal-audit/',
  '-- Idempotent: safe to re-run. Never edit by hand — regenerate instead.',
  '',
];

for (const entry of INTERNAL_AUDIT_TEMPLATE_ENTRIES) {
  const code = entry.eventCode;
  const spec = entry.entry;

  const properties: Record<string, unknown> = {};
  for (const t of entry.tokens) properties[t] = { type: 'string', minLength: 1 };
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: [...entry.tokens],
    properties,
  };

  const channels = CHANNELS.filter((channel) => spec.channels.includes(channel)).map((channel) => {
    const variant = entry.variants[channel] as unknown as Record<string, string>;
    const cfg = CHANNEL_CONFIG[channel];
    return {
      channel,
      content: variant,
      checksum: sha256(canonical(variant)),
      layoutId: cfg.layoutId,
      layoutVersionId: cfg.layoutVersionId,
      senderIdentityId: cfg.senderIdentityId,
      priority: cfg.priority,
    };
  });

  const payload = {
    actorId: ACTOR_ID,
    organizationId: ORG_ID,
    departmentId: DEPT_ID,
    locale: LOCALE,
    code,
    name: entry.name,
    description: entry.description,
    familyCode: entry.familyCode,
    communicationClass: spec.communicationClass,
    priority: spec.priority,
    schema,
    schemaChecksum: sha256(canonical(schema)),
    samplePayload: entry.samplePayload,
    channels,
  };

  lines.push(
    `-- ${code} — ${entry.name}`,
    `SELECT public.omni_comms_priv_seed_internal_audit_event(${q(JSON.stringify(payload))}::jsonb);`,
    '',
  );
}

process.stdout.write(lines.join('\n'));
