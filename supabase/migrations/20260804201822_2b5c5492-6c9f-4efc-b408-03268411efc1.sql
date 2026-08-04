DO $mig$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc
   WHERE proname = 'bn_life_certificate_detail_v1'
     AND pronamespace = 'public'::regnamespace;

  v_def := replace(
    v_def,
    '''evidence_version'', lc.evidence_version,',
    '''evidence_receipt_revision'', lc.evidence_receipt_revision,
                     ''evidence_document'', CASE WHEN lc.evidence_document_snapshot IS NULL THEN NULL
                        ELSE jsonb_build_object(
                          ''file_name'', lc.evidence_document_snapshot->>''file_name'',
                          ''document_type_code'', lc.evidence_document_snapshot->>''document_type_code'',
                          ''mime_type'', lc.evidence_document_snapshot->>''mime_type'',
                          ''file_size'', lc.evidence_document_snapshot->>''file_size'') END,');

  IF position('evidence_receipt_revision' in v_def) = 0 THEN
    RAISE EXCEPTION 'detail patch did not apply';
  END IF;

  EXECUTE v_def;
END $mig$;

REVOKE ALL ON FUNCTION public.bn_life_certificate_detail_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_life_certificate_detail_v1(uuid) TO authenticated, service_role;