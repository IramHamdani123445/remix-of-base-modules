/**
 * Generates the idempotent SQL seed registering EVERY Internal Audit
 * communication in the Omni-Comms registries:
 *
 *   caller module → event definition → published event contract →
 *   event-scoped template family → published Email / In-App template
 *   versions → enabled routes → active INTERNAL_AUDIT producer binding.
 *
 * Re-runnable: every statement looks the current row up by its natural key and
 * only inserts what is missing. Published versions are content-addressed by
 * checksum, so re-running with unchanged content is a no-op.
 *
 * Usage: bun run scripts/omni-comms/seed-internal-audit-templates.ts > /tmp/ia-seed.sql
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
  '-- Registered caller module.',
  'INSERT INTO public.omni_comms_caller_module_registry',
  '  (module_code, permission_module, permission_action, is_active, notes)',
  "SELECT 'INTERNAL_AUDIT', 'internal_audit', 'view', true, 'Internal Audit business module.'",
  'WHERE NOT EXISTS (SELECT 1 FROM public.omni_comms_caller_module_registry',
  "                   WHERE module_code = 'INTERNAL_AUDIT');",
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
    `    VALUES (v_event, ${q(code)}, 'INTERNAL_AUDIT', ${q(code.split('.')[1])}, ${q(entry.name)},`,
    `       ${q(entry.description)}, ${q(spec.communicationClass)}, ${q(spec.priority)},`,
    `       'draft', now(), ${q(ACTOR_ID)}, now(), ${q(ACTOR_ID)});`,
    '  END IF;',
    '  UPDATE public.omni_comms_event_definition',
    `     SET name = ${q(entry.name)}, description = ${q(entry.description)},`,
    `         communication_class = ${q(spec.communicationClass)},`,
    `         default_priority = ${q(spec.priority)},`,
    `         status = CASE WHEN status IN ('draft','suspended') THEN 'active' ELSE status END,`,
    `         updated_at = now(), updated_by = ${q(ACTOR_ID)}`,
    '   WHERE id = v_event;',
    '',
    '  -- Published event contract (content-addressed): insert draft, then publish.',
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
    '       checksum, created_at, created_by, updated_at, updated_by)',
    `    VALUES (gen_random_uuid(), v_event, v_version, ${q(JSON.stringify(schema))}::jsonb,`,
    `       ${q(JSON.stringify(entry.samplePayload))}::jsonb, 'draft', ${q(schemaChecksum)},`,
    `       now(), ${q(ACTOR_ID)}, now(), ${q(ACTOR_ID)});`,
    '    UPDATE public.omni_comms_event_contract',
    `       SET status = 'published', published_at = now(), published_by = ${q(ACTOR_ID)},`,
    `           updated_at = now(), updated_by = ${q(ACTOR_ID)}`,
    '     WHERE event_definition_id = v_event AND version_number = v_version;',
    '  END IF;',
    '',
    '  -- Event-scoped template family: insert draft, then activate.',
    '  SELECT id INTO v_family FROM public.omni_comms_template_family',
    `   WHERE event_definition_id = v_event AND status = 'active' LIMIT 1;`,
    '  IF v_family IS NULL THEN',
    '    SELECT id INTO v_family FROM public.omni_comms_template_family',
    `     WHERE event_definition_id = v_event AND status = 'draft' LIMIT 1;`,
    '  END IF;',
    '  IF v_family IS NULL THEN',
    '    v_family := gen_random_uuid();',
    '    INSERT INTO public.omni_comms_template_family',
    '      (id, code, name, description, scope_type, organization_id, department_id,',
    '       event_definition_id, status, created_at, created_by, updated_at, updated_by)',
    `    VALUES (v_family, ${q(entry.familyCode)}, ${q(entry.name)}, ${q(entry.description)},`,
    `       'event', ${q(ORG_ID)}, NULL, v_event, 'draft',`,
    `       now(), ${q(ACTOR_ID)}, now(), ${q(ACTOR_ID)});`,
    '  END IF;',
    '',

    '',
  );

  for (const channel of CHANNELS) {
    if (!spec.channels.includes(channel)) continue;
    const variant = entry.variants[channel] as unknown as Record<string, string>;
    const variantChecksum = sha256(canonical(variant));
    const cfg = CHANNEL_CONFIG[channel];
    lines.push(
      `  -- Published ${channel} template version (content-addressed).`,
      '  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version',
      `                  WHERE template_family_id = v_family AND channel = ${q(channel)}`,
      `                    AND locale = ${q(LOCALE)} AND status = 'published'`,
      `                    AND checksum = ${q(variantChecksum)}) THEN`,
      '    UPDATE public.omni_comms_template_version',
      `       SET status = 'retired', retired_at = now(), retired_by = ${q(ACTOR_ID)},`,
      `           retirement_reason = 'Superseded by the generated Internal Audit template library',`,
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
      `       'pinned', ${q(cfg.layoutId)}, ${q(cfg.layoutVersionId)});`,
      '  END IF;',
      '',
      `  -- Department-scoped ${channel} route.`,
      '  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_event_route',
      `                  WHERE event_definition_id = v_event AND channel = ${q(channel)}`,
      `                    AND organization_id = ${q(ORG_ID)} AND department_id = ${q(DEPT_ID)}) THEN`,
      '    INSERT INTO public.omni_comms_event_route',
      '      (id, organization_id, department_id, event_definition_id, channel, is_required,',
      '       is_enabled, priority, template_family_id, sender_identity_id,',
      '       sender_resolution_policy, preference_policy, lifecycle_state, created_at,',
      '       created_by, updated_at, updated_by, activated_at, activated_by)',
      `    VALUES (gen_random_uuid(), ${q(ORG_ID)}, ${q(DEPT_ID)}, v_event, ${q(channel)}, true, true,`,
      `       ${cfg.priority}, v_family, ${q(cfg.senderIdentityId)}, 'explicit', 'honour', 'active',`,
      `       now(), ${q(ACTOR_ID)}, now(), ${q(ACTOR_ID)}, now(), ${q(ACTOR_ID)});`,
      '  ELSE',
      '    UPDATE public.omni_comms_event_route',
      `       SET template_family_id = v_family, is_enabled = true, lifecycle_state = 'active',`,
      `           updated_at = now(), updated_by = ${q(ACTOR_ID)}`,
      `     WHERE event_definition_id = v_event AND channel = ${q(channel)}`,
      `       AND organization_id = ${q(ORG_ID)} AND department_id = ${q(DEPT_ID)};`,
      '  END IF;',
      '',
    );
  }

  lines.push(
    '  -- Active INTERNAL_AUDIT producer binding (queued only).',
    '  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_producer_event_binding',
    `                  WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'`,
    `                    AND organization_id = ${q(ORG_ID)} AND department_id = ${q(DEPT_ID)}) THEN`,
    '    INSERT INTO public.omni_comms_producer_event_binding',
    '      (id, organization_id, department_id, caller_module_code, event_definition_id,',
    '       allowed_modes, status, integration_reference, created_at, created_by, updated_at,',
    '       updated_by, activated_at, activated_by)',
    `    VALUES (gen_random_uuid(), ${q(ORG_ID)}, ${q(DEPT_ID)}, 'INTERNAL_AUDIT', v_event,`,
    `       ARRAY['queued']::text[], 'active', 'emitInternalAuditCommunication', now(), ${q(ACTOR_ID)},`,
    `       now(), ${q(ACTOR_ID)}, now(), ${q(ACTOR_ID)});`,
    '  ELSE',
    '    UPDATE public.omni_comms_producer_event_binding',
    `       SET status = 'active', allowed_modes = ARRAY['queued']::text[],`,
    `           activated_at = COALESCE(activated_at, now()),`,
    `           activated_by = COALESCE(activated_by, ${q(ACTOR_ID)}),`,
    `           updated_at = now(), updated_by = ${q(ACTOR_ID)}`,
    `     WHERE event_definition_id = v_event AND caller_module_code = 'INTERNAL_AUDIT'`,
    `       AND organization_id = ${q(ORG_ID)} AND department_id = ${q(DEPT_ID)};`,
    '  END IF;',
    'END $$;',
    '',
  );
}

process.stdout.write(lines.join('\n'));
