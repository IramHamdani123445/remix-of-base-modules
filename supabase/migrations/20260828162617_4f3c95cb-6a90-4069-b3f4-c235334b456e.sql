-- DEF-S1B-18: ia_record_communication_stage silently accepted unknown stage codes,
-- stamping stage_order 99. Lifecycle gates (preparation completion, report issuance)
-- key off canonical codes, so the auditee communication appeared recorded while the
-- gate remained unmet with no error shown. The command must now reject unknown codes.

CREATE OR REPLACE FUNCTION public.ia_record_communication_stage(
  p_engagement_id uuid,
  p_stage_code text,
  p_template_id uuid DEFAULT NULL::uuid,
  p_recipient_name text DEFAULT NULL::text,
  p_recipient_email text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text,
  p_created_by text DEFAULT NULL::text,
  p_acknowledgment_required boolean DEFAULT false,
  p_mode text DEFAULT 'send'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_stage_order INT;
  v_template_name TEXT;
  v_policy RECORD;
  v_stage_id UUID;
  v_code text := upper(replace(trim(COALESCE(p_stage_code, '')), ' ', '_'));
  v_actor text := public.ia_actor_label();
BEGIN
  IF NOT public.ia_cmd_guard_elevated('audit_engagements', 'edit', p_engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN',
      'error', 'You do not have permission to record communications for this engagement');
  END IF;

  v_stage_order := CASE v_code
    WHEN 'PLAN_INTIMATION' THEN 1 WHEN 'ENGAGEMENT_NOTIFICATION' THEN 1 WHEN 'AUDIT_NOTIFICATION' THEN 1
    WHEN 'TEAM_AND_SCOPE_NOTICE' THEN 2
    WHEN 'DOC_REQUEST' THEN 3 WHEN 'ENTRANCE_MEETING' THEN 4
    WHEN 'QUERY_CYCLE' THEN 5 WHEN 'DRAFT_FINDING_DISCUSSION' THEN 6
    WHEN 'EXIT_MEETING' THEN 7 WHEN 'FINAL_REPORT_ISSUE' THEN 8
    WHEN 'ACTION_PLAN_REMINDER' THEN 9 ELSE NULL
  END;

  IF v_stage_order IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_INVALID_STAGE',
      'error', format('"%s" is not a recognised engagement communication stage', p_stage_code),
      'allowed_stage_codes', jsonb_build_array(
        'PLAN_INTIMATION','ENGAGEMENT_NOTIFICATION','AUDIT_NOTIFICATION','TEAM_AND_SCOPE_NOTICE',
        'DOC_REQUEST','ENTRANCE_MEETING','QUERY_CYCLE','DRAFT_FINDING_DISCUSSION',
        'EXIT_MEETING','FINAL_REPORT_ISSUE','ACTION_PLAN_REMINDER'));
  END IF;

  IF p_template_id IS NOT NULL THEN
    SELECT name INTO v_template_name FROM public.ia_document_templates WHERE id = p_template_id;
    SELECT * INTO v_policy FROM public.ia_template_policy_matrix WHERE stage_code = v_code AND is_active = true LIMIT 1;
    IF v_policy IS NOT NULL AND v_policy.is_mandatory THEN
      IF NOT EXISTS (SELECT 1 FROM public.ia_document_templates WHERE id = p_template_id AND category = v_policy.required_template_category AND is_active = true) THEN
        RETURN jsonb_build_object('success', false, 'error', format('Template must be of category "%s" for stage %s', v_policy.required_template_category, v_code));
      END IF;
    END IF;
  END IF;

  IF v_code <> 'QUERY_CYCLE' THEN
    IF EXISTS (SELECT 1 FROM public.ia_communication_stages WHERE engagement_id = p_engagement_id AND stage_code = v_code AND delivery_status IN ('Sent','Delivered','Acknowledged')) THEN
      RETURN jsonb_build_object('success', false, 'code', 'IA_STAGE_ALREADY_DONE',
        'error', format('Stage %s already completed for this engagement', v_code));
    END IF;
  END IF;

  INSERT INTO public.ia_communication_stages (engagement_id, stage_code, stage_order, template_id, template_name, recipient_name, recipient_email, sent_at, acknowledgment_required, delivery_status, notes, created_by)
  VALUES (p_engagement_id, v_code, v_stage_order, p_template_id, v_template_name, p_recipient_name, p_recipient_email, now(), p_acknowledgment_required, 'Sent', COALESCE(p_notes, p_created_by), v_actor)
  RETURNING id INTO v_stage_id;

  PERFORM public.ia_log_event('IA.COMMUNICATION.STAGE_RECORDED', 'communication_stage', v_stage_id, p_engagement_id, NULL,
    NULL,
    jsonb_build_object('stage_code', v_code, 'recipient_email', p_recipient_email, 'delivery_status', 'Sent'),
    p_notes, NULL, 'ia_record_communication_stage');

  RETURN jsonb_build_object('success', true, 'stage_id', v_stage_id, 'stage_code', v_code, 'stage_order', v_stage_order);
END;
$function$;

-- Normalise the two non-canonical rows just created on ENG-2027-002
UPDATE public.ia_communication_stages
   SET stage_code = 'ENGAGEMENT_NOTIFICATION', stage_order = 1
 WHERE engagement_id = '66579005-1b9c-4155-a464-f86deb4d45b4' AND stage_code = 'Engagement Notification';

UPDATE public.ia_communication_stages
   SET stage_code = 'ENTRANCE_MEETING', stage_order = 4
 WHERE engagement_id = '66579005-1b9c-4155-a464-f86deb4d45b4' AND stage_code = 'Entrance Meeting';