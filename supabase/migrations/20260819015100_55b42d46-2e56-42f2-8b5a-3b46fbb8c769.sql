CREATE TABLE IF NOT EXISTS public.omni_comms_template_provider_registration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  template_version_id uuid NOT NULL
    REFERENCES public.omni_comms_template_version(id) ON DELETE CASCADE,
  provider_account_id uuid NOT NULL
    REFERENCES public.omni_comms_provider_account(id) ON DELETE CASCADE,
  adapter_key text NOT NULL,
  provider_template_ref text,
  provider_status text NOT NULL DEFAULT 'draft'
    CHECK (provider_status IN ('draft','submitted','approved','rejected','disabled')),
  provider_language text NOT NULL DEFAULT 'en',
  provider_category text NOT NULL DEFAULT 'utility'
    CHECK (provider_category IN ('utility','authentication','marketing')),
  variable_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  rejection_code text,
  rejection_reason text,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  UNIQUE (template_version_id, provider_account_id)
);

GRANT SELECT ON public.omni_comms_template_provider_registration TO authenticated;
GRANT ALL ON public.omni_comms_template_provider_registration TO service_role;

ALTER TABLE public.omni_comms_template_provider_registration ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS omni_comms_tpr_read ON public.omni_comms_template_provider_registration;
CREATE POLICY omni_comms_tpr_read
  ON public.omni_comms_template_provider_registration
  FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'omni_comms', 'view'));

CREATE INDEX IF NOT EXISTS omni_comms_tpr_version_idx
  ON public.omni_comms_template_provider_registration (template_version_id);

COMMENT ON TABLE public.omni_comms_template_provider_registration IS
  'Provider registration metadata for a template version (e.g. Twilio ContentSid). Never business content.';

-- Deterministic canonical-token -> positional variable mapping.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_build_variable_mapping(
  p_channel text, p_content jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_order text[] := ARRAY['header','body','footer','media_url','button_label','button_url'];
  v_key text; v_tok text;
  v_seen text[] := ARRAY[]::text[];
  v_out jsonb := '{}'::jsonb;
  v_pos int := 0;
BEGIN
  IF p_content IS NULL THEN RETURN v_out; END IF;
  FOREACH v_key IN ARRAY v_order LOOP
    IF NOT (p_content ? v_key) THEN CONTINUE; END IF;
    FOREACH v_tok IN ARRAY public.omni_comms_priv_extract_tokens(p_content ->> v_key) LOOP
      IF v_tok = ANY(v_seen) THEN CONTINUE; END IF;
      v_seen := v_seen || v_tok;
      v_pos := v_pos + 1;
      v_out := v_out || jsonb_build_object(v_pos::text, v_tok);
    END LOOP;
  END LOOP;
  RETURN v_out;
END; $function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_build_variable_mapping(text,jsonb) FROM public;

CREATE OR REPLACE FUNCTION public.omni_comms_template_provider_registration_upsert(
  p_template_version_id uuid,
  p_provider_account_id uuid,
  p_provider_language text DEFAULT 'en',
  p_provider_category text DEFAULT 'utility',
  p_correlation_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid; v_ver public.omni_comms_template_version;
  v_acct public.omni_comms_provider_account; v_adapter text;
  v_row public.omni_comms_template_provider_registration; v_map jsonb;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('author_templates');
  SELECT * INTO v_ver FROM public.omni_comms_template_version WHERE id = p_template_version_id;
  IF v_ver.id IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='template_version_not_found'; END IF;
  SELECT * INTO v_acct FROM public.omni_comms_provider_account WHERE id = p_provider_account_id;
  IF v_acct.id IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='provider_account_not_found'; END IF;
  SELECT COALESCE(p.adapter_key, p.code) INTO v_adapter
    FROM public.omni_comms_provider p WHERE p.id = v_acct.provider_id;

  v_map := public.omni_comms_priv_build_variable_mapping(v_ver.channel, v_ver.content);

  INSERT INTO public.omni_comms_template_provider_registration (
    organization_id, template_version_id, provider_account_id, adapter_key,
    provider_language, provider_category, variable_mapping, created_by, updated_by)
  VALUES (
    v_acct.organization_id, p_template_version_id, p_provider_account_id, v_adapter,
    COALESCE(NULLIF(btrim(p_provider_language),''),'en'),
    COALESCE(NULLIF(btrim(p_provider_category),''),'utility'), v_map, v_uid, v_uid)
  ON CONFLICT (template_version_id, provider_account_id) DO UPDATE
    SET provider_language = EXCLUDED.provider_language,
        provider_category = EXCLUDED.provider_category,
        variable_mapping = CASE
          WHEN public.omni_comms_template_provider_registration.provider_status = 'approved'
          THEN public.omni_comms_template_provider_registration.variable_mapping
          ELSE EXCLUDED.variable_mapping END,
        updated_at = now(), updated_by = v_uid
  RETURNING * INTO v_row;

  PERFORM public.omni_comms_priv_write_template_audit(
    v_uid, 'register_provider_template', 'template_provider_registration', v_row.id,
    v_adapter || ':' || v_ver.channel, NULL,
    jsonb_build_object('provider_status', v_row.provider_status,
                       'variable_mapping', v_row.variable_mapping),
    NULL, NULL, p_correlation_id);

  RETURN to_jsonb(v_row);
END; $function$;

CREATE OR REPLACE FUNCTION public.omni_comms_template_provider_registration_submit(
  p_id uuid, p_provider_template_ref text, p_correlation_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_uid uuid; v_row public.omni_comms_template_provider_registration; v_ref text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('author_templates');
  v_ref := NULLIF(btrim(COALESCE(p_provider_template_ref,'')),'');
  SELECT * INTO v_row FROM public.omni_comms_template_provider_registration WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='registration_not_found'; END IF;
  IF v_row.provider_status = 'approved' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING ERRCODE='P0001', DETAIL='registration_already_approved'; END IF;
  IF v_row.adapter_key = 'twilio_whatsapp' AND v_ref IS NOT NULL AND v_ref !~ '^HX[0-9a-fA-F]{32}$' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='provider_template_ref_invalid'; END IF;

  UPDATE public.omni_comms_template_provider_registration
     SET provider_status='submitted', provider_template_ref = COALESCE(v_ref, provider_template_ref),
         submitted_at = now(), rejected_at = NULL, rejection_code = NULL, rejection_reason = NULL,
         updated_at = now(), updated_by = v_uid
   WHERE id = p_id RETURNING * INTO v_row;

  PERFORM public.omni_comms_priv_write_template_audit(
    v_uid, 'submit', 'template_provider_registration', v_row.id, v_row.adapter_key,
    NULL, jsonb_build_object('provider_status','submitted'), NULL, NULL, p_correlation_id);
  RETURN to_jsonb(v_row);
END; $function$;

CREATE OR REPLACE FUNCTION public.omni_comms_template_provider_registration_approve(
  p_id uuid, p_provider_template_ref text, p_correlation_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_uid uuid; v_row public.omni_comms_template_provider_registration; v_ref text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('approve_templates');
  SELECT * INTO v_row FROM public.omni_comms_template_provider_registration WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='registration_not_found'; END IF;
  v_ref := NULLIF(btrim(COALESCE(p_provider_template_ref, v_row.provider_template_ref, '')),'');
  IF v_ref IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='provider_template_ref_required'; END IF;
  IF v_row.adapter_key = 'twilio_whatsapp' AND v_ref !~ '^HX[0-9a-fA-F]{32}$' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='provider_template_ref_invalid'; END IF;

  UPDATE public.omni_comms_template_provider_registration
     SET provider_status='approved', provider_template_ref = v_ref, approved_at = now(),
         rejected_at = NULL, rejection_code = NULL, rejection_reason = NULL,
         last_checked_at = now(), updated_at = now(), updated_by = v_uid
   WHERE id = p_id RETURNING * INTO v_row;

  PERFORM public.omni_comms_priv_write_template_audit(
    v_uid, 'approve', 'template_provider_registration', v_row.id, v_row.adapter_key,
    NULL, jsonb_build_object('provider_status','approved'), NULL, NULL, p_correlation_id);
  RETURN to_jsonb(v_row);
END; $function$;

CREATE OR REPLACE FUNCTION public.omni_comms_template_provider_registration_reject(
  p_id uuid, p_rejection_code text, p_rejection_reason text, p_correlation_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_uid uuid; v_row public.omni_comms_template_provider_registration;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('approve_templates');
  IF COALESCE(btrim(p_rejection_code),'') = '' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='rejection_code_required'; END IF;
  UPDATE public.omni_comms_template_provider_registration
     SET provider_status='rejected', rejected_at = now(), approved_at = NULL,
         rejection_code = left(btrim(p_rejection_code),80),
         rejection_reason = left(COALESCE(btrim(p_rejection_reason),''),1000),
         last_checked_at = now(), updated_at = now(), updated_by = v_uid
   WHERE id = p_id RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='registration_not_found'; END IF;
  PERFORM public.omni_comms_priv_write_template_audit(
    v_uid, 'reject', 'template_provider_registration', v_row.id, v_row.adapter_key,
    NULL, jsonb_build_object('provider_status','rejected','code',v_row.rejection_code),
    NULL, NULL, p_correlation_id);
  RETURN to_jsonb(v_row);
END; $function$;

CREATE OR REPLACE FUNCTION public.omni_comms_template_provider_registration_list(
  p_template_version_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_items jsonb;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at), '[]'::jsonb) INTO v_items
    FROM public.omni_comms_template_provider_registration r
   WHERE r.template_version_id = p_template_version_id;
  RETURN jsonb_build_object('items', v_items);
END; $function$;

REVOKE ALL ON FUNCTION public.omni_comms_template_provider_registration_upsert(uuid,uuid,text,text,text) FROM public;
REVOKE ALL ON FUNCTION public.omni_comms_template_provider_registration_submit(uuid,text,text) FROM public;
REVOKE ALL ON FUNCTION public.omni_comms_template_provider_registration_approve(uuid,text,text) FROM public;
REVOKE ALL ON FUNCTION public.omni_comms_template_provider_registration_reject(uuid,text,text,text) FROM public;
REVOKE ALL ON FUNCTION public.omni_comms_template_provider_registration_list(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.omni_comms_template_provider_registration_upsert(uuid,uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_template_provider_registration_submit(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_template_provider_registration_approve(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_template_provider_registration_reject(uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_template_provider_registration_list(uuid) TO authenticated;

-- Trusted system bootstrap evidence for the seeded twilio_whatsapp provider.
INSERT INTO public.core_audit_log (
  event_code, event_name, event_category, severity, risk_level,
  module_code, domain_code, entity_type, entity_id, entity_display_name,
  action, outcome, after_value, notes, source, source_component)
SELECT
  'OMNI_COMMS.PROVIDER.SYSTEM_BOOTSTRAP', 'system_bootstrap', 'configuration', 'info', 'low',
  'OMNI_COMMS', 'providers', 'provider', p.id::text, p.code,
  'system_bootstrap', 'success',
  jsonb_build_object('status', p.status, 'classification', 'trusted_system_bootstrap'),
  'Initial twilio_whatsapp provider activation is a trusted system bootstrap, not an operator-governed lifecycle transition.',
  'migration', 'omni_comms_pre_release_correction'
FROM public.omni_comms_provider p
WHERE p.code = 'twilio_whatsapp';