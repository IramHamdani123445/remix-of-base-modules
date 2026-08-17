/**
 * Generates the idempotent SQL seed that registers EVERY Email-capable
 * Benefits communication in the Omni-Comms registries:
 *
 *   event definition → published event contract → event-scoped template
 *   family → published Email template version → enabled Email route →
 *   active BENEFITS producer binding.
 *
 * Re-runnable: every statement looks the current row up by its natural key
 * and only inserts what is missing. Published template/contract versions are
 * content-addressed by checksum, so re-running with unchanged content is a
 * no-op and changed content publishes the next version and retires the old.
 *
 * Usage: bun run scripts/omni-comms/seed-benefits-templates.ts > /tmp/seed.sql
 */
import './_browser-globals-shim';
import { createHash } from 'node:crypto';
import { BENEFITS_TEMPLATE_ENTRIES } from '../../src/platform/omni-comms/integrations/business/benefits/templates/benefitsTemplateRegistry';

const ORG_ID = '69afc88b-da5c-4f41-a1e7-199e1ee1d416';
const DEPT_ID = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
const ACTOR_ID = '08655ffc-6bb2-4eea-bc5b-502c52cdcf85';
const EMAIL_LAYOUT_ID = 'c0a9d637-b9ee-4162-8b41-6a27493f1cd2';
const EMAIL_LAYOUT_VERSION_ID = 'cce3a2af-288a-4a60-b6fe-b0369c8084d7';
const EMAIL_SENDER_IDENTITY_ID = 'e537f062-b1cd-48d2-be9f-e6a46ebe0b8b';
const LOCALE = 'en-US';

/**
 * Channel → pinned reference layout. Every published template version must
 * carry a layout whose kind matches the channel (LETTER for print, SMS for
 * sms, WHATSAPP for whatsapp, EMAIL for email).
 */
export const SEED_CHANNEL_LAYOUTS: Record<
  string,
  { layoutId: string; layoutVersionId: string }
> = {
  email: { layoutId: EMAIL_LAYOUT_ID, layoutVersionId: EMAIL_LAYOUT_VERSION_ID },
  print: {
    layoutId: 'de5c568a-a51c-496f-b65c-91b39c405c59',
    layoutVersionId: 'a6eed409-0478-4af7-8aa4-2ff22060ea5b',
  },
  sms: {
    layoutId: '51451fdb-725b-4c7f-ae8f-c9f9078064ad',
    layoutVersionId: '87225c40-d929-4c48-9d91-bc0b155a8b0a',
  },
  whatsapp: {
    layoutId: 'df941d25-02ca-44b5-9ab0-a06c8ada73ae',
    layoutVersionId: '3636a3e2-c0a5-4535-abe2-f45184910551',
  },
};

const SEEDED_CHANNELS = ['email', 'print', 'sms', 'whatsapp'] as const;
type SeededChannel = (typeof SEEDED_CHANNELS)[number];

/** Channel-native content, exactly matching each channel's content schema. */
function channelContent(
  entry: (typeof BENEFITS_TEMPLATE_ENTRIES)[number],
  channel: SeededChannel,
): Record<string, string> {
  switch (channel) {
    case 'email':
      return {
        subject: entry.variants.email.subject,
        text: entry.variants.email.text,
        html: entry.variants.email.html,
      };
    case 'print':
      return {
        subject: entry.variants.print.subject,
        text: entry.variants.print.text,
        html: entry.variants.print.html,
      };
    case 'sms':
      return { body: entry.variants.sms.body };
    case 'whatsapp':
      return { body: entry.variants.whatsapp.body };
  }
}

function q(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Deterministic canonical JSON so a checksum only changes when content does. */
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
  '-- Benefits → Omni-Comms email catalogue seed (generated).',
  '-- Source of truth: src/platform/omni-comms/integrations/business/benefits/templates/',
  '-- Idempotent: safe to re-run. Never edit by hand — regenerate instead.',
  '',
];

for (const entry of BENEFITS_TEMPLATE_ENTRIES) {
  const code = entry.registeredEventCode;
  const entityType = code.split('.')[1];
  const familyCode = `bn_${entry.templateFamilyCode}`.slice(0, 60);

  const content = {
    subject: entry.content.subject,
    text: entry.content.text,
    html: entry.content.html,
  };
  const contentChecksum = sha256(canonical(content));

  const properties: Record<string, unknown> = {};
  for (const token of entry.tokens) {
    properties[token] = { type: 'string', minLength: 1 };
  }
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: [...entry.tokens],
    properties,
  };
  const schemaChecksum = sha256(canonical(schema));

  lines.push(
    `-- ${code} — ${entry.name}`,
    'DO $$',
    'DECLARE',
    '  v_event uuid;',
    '  v_family uuid;',
    '  v_version integer;',
    'BEGIN',
    `  SELECT id INTO v_event FROM public.omni_comms_event_definition WHERE code = ${q(code)};`,
    '  IF v_event IS NULL THEN',
    '    v_event := gen_random_uuid();',
    '    INSERT INTO public.omni_comms_event_definition',
    '      (id, code, module_code, entity_type, name, description, communication_class,',
    '       default_priority, status, created_at, created_by, updated_at, updated_by)',
    `    VALUES (v_event, ${q(code)}, 'BENEFITS', ${q(entityType)}, ${q(entry.name)},`,
    `       ${q(entry.description)}, ${q(entry.communicationClass)}, ${q(entry.priority)},`,
    `       'active', now(), ${q(ACTOR_ID)}, now(), ${q(ACTOR_ID)});`,
    '  ELSE',
    '    UPDATE public.omni_comms_event_definition',
    `       SET name = ${q(entry.name)}, description = ${q(entry.description)},`,
    `           communication_class = ${q(entry.communicationClass)},`,
    `           default_priority = ${q(entry.priority)}, status = 'active',`,
    `           updated_at = now(), updated_by = ${q(ACTOR_ID)}`,
    '     WHERE id = v_event;',
    '  END IF;',
    '',
    '  -- Published event contract (content-addressed).',
    '  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_contract',
    `                  WHERE event_definition_id = v_event AND status = 'published'`,
    `                    AND checksum = ${q(schemaChecksum)}) THEN`,
    '    UPDATE public.omni_comms_event_contract',
    `       SET status = 'retired', retired_at = now(), retired_by = ${q(ACTOR_ID)},`,
    `           updated_at = now(), updated_by = ${q(ACTOR_ID)}`,
    `     WHERE event_definition_id = v_event AND status = 'published';`,
    '    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version',
    '      FROM public.omni_comms_event_contract WHERE event_definition_id = v_event;',
    '    INSERT INTO public.omni_comms_event_contract',
    '      (id, event_definition_id, version_number, json_schema, sample_payload, status,',
    '       checksum, published_at, published_by, created_at, created_by, updated_at, updated_by)',
    `    VALUES (gen_random_uuid(), v_event, v_version, ${q(JSON.stringify(schema))}::jsonb,`,
    `       ${q(JSON.stringify(entry.samplePayload))}::jsonb, 'published', ${q(schemaChecksum)},`,
    `       now(), ${q(ACTOR_ID)}, now(), ${q(ACTOR_ID)}, now(), ${q(ACTOR_ID)});`,
    '  END IF;',
    '',
    '  -- Event-scoped template family.',
    '  SELECT id INTO v_family FROM public.omni_comms_template_family',
    `   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;`,
    '  IF v_family IS NULL THEN',
    '    v_family := gen_random_uuid();',
    '    INSERT INTO public.omni_comms_template_family',
    '      (id, code, name, description, scope_type, organization_id, department_id,',
    '       event_definition_id, status, activated_at, activated_by, created_at, created_by,',
    '       updated_at, updated_by)',
    `    VALUES (v_family, ${q(familyCode)}, ${q(entry.name)}, ${q(entry.description)},`,
    `       'event', ${q(ORG_ID)}, NULL, v_event, 'active', now(), ${q(ACTOR_ID)},`,
    `       now(), ${q(ACTOR_ID)}, now(), ${q(ACTOR_ID)});`,
    '  END IF;',
    '',
  );

  // Published channel-native template versions (content-addressed).
  for (const channel of SEEDED_CHANNELS) {
    const variant = channelContent(entry, channel);
    const variantChecksum = sha256(canonical(variant));
    const layout = SEED_CHANNEL_LAYOUTS[channel];
    lines.push(
      `  -- Published ${channel} template version (content-addressed).`,
      '  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version',
      `                  WHERE template_family_id = v_family AND channel = ${q(channel)}`,
      `                    AND locale = ${q(LOCALE)} AND status = 'published'`,
      `                    AND checksum = ${q(variantChecksum)}) THEN`,
      '    UPDATE public.omni_comms_template_version',
      `       SET status = 'retired', retired_at = now(), retired_by = ${q(ACTOR_ID)},`,
      `           retirement_reason = 'Superseded by the generated Benefits template library',`,
      `           updated_at = now(), updated_by = ${q(ACTOR_ID)}`,
      '     WHERE template_family_id = v_family',
      `       AND channel = ${q(channel)} AND locale = ${q(LOCALE)} AND status = 'published';`,
      '    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version',
      '      FROM public.omni_comms_template_version',
      `     WHERE template_family_id = v_family AND channel = ${q(channel)} AND locale = ${q(LOCALE)};`,
      '    INSERT INTO public.omni_comms_template_version',
      '      (id, template_family_id, version_number, channel, locale, content, status, checksum,',
      '       approved_at, approved_by, published_at, published_by, created_at, created_by,',
      '       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)',
      `    VALUES (gen_random_uuid(), v_family, v_version, ${q(channel)}, ${q(LOCALE)},`,
      `       ${q(JSON.stringify(variant))}::jsonb, 'published', ${q(variantChecksum)},`,
      `       now(), ${q(ACTOR_ID)}, now(), ${q(ACTOR_ID)}, now(), NULL, now(), ${q(ACTOR_ID)},`,
      `       'pinned', ${q(layout.layoutId)}, ${q(layout.layoutVersionId)});`,
      '  END IF;',
      '',
    );
  }

  lines.push(
    '  -- Department-scoped Email route.',
    '  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route',
    `                  WHERE event_definition_id = v_event AND channel = 'email'`,
    `                    AND organization_id = ${q(ORG_ID)} AND department_id = ${q(DEPT_ID)}) THEN`,
    '    INSERT INTO public.omni_comms_event_route',
    '      (id, organization_id, department_id, event_definition_id, channel, is_required,',
    '       is_enabled, priority, template_family_id, sender_identity_id,',
    '       sender_resolution_policy, preference_policy, lifecycle_state, created_at,',
    '       created_by, updated_at, updated_by, activated_at, activated_by)',
    `    VALUES (gen_random_uuid(), ${q(ORG_ID)}, ${q(DEPT_ID)}, v_event, 'email', true, true,`,
    `       100, v_family, ${q(EMAIL_SENDER_IDENTITY_ID)}, 'explicit', 'honour', 'active',`,
    `       now(), ${q(ACTOR_ID)}, now(), ${q(ACTOR_ID)}, now(), ${q(ACTOR_ID)});`,
    '  ELSE',
    '    UPDATE public.omni_comms_event_route',
    `       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',`,
    `           updated_at = now(), updated_by = ${q(ACTOR_ID)}`,
    `     WHERE event_definition_id = v_event AND channel = 'email'`,
    `       AND organization_id = ${q(ORG_ID)} AND department_id = ${q(DEPT_ID)};`,
    '  END IF;',
    '',
    '  -- Active BENEFITS producer binding (queued only).',
    '  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding',
    `                  WHERE event_definition_id = v_event AND caller_module_code = 'BENEFITS'`,
    `                    AND organization_id = ${q(ORG_ID)} AND department_id = ${q(DEPT_ID)}) THEN`,
    '    INSERT INTO public.omni_comms_producer_event_binding',
    '      (id, organization_id, department_id, caller_module_code, event_definition_id,',
    '       allowed_modes, status, integration_reference, created_at, created_by, updated_at,',
    '       updated_by, activated_at, activated_by)',
    `    VALUES (gen_random_uuid(), ${q(ORG_ID)}, ${q(DEPT_ID)}, 'BENEFITS', v_event,`,
    `       ARRAY['queued']::text[], 'active', 'emitBenefitsCommunication', now(), ${q(ACTOR_ID)},`,
    `       now(), ${q(ACTOR_ID)}, now(), ${q(ACTOR_ID)});`,
    '  ELSE',
    '    UPDATE public.omni_comms_producer_event_binding',
    `       SET status = 'active', allowed_modes = ARRAY['queued']::text[],`,
    `           activated_at = COALESCE(activated_at, now()),`,
    `           activated_by = COALESCE(activated_by, ${q(ACTOR_ID)}),`,
    `           updated_at = now(), updated_by = ${q(ACTOR_ID)}`,
    `     WHERE event_definition_id = v_event AND caller_module_code = 'BENEFITS'`,
    `       AND organization_id = ${q(ORG_ID)} AND department_id = ${q(DEPT_ID)};`,
    '  END IF;',
    'END $$;',
    '',
  );
}

process.stdout.write(lines.join('\n'));

/*
 * Also emit the deployable seed catalogue consumed by the
 * `omni-comms-benefits-seed` Edge Function. The Edge Function applies the
 * SAME rows with the service role (the SQL file is repository evidence).
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const seedRows = BENEFITS_TEMPLATE_ENTRIES.map((entry) => {
  const code = entry.registeredEventCode;
  const content = {
    subject: entry.content.subject,
    text: entry.content.text,
    html: entry.content.html,
  };
  const properties: Record<string, unknown> = {};
  for (const token of entry.tokens) properties[token] = { type: 'string', minLength: 1 };
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: [...entry.tokens],
    properties,
  };
  return {
    code,
    entityType: code.split('.')[1],
    name: entry.name,
    description: entry.description,
    communicationClass: entry.communicationClass,
    priority: entry.priority,
    familyCode: `bn_${entry.templateFamilyCode}`.slice(0, 60),
    recipientRole: entry.recipientRole,
    tokens: entry.tokens,
    content,
    contentChecksum: sha256(canonical(content)),
    variants: SEEDED_CHANNELS.map((channel) => {
      const variant = channelContent(entry, channel);
      return {
        channel,
        content: variant,
        checksum: sha256(canonical(variant)),
        layoutId: SEED_CHANNEL_LAYOUTS[channel].layoutId,
        layoutVersionId: SEED_CHANNEL_LAYOUTS[channel].layoutVersionId,
      };
    }),
    schema,
    schemaChecksum: sha256(canonical(schema)),
    samplePayload: entry.samplePayload,
  };
});

const outDir = 'supabase/functions/omni-comms-benefits-seed';
mkdirSync(outDir, { recursive: true });
writeFileSync(
  `${outDir}/catalogue.generated.ts`,
  `// GENERATED by scripts/omni-comms/seed-benefits-templates.ts — do not edit.\n` +
    `export const SEED_ORG_ID = ${JSON.stringify(ORG_ID)};\n` +
    `export const SEED_DEPT_ID = ${JSON.stringify(DEPT_ID)};\n` +
    `export const SEED_ACTOR_ID = ${JSON.stringify(ACTOR_ID)};\n` +
    `export const SEED_EMAIL_LAYOUT_ID = ${JSON.stringify(EMAIL_LAYOUT_ID)};\n` +
    `export const SEED_EMAIL_LAYOUT_VERSION_ID = ${JSON.stringify(EMAIL_LAYOUT_VERSION_ID)};\n` +
    `export const SEED_EMAIL_SENDER_IDENTITY_ID = ${JSON.stringify(EMAIL_SENDER_IDENTITY_ID)};\n` +
    `export const SEED_LOCALE = ${JSON.stringify(LOCALE)};\n` +
    `export interface BenefitsSeedRow {\n` +
    `  code: string; entityType: string; name: string; description: string;\n` +
    `  communicationClass: string; priority: string; familyCode: string;\n` +
    `  recipientRole: string; tokens: string[];\n` +
    `  content: { subject: string; text: string; html: string };\n` +
    `  variants: { channel: string; content: Record<string, string>;\n` +
    `    checksum: string; layoutId: string; layoutVersionId: string }[];\n` +
    `  contentChecksum: string; schema: Record<string, unknown>;\n` +
    `  schemaChecksum: string; samplePayload: Record<string, string>;\n` +
    `}\n` +
    `export const BENEFITS_SEED_ROWS: BenefitsSeedRow[] = ${JSON.stringify(seedRows, null, 1)};\n`,
  'utf8',
);
