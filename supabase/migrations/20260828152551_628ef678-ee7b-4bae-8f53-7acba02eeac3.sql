-- Stage 1B DEF-S1B-09: risk level round-trip inflation.
-- Assessed levels are mapped to numeric scores (Critical=100, High=80, Medium=50, Low=20) and then
-- re-banded with >=80 => Critical, which silently promoted every "High" function to "Critical".
-- Correct the bands so the numeric score round-trips back to the assessed level.
DO $mig$
DECLARE v_def text; v_new text; v_bad text; v_good text;
BEGIN
  v_bad :=
    'WHEN v_risk_score >= 80 THEN ''Critical''' || chr(10) ||
    '    WHEN v_risk_score >= 50 THEN ''High''' || chr(10) ||
    '    WHEN v_risk_score >= 25 THEN ''Medium''';
  v_good :=
    'WHEN v_risk_score >= 90 THEN ''Critical''' || chr(10) ||
    '    WHEN v_risk_score >= 65 THEN ''High''' || chr(10) ||
    '    WHEN v_risk_score >= 35 THEN ''Medium''';

  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc
  WHERE proname = 'ia_compute_engagement_priority_score' AND pronamespace = 'public'::regnamespace;
  v_new := replace(v_def, v_bad, v_good);
  IF v_new = v_def THEN
    RAISE EXCEPTION 'DEF-S1B-09: expected risk banding block not found in ia_compute_engagement_priority_score';
  END IF;
  EXECUTE v_new;

  -- Generator fallback bands
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc
  WHERE proname = 'ia_generate_auto_plan_candidates' AND pronamespace = 'public'::regnamespace;
  v_new := replace(v_def,
    'WHEN COALESCE(NULLIF(v_score->>''risk_score'', '''')::numeric, 0) >= 80 THEN ''Critical''',
    'WHEN COALESCE(NULLIF(v_score->>''risk_score'', '''')::numeric, 0) >= 90 THEN ''Critical''');
  v_new := replace(v_new,
    'WHEN COALESCE(NULLIF(v_score->>''risk_score'', '''')::numeric, 0) >= 50 THEN ''High''
      WHEN COALESCE(NULLIF(v_score->>''risk_score'', '''')::numeric, 0) >= 25 THEN ''Medium''',
    'WHEN COALESCE(NULLIF(v_score->>''risk_score'', '''')::numeric, 0) >= 65 THEN ''High''
      WHEN COALESCE(NULLIF(v_score->>''risk_score'', '''')::numeric, 0) >= 35 THEN ''Medium''');
  IF v_new <> v_def THEN EXECUTE v_new; END IF;

  -- Conversion bands
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc
  WHERE proname = 'ia_convert_candidates_to_engagements' AND pronamespace = 'public'::regnamespace;
  v_new := replace(v_def,
    'WHEN v_candidate.risk_score >= 75 THEN ''Critical''
      WHEN v_candidate.risk_score >= 50 THEN ''High''
      WHEN v_candidate.risk_score >= 25 THEN ''Medium''',
    'WHEN v_candidate.risk_score >= 90 THEN ''Critical''
      WHEN v_candidate.risk_score >= 65 THEN ''High''
      WHEN v_candidate.risk_score >= 35 THEN ''Medium''');
  IF v_new = v_def THEN
    RAISE EXCEPTION 'DEF-S1B-09: expected risk banding block not found in ia_convert_candidates_to_engagements';
  END IF;
  EXECUTE v_new;
END
$mig$;

DO $chk$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('ia_compute_engagement_priority_score', 'ia_convert_candidates_to_engagements')
      AND (prosrc LIKE '%v_risk_score >= 80 THEN ''Critical''%' OR prosrc LIKE '%risk_score >= 75 THEN ''Critical''%')
  ) THEN
    RAISE EXCEPTION 'DEF-S1B-09 fix did not apply';
  END IF;
END
$chk$;