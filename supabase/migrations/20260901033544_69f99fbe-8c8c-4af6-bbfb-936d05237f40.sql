DO $mig$
DECLARE
  v_def text;
  v_before text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='ce_legal_proceeding_register_v1';

  IF v_def IS NULL THEN RAISE EXCEPTION 'register function not found'; END IF;

  -- 1. Awaiting Legal Action tab
  v_before := v_def;
  v_def := replace(v_def,
    E'OR (v_tab = ''ACTIVE''      AND NOT s.is_closed)',
    E'OR (v_tab = ''ACTIVE''      AND NOT s.is_closed)\n           OR (v_tab = ''AWAITING_LEGAL'' AND s.stage_code = ''AWAITING_LEGAL'' AND NOT s.is_closed)');
  IF v_def = v_before THEN RAISE EXCEPTION 'tab predicate anchor not found'; END IF;

  -- 2. KPI block
  v_before := v_def;
  v_def := replace(v_def,
    E'''active'',      (SELECT count(*) FROM scored WHERE NOT is_closed),',
    E'''active'',      (SELECT count(*) FROM scored WHERE NOT is_closed),\n      ''awaiting_legal'', (SELECT count(*) FROM scored WHERE stage_code = ''AWAITING_LEGAL'' AND NOT is_closed),\n      ''awaiting_legal_overdue'', (SELECT count(*) FROM scored WHERE awaiting_legal_overdue),\n      ''hearings_soon'', (SELECT count(*) FROM scored WHERE hearing_soon),\n      ''judgments'', (SELECT count(*) FROM scored WHERE stage_group = ''JUDGMENT'' OR outcome_code IN (''JUDGMENT_GRANTED'',''CONSENT_ORDER'')),\n      ''judgment_no_enforcement'', (SELECT count(*) FROM scored WHERE judgment_no_enforcement),\n      ''closed'', (SELECT count(*) FROM scored WHERE is_closed),\n      ''recovered_total'', CASE WHEN v_can_money THEN (SELECT COALESCE(sum(recovered_amount),0) FROM scored) ELSE NULL END,');
  IF v_def = v_before THEN RAISE EXCEPTION 'kpi anchor not found'; END IF;

  -- 3. Tab counts
  v_before := v_def;
  v_def := replace(v_def,
    E'''ALL'',        (SELECT count(*) FROM scored),',
    E'''ALL'',        (SELECT count(*) FROM scored),\n      ''AWAITING_LEGAL'', (SELECT count(*) FROM scored WHERE stage_code = ''AWAITING_LEGAL'' AND NOT is_closed),');
  IF v_def = v_before THEN RAISE EXCEPTION 'tab count anchor not found'; END IF;

  EXECUTE v_def;
END
$mig$;