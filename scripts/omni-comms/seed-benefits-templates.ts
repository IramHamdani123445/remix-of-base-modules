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
    '  -- Published Email template version (content-addressed).',
    '  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_template_version',
    `                  WHERE template_family_id = v_family AND channel = 'email'`,
    `                    AND locale = ${q(LOCALE)} AND status = 'published'`,
    `                    AND checksum = ${q(contentChecksum)}) THEN`,
    '    UPDATE public.omni_comms_template_version',
    `       SET status = 'retired', retired_at = now(), retired_by = ${q(ACTOR_ID)},`,
    `           retirement_reason = 'Superseded by the generated Benefits letter library',`,
    `           updated_at = now(), updated_by = ${q(ACTOR_ID)}`,
    '     WHERE template_family_id = v_family',
    `       AND channel = 'email' AND locale = ${q(LOCALE)} AND status = 'published';`,
    '    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version',
    '      FROM public.omni_comms_template_version',
    `     WHERE template_family_id = v_family AND channel = 'email' AND locale = ${q(LOCALE)};`,
    '    INSERT INTO public.omni_comms_template_version',
    '      (id, template_family_id, version_number, channel, locale, content, status, checksum,',
    '       approved_at, approved_by, published_at, published_by, created_at, created_by,',
    '       updated_at, updated_by, layout_selection_mode, layout_id, pinned_layout_version_id)',
    `    VALUES (gen_random_uuid(), v_family, v_version, 'email', ${q(LOCALE)},`,
    `       ${q(JSON.stringify(content))}::jsonb, 'published', ${q(contentChecksum)},`,
    `       now(), ${q(ACTOR_ID)}, now(), ${q(ACTOR_ID)}, now(), NULL, now(), ${q(ACTOR_ID)},`,
    `       'pinned', ${q(EMAIL_LAYOUT_ID)}, ${q(EMAIL_LAYOUT_VERSION_ID)});`,
    '  END IF;',
    '',
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
