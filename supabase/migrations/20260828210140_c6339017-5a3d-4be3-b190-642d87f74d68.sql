
-- ============================================================
-- DEF-S1B-44 / DEF-S1B-52 — canonical IA communication payload
-- vocabulary + fail-early contract validation + stage traceability
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ia_comms_payload_alias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_code text,                     -- NULL = applies to every IA event
  legacy_key text NOT NULL,
  canonical_key text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ia_comms_payload_alias_uq
  ON public.ia_comms_payload_alias (coalesce(event_code, '*'), legacy_key, canonical_key);

GRANT SELECT ON public.ia_comms_payload_alias TO authenticated;
GRANT ALL ON public.ia_comms_payload_alias TO service_role;

ALTER TABLE public.ia_comms_payload_alias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ia_comms_payload_alias_read ON public.ia_comms_payload_alias;
CREATE POLICY ia_comms_payload_alias_read
  ON public.ia_comms_payload_alias FOR SELECT TO authenticated USING (true);

DROP TRIGGER IF EXISTS ia_comms_payload_alias_touch ON public.ia_comms_payload_alias;
CREATE TRIGGER ia_comms_payload_alias_touch
  BEFORE UPDATE ON public.ia_comms_payload_alias
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.ia_comms_payload_alias (event_code, legacy_key, canonical_key, notes)
VALUES
  (NULL, 'auditTitle',          'engagementTitle', 'DEF-S1B-44'),
  (NULL, 'engagementName',      'engagementTitle', 'DEF-S1B-44'),
  (NULL, 'engagementRef',       'reference',       'DEF-S1B-44'),
  (NULL, 'engagementReference', 'reference',       'DEF-S1B-44'),
  (NULL, 'referenceNo',         'reference',       'DEF-S1B-44'),
  (NULL, 'recipientName',       'subjectName',     'DEF-S1B-44'),
  (NULL, 'planTitle',           'subjectName',     'DEF-S1B-44'),
  (NULL, 'planName',            'planTitle',       'DEF-S1B-44'),
  (NULL, 'question',            'requestSummary',  'DEF-S1B-44'),
  (NULL, 'requestTitle',        'requestSummary',  'DEF-S1B-44'),
  (NULL, 'requestDescription',  'requestSummary',  'DEF-S1B-44'),
  (NULL, 'actionSummary',       'actionTitle',     'DEF-S1B-44'),
  (NULL, 'actionDescription',   'actionTitle',     'DEF-S1B-44'),
  (NULL, 'findingSummary',      'findingTitle',    'DEF-S1B-44'),
  (NULL, 'findingHeadline',     'findingTitle',    'DEF-S1B-44'),
  (NULL, 'severityLevel',       'severity',        'DEF-S1B-44'),
  (NULL, 'riskRating',          'severity',        'DEF-S1B-44'),
  (NULL, 'dueOn',               'dueDate',         'DEF-S1B-44'),
  (NULL, 'responseDueDate',     'dueDate',         'DEF-S1B-44'),
  (NULL, 'raisedDate',          'raisedOn',        'DEF-S1B-44'),
  (NULL, 'startDate',           'plannedStartDate','DEF-S1B-44'),
  (NULL, 'endDate',             'plannedEndDate',  'DEF-S1B-44'),
  (NULL, 'scope',               'scopeSummary',    'DEF-S1B-44'),
  (NULL, 'departmentName',      'auditeeUnit',     'DEF-S1B-44'),
  (NULL, 'auditeeDepartment',   'auditeeUnit',     'DEF-S1B-44'),
  (NULL, 'followupTitle',       'followupSubject', 'DEF-S1B-44'),
  (NULL, 'version',             'versionNumber',   'DEF-S1B-44'),
  (NULL, 'opinion',             'overallOpinion',  'DEF-S1B-44')
ON CONFLICT DO NOTHING;

COMMENT ON TABLE public.ia_comms_payload_alias IS
  'DEF-S1B-44: governed translation from legacy Internal Audit producer keys to the canonical Omni-Comms contract vocabulary. An alias only applies when the canonical key is a contract property and the producer did not already supply it.';

-- ------------------------------------------------------------
-- Canonical projection: alias -> project -> validate
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_comms_contract_project(
  p_event_code text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_code text := upper(btrim(p_event_code));
  v_schema jsonb;
  v_props jsonb;
  v_closed boolean;
  v_in jsonb := coalesce(p_payload, '{}'::jsonb);
  v_work jsonb;
  v_out jsonb := '{}'::jsonb;
  v_missing text[] := '{}';
  v_unsupported text[] := '{}';
  r record;
BEGIN
  SELECT c.json_schema INTO v_schema
  FROM public.omni_comms_event_contract c
  JOIN public.omni_comms_event_definition d ON d.id = c.event_definition_id
  WHERE d.code = v_code AND c.status = 'published'
  ORDER BY c.version_number DESC
  LIMIT 1;

  IF v_schema IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true, 'event_code', v_code, 'payload', v_in,
      'missing_fields', '[]'::jsonb, 'unsupported_fields', '[]'::jsonb,
      'contract', false);
  END IF;

  v_props  := coalesce(v_schema->'properties', '{}'::jsonb);
  v_closed := NOT coalesce((v_schema->>'additionalProperties')::boolean, true);
  v_work   := v_in;

  -- 1) Apply governed aliases (only when target is a contract property and is absent)
  FOR r IN
    SELECT a.legacy_key, a.canonical_key
    FROM public.ia_comms_payload_alias a
    WHERE a.event_code IS NULL OR upper(btrim(a.event_code)) = v_code
    ORDER BY (a.event_code IS NOT NULL) DESC
  LOOP
    IF v_work ? r.legacy_key
       AND v_props ? r.canonical_key
       AND coalesce(nullif(btrim(coalesce(v_work->>r.canonical_key, '')), ''), '') = ''
       AND coalesce(nullif(btrim(coalesce(v_work->>r.legacy_key, '')), ''), '') <> ''
    THEN
      v_work := (v_work - r.canonical_key)
                || jsonb_build_object(r.canonical_key, v_work->r.legacy_key);
    END IF;
  END LOOP;

  -- 2) Project onto contract properties (only for closed contracts)
  IF v_closed THEN
    SELECT coalesce(jsonb_object_agg(k, v), '{}'::jsonb) INTO v_out
    FROM jsonb_each(v_work) e(k, v)
    WHERE v_props ? k;

    SELECT coalesce(array_agg(k ORDER BY k), '{}') INTO v_unsupported
    FROM jsonb_each(v_work) e(k, v)
    WHERE NOT (v_props ? k);
  ELSE
    v_out := v_work;
  END IF;

  -- 3) Required-field validation on the projected payload
  SELECT coalesce(array_agg(x ORDER BY x), '{}') INTO v_missing
  FROM jsonb_array_elements_text(coalesce(v_schema->'required', '[]'::jsonb)) x
  WHERE NOT (v_out ? x)
     OR v_out->>x IS NULL
     OR btrim(coalesce(v_out->>x, '')) = '';

  RETURN jsonb_build_object(
    'ok', (array_length(v_missing, 1) IS NULL),
    'event_code', v_code,
    'payload', v_out,
    'missing_fields', to_jsonb(v_missing),
    'unsupported_fields', to_jsonb(v_unsupported),
    'contract', true
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ia_comms_contract_project(text, jsonb) TO authenticated, service_role;

-- Backwards-compatible projection helper (non-raising)
CREATE OR REPLACE FUNCTION public.ia_comms_contract_payload(
  p_event_code text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.ia_comms_contract_project(p_event_code, p_payload)->'payload';
$function$;

-- ------------------------------------------------------------
-- ia_comms_emit — fail early, never silently strip
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_comms_emit(
  p_event_code text,
  p_entity_type text,
  p_entity_id text,
  p_occurrence text,
  p_recipient_facts jsonb,
  p_payload jsonb,
  p_correlation_id text DEFAULT NULL::text,
  p_department_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_dept uuid;
  v_proj jsonb;
BEGIN
  IF coalesce(jsonb_typeof(p_recipient_facts), 'null') <> 'object'
     OR p_recipient_facts = '{}'::jsonb THEN
    RETURN jsonb_build_object(
      'status','blocked',
      'reason','recipient_resolution_failed',
      'code','IA_COMMS_RECIPIENT_REQUIRED',
      'event_code', upper(btrim(p_event_code)));
  END IF;

  v_proj := public.ia_comms_contract_project(p_event_code, coalesce(p_payload, '{}'::jsonb));

  IF NOT coalesce((v_proj->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object(
      'status','blocked',
      'reason','contract_required_field_missing',
      'code','IA_COMMS_CONTRACT_REQUIRED_FIELD_MISSING',
      'event_code', v_proj->>'event_code',
      'missing_fields', v_proj->'missing_fields',
      'unsupported_fields', v_proj->'unsupported_fields');
  END IF;

  v_dept := p_department_id;
  IF v_dept IS NULL THEN
    SELECT d.id INTO v_dept
    FROM public.core_department d
    WHERE d.code = 'INTERNAL_AUDIT'
    LIMIT 1;
  END IF;

  v_result := public.omni_comms_priv_enqueue_business_event(
    NULL,
    'INTERNAL_AUDIT',
    upper(btrim(p_event_code)),
    p_entity_type,
    p_entity_id,
    coalesce(nullif(btrim(p_occurrence), ''), 'default'),
    NULL,
    v_dept,
    p_recipient_facts,
    v_proj->'payload',
    p_correlation_id
  );

  RETURN v_result || jsonb_build_object('status', coalesce(v_result->>'status','queued'));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'status','failed',
    'code','IA_COMMS_OBLIGATION_CREATION_FAILED',
    'event_code', upper(btrim(p_event_code)),
    'reason', SQLERRM);
END;
$function$;

-- ------------------------------------------------------------
-- DEF-S1B-52 — narrow traceability on the operator timeline
-- ------------------------------------------------------------
ALTER TABLE public.ia_communication_stages
  ADD COLUMN IF NOT EXISTS event_code text,
  ADD COLUMN IF NOT EXISTS occurrence text,
  ADD COLUMN IF NOT EXISTS omni_comms_request_id uuid,
  ADD COLUMN IF NOT EXISTS event_outbox_id uuid,
  ADD COLUMN IF NOT EXISTS communication_state text;

CREATE INDEX IF NOT EXISTS ia_communication_stages_request_idx
  ON public.ia_communication_stages (omni_comms_request_id);
CREATE INDEX IF NOT EXISTS ia_communication_stages_outbox_idx
  ON public.ia_communication_stages (event_outbox_id);

COMMENT ON COLUMN public.ia_communication_stages.omni_comms_request_id IS
  'DEF-S1B-52: canonical Omni-Comms request produced by this business stage. Reference only — provider payloads are never copied here.';
