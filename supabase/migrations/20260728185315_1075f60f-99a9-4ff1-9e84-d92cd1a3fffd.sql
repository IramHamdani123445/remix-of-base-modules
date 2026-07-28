
CREATE OR REPLACE FUNCTION public.core_comm_pilot_migration_dry_run(
  p_organization_id uuid, p_department_id uuid,
  p_letterhead_id uuid, p_signature_id uuid, p_footer_id uuid, p_dept_signature_id uuid,
  p_email_layout_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_lh record; v_sig record; v_ft record; v_dsig record; v_lay record;
BEGIN
  PERFORM public.omni_comms_priv_require_capability('view');
  PERFORM public.core_priv_verify_department_ownership(p_department_id, p_organization_id);
  SELECT id, name, header_html, footer_html INTO v_lh FROM public.comm_letterhead WHERE id = p_letterhead_id;
  SELECT id, name, html_signature INTO v_sig FROM public.comm_email_signature WHERE id = p_signature_id;
  SELECT id, name, footer_html INTO v_ft FROM public.comm_print_footer WHERE id = p_footer_id;
  IF p_dept_signature_id IS NOT NULL THEN
    SELECT id, name, html_signature INTO v_dsig FROM public.comm_email_signature WHERE id = p_dept_signature_id;
  END IF;
  SELECT id, name, layout_kind INTO v_lay FROM public.core_template_layout WHERE id = p_email_layout_id;
  RETURN jsonb_build_object(
    'organization_id', p_organization_id, 'department_id', p_department_id,
    'sources', jsonb_build_object('letterhead', to_jsonb(v_lh), 'org_signature', to_jsonb(v_sig),
      'footer', to_jsonb(v_ft), 'dept_signature', to_jsonb(v_dsig), 'email_layout', to_jsonb(v_lay)),
    'destination_codes', jsonb_build_object(
      'org_email_header', 'PILOT.ORG.EMAIL_HEADER', 'org_email_footer', 'PILOT.ORG.EMAIL_FOOTER',
      'org_email_signature', 'PILOT.ORG.EMAIL_SIGNATURE', 'dept_email_signature', 'PILOT.DEPT.EMAIL_SIGNATURE'),
    'ambiguity', CASE
      WHEN v_lh.id IS NULL OR v_sig.id IS NULL OR v_ft.id IS NULL OR v_lay.id IS NULL THEN 'source_missing'
      ELSE 'none' END,
    'storage_bucket_check', true, 'dry_run', true);
END;$$;
ALTER FUNCTION public.core_comm_pilot_migration_dry_run(uuid,uuid,uuid,uuid,uuid,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.core_comm_pilot_migration_dry_run(uuid,uuid,uuid,uuid,uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.core_comm_pilot_migration_dry_run(uuid,uuid,uuid,uuid,uuid,uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.core_comm_pilot_migration_apply(
  p_organization_id uuid, p_department_id uuid,
  p_letterhead_id uuid, p_signature_id uuid, p_footer_id uuid, p_dept_signature_id uuid,
  p_email_layout_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_uid uuid;
  v_lh record; v_sig record; v_ft record; v_dsig record; v_lay record;
  v_asset_hdr uuid; v_asset_ftr uuid; v_asset_sig uuid; v_asset_dsig uuid;
  v_ver_hdr uuid; v_ver_ftr uuid; v_ver_sig uuid; v_ver_dsig uuid;
  v_layv uuid;
  v_hdr_html text; v_ftr_html text; v_sig_html text; v_dsig_html text;
  v_slots jsonb;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  PERFORM public.core_priv_verify_department_ownership(p_department_id, p_organization_id);
  SELECT id, header_html, footer_html INTO v_lh FROM public.comm_letterhead WHERE id = p_letterhead_id;
  SELECT id, html_signature INTO v_sig FROM public.comm_email_signature WHERE id = p_signature_id;
  SELECT id, footer_html INTO v_ft FROM public.comm_print_footer WHERE id = p_footer_id;
  IF p_dept_signature_id IS NOT NULL THEN
    SELECT id, html_signature INTO v_dsig FROM public.comm_email_signature WHERE id = p_dept_signature_id;
  END IF;
  SELECT id INTO v_lay FROM public.core_template_layout WHERE id = p_email_layout_id;
  IF v_lh.id IS NULL OR v_sig.id IS NULL OR v_ft.id IS NULL OR v_lay.id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='pilot_source_missing';
  END IF;
  v_hdr_html := COALESCE(v_lh.header_html, '<div>Header</div>');
  v_ftr_html := COALESCE(v_ft.footer_html, '<div>Footer</div>');
  v_sig_html := COALESCE(v_sig.html_signature, '<div>Signature</div>');
  IF v_dsig.id IS NOT NULL THEN
    v_dsig_html := COALESCE(v_dsig.html_signature, '<div>Dept Signature</div>');
  END IF;

  INSERT INTO public.core_comm_asset(organization_id, asset_type, code, name, status, created_by, updated_by)
    VALUES (p_organization_id, 'email_header', 'PILOT.ORG.EMAIL_HEADER', 'Pilot organisation email header', 'draft', v_uid, v_uid)
    ON CONFLICT (organization_id, asset_type, code) DO UPDATE SET updated_by=v_uid, updated_at=now()
    RETURNING id INTO v_asset_hdr;
  INSERT INTO public.core_comm_asset(organization_id, asset_type, code, name, status, created_by, updated_by)
    VALUES (p_organization_id, 'email_footer', 'PILOT.ORG.EMAIL_FOOTER', 'Pilot organisation email footer', 'draft', v_uid, v_uid)
    ON CONFLICT (organization_id, asset_type, code) DO UPDATE SET updated_by=v_uid, updated_at=now()
    RETURNING id INTO v_asset_ftr;
  INSERT INTO public.core_comm_asset(organization_id, asset_type, code, name, status, created_by, updated_by)
    VALUES (p_organization_id, 'email_signature', 'PILOT.ORG.EMAIL_SIGNATURE', 'Pilot organisation email signature', 'draft', v_uid, v_uid)
    ON CONFLICT (organization_id, asset_type, code) DO UPDATE SET updated_by=v_uid, updated_at=now()
    RETURNING id INTO v_asset_sig;
  IF v_dsig.id IS NOT NULL THEN
    INSERT INTO public.core_comm_asset(organization_id, department_id, asset_type, code, name, status, created_by, updated_by)
      VALUES (p_organization_id, p_department_id, 'email_signature', 'PILOT.DEPT.EMAIL_SIGNATURE', 'Pilot department email signature', 'draft', v_uid, v_uid)
      ON CONFLICT (organization_id, asset_type, code) DO UPDATE SET updated_by=v_uid, updated_at=now()
      RETURNING id INTO v_asset_dsig;
  END IF;

  INSERT INTO public.core_comm_asset_version(asset_id, version_number, content_html, checksum, published_by)
    VALUES (v_asset_hdr, 1, v_hdr_html, encode(extensions.digest(v_hdr_html,'sha256'),'hex'), v_uid)
    ON CONFLICT (asset_id, version_number) DO NOTHING RETURNING id INTO v_ver_hdr;
  IF v_ver_hdr IS NULL THEN SELECT id INTO v_ver_hdr FROM public.core_comm_asset_version WHERE asset_id=v_asset_hdr AND version_number=1; END IF;
  INSERT INTO public.core_comm_asset_version(asset_id, version_number, content_html, checksum, published_by)
    VALUES (v_asset_ftr, 1, v_ftr_html, encode(extensions.digest(v_ftr_html,'sha256'),'hex'), v_uid)
    ON CONFLICT (asset_id, version_number) DO NOTHING RETURNING id INTO v_ver_ftr;
  IF v_ver_ftr IS NULL THEN SELECT id INTO v_ver_ftr FROM public.core_comm_asset_version WHERE asset_id=v_asset_ftr AND version_number=1; END IF;
  INSERT INTO public.core_comm_asset_version(asset_id, version_number, content_html, checksum, published_by)
    VALUES (v_asset_sig, 1, v_sig_html, encode(extensions.digest(v_sig_html,'sha256'),'hex'), v_uid)
    ON CONFLICT (asset_id, version_number) DO NOTHING RETURNING id INTO v_ver_sig;
  IF v_ver_sig IS NULL THEN SELECT id INTO v_ver_sig FROM public.core_comm_asset_version WHERE asset_id=v_asset_sig AND version_number=1; END IF;
  IF v_asset_dsig IS NOT NULL THEN
    INSERT INTO public.core_comm_asset_version(asset_id, version_number, content_html, checksum, published_by)
      VALUES (v_asset_dsig, 1, v_dsig_html, encode(extensions.digest(v_dsig_html,'sha256'),'hex'), v_uid)
      ON CONFLICT (asset_id, version_number) DO NOTHING RETURNING id INTO v_ver_dsig;
    IF v_ver_dsig IS NULL THEN SELECT id INTO v_ver_dsig FROM public.core_comm_asset_version WHERE asset_id=v_asset_dsig AND version_number=1; END IF;
  END IF;

  UPDATE public.core_comm_asset SET status='active', active_version_id=v_ver_hdr, activated_at=COALESCE(activated_at,now()), activated_by=COALESCE(activated_by,v_uid) WHERE id=v_asset_hdr AND status<>'retired';
  UPDATE public.core_comm_asset SET status='active', active_version_id=v_ver_ftr, activated_at=COALESCE(activated_at,now()), activated_by=COALESCE(activated_by,v_uid) WHERE id=v_asset_ftr AND status<>'retired';
  UPDATE public.core_comm_asset SET status='active', active_version_id=v_ver_sig, activated_at=COALESCE(activated_at,now()), activated_by=COALESCE(activated_by,v_uid) WHERE id=v_asset_sig AND status<>'retired';
  IF v_asset_dsig IS NOT NULL THEN
    UPDATE public.core_comm_asset SET status='active', active_version_id=v_ver_dsig, activated_at=COALESCE(activated_at,now()), activated_by=COALESCE(activated_by,v_uid) WHERE id=v_asset_dsig AND status<>'retired';
  END IF;

  v_slots := jsonb_build_array(
    jsonb_build_object('code','email_header','order',10,'required',false,'allowed_asset_types', jsonb_build_array('email_header')),
    jsonb_build_object('code','content_body','order',20,'required',true),
    jsonb_build_object('code','email_signature','order',30,'required',false,'allowed_asset_types', jsonb_build_array('email_signature')),
    jsonb_build_object('code','disclaimer','order',40,'required',false,'allowed_asset_types', jsonb_build_array('disclaimer')),
    jsonb_build_object('code','email_footer','order',50,'required',false,'allowed_asset_types', jsonb_build_array('email_footer'))
  );
  INSERT INTO public.core_template_layout_version(layout_id, version_number, slots, checksum, published_by)
    VALUES (p_email_layout_id, 1, v_slots, encode(extensions.digest(v_slots::text,'sha256'),'hex'), v_uid)
    ON CONFLICT (layout_id, version_number) DO NOTHING RETURNING id INTO v_layv;
  IF v_layv IS NULL THEN SELECT id INTO v_layv FROM public.core_template_layout_version WHERE layout_id=p_email_layout_id AND version_number=1; END IF;

  PERFORM public.core_comm_assignment_upsert_org_default(p_organization_id,'email','layout_default',NULL,p_email_layout_id,NULL);
  PERFORM public.core_comm_assignment_upsert_org_default(p_organization_id,'email','asset_slot','email_header',NULL,v_asset_hdr);
  PERFORM public.core_comm_assignment_upsert_org_default(p_organization_id,'email','asset_slot','email_footer',NULL,v_asset_ftr);
  PERFORM public.core_comm_assignment_upsert_org_default(p_organization_id,'email','asset_slot','email_signature',NULL,v_asset_sig);
  IF v_asset_dsig IS NOT NULL THEN
    PERFORM public.core_comm_assignment_upsert_dept_override(p_organization_id, p_department_id,'email','asset_slot','email_signature',NULL,v_asset_dsig);
  END IF;

  RETURN jsonb_build_object('ok', true, 'organization_id', p_organization_id, 'department_id', p_department_id,
    'assets', jsonb_build_object('email_header', v_asset_hdr, 'email_footer', v_asset_ftr, 'email_signature', v_asset_sig, 'dept_email_signature', v_asset_dsig),
    'versions', jsonb_build_object('email_header', v_ver_hdr, 'email_footer', v_ver_ftr, 'email_signature', v_ver_sig, 'dept_email_signature', v_ver_dsig),
    'layout_version_id', v_layv);
END;$$;
ALTER FUNCTION public.core_comm_pilot_migration_apply(uuid,uuid,uuid,uuid,uuid,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.core_comm_pilot_migration_apply(uuid,uuid,uuid,uuid,uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.core_comm_pilot_migration_apply(uuid,uuid,uuid,uuid,uuid,uuid,uuid) TO authenticated;
