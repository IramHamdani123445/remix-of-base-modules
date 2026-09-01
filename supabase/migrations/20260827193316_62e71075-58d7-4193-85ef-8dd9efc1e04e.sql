-- ────────────────────────────────────────────────────────────────────────────
-- DEF-3 — Governed Omni-Comms attachment contract
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.omni_comms_attachment_bucket_policy (
  storage_bucket text PRIMARY KEY,
  is_enabled boolean NOT NULL DEFAULT true,
  max_byte_size bigint NOT NULL DEFAULT 10485760,
  allowed_content_types text[] NOT NULL DEFAULT ARRAY['application/pdf','image/png','image/jpeg','text/csv'],
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.omni_comms_channel_attachment_policy (
  channel text PRIMARY KEY,
  supports_attachments boolean NOT NULL DEFAULT false,
  max_attachments integer NOT NULL DEFAULT 0,
  max_total_bytes bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.omni_comms_attachment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  department_id uuid,
  owner_module_code text NOT NULL,
  source_entity_type text NOT NULL,
  source_entity_id text NOT NULL,
  storage_bucket text NOT NULL REFERENCES public.omni_comms_attachment_bucket_policy(storage_bucket),
  storage_path text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  byte_size bigint NOT NULL,
  checksum_sha256 text NOT NULL,
  classification text NOT NULL DEFAULT 'internal',
  version_number integer NOT NULL DEFAULT 1,
  supersedes_attachment_id uuid REFERENCES public.omni_comms_attachment(id),
  status text NOT NULL DEFAULT 'registered',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  retired_at timestamptz,
  retired_by uuid,
  retirement_reason text,
  CONSTRAINT omni_comms_attachment_status_chk
    CHECK (status IN ('registered','quarantined','retired')),
  CONSTRAINT omni_comms_attachment_classification_chk
    CHECK (classification IN ('public','internal','confidential','restricted')),
  CONSTRAINT omni_comms_attachment_checksum_chk
    CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT omni_comms_attachment_size_chk
    CHECK (byte_size > 0 AND byte_size <= 26214400),
  CONSTRAINT omni_comms_attachment_name_chk
    CHECK (length(file_name) BETWEEN 1 AND 200 AND file_name !~ '[/\\]'),
  CONSTRAINT omni_comms_attachment_path_chk
    CHECK (length(storage_path) BETWEEN 1 AND 1024 AND storage_path !~ '\.\.')
);

CREATE UNIQUE INDEX IF NOT EXISTS omni_comms_attachment_identity_uk
  ON public.omni_comms_attachment (organization_id, storage_bucket, storage_path, checksum_sha256);
CREATE INDEX IF NOT EXISTS omni_comms_attachment_source_ix
  ON public.omni_comms_attachment (organization_id, source_entity_type, source_entity_id);

CREATE TABLE IF NOT EXISTS public.omni_comms_request_attachment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.omni_comms_request(id) ON DELETE CASCADE,
  attachment_id uuid NOT NULL REFERENCES public.omni_comms_attachment(id),
  ordinal integer NOT NULL,
  disposition text NOT NULL DEFAULT 'attachment',
  required_for_delivery boolean NOT NULL DEFAULT false,
  pinned_checksum_sha256 text NOT NULL,
  pinned_byte_size bigint NOT NULL,
  pinned_file_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT omni_comms_request_attachment_disposition_chk
    CHECK (disposition IN ('attachment','inline')),
  CONSTRAINT omni_comms_request_attachment_ordinal_chk CHECK (ordinal BETWEEN 1 AND 20)
);

CREATE UNIQUE INDEX IF NOT EXISTS omni_comms_request_attachment_uk
  ON public.omni_comms_request_attachment (request_id, attachment_id);
CREATE UNIQUE INDEX IF NOT EXISTS omni_comms_request_attachment_ordinal_uk
  ON public.omni_comms_request_attachment (request_id, ordinal);

CREATE TABLE IF NOT EXISTS public.omni_comms_message_attachment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.omni_comms_message(id) ON DELETE CASCADE,
  request_attachment_id uuid NOT NULL REFERENCES public.omni_comms_request_attachment(id) ON DELETE CASCADE,
  attachment_id uuid NOT NULL REFERENCES public.omni_comms_attachment(id),
  channel text NOT NULL,
  ordinal integer NOT NULL,
  outcome text NOT NULL,
  outcome_reason text,
  checksum_sha256 text NOT NULL,
  byte_size bigint NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT omni_comms_message_attachment_outcome_chk
    CHECK (outcome IN ('included','dropped','blocked'))
);

CREATE UNIQUE INDEX IF NOT EXISTS omni_comms_message_attachment_uk
  ON public.omni_comms_message_attachment (message_id, request_attachment_id);

ALTER TABLE public.omni_comms_attachment_bucket_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omni_comms_channel_attachment_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omni_comms_attachment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omni_comms_request_attachment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omni_comms_message_attachment ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.omni_comms_attachment_bucket_policy FROM anon, authenticated;
REVOKE ALL ON public.omni_comms_channel_attachment_policy FROM anon, authenticated;
REVOKE ALL ON public.omni_comms_attachment FROM anon, authenticated;
REVOKE ALL ON public.omni_comms_request_attachment FROM anon, authenticated;
REVOKE ALL ON public.omni_comms_message_attachment FROM anon, authenticated;

GRANT ALL ON public.omni_comms_attachment_bucket_policy TO service_role;
GRANT ALL ON public.omni_comms_channel_attachment_policy TO service_role;
GRANT ALL ON public.omni_comms_attachment TO service_role;
GRANT ALL ON public.omni_comms_request_attachment TO service_role;
GRANT ALL ON public.omni_comms_message_attachment TO service_role;

INSERT INTO public.omni_comms_attachment_bucket_policy (storage_bucket, max_byte_size, allowed_content_types, notes)
VALUES
  ('ia-artifacts', 10485760, ARRAY['application/pdf','image/png','image/jpeg','text/csv'], 'Internal Audit governed artefacts'),
  ('ia-evidence', 10485760, ARRAY['application/pdf','image/png','image/jpeg','text/csv'], 'Internal Audit evidence'),
  ('audit-attachments', 10485760, ARRAY['application/pdf','image/png','image/jpeg','text/csv'], 'Audit correspondence attachments'),
  ('core-documents', 10485760, ARRAY['application/pdf'], 'Official generated documents')
ON CONFLICT (storage_bucket) DO NOTHING;

INSERT INTO public.omni_comms_channel_attachment_policy (channel, supports_attachments, max_attachments, max_total_bytes)
VALUES
  ('email', true, 10, 20971520),
  ('sms', false, 0, 0),
  ('whatsapp', false, 0, 0),
  ('push', false, 0, 0),
  ('in_app', false, 0, 0),
  ('print', false, 0, 0),
  ('voice', false, 0, 0),
  ('webhook', false, 0, 0)
ON CONFLICT (channel) DO NOTHING;

-- ── Registration (authenticated, governed) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.omni_comms_register_attachment(
  p_organization_id uuid,
  p_owner_module_code text,
  p_source_entity_type text,
  p_source_entity_id text,
  p_storage_bucket text,
  p_storage_path text,
  p_file_name text,
  p_content_type text,
  p_byte_size bigint,
  p_checksum_sha256 text,
  p_classification text DEFAULT 'internal',
  p_department_id uuid DEFAULT NULL,
  p_supersedes_attachment_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy public.omni_comms_attachment_bucket_policy%ROWTYPE;
  v_existing public.omni_comms_attachment%ROWTYPE;
  v_id uuid;
  v_version integer := 1;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_authenticated');
  END IF;

  SELECT * INTO v_policy
  FROM public.omni_comms_attachment_bucket_policy
  WHERE storage_bucket = p_storage_bucket AND is_enabled;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'attachment_bucket_not_allowed');
  END IF;

  IF p_content_type IS NULL OR NOT (p_content_type = ANY (v_policy.allowed_content_types)) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'attachment_content_type_not_allowed');
  END IF;

  IF p_byte_size IS NULL OR p_byte_size <= 0 OR p_byte_size > v_policy.max_byte_size THEN
    RETURN jsonb_build_object('ok', false, 'code', 'attachment_too_large');
  END IF;

  IF p_checksum_sha256 IS NULL OR p_checksum_sha256 !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'attachment_checksum_invalid');
  END IF;

  IF p_organization_id IS NULL OR p_owner_module_code IS NULL
     OR p_source_entity_type IS NULL OR p_source_entity_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'attachment_source_required');
  END IF;

  -- Idempotent identity: same org + bucket + path + content ⇒ same attachment.
  SELECT * INTO v_existing
  FROM public.omni_comms_attachment
  WHERE organization_id = p_organization_id
    AND storage_bucket = p_storage_bucket
    AND storage_path = p_storage_path
    AND checksum_sha256 = p_checksum_sha256;
  IF FOUND THEN
    IF v_existing.status <> 'registered' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'attachment_not_available');
    END IF;
    RETURN jsonb_build_object(
      'ok', true, 'attachment_id', v_existing.id,
      'version_number', v_existing.version_number, 'replayed', true
    );
  END IF;

  IF p_supersedes_attachment_id IS NOT NULL THEN
    SELECT version_number + 1 INTO v_version
    FROM public.omni_comms_attachment
    WHERE id = p_supersedes_attachment_id AND organization_id = p_organization_id;
    IF v_version IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'attachment_predecessor_invalid');
    END IF;
  END IF;

  INSERT INTO public.omni_comms_attachment (
    organization_id, department_id, owner_module_code, source_entity_type,
    source_entity_id, storage_bucket, storage_path, file_name, content_type,
    byte_size, checksum_sha256, classification, version_number,
    supersedes_attachment_id, created_by
  ) VALUES (
    p_organization_id, p_department_id, p_owner_module_code, p_source_entity_type,
    p_source_entity_id, p_storage_bucket, p_storage_path, p_file_name, p_content_type,
    p_byte_size, p_checksum_sha256, COALESCE(p_classification, 'internal'), v_version,
    p_supersedes_attachment_id, auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'attachment_id', v_id, 'version_number', v_version, 'replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_register_attachment(uuid,text,text,text,text,text,text,text,bigint,text,text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_register_attachment(uuid,text,text,text,text,text,text,text,bigint,text,text,uuid,uuid) TO authenticated, service_role;

-- ── Pinning onto a request (trusted runtime only) ──────────────────────────
CREATE OR REPLACE FUNCTION public.omni_comms_priv_attach_request_attachments(
  p_request_id uuid,
  p_organization_id uuid,
  p_attachments jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_att public.omni_comms_attachment%ROWTYPE;
  v_ordinal integer := 0;
  v_pinned integer := 0;
  v_total bigint := 0;
BEGIN
  IF p_attachments IS NULL OR jsonb_typeof(p_attachments) <> 'array'
     OR jsonb_array_length(p_attachments) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'pinned', 0);
  END IF;

  IF jsonb_array_length(p_attachments) > 20 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'attachment_limit_exceeded');
  END IF;

  -- Replay-safe: an already-pinned request keeps its original manifest.
  IF EXISTS (SELECT 1 FROM public.omni_comms_request_attachment WHERE request_id = p_request_id) THEN
    SELECT count(*) INTO v_pinned FROM public.omni_comms_request_attachment WHERE request_id = p_request_id;
    RETURN jsonb_build_object('ok', true, 'pinned', v_pinned, 'replayed', true);
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_attachments)
  LOOP
    v_ordinal := v_ordinal + 1;
    SELECT * INTO v_att
    FROM public.omni_comms_attachment
    WHERE id = (v_item->>'attachment_id')::uuid
      AND organization_id = p_organization_id
      AND status = 'registered';
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'code', 'attachment_not_available');
    END IF;

    v_total := v_total + v_att.byte_size;

    INSERT INTO public.omni_comms_request_attachment (
      request_id, attachment_id, ordinal, disposition, required_for_delivery,
      pinned_checksum_sha256, pinned_byte_size, pinned_file_name
    ) VALUES (
      p_request_id, v_att.id, v_ordinal,
      COALESCE(v_item->>'disposition', 'attachment'),
      COALESCE((v_item->>'required_for_delivery')::boolean, false),
      v_att.checksum_sha256, v_att.byte_size, v_att.file_name
    );
    v_pinned := v_pinned + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'pinned', v_pinned, 'total_bytes', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_attach_request_attachments(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_attach_request_attachments(uuid,uuid,jsonb) TO service_role;

-- ── Per-message channel resolution (trusted runtime only) ──────────────────
CREATE OR REPLACE FUNCTION public.omni_comms_priv_resolve_message_attachments(
  p_message_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_msg public.omni_comms_message%ROWTYPE;
  v_policy public.omni_comms_channel_attachment_policy%ROWTYPE;
  v_row record;
  v_included integer := 0;
  v_dropped integer := 0;
  v_blocked integer := 0;
  v_bytes bigint := 0;
  v_outcome text;
  v_reason text;
BEGIN
  SELECT * INTO v_msg FROM public.omni_comms_message WHERE id = p_message_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'message_not_found');
  END IF;

  SELECT * INTO v_policy FROM public.omni_comms_channel_attachment_policy WHERE channel = v_msg.channel;
  IF NOT FOUND THEN
    v_policy.supports_attachments := false;
    v_policy.max_attachments := 0;
    v_policy.max_total_bytes := 0;
  END IF;

  DELETE FROM public.omni_comms_message_attachment WHERE message_id = p_message_id;

  FOR v_row IN
    SELECT ra.*, a.content_type
    FROM public.omni_comms_request_attachment ra
    JOIN public.omni_comms_attachment a ON a.id = ra.attachment_id
    WHERE ra.request_id = v_msg.request_id
    ORDER BY ra.ordinal
  LOOP
    v_reason := NULL;
    IF NOT v_policy.supports_attachments THEN
      v_outcome := CASE WHEN v_row.required_for_delivery THEN 'blocked' ELSE 'dropped' END;
      v_reason := 'channel_does_not_support_attachments';
    ELSIF v_included >= v_policy.max_attachments THEN
      v_outcome := CASE WHEN v_row.required_for_delivery THEN 'blocked' ELSE 'dropped' END;
      v_reason := 'attachment_count_limit';
    ELSIF v_bytes + v_row.pinned_byte_size > v_policy.max_total_bytes THEN
      v_outcome := CASE WHEN v_row.required_for_delivery THEN 'blocked' ELSE 'dropped' END;
      v_reason := 'attachment_size_limit';
    ELSE
      v_outcome := 'included';
      v_bytes := v_bytes + v_row.pinned_byte_size;
    END IF;

    INSERT INTO public.omni_comms_message_attachment (
      message_id, request_attachment_id, attachment_id, channel, ordinal,
      outcome, outcome_reason, checksum_sha256, byte_size, file_name, content_type
    ) VALUES (
      p_message_id, v_row.id, v_row.attachment_id, v_msg.channel, v_row.ordinal,
      v_outcome, v_reason, v_row.pinned_checksum_sha256, v_row.pinned_byte_size,
      v_row.pinned_file_name, v_row.content_type
    );

    IF v_outcome = 'included' THEN v_included := v_included + 1;
    ELSIF v_outcome = 'dropped' THEN v_dropped := v_dropped + 1;
    ELSE v_blocked := v_blocked + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', v_blocked = 0,
    'code', CASE WHEN v_blocked > 0 THEN 'attachment_required_unsupported' ELSE NULL END,
    'included', v_included, 'dropped', v_dropped, 'blocked', v_blocked,
    'total_bytes', v_bytes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_resolve_message_attachments(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_resolve_message_attachments(uuid) TO service_role;

-- ── Dispatch manifest (trusted dispatcher only) ────────────────────────────
CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_attachment_manifest(
  p_message_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'ordinal', ma.ordinal,
           'file_name', ma.file_name,
           'content_type', ma.content_type,
           'byte_size', ma.byte_size,
           'checksum_sha256', ma.checksum_sha256,
           'storage_bucket', a.storage_bucket,
           'storage_path', a.storage_path,
           'disposition', ra.disposition,
           'required_for_delivery', ra.required_for_delivery
         ) ORDER BY ma.ordinal), '[]'::jsonb)
  FROM public.omni_comms_message_attachment ma
  JOIN public.omni_comms_attachment a ON a.id = ma.attachment_id
  JOIN public.omni_comms_request_attachment ra ON ra.id = ma.request_attachment_id
  WHERE ma.message_id = p_message_id
    AND ma.outcome = 'included';
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_dispatch_attachment_manifest(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_dispatch_attachment_manifest(uuid) TO service_role;

-- ── Evidence read model (authenticated, bounded, no storage paths) ─────────
CREATE OR REPLACE FUNCTION public.omni_comms_attachment_evidence(
  p_request_id uuid
)
RETURNS TABLE (
  message_id uuid,
  channel text,
  ordinal integer,
  file_name text,
  content_type text,
  byte_size bigint,
  checksum_sha256 text,
  outcome text,
  outcome_reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ma.message_id, ma.channel, ma.ordinal, ma.file_name, ma.content_type,
         ma.byte_size, ma.checksum_sha256, ma.outcome, ma.outcome_reason
  FROM public.omni_comms_message_attachment ma
  JOIN public.omni_comms_message m ON m.id = ma.message_id
  WHERE m.request_id = p_request_id
    AND auth.uid() IS NOT NULL
  ORDER BY ma.channel, ma.ordinal;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_attachment_evidence(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.omni_comms_attachment_evidence(uuid) TO authenticated, service_role;