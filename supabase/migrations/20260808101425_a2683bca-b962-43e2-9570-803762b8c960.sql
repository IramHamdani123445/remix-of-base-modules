-- ============================================================
-- BN Uprating Epic 2 — Run approval and execution scheduling
-- Pre-execution only: no award, entitlement or payment mutation.
-- ============================================================

ALTER TABLE public.bn_uprating_run DROP CONSTRAINT IF EXISTS bn_uprating_run_status_ck;
ALTER TABLE public.bn_uprating_run ADD CONSTRAINT bn_uprating_run_status_ck
  CHECK (status = ANY (ARRAY['DRAFT','PARAMETERISED','ELIGIBILITY_SNAPSHOT','EXCLUSIONS_APPLIED','DRY_RUN','AWAITING_APPROVAL','APPROVED']));

ALTER TABLE public.bn_uprating_run
  ADD COLUMN IF NOT EXISTS current_approval_package_id uuid,
  ADD COLUMN IF NOT EXISTS current_approval_id uuid,
  ADD COLUMN IF NOT EXISTS approval_cycle_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_by_name text,
  ADD COLUMN IF NOT EXISTS current_schedule_id uuid;

-- ---------- Approval package (immutable) ----------
CREATE TABLE IF NOT EXISTS public.bn_uprating_run_approval_package (
  package_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.bn_uprating_run(run_id) ON DELETE CASCADE,
  cycle_no integer NOT NULL,
  run_row_version integer NOT NULL,
  policy_id uuid NOT NULL,
  policy_version_id uuid NOT NULL,
  policy_version_reference text,
  frozen_policy_type text,
  target_effective_date date NOT NULL,
  scope_description text,
  snapshot_id uuid NOT NULL,
  snapshot_version integer NOT NULL,
  snapshot_fingerprint text,
  simulation_id uuid NOT NULL,
  simulation_version integer NOT NULL,
  input_fingerprint text NOT NULL,
  population_total integer NOT NULL DEFAULT 0,
  included_count integer NOT NULL DEFAULT 0,
  excluded_count integer NOT NULL DEFAULT 0,
  exception_count integer NOT NULL DEFAULT 0,
  unresolved_blocking_count integer NOT NULL DEFAULT 0,
  failed_item_count integer NOT NULL DEFAULT 0,
  current_total_minor bigint NOT NULL DEFAULT 0,
  proposed_total_minor bigint NOT NULL DEFAULT 0,
  delta_total_minor bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'CURRENT'
    CHECK (status = ANY (ARRAY['CURRENT','APPROVED','HISTORICAL','SUPERSEDED'])),
  submitted_by uuid NOT NULL,
  submitted_by_name text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, cycle_no)
);
GRANT ALL ON public.bn_uprating_run_approval_package TO service_role;
ALTER TABLE public.bn_uprating_run_approval_package ENABLE ROW LEVEL SECURITY;
CREATE POLICY "uprating approval package service only"
  ON public.bn_uprating_run_approval_package FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------- Approval cycle ----------
CREATE TABLE IF NOT EXISTS public.bn_uprating_run_approval (
  approval_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.bn_uprating_run(run_id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES public.bn_uprating_run_approval_package(package_id) ON DELETE CASCADE,
  cycle_no integer NOT NULL,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status = ANY (ARRAY['PENDING','APPROVED','RETURNED'])),
  submitted_by uuid NOT NULL,
  submitted_by_name text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  submission_note text,
  decision text CHECK (decision IS NULL OR decision = ANY (ARRAY['APPROVE','RETURN_FOR_REWORK'])),
  decision_reason text,
  justification text,
  decided_by uuid,
  decided_by_name text,
  decided_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, cycle_no)
);
GRANT ALL ON public.bn_uprating_run_approval TO service_role;
ALTER TABLE public.bn_uprating_run_approval ENABLE ROW LEVEL SECURITY;
CREATE POLICY "uprating approval service only"
  ON public.bn_uprating_run_approval FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------- Execution schedule ----------
CREATE TABLE IF NOT EXISTS public.bn_uprating_execution_schedule (
  schedule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.bn_uprating_run(run_id) ON DELETE CASCADE,
  approval_id uuid NOT NULL REFERENCES public.bn_uprating_run_approval(approval_id),
  package_id uuid NOT NULL REFERENCES public.bn_uprating_run_approval_package(package_id),
  schedule_version integer NOT NULL,
  status text NOT NULL DEFAULT 'PLANNED'
    CHECK (status = ANY (ARRAY['PLANNED','DUE','SUPERSEDED','CANCELLED'])),
  planned_execution_at timestamptz NOT NULL,
  time_zone text NOT NULL,
  window_start_at timestamptz,
  window_end_at timestamptz,
  batch_size integer,
  max_concurrent_batches integer,
  batch_strategy text,
  notes text,
  supersedes_schedule_id uuid,
  superseded_at timestamptz,
  cancelled_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancelled_by_name text,
  created_by uuid NOT NULL,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  row_version integer NOT NULL DEFAULT 1,
  correlation_id uuid,
  UNIQUE (run_id, schedule_version)
);
GRANT ALL ON public.bn_uprating_execution_schedule TO service_role;
ALTER TABLE public.bn_uprating_execution_schedule ENABLE ROW LEVEL SECURITY;
CREATE POLICY "uprating execution schedule service only"
  ON public.bn_uprating_execution_schedule FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS bn_uprating_run_approval_pending_idx
  ON public.bn_uprating_run_approval(status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS bn_uprating_execution_schedule_active_idx
  ON public.bn_uprating_execution_schedule(run_id, status);

-- ---------- Governed reference configuration ----------
INSERT INTO public.bn_uprating_reference_value(domain, code, label, description, sort_order, is_active) VALUES
  ('RUN_STATUS','AWAITING_APPROVAL','Awaiting approval','Submitted as an immutable approval package and awaiting an independent decision.',60,true),
  ('RUN_STATUS','APPROVED','Approved','Independently approved. Execution has not started.',70,true),
  ('APPROVAL_STATUS','PENDING','Pending decision',NULL,10,true),
  ('APPROVAL_STATUS','APPROVED','Approved',NULL,20,true),
  ('APPROVAL_STATUS','RETURNED','Returned for rework',NULL,30,true),
  ('APPROVAL_DECISION','APPROVE','Approve',NULL,10,true),
  ('APPROVAL_DECISION','RETURN_FOR_REWORK','Return for rework',NULL,20,true),
  ('SCHEDULE_STATUS','PLANNED','Planned',NULL,10,true),
  ('SCHEDULE_STATUS','DUE','Due',NULL,20,true),
  ('SCHEDULE_STATUS','SUPERSEDED','Superseded',NULL,30,true),
  ('SCHEDULE_STATUS','CANCELLED','Cancelled',NULL,40,true),
  ('SCHEDULE_CONFIG','DEFAULT_TIME_ZONE','America/St_Kitts','Authoritative scheduling time zone.',10,true),
  ('SCHEDULE_CONFIG','DEFAULT_BATCH_SIZE','200','Governed default batch size for later execution.',20,true),
  ('SCHEDULE_CONFIG','MIN_BATCH_SIZE','25','Governed minimum batch size.',30,true),
  ('SCHEDULE_CONFIG','MAX_BATCH_SIZE','2000','Governed maximum batch size.',40,true),
  ('SCHEDULE_CONFIG','DEFAULT_MAX_CONCURRENT_BATCHES','2','Governed default batch concurrency.',50,true),
  ('SCHEDULE_CONFIG','MAX_CONCURRENT_BATCHES','4','Governed maximum batch concurrency.',60,true),
  ('SCHEDULE_CONFIG','MIN_LEAD_MINUTES','15','Minimum lead time between scheduling and planned execution.',70,true)
ON CONFLICT DO NOTHING;

-- ---------- Governed scheduling configuration helper ----------
CREATE OR REPLACE FUNCTION public._bn_uprating_schedule_config()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_object_agg(code, label)
    FROM public.bn_uprating_reference_value
   WHERE domain = 'SCHEDULE_CONFIG' AND is_active;
$$;

-- ---------- Approval readiness helper ----------
CREATE OR REPLACE FUNCTION public._bn_uprating_approval_readiness(p_run_id uuid, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r public.bn_uprating_run%ROWTYPE;
  v_snap public.bn_uprating_run_snapshot%ROWTYPE;
  v_sim public.bn_uprating_simulation%ROWTYPE;
  v_ver public.bn_uprating_policy_version%ROWTYPE;
  v_block int := 0; v_open int := 0; v_pending int := 0;
  v_blockers jsonb := '[]'::jsonb; v_warnings jsonb := '[]'::jsonb;
  v_decide boolean;
BEGIN
  SELECT * INTO r FROM public.bn_uprating_run WHERE run_id = p_run_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('can_submit', false, 'blockers',
      jsonb_build_array(jsonb_build_object('code','E_NOT_FOUND','message','That uprating run could not be found.')),
      'warnings','[]'::jsonb);
  END IF;

  v_decide := COALESCE((public.bn_uprating_check_actor_permission(p_actor,'decide',true)->>'ok')::boolean,false);
  IF NOT v_decide THEN
    v_blockers := v_blockers || jsonb_build_object('code','E_PERMISSION','message','You do not have permission to submit a run for approval.');
  END IF;

  IF r.status <> 'DRY_RUN' THEN
    v_blockers := v_blockers || jsonb_build_object('code','E_INVALID_STATE',
      'message','Only a simulated run in Dry run may be submitted for approval.');
  END IF;

  SELECT count(*) INTO v_pending FROM public.bn_uprating_run_approval
   WHERE run_id = p_run_id AND status = 'PENDING';
  IF v_pending > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('code','E_ALREADY_SUBMITTED',
      'message','This run already has an approval cycle awaiting a decision.');
  END IF;

  IF r.current_snapshot_id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','E_NO_POPULATION','message','Build the population snapshot first.');
  ELSE
    SELECT * INTO v_snap FROM public.bn_uprating_run_snapshot WHERE snapshot_id = r.current_snapshot_id;
    IF v_snap.status <> 'CURRENT' THEN
      v_blockers := v_blockers || jsonb_build_object('code','E_SNAPSHOT_SUPERSEDED','message','The population snapshot has been superseded. Rebuild and resimulate.');
    END IF;
    SELECT count(*) FILTER (WHERE is_blocking), count(*) INTO v_block, v_open
      FROM public.bn_uprating_run_exception
     WHERE snapshot_id = r.current_snapshot_id AND resolution_status = 'OPEN';
    IF v_block > 0 THEN
      v_blockers := v_blockers || jsonb_build_object('code','E_BLOCKING_EXCEPTIONS',
        'message', v_block || ' blocking exception(s) remain unresolved.');
    END IF;
    IF v_open - v_block > 0 THEN
      v_warnings := v_warnings || jsonb_build_object('code','W_OPEN_EXCEPTIONS',
        'message', (v_open - v_block) || ' non-blocking exception(s) remain open.');
    END IF;
  END IF;

  IF r.current_simulation_id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','E_NO_SIMULATION','message','Run a simulation before submitting for approval.');
  ELSE
    SELECT * INTO v_sim FROM public.bn_uprating_simulation WHERE simulation_id = r.current_simulation_id;
    IF r.simulation_state <> 'CURRENT' OR v_sim.status <> 'CURRENT' THEN
      v_blockers := v_blockers || jsonb_build_object('code','E_SIMULATION_STALE','message','The simulation is stale. Resimulate before submitting.');
    END IF;
    IF v_sim.input_fingerprint IS DISTINCT FROM r.input_fingerprint
       OR v_sim.snapshot_id IS DISTINCT FROM r.current_snapshot_id THEN
      v_blockers := v_blockers || jsonb_build_object('code','E_FINGERPRINT_MISMATCH','message','The simulation no longer matches the current run inputs.');
    END IF;
    IF COALESCE(v_sim.failed_items,0) > 0 THEN
      v_blockers := v_blockers || jsonb_build_object('code','E_CALCULATION_FAILURES',
        'message', v_sim.failed_items || ' award(s) failed calculation in the current simulation.');
    END IF;
  END IF;

  SELECT * INTO v_ver FROM public.bn_uprating_policy_version WHERE policy_version_id = r.policy_version_id;
  IF v_ver.status <> 'ACTIVE' THEN
    v_blockers := v_blockers || jsonb_build_object('code','E_POLICY_PROVENANCE','message','The policy version used by this run is no longer active.');
  ELSIF r.target_effective_date < COALESCE(v_ver.effective_from,'0001-01-01'::date)
     OR r.target_effective_date > COALESCE(v_ver.effective_to,'9999-12-31'::date) THEN
    v_blockers := v_blockers || jsonb_build_object('code','E_POLICY_PROVENANCE','message','The target effective date is outside the policy version effective period.');
  END IF;

  RETURN jsonb_build_object(
    'run_id', r.run_id,
    'run_reference', r.run_reference,
    'status', r.status,
    'row_version', r.row_version,
    'can_submit', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers,
    'warnings', v_warnings,
    'current_snapshot_version', r.current_snapshot_version,
    'current_simulation_version', r.current_simulation_version,
    'simulation_fingerprint', r.input_fingerprint,
    'available_action', CASE WHEN jsonb_array_length(v_blockers) = 0 THEN 'BN_UPRATING_SUBMIT_RUN_FOR_APPROVAL' ELSE NULL END,
    'population_summary', jsonb_build_object(
      'total_items', COALESCE(v_snap.total_items,0),
      'included_count', COALESCE(v_snap.eligible_items,0),
      'excluded_count', COALESCE(v_snap.excluded_items,0)),
    'exception_summary', jsonb_build_object(
      'exception_items', COALESCE(v_snap.exception_items,0),
      'open_exceptions', v_open,
      'unresolved_blocking', v_block),
    'financial_summary', jsonb_build_object(
      'simulated_current_total_minor', COALESCE(v_sim.current_total_minor,0),
      'simulated_proposed_total_minor', COALESCE(v_sim.proposed_total_minor,0),
      'simulated_change_minor', COALESCE(v_sim.delta_total_minor,0),
      'failed_items', COALESCE(v_sim.failed_items,0)));
END; $$;

CREATE OR REPLACE FUNCTION public.bn_uprating_run_approval_readiness_v1(p_actor_user_id uuid, p_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public._bn_uprating_require(p_actor_user_id,'read',false);
  RETURN jsonb_build_object('status','OK','data', public._bn_uprating_approval_readiness(p_run_id, p_actor_user_id));
END; $$;

-- ---------- Execution schedule readiness ----------
CREATE OR REPLACE FUNCTION public.bn_uprating_execution_schedule_readiness_v1(p_actor_user_id uuid, p_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r public.bn_uprating_run%ROWTYPE;
  p public.bn_uprating_run_approval_package%ROWTYPE;
  a public.bn_uprating_run_approval%ROWTYPE;
  s public.bn_uprating_execution_schedule%ROWTYPE;
  v_admin boolean; v_blockers jsonb := '[]'::jsonb; v_warnings jsonb := '[]'::jsonb;
  v_cfg jsonb;
BEGIN
  PERFORM public._bn_uprating_require(p_actor_user_id,'read',false);
  SELECT * INTO r FROM public.bn_uprating_run WHERE run_id = p_run_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','ERROR','code','E_NOT_FOUND','message','That uprating run could not be found.','data',NULL);
  END IF;
  v_cfg := public._bn_uprating_schedule_config();
  v_admin := COALESCE((public.bn_uprating_check_actor_permission(p_actor_user_id,'admin',true)->>'ok')::boolean,false);
  IF NOT v_admin THEN
    v_blockers := v_blockers || jsonb_build_object('code','E_PERMISSION','message','You do not have permission to schedule execution.');
  END IF;
  IF r.status <> 'APPROVED' THEN
    v_blockers := v_blockers || jsonb_build_object('code','E_INVALID_STATE','message','Only an approved run may be scheduled for execution.');
  END IF;
  SELECT * INTO p FROM public.bn_uprating_run_approval_package WHERE package_id = r.current_approval_package_id;
  SELECT * INTO a FROM public.bn_uprating_run_approval WHERE approval_id = r.current_approval_id;
  IF p.package_id IS NULL OR a.approval_id IS NULL OR a.status <> 'APPROVED' THEN
    v_blockers := v_blockers || jsonb_build_object('code','E_NO_APPROVAL','message','There is no current approved package for this run.');
  ELSIF p.run_row_version IS DISTINCT FROM r.row_version
     OR p.simulation_id IS DISTINCT FROM r.current_simulation_id
     OR p.input_fingerprint IS DISTINCT FROM r.input_fingerprint THEN
    v_blockers := v_blockers || jsonb_build_object('code','E_APPROVAL_STALE','message','The approved package no longer matches the current run.');
  END IF;
  SELECT * INTO s FROM public.bn_uprating_execution_schedule
   WHERE run_id = p_run_id AND status IN ('PLANNED','DUE')
   ORDER BY schedule_version DESC LIMIT 1;
  IF s.schedule_id IS NOT NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','E_SCHEDULE_EXISTS','message','This run already has an active execution schedule. Reschedule or cancel it instead.');
  END IF;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'run_id', r.run_id,
    'run_reference', r.run_reference,
    'status', r.status,
    'row_version', r.row_version,
    'can_schedule', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers,
    'warnings', v_warnings,
    'approved_package', CASE WHEN p.package_id IS NULL THEN NULL ELSE jsonb_build_object(
        'package_id', p.package_id,'cycle_no', p.cycle_no,'snapshot_version', p.snapshot_version,
        'simulation_version', p.simulation_version,'input_fingerprint', p.input_fingerprint,
        'target_effective_date', p.target_effective_date,'included_count', p.included_count,
        'excluded_count', p.excluded_count,
        'simulated_current_total_minor', p.current_total_minor,
        'simulated_proposed_total_minor', p.proposed_total_minor,
        'simulated_change_minor', p.delta_total_minor,
        'approved_by_name', a.decided_by_name,'approved_at', a.decided_at) END,
    'current_schedule', CASE WHEN s.schedule_id IS NULL THEN NULL ELSE to_jsonb(s) END,
    'allowed_scheduling_fields', jsonb_build_object(
        'planned_execution_at', true,'time_zone', true,'window_start_at', true,
        'window_end_at', true,'batch_size', true,'max_concurrent_batches', true,'notes', true),
    'configuration', v_cfg,
    'available_actions', CASE WHEN jsonb_array_length(v_blockers) = 0
        THEN jsonb_build_array('BN_UPRATING_SCHEDULE_EXECUTION')
        WHEN s.schedule_id IS NOT NULL AND v_admin
        THEN jsonb_build_array('BN_UPRATING_RESCHEDULE_EXECUTION','BN_UPRATING_CANCEL_EXECUTION_SCHEDULE')
        ELSE '[]'::jsonb END));
END; $$;

-- ---------- Approval detail read ----------
CREATE OR REPLACE FUNCTION public.bn_uprating_run_approval_v1(p_actor_user_id uuid, p_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.bn_uprating_run%ROWTYPE; v_pkg jsonb; v_cycles jsonb; v_sched jsonb;
BEGIN
  PERFORM public._bn_uprating_require(p_actor_user_id,'read',false);
  SELECT * INTO r FROM public.bn_uprating_run WHERE run_id = p_run_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','ERROR','code','E_NOT_FOUND','message','That uprating run could not be found.','data',NULL);
  END IF;
  SELECT to_jsonb(p) INTO v_pkg FROM public.bn_uprating_run_approval_package p
   WHERE p.package_id = r.current_approval_package_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.cycle_no DESC),'[]'::jsonb) INTO v_cycles
    FROM public.bn_uprating_run_approval c WHERE c.run_id = p_run_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.schedule_version DESC),'[]'::jsonb) INTO v_sched
    FROM public.bn_uprating_execution_schedule s WHERE s.run_id = p_run_id;
  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'run_id', r.run_id,'run_reference', r.run_reference,'status', r.status,'row_version', r.row_version,
    'current_package', v_pkg,'cycles', v_cycles,'schedules', v_sched,
    'approval_readiness', public._bn_uprating_approval_readiness(p_run_id, p_actor_user_id)));
END; $$;

-- ---------- Approval queue ----------
CREATE OR REPLACE FUNCTION public.bn_uprating_run_approval_queue_v1(
  p_actor_user_id uuid, p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_rows jsonb; v_total int; v_search text;
BEGIN
  PERFORM public._bn_uprating_require(p_actor_user_id,'read',false);
  v_search := NULLIF(p_filters->>'search','');
  SELECT count(*) INTO v_total
    FROM public.bn_uprating_run_approval a
    JOIN public.bn_uprating_run r ON r.run_id = a.run_id
   WHERE a.status = 'PENDING'
     AND (v_search IS NULL OR r.run_reference ILIKE '%'||v_search||'%' OR COALESCE(r.run_name,'') ILIKE '%'||v_search||'%');
  SELECT COALESCE(jsonb_agg(t ORDER BY t->>'submitted_at'),'[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object(
      'approval_id', a.approval_id,'package_id', a.package_id,'cycle_no', a.cycle_no,
      'run_id', r.run_id,'run_reference', r.run_reference,'run_name', r.run_name,
      'policy_code', pol.policy_code,'policy_name', pol.policy_name,
      'policy_version_reference', pv.version_reference,
      'target_effective_date', r.target_effective_date,
      'population_total', p.population_total,'included_count', p.included_count,
      'excluded_count', p.excluded_count,'exception_count', p.exception_count,
      'unresolved_blocking_count', p.unresolved_blocking_count,
      'simulated_current_total_minor', p.current_total_minor,
      'simulated_proposed_total_minor', p.proposed_total_minor,
      'simulated_change_minor', p.delta_total_minor,
      'submitted_by_name', a.submitted_by_name,'submitted_by', a.submitted_by,
      'submitted_at', a.submitted_at,
      'age_hours', round(EXTRACT(EPOCH FROM (now() - a.submitted_at))/3600.0, 1),
      'action_required', 'Independent approval decision') AS t
      FROM public.bn_uprating_run_approval a
      JOIN public.bn_uprating_run r ON r.run_id = a.run_id
      JOIN public.bn_uprating_run_approval_package p ON p.package_id = a.package_id
      JOIN public.bn_uprating_policy pol ON pol.policy_id = r.policy_id
      JOIN public.bn_uprating_policy_version pv ON pv.policy_version_id = r.policy_version_id
     WHERE a.status = 'PENDING'
       AND (v_search IS NULL OR r.run_reference ILIKE '%'||v_search||'%' OR COALESCE(r.run_name,'') ILIKE '%'||v_search||'%')
     ORDER BY a.submitted_at
     LIMIT GREATEST(p_limit,1) OFFSET GREATEST(p_offset,0)) q;
  RETURN jsonb_build_object('status','OK','data', jsonb_build_object('rows', v_rows,'total', v_total));
END; $$;

-- ---------- Scheduled-run queue ----------
CREATE OR REPLACE FUNCTION public.bn_uprating_scheduled_run_queue_v1(
  p_actor_user_id uuid, p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_rows jsonb; v_total int;
BEGIN
  PERFORM public._bn_uprating_require(p_actor_user_id,'read',false);
  SELECT count(*) INTO v_total FROM public.bn_uprating_run r WHERE r.status = 'APPROVED';
  SELECT COALESCE(jsonb_agg(t ORDER BY t->>'run_reference'),'[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object(
      'run_id', r.run_id,'run_reference', r.run_reference,'run_name', r.run_name,
      'target_effective_date', r.target_effective_date,
      'approved_at', r.approved_at,'approved_by_name', r.approved_by_name,
      'schedule_id', s.schedule_id,'schedule_version', s.schedule_version,
      'planned_execution_at', s.planned_execution_at,'time_zone', s.time_zone,
      'schedule_status', COALESCE(s.status,'NOT_SCHEDULED'),
      'queue_state', CASE
          WHEN s.schedule_id IS NULL THEN 'APPROVED_NOT_SCHEDULED'
          WHEN s.planned_execution_at <= now() THEN 'DUE'
          ELSE 'SCHEDULED' END) AS t
      FROM public.bn_uprating_run r
      LEFT JOIN LATERAL (
        SELECT * FROM public.bn_uprating_execution_schedule x
         WHERE x.run_id = r.run_id AND x.status IN ('PLANNED','DUE')
         ORDER BY x.schedule_version DESC LIMIT 1) s ON true
     WHERE r.status = 'APPROVED'
     ORDER BY r.run_reference
     LIMIT GREATEST(p_limit,1) OFFSET GREATEST(p_offset,0)) q;
  RETURN jsonb_build_object('status','OK','data', jsonb_build_object('rows', v_rows,'total', v_total));
END; $$;
