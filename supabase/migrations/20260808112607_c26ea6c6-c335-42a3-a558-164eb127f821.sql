-- ============================================================
-- BN Uprating Epic 3 — Batch execution and failed-item retry.
-- Executes exactly what was approved. No live recalculation.
-- ============================================================

-- ---------- Run lifecycle extension ----------
ALTER TABLE public.bn_uprating_run DROP CONSTRAINT IF EXISTS bn_uprating_run_status_ck;
ALTER TABLE public.bn_uprating_run ADD CONSTRAINT bn_uprating_run_status_ck
  CHECK (status = ANY (ARRAY['DRAFT','PARAMETERISED','ELIGIBILITY_SNAPSHOT','EXCLUSIONS_APPLIED',
    'DRY_RUN','AWAITING_APPROVAL','APPROVED','EXECUTING','COMPLETED','PARTIAL','FAILED']));

ALTER TABLE public.bn_uprating_run
  ADD COLUMN IF NOT EXISTS current_execution_session_id uuid,
  ADD COLUMN IF NOT EXISTS execution_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS execution_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS executed_item_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_item_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS applied_delta_total_minor bigint NOT NULL DEFAULT 0;

DO $ddl$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.bn_uprating_execution_schedule'::regclass
              AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%PLANNED%'
  LOOP
    EXECUTE format('ALTER TABLE public.bn_uprating_execution_schedule DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $ddl$;
ALTER TABLE public.bn_uprating_execution_schedule ADD CONSTRAINT bn_uprating_execution_schedule_status_check
  CHECK (status = ANY (ARRAY['PLANNED','DUE','IN_PROGRESS','COMPLETED','SUPERSEDED','CANCELLED']));

-- ---------- Reference data ----------
INSERT INTO public.bn_uprating_reference_value(domain, code, label, description, sort_order) VALUES
 ('RUN_STATUS','AWAITING_APPROVAL','Awaiting approval','Submitted as an immutable package for independent approval.',60),
 ('RUN_STATUS','APPROVED','Approved','Independently approved and ready to be scheduled.',70),
 ('RUN_STATUS','EXECUTING','Executing','Approved changes are being applied in governed batches.',80),
 ('RUN_STATUS','COMPLETED','Completed','All approved items were applied successfully.',90),
 ('RUN_STATUS','PARTIAL','Partially applied','Some approved items could not be applied and remain outstanding.',100),
 ('RUN_STATUS','FAILED','Failed','Execution could not be completed.',110),

 ('EXECUTION_SESSION_STATUS','PLANNED','Planned','Batches prepared from the approved package; nothing applied yet.',10),
 ('EXECUTION_SESSION_STATUS','IN_PROGRESS','In progress','One or more batches have been applied.',20),
 ('EXECUTION_SESSION_STATUS','COMPLETED','Completed','All batches applied with no outstanding failures.',30),
 ('EXECUTION_SESSION_STATUS','PARTIAL','Partial','All batches attempted; some items failed.',40),

 ('EXECUTION_BATCH_STATUS','PENDING','Pending','Batch prepared and awaiting execution.',10),
 ('EXECUTION_BATCH_STATUS','COMPLETED','Completed','Every item in the batch was applied.',20),
 ('EXECUTION_BATCH_STATUS','PARTIAL','Partial','Some items in the batch failed.',30),
 ('EXECUTION_BATCH_STATUS','FAILED','Failed','No item in the batch could be applied.',40),

 ('EXECUTION_ITEM_STATUS','APPLIED','Applied','The approved amount was applied to the award.',10),
 ('EXECUTION_ITEM_STATUS','FAILED','Failed','The approved amount could not be applied.',20),
 ('EXECUTION_ITEM_STATUS','SKIPPED','Skipped','The item was already applied and was not applied again.',30),
 ('EXECUTION_ITEM_STATUS','SUPERSEDED','Superseded','A later attempt replaced this attempt.',40),

 ('EXECUTION_FAILURE_CODE','AWARD_NOT_FOUND','Award not found','The award no longer exists.',10),
 ('EXECUTION_FAILURE_CODE','STALE_ROW_VERSION','Award changed since approval','The award changed after the approved population snapshot was taken.',20),
 ('EXECUTION_FAILURE_CODE','AWARD_STATUS_CHANGED','Award status changed','The award is no longer in a state that may be uprated.',30),
 ('EXECUTION_FAILURE_CODE','AWARD_PAYMENT_HELD','Payment held','Payment on this award is held or suspended.',40),
 ('EXECUTION_FAILURE_CODE','BASE_AMOUNT_MISMATCH','Base amount changed','The current award amount no longer matches the approved base amount.',50),
 ('EXECUTION_FAILURE_CODE','TRANSIENT_ERROR','Temporary problem','A temporary problem prevented the change from being applied.',60),

 ('EXECUTION_CONFIG','MAX_BATCHES_PER_CALL','1','Number of batches applied by a single execute action.',10),
 ('EXECUTION_CONFIG','MAX_RETRY_ATTEMPTS','3','Maximum attempts allowed per approved item.',20)
ON CONFLICT (domain, code) DO NOTHING;

-- ---------- Execution session (one governed execution per run) ----------
CREATE TABLE IF NOT EXISTS public.bn_uprating_execution_session (
  session_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                uuid NOT NULL REFERENCES public.bn_uprating_run(run_id) ON DELETE CASCADE,
  schedule_id           uuid NOT NULL REFERENCES public.bn_uprating_execution_schedule(schedule_id),
  package_id            uuid NOT NULL REFERENCES public.bn_uprating_run_approval_package(package_id),
  approval_id           uuid NOT NULL REFERENCES public.bn_uprating_run_approval(approval_id),
  snapshot_id           uuid NOT NULL,
  simulation_id         uuid NOT NULL,
  input_fingerprint     text NOT NULL,
  target_effective_date date NOT NULL,
  status                text NOT NULL DEFAULT 'PLANNED'
    CHECK (status = ANY (ARRAY['PLANNED','IN_PROGRESS','COMPLETED','PARTIAL'])),
  batch_size            integer NOT NULL,
  planned_item_count    integer NOT NULL DEFAULT 0,
  planned_batch_count   integer NOT NULL DEFAULT 0,
  completed_batch_count integer NOT NULL DEFAULT 0,
  applied_item_count    integer NOT NULL DEFAULT 0,
  failed_item_count     integer NOT NULL DEFAULT 0,
  skipped_item_count    integer NOT NULL DEFAULT 0,
  approved_delta_total_minor bigint NOT NULL DEFAULT 0,
  applied_delta_total_minor  bigint NOT NULL DEFAULT 0,
  started_by            uuid NOT NULL,
  started_by_name       text,
  started_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz,
  row_version           integer NOT NULL DEFAULT 1,
  correlation_id        uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS bn_uprating_exec_session_run_uk
  ON public.bn_uprating_execution_session(run_id);
GRANT ALL ON public.bn_uprating_execution_session TO service_role;
REVOKE ALL ON public.bn_uprating_execution_session FROM anon, authenticated;
ALTER TABLE public.bn_uprating_execution_session ENABLE ROW LEVEL SECURITY;

-- ---------- Execution batch (deterministic, immutable membership) ----------
CREATE TABLE IF NOT EXISTS public.bn_uprating_execution_batch (
  batch_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES public.bn_uprating_execution_session(session_id) ON DELETE CASCADE,
  run_id          uuid NOT NULL REFERENCES public.bn_uprating_run(run_id) ON DELETE CASCADE,
  batch_no        integer NOT NULL,
  batch_kind      text NOT NULL DEFAULT 'PRIMARY'
    CHECK (batch_kind = ANY (ARRAY['PRIMARY','RETRY'])),
  retry_of_batch_id uuid REFERENCES public.bn_uprating_execution_batch(batch_id),
  status          text NOT NULL DEFAULT 'PENDING'
    CHECK (status = ANY (ARRAY['PENDING','COMPLETED','PARTIAL','FAILED'])),
  item_count      integer NOT NULL DEFAULT 0,
  applied_count   integer NOT NULL DEFAULT 0,
  failed_count    integer NOT NULL DEFAULT 0,
  skipped_count   integer NOT NULL DEFAULT 0,
  applied_delta_minor bigint NOT NULL DEFAULT 0,
  executed_by     uuid,
  executed_by_name text,
  executed_at     timestamptz,
  correlation_id  uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, batch_no)
);
CREATE INDEX IF NOT EXISTS bn_uprating_exec_batch_session_idx
  ON public.bn_uprating_execution_batch(session_id, batch_no);
GRANT ALL ON public.bn_uprating_execution_batch TO service_role;
REVOKE ALL ON public.bn_uprating_execution_batch FROM anon, authenticated;
ALTER TABLE public.bn_uprating_execution_batch ENABLE ROW LEVEL SECURITY;

-- ---------- Execution item (immutable per-attempt result) ----------
CREATE TABLE IF NOT EXISTS public.bn_uprating_execution_item (
  execution_item_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          uuid NOT NULL REFERENCES public.bn_uprating_execution_session(session_id) ON DELETE CASCADE,
  batch_id            uuid NOT NULL REFERENCES public.bn_uprating_execution_batch(batch_id) ON DELETE CASCADE,
  run_id              uuid NOT NULL REFERENCES public.bn_uprating_run(run_id) ON DELETE CASCADE,
  simulation_item_id  uuid NOT NULL,
  snapshot_item_id    uuid NOT NULL,
  award_id            uuid,
  award_reference     text NOT NULL,
  award_component_code text,
  attempt_no          integer NOT NULL DEFAULT 1,
  status              text NOT NULL DEFAULT 'PENDING'
    CHECK (status = ANY (ARRAY['PENDING','APPLIED','FAILED','SKIPPED','SUPERSEDED'])),
  approved_base_amount_minor bigint NOT NULL,
  approved_amount_minor      bigint NOT NULL,
  approved_delta_minor       bigint NOT NULL,
  applied_amount_minor       bigint,
  applied_delta_minor        bigint,
  expected_row_version integer,
  observed_row_version integer,
  applied_row_version  integer,
  award_rate_history_id uuid,
  failure_code        text,
  failure_reason      text,
  is_retryable        boolean NOT NULL DEFAULT false,
  applied_at          timestamptz,
  correlation_id      uuid,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS bn_uprating_exec_item_applied_uk
  ON public.bn_uprating_execution_item(session_id, simulation_item_id)
  WHERE status = 'APPLIED';
CREATE INDEX IF NOT EXISTS bn_uprating_exec_item_batch_idx
  ON public.bn_uprating_execution_item(batch_id, award_reference);
CREATE INDEX IF NOT EXISTS bn_uprating_exec_item_session_status_idx
  ON public.bn_uprating_execution_item(session_id, status);
GRANT ALL ON public.bn_uprating_execution_item TO service_role;
REVOKE ALL ON public.bn_uprating_execution_item FROM anon, authenticated;
ALTER TABLE public.bn_uprating_execution_item ENABLE ROW LEVEL SECURITY;

-- ---------- Execution config helper ----------
CREATE OR REPLACE FUNCTION public._bn_uprating_execution_config()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE(jsonb_object_agg(code, label), '{}'::jsonb)
    FROM public.bn_uprating_reference_value
   WHERE domain = 'EXECUTION_CONFIG' AND is_active;
$function$;

-- ---------- Governed Award target boundary ----------
CREATE OR REPLACE FUNCTION public._bn_uprating_apply_award(
  p_item_id uuid,
  p_actor_user_id uuid,
  p_run_reference text,
  p_target_effective_date date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  it public.bn_uprating_execution_item%ROWTYPE;
  aw public.bn_award%ROWTYPE;
  v_new_amount numeric(18,2);
  v_rate_id uuid;
  v_held boolean;
BEGIN
  SELECT * INTO it FROM public.bn_uprating_execution_item WHERE execution_item_id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','FAILED','failure_code','TRANSIENT_ERROR',
      'failure_reason','The execution item could not be read.','is_retryable',true);
  END IF;

  IF EXISTS (SELECT 1 FROM public.bn_uprating_execution_item x
              WHERE x.session_id = it.session_id
                AND x.simulation_item_id = it.simulation_item_id
                AND x.status = 'APPLIED') THEN
    RETURN jsonb_build_object('status','SKIPPED','failure_code',NULL,
      'failure_reason','This approved change was already applied.','is_retryable',false);
  END IF;

  SELECT * INTO aw FROM public.bn_award WHERE id = it.award_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','FAILED','failure_code','AWARD_NOT_FOUND',
      'failure_reason','The award could not be found.','is_retryable',false);
  END IF;

  IF it.expected_row_version IS NOT NULL AND aw.row_version IS DISTINCT FROM it.expected_row_version THEN
    RETURN jsonb_build_object('status','FAILED','failure_code','STALE_ROW_VERSION',
      'failure_reason','The award changed after the approved population snapshot was taken.',
      'is_retryable',false,'observed_row_version', aw.row_version);
  END IF;

  IF upper(COALESCE(aw.status,'')) NOT IN ('ACTIVE','IN_PAYMENT','CURRENT') THEN
    RETURN jsonb_build_object('status','FAILED','failure_code','AWARD_STATUS_CHANGED',
      'failure_reason','The award is no longer in a state that may be uprated.',
      'is_retryable',false,'observed_row_version', aw.row_version);
  END IF;

  IF round(COALESCE(aw.base_amount,0) * 100)::bigint IS DISTINCT FROM it.approved_base_amount_minor THEN
    RETURN jsonb_build_object('status','FAILED','failure_code','BASE_AMOUNT_MISMATCH',
      'failure_reason','The current award amount no longer matches the approved base amount.',
      'is_retryable',false,'observed_row_version', aw.row_version);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.bn_award_suspension_event se
     WHERE se.bn_award_id = aw.id
       AND COALESCE(se.status,'') IN ('ACTIVE','APPROVED','EXECUTED')
       AND (se.suspended_to IS NULL OR se.suspended_to >= p_target_effective_date)
  ) INTO v_held;
  IF v_held THEN
    RETURN jsonb_build_object('status','FAILED','failure_code','AWARD_PAYMENT_HELD',
      'failure_reason','Payment on this award is currently held or suspended.',
      'is_retryable',true,'observed_row_version', aw.row_version);
  END IF;

  v_new_amount := (it.approved_amount_minor::numeric / 100);

  UPDATE public.bn_award_rate_history
     SET effective_to = p_target_effective_date - 1, modified_at = now(),
         modified_by = left(COALESCE(p_actor_user_id::text,''),50)
   WHERE bn_award_id = aw.id
     AND effective_to IS NULL
     AND effective_from < p_target_effective_date;

  INSERT INTO public.bn_award_rate_history(bn_award_id, effective_from, rate_amount, currency,
    change_reason, reference_doc, entered_by)
  VALUES (aw.id, p_target_effective_date, v_new_amount, COALESCE(aw.currency,'XCD'),
    'UPRATING', p_run_reference, left(COALESCE(p_actor_user_id::text,''),50))
  RETURNING id INTO v_rate_id;

  UPDATE public.bn_award
     SET base_amount = v_new_amount,
         row_version = COALESCE(row_version,1) + 1,
         modified_by = left(COALESCE(p_actor_user_id::text,''),50),
         modified_at = now()
   WHERE id = aw.id
  RETURNING * INTO aw;

  RETURN jsonb_build_object('status','APPLIED','failure_code',NULL,'failure_reason',NULL,
    'is_retryable',false,'observed_row_version', it.expected_row_version,
    'applied_row_version', aw.row_version,'award_rate_history_id', v_rate_id,
    'applied_amount_minor', it.approved_amount_minor);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('status','FAILED','failure_code','TRANSIENT_ERROR',
    'failure_reason','A temporary problem prevented this change from being applied.','is_retryable',true);
END; $function$;

-- ---------- Batch runner ----------
CREATE OR REPLACE FUNCTION public._bn_uprating_execute_batch_items(
  p_batch_id uuid,
  p_actor_user_id uuid,
  p_actor_name text,
  p_run_reference text,
  p_target_effective_date date,
  p_correlation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  b public.bn_uprating_execution_batch%ROWTYPE;
  rec record; res jsonb;
  v_applied int := 0; v_failed int := 0; v_skipped int := 0; v_delta bigint := 0;
  v_status text;
BEGIN
  SELECT * INTO b FROM public.bn_uprating_execution_batch WHERE batch_id = p_batch_id FOR UPDATE;

  FOR rec IN
    SELECT execution_item_id FROM public.bn_uprating_execution_item
     WHERE batch_id = p_batch_id AND status = 'PENDING'
     ORDER BY award_reference, simulation_item_id
  LOOP
    res := public._bn_uprating_apply_award(rec.execution_item_id, p_actor_user_id,
             p_run_reference, p_target_effective_date);

    UPDATE public.bn_uprating_execution_item
       SET status = res->>'status',
           failure_code = NULLIF(res->>'failure_code',''),
           failure_reason = NULLIF(res->>'failure_reason',''),
           is_retryable = COALESCE((res->>'is_retryable')::boolean,false),
           observed_row_version = NULLIF(res->>'observed_row_version','')::int,
           applied_row_version = NULLIF(res->>'applied_row_version','')::int,
           award_rate_history_id = NULLIF(res->>'award_rate_history_id','')::uuid,
           applied_amount_minor = CASE WHEN res->>'status' = 'APPLIED' THEN approved_amount_minor END,
           applied_delta_minor = CASE WHEN res->>'status' = 'APPLIED' THEN approved_delta_minor END,
           applied_at = CASE WHEN res->>'status' = 'APPLIED' THEN now() END,
           correlation_id = p_correlation_id
     WHERE execution_item_id = rec.execution_item_id;

    IF res->>'status' = 'APPLIED' THEN
      v_applied := v_applied + 1;
      SELECT v_delta + approved_delta_minor INTO v_delta
        FROM public.bn_uprating_execution_item WHERE execution_item_id = rec.execution_item_id;
    ELSIF res->>'status' = 'SKIPPED' THEN
      v_skipped := v_skipped + 1;
    ELSE
      v_failed := v_failed + 1;
    END IF;
  END LOOP;

  v_status := CASE WHEN v_failed = 0 THEN 'COMPLETED'
                   WHEN v_applied = 0 AND v_skipped = 0 THEN 'FAILED'
                   ELSE 'PARTIAL' END;

  UPDATE public.bn_uprating_execution_batch
     SET status = v_status, applied_count = v_applied, failed_count = v_failed,
         skipped_count = v_skipped, applied_delta_minor = v_delta,
         executed_by = p_actor_user_id, executed_by_name = p_actor_name,
         executed_at = now(), correlation_id = p_correlation_id, updated_at = now()
   WHERE batch_id = p_batch_id;

  RETURN jsonb_build_object('batch_id', p_batch_id,'batch_no', b.batch_no,'status', v_status,
    'applied_count', v_applied,'failed_count', v_failed,'skipped_count', v_skipped,
    'applied_delta_minor', v_delta);
END; $function$;

-- ---------- Session roll-up ----------
CREATE OR REPLACE FUNCTION public._bn_uprating_rollup_session(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  s public.bn_uprating_execution_session%ROWTYPE;
  v_applied int; v_failed int; v_skipped int; v_delta bigint; v_done int; v_status text;
BEGIN
  SELECT * INTO s FROM public.bn_uprating_execution_session WHERE session_id = p_session_id FOR UPDATE;

  WITH latest AS (
    SELECT DISTINCT ON (simulation_item_id) *
      FROM public.bn_uprating_execution_item
     WHERE session_id = p_session_id
     ORDER BY simulation_item_id, (status='APPLIED') DESC, attempt_no DESC, created_at DESC
  )
  SELECT count(*) FILTER (WHERE status='APPLIED'),
         count(*) FILTER (WHERE status='FAILED'),
         count(*) FILTER (WHERE status='SKIPPED'),
         COALESCE(sum(applied_delta_minor) FILTER (WHERE status='APPLIED'),0)
    INTO v_applied, v_failed, v_skipped, v_delta
    FROM latest;

  SELECT count(*) INTO v_done FROM public.bn_uprating_execution_batch
   WHERE session_id = p_session_id AND status <> 'PENDING';

  v_status := CASE
    WHEN EXISTS (SELECT 1 FROM public.bn_uprating_execution_batch
                  WHERE session_id = p_session_id AND status='PENDING') THEN 'IN_PROGRESS'
    WHEN v_failed = 0 THEN 'COMPLETED'
    ELSE 'PARTIAL' END;

  UPDATE public.bn_uprating_execution_session
     SET status = v_status, applied_item_count = v_applied, failed_item_count = v_failed,
         skipped_item_count = v_skipped, applied_delta_total_minor = v_delta,
         completed_batch_count = v_done,
         completed_at = CASE WHEN v_status IN ('COMPLETED','PARTIAL') THEN now() ELSE NULL END,
         row_version = row_version + 1, updated_at = now()
   WHERE session_id = p_session_id;

  RETURN jsonb_build_object('session_id', p_session_id,'status', v_status,
    'applied_item_count', v_applied,'failed_item_count', v_failed,
    'skipped_item_count', v_skipped,'applied_delta_total_minor', v_delta,
    'completed_batch_count', v_done,'planned_batch_count', s.planned_batch_count,
    'planned_item_count', s.planned_item_count);
END; $function$;

-- ---------- Execution readiness ----------
CREATE OR REPLACE FUNCTION public._bn_uprating_execution_readiness(p_run_id uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  r public.bn_uprating_run%ROWTYPE;
  p public.bn_uprating_run_approval_package%ROWTYPE;
  a public.bn_uprating_run_approval%ROWTYPE;
  s public.bn_uprating_execution_schedule%ROWTYPE;
  es public.bn_uprating_execution_session%ROWTYPE;
  v_sim public.bn_uprating_simulation%ROWTYPE;
  v_admin boolean; v_blockers jsonb := '[]'::jsonb; v_warnings jsonb := '[]'::jsonb;
  v_pending int := 0; v_retryable int := 0; v_permanent int := 0;
BEGIN
  SELECT * INTO r FROM public.bn_uprating_run WHERE run_id = p_run_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('can_execute', false, 'can_retry', false,
      'blockers', jsonb_build_array(jsonb_build_object('code','E_NOT_FOUND',
        'message','That uprating run could not be found.')), 'warnings','[]'::jsonb);
  END IF;

  v_admin := COALESCE((public.bn_uprating_check_actor_permission(p_actor,'admin',true)->>'ok')::boolean,false);
  IF NOT v_admin THEN
    v_blockers := v_blockers || jsonb_build_object('code','E_PERMISSION',
      'message','You do not have permission to execute an uprating run.');
  END IF;

  IF r.status NOT IN ('APPROVED','EXECUTING','PARTIAL') THEN
    v_blockers := v_blockers || jsonb_build_object('code','E_INVALID_STATE',
      'message','Only an approved run that has been scheduled may be executed.');
  END IF;

  SELECT * INTO p FROM public.bn_uprating_run_approval_package WHERE package_id = r.current_approval_package_id;
  SELECT * INTO a FROM public.bn_uprating_run_approval WHERE approval_id = r.current_approval_id;
  IF p.package_id IS NULL OR a.approval_id IS NULL OR a.status <> 'APPROVED' THEN
    v_blockers := v_blockers || jsonb_build_object('code','E_NO_APPROVAL',
      'message','There is no current approved package for this run.');
  ELSIF p.simulation_id IS DISTINCT FROM r.current_simulation_id
     OR p.snapshot_id IS DISTINCT FROM r.current_snapshot_id
     OR p.input_fingerprint IS DISTINCT FROM r.input_fingerprint THEN
    v_blockers := v_blockers || jsonb_build_object('code','E_APPROVAL_STALE',
      'message','The approved package no longer matches the run. Nothing may be executed.');
  END IF;

  SELECT * INTO es FROM public.bn_uprating_execution_session WHERE run_id = p_run_id;

  IF es.session_id IS NULL THEN
    SELECT * INTO s FROM public.bn_uprating_execution_schedule
     WHERE run_id = p_run_id AND status IN ('PLANNED','DUE','IN_PROGRESS')
     ORDER BY schedule_version DESC LIMIT 1;
    IF s.schedule_id IS NULL THEN
      v_blockers := v_blockers || jsonb_build_object('code','E_NO_SCHEDULE',
        'message','Schedule the execution before it can be run.');
    ELSE
      IF now() < s.planned_execution_at THEN
        v_blockers := v_blockers || jsonb_build_object('code','E_NOT_DUE',
          'message','The planned execution time has not been reached yet.');
      END IF;
      IF s.window_end_at IS NOT NULL AND now() > s.window_end_at THEN
        v_blockers := v_blockers || jsonb_build_object('code','E_WINDOW_CLOSED',
          'message','The approved execution window has closed. Reschedule before executing.');
      END IF;
    END IF;
  ELSE
    SELECT * INTO s FROM public.bn_uprating_execution_schedule WHERE schedule_id = es.schedule_id;
    SELECT count(*) INTO v_pending FROM public.bn_uprating_execution_batch
     WHERE session_id = es.session_id AND status = 'PENDING';
    IF v_pending = 0 THEN
      v_blockers := v_blockers || jsonb_build_object('code','E_NO_PENDING_BATCH',
        'message','Every prepared batch has already been executed.');
    END IF;
  END IF;

  IF es.session_id IS NOT NULL THEN
    SELECT count(*) FILTER (WHERE is_retryable), count(*) FILTER (WHERE NOT is_retryable)
      INTO v_retryable, v_permanent
      FROM public.bn_uprating_execution_item i
     WHERE i.session_id = es.session_id AND i.status='FAILED'
       AND NOT EXISTS (SELECT 1 FROM public.bn_uprating_execution_item x
                        WHERE x.session_id = i.session_id
                          AND x.simulation_item_id = i.simulation_item_id
                          AND x.status='APPLIED');
  END IF;

  SELECT * INTO v_sim FROM public.bn_uprating_simulation WHERE simulation_id = r.current_simulation_id;

  RETURN jsonb_build_object(
    'run_id', r.run_id,
    'run_reference', r.run_reference,
    'status', r.status,
    'row_version', r.row_version,
    'can_execute', jsonb_array_length(v_blockers) = 0,
    'can_retry', v_admin AND es.session_id IS NOT NULL AND v_retryable > 0
                 AND r.status IN ('EXECUTING','PARTIAL'),
    'blockers', v_blockers,
    'warnings', v_warnings,
    'has_session', es.session_id IS NOT NULL,
    'session_status', es.status,
    'pending_batches', v_pending,
    'retryable_failures', v_retryable,
    'permanent_failures', v_permanent,
    'planned_item_count', COALESCE(es.planned_item_count, COALESCE(p.included_count,0)),
    'planned_batch_count', es.planned_batch_count,
    'schedule_id', s.schedule_id,
    'planned_execution_at', s.planned_execution_at,
    'batch_size', COALESCE(es.batch_size, s.batch_size),
    'approved_delta_total_minor', COALESCE(p.delta_total_minor, COALESCE(v_sim.delta_total_minor,0)));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_uprating_execution_readiness_v1(p_actor_user_id uuid, p_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM public._bn_uprating_require(p_actor_user_id,'read',false);
  RETURN jsonb_build_object('status','OK','code',NULL,'message',NULL,
    'data', public._bn_uprating_execution_readiness(p_run_id, p_actor_user_id));
END; $function$;

-- ---------- Epic 3 command boundary ----------
ALTER FUNCTION public.bn_uprating_run_command_v1(text,uuid,jsonb,uuid,uuid,integer,uuid,uuid)
  RENAME TO _bn_uprating_run_command_epic2;

CREATE OR REPLACE FUNCTION public.bn_uprating_run_command_v1(
  p_command_name text,
  p_actor_user_id uuid,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_run_id uuid DEFAULT NULL::uuid,
  p_exception_id uuid DEFAULT NULL::uuid,
  p_expected_row_version integer DEFAULT NULL::integer,
  p_idempotency_key uuid DEFAULT NULL::uuid,
  p_correlation_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_hash text;
  v_cache public.bn_uprating_command_idempotency%ROWTYPE;
  r public.bn_uprating_run%ROWTYPE;
  p public.bn_uprating_run_approval_package%ROWTYPE;
  a public.bn_uprating_run_approval%ROWTYPE;
  s public.bn_uprating_execution_schedule%ROWTYPE;
  es public.bn_uprating_execution_session%ROWTYPE;
  v_sim public.bn_uprating_simulation%ROWTYPE;
  v_ready jsonb; v_result jsonb; v_cfg jsonb; v_batch_res jsonb; v_roll jsonb;
  v_prev text; v_new text; v_actor_name text;
  v_batch_id uuid; v_batch_no int; v_batch_size int; v_count int;
  v_max_batches int; v_max_attempts int; v_loops int := 0;
  v_results jsonb := '[]'::jsonb; v_retry_items int := 0;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RETURN jsonb_build_object('status','ERROR','code','E_UNAUTHENTICATED','message','You must be signed in to perform this action.','data',NULL);
  END IF;

  IF p_command_name NOT IN ('BN_UPRATING_EXECUTE_BATCH','BN_UPRATING_RETRY_FAILED') THEN
    RETURN public._bn_uprating_run_command_epic2(p_command_name, p_actor_user_id, p_payload, p_run_id,
      p_exception_id, p_expected_row_version, p_idempotency_key, p_correlation_id);
  END IF;

  v_hash := md5(COALESCE(p_payload::text,''));
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_cache FROM public.bn_uprating_command_idempotency WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      IF v_cache.command_name IS DISTINCT FROM p_command_name OR v_cache.payload_hash IS DISTINCT FROM v_hash THEN
        RETURN jsonb_build_object('status','ERROR','code','E_IDEMPOTENCY_MISMATCH',
          'message','This request key has already been used with different details. Start a new request.','data',NULL);
      END IF;
      RETURN v_cache.result_json || jsonb_build_object('replayed', true);
    END IF;
  END IF;

  IF p_run_id IS NULL THEN
    RETURN jsonb_build_object('status','ERROR','code','E_INVALID_PAYLOAD','message','An uprating run must be selected.','data',NULL);
  END IF;

  PERFORM public._bn_uprating_require(p_actor_user_id,'admin',true);

  SELECT * INTO r FROM public.bn_uprating_run WHERE run_id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','ERROR','code','E_NOT_FOUND','message','That uprating run could not be found.','data',NULL);
  END IF;
  IF p_expected_row_version IS NOT NULL AND p_expected_row_version <> r.row_version THEN
    RETURN jsonb_build_object('status','ERROR','code','E_STALE_ROW_VERSION',
      'message','This run has changed since you loaded it. Reload and try again.','data',
      jsonb_build_object('row_version', r.row_version));
  END IF;

  v_actor_name := public._bn_uprating_actor_name(p_actor_user_id);
  v_cfg := public._bn_uprating_execution_config();
  v_max_batches := GREATEST(COALESCE(NULLIF(v_cfg->>'MAX_BATCHES_PER_CALL','')::int,1),1);
  v_max_attempts := GREATEST(COALESCE(NULLIF(v_cfg->>'MAX_RETRY_ATTEMPTS','')::int,3),1);
  v_prev := r.status; v_new := r.status;

  SELECT * INTO p FROM public.bn_uprating_run_approval_package WHERE package_id = r.current_approval_package_id;
  SELECT * INTO a FROM public.bn_uprating_run_approval WHERE approval_id = r.current_approval_id;
  SELECT * INTO v_sim FROM public.bn_uprating_simulation WHERE simulation_id = r.current_simulation_id;

  IF a.approval_id IS NOT NULL AND (a.submitted_by = p_actor_user_id
     OR COALESCE(v_sim.simulated_by, '00000000-0000-0000-0000-000000000000'::uuid) = p_actor_user_id) THEN
    RETURN jsonb_build_object('status','ERROR','code','E_MAKER_CHECKER',
      'message','You prepared or submitted this run, so an independent officer must execute it.','data',NULL);
  END IF;

  -- ============ EXECUTE BATCH ============
  IF p_command_name = 'BN_UPRATING_EXECUTE_BATCH' THEN
    v_ready := public._bn_uprating_execution_readiness(p_run_id, p_actor_user_id);
    IF NOT COALESCE((v_ready->>'can_execute')::boolean,false) THEN
      RETURN jsonb_build_object('status','ERROR',
        'code', COALESCE(v_ready->'blockers'->0->>'code','E_NOT_READY'),
        'message', COALESCE(v_ready->'blockers'->0->>'message','This run is not ready for execution.'),
        'data', jsonb_build_object('blockers', v_ready->'blockers'));
    END IF;

    SELECT * INTO es FROM public.bn_uprating_execution_session WHERE run_id = p_run_id FOR UPDATE;

    IF es.session_id IS NULL THEN
      SELECT * INTO s FROM public.bn_uprating_execution_schedule
       WHERE run_id = p_run_id AND status IN ('PLANNED','DUE','IN_PROGRESS')
       ORDER BY schedule_version DESC LIMIT 1 FOR UPDATE;
      v_batch_size := GREATEST(COALESCE(s.batch_size, 100), 1);

      INSERT INTO public.bn_uprating_execution_session(run_id, schedule_id, package_id, approval_id,
        snapshot_id, simulation_id, input_fingerprint, target_effective_date, status, batch_size,
        approved_delta_total_minor, started_by, started_by_name, correlation_id)
      VALUES (r.run_id, s.schedule_id, p.package_id, a.approval_id, p.snapshot_id, p.simulation_id,
        p.input_fingerprint, r.target_effective_date, 'PLANNED', v_batch_size,
        COALESCE(p.delta_total_minor,0), p_actor_user_id, v_actor_name, p_correlation_id)
      RETURNING * INTO es;

      WITH plan AS (
        SELECT si.simulation_item_id, si.snapshot_item_id, sn.award_id, si.award_reference,
               si.award_component_code, si.base_amount_minor, si.proposed_amount_minor,
               si.delta_amount_minor, sn.source_row_version,
               ((row_number() OVER (ORDER BY si.award_reference, si.simulation_item_id) - 1)
                 / es.batch_size)::int + 1 AS batch_no
          FROM public.bn_uprating_simulation_item si
          JOIN public.bn_uprating_run_snapshot_item sn ON sn.snapshot_item_id = si.snapshot_item_id
         WHERE si.simulation_id = es.simulation_id
           AND si.calculation_status = 'CALCULATED'
           AND sn.eligibility_status = 'ELIGIBLE'
           AND sn.exception_status IN ('NONE','RESOLVED')
           AND si.delta_amount_minor <> 0
      ), batches AS (
        INSERT INTO public.bn_uprating_execution_batch(session_id, run_id, batch_no, batch_kind,
          status, item_count, correlation_id)
        SELECT es.session_id, r.run_id, batch_no, 'PRIMARY', 'PENDING', count(*), p_correlation_id
          FROM plan GROUP BY batch_no
        RETURNING batch_id, batch_no
      )
      INSERT INTO public.bn_uprating_execution_item(session_id, batch_id, run_id, simulation_item_id,
        snapshot_item_id, award_id, award_reference, award_component_code, attempt_no, status,
        approved_base_amount_minor, approved_amount_minor, approved_delta_minor,
        expected_row_version, correlation_id)
      SELECT es.session_id, b.batch_id, r.run_id, pl.simulation_item_id, pl.snapshot_item_id,
             pl.award_id, pl.award_reference, pl.award_component_code, 1, 'PENDING',
             pl.base_amount_minor, pl.proposed_amount_minor, pl.delta_amount_minor,
             pl.source_row_version, p_correlation_id
        FROM plan pl JOIN batches b ON b.batch_no = pl.batch_no;

      SELECT count(*) INTO v_count FROM public.bn_uprating_execution_item WHERE session_id = es.session_id;
      UPDATE public.bn_uprating_execution_session
         SET planned_item_count = v_count,
             planned_batch_count = (SELECT count(*) FROM public.bn_uprating_execution_batch
                                     WHERE session_id = es.session_id),
             row_version = row_version + 1, updated_at = now()
       WHERE session_id = es.session_id RETURNING * INTO es;

      IF v_count = 0 THEN
        RETURN jsonb_build_object('status','ERROR','code','E_NOTHING_TO_EXECUTE',
          'message','The approved package contains no award changes to apply.','data',NULL);
      END IF;

      UPDATE public.bn_uprating_execution_schedule
         SET status='IN_PROGRESS', row_version = row_version + 1, updated_at = now()
       WHERE schedule_id = es.schedule_id;

      UPDATE public.bn_uprating_run
         SET status='EXECUTING', current_execution_session_id = es.session_id,
             execution_started_at = now(), row_version = row_version + 1, updated_at = now()
       WHERE run_id = r.run_id RETURNING * INTO r;
      v_new := 'EXECUTING';

      PERFORM public._bn_uprating_run_event(r.run_id,'EXECUTION_STARTED','Execution started',
        'Execution plan frozen from the approved package: ' || es.planned_item_count ||
        ' award change(s) in ' || es.planned_batch_count || ' batch(es).',
        v_prev, v_new, p_actor_user_id, p_correlation_id);
    ELSE
      IF r.status = 'PARTIAL' THEN
        UPDATE public.bn_uprating_run SET status='EXECUTING', row_version = row_version + 1,
               updated_at = now() WHERE run_id = r.run_id RETURNING * INTO r;
        v_new := 'EXECUTING';
      END IF;
    END IF;

    LOOP
      EXIT WHEN v_loops >= v_max_batches;
      SELECT batch_id, batch_no INTO v_batch_id, v_batch_no
        FROM public.bn_uprating_execution_batch
       WHERE session_id = es.session_id AND status='PENDING'
       ORDER BY batch_no LIMIT 1 FOR UPDATE;
      EXIT WHEN v_batch_id IS NULL;

      v_batch_res := public._bn_uprating_execute_batch_items(v_batch_id, p_actor_user_id, v_actor_name,
        r.run_reference, r.target_effective_date, p_correlation_id);
      v_results := v_results || v_batch_res;
      v_loops := v_loops + 1;
      v_batch_id := NULL;
    END LOOP;

    v_roll := public._bn_uprating_rollup_session(es.session_id);

    v_new := CASE WHEN v_roll->>'status' = 'IN_PROGRESS' THEN 'EXECUTING'
                  WHEN v_roll->>'status' = 'COMPLETED' THEN 'COMPLETED'
                  ELSE 'PARTIAL' END;

    UPDATE public.bn_uprating_run
       SET status = v_new,
           executed_item_count = (v_roll->>'applied_item_count')::int,
           failed_item_count = (v_roll->>'failed_item_count')::int,
           applied_delta_total_minor = (v_roll->>'applied_delta_total_minor')::bigint,
           execution_completed_at = CASE WHEN v_new IN ('COMPLETED','PARTIAL') THEN now() ELSE NULL END,
           row_version = row_version + 1, updated_at = now()
     WHERE run_id = r.run_id RETURNING * INTO r;

    IF v_new IN ('COMPLETED','PARTIAL') THEN
      UPDATE public.bn_uprating_execution_schedule SET status='COMPLETED',
             row_version = row_version + 1, updated_at = now()
       WHERE schedule_id = es.schedule_id;
    END IF;

    PERFORM public._bn_uprating_run_event(r.run_id,'BATCH_EXECUTED','Batch executed',
      v_loops || ' batch(es) applied. Applied ' || (v_roll->>'applied_item_count') ||
      ', outstanding failures ' || (v_roll->>'failed_item_count') || '.',
      v_prev, v_new, p_actor_user_id, p_correlation_id);

    v_result := jsonb_build_object('status','OK','code',NULL,
      'message', CASE WHEN v_new='COMPLETED' THEN 'Execution complete. All approved changes were applied.'
                      WHEN v_new='PARTIAL' THEN 'Execution finished with outstanding failures. Retry the eligible items.'
                      ELSE 'Batch applied. More batches remain.' END,
      'data', jsonb_build_object('run_id', r.run_id,'status', r.status,'row_version', r.row_version,
        'session_id', es.session_id,'batches_executed', v_loops,'batch_results', v_results,
        'session', v_roll));

  -- ============ RETRY FAILED ============
  ELSE
    SELECT * INTO es FROM public.bn_uprating_execution_session WHERE run_id = p_run_id FOR UPDATE;
    IF es.session_id IS NULL THEN
      RETURN jsonb_build_object('status','ERROR','code','E_NO_SESSION',
        'message','This run has not been executed yet, so there is nothing to retry.','data',NULL);
    END IF;
    IF r.status NOT IN ('EXECUTING','PARTIAL') THEN
      RETURN jsonb_build_object('status','ERROR','code','E_INVALID_STATE',
        'message','Only a run with outstanding execution failures may be retried.','data',NULL);
    END IF;
    IF EXISTS (SELECT 1 FROM public.bn_uprating_execution_batch
                WHERE session_id = es.session_id AND status='PENDING') THEN
      RETURN jsonb_build_object('status','ERROR','code','E_BATCHES_PENDING',
        'message','Finish executing the prepared batches before retrying failed items.','data',NULL);
    END IF;

    SELECT COALESCE(max(batch_no),0) + 1 INTO v_batch_no
      FROM public.bn_uprating_execution_batch WHERE session_id = es.session_id;

    INSERT INTO public.bn_uprating_execution_batch(session_id, run_id, batch_no, batch_kind,
      status, item_count, correlation_id)
    VALUES (es.session_id, r.run_id, v_batch_no, 'RETRY', 'PENDING', 0, p_correlation_id)
    RETURNING batch_id INTO v_batch_id;

    WITH latest AS (
      SELECT DISTINCT ON (i.simulation_item_id) i.*
        FROM public.bn_uprating_execution_item i
       WHERE i.session_id = es.session_id
       ORDER BY i.simulation_item_id, i.attempt_no DESC, i.created_at DESC
    ), eligible AS (
      SELECT l.* FROM latest l
       WHERE l.status = 'FAILED' AND l.is_retryable
         AND l.attempt_no < v_max_attempts
         AND NOT EXISTS (SELECT 1 FROM public.bn_uprating_execution_item x
                          WHERE x.session_id = es.session_id
                            AND x.simulation_item_id = l.simulation_item_id
                            AND x.status='APPLIED')
    ), superseded AS (
      UPDATE public.bn_uprating_execution_item t SET status='SUPERSEDED'
        FROM eligible e WHERE t.execution_item_id = e.execution_item_id
      RETURNING t.execution_item_id
    )
    INSERT INTO public.bn_uprating_execution_item(session_id, batch_id, run_id, simulation_item_id,
      snapshot_item_id, award_id, award_reference, award_component_code, attempt_no, status,
      approved_base_amount_minor, approved_amount_minor, approved_delta_minor,
      expected_row_version, correlation_id)
    SELECT es.session_id, v_batch_id, r.run_id, e.simulation_item_id, e.snapshot_item_id,
           e.award_id, e.award_reference, e.award_component_code, e.attempt_no + 1, 'PENDING',
           e.approved_base_amount_minor, e.approved_amount_minor, e.approved_delta_minor,
           e.expected_row_version, p_correlation_id
      FROM eligible e;

    SELECT count(*) INTO v_retry_items FROM public.bn_uprating_execution_item WHERE batch_id = v_batch_id;

    IF v_retry_items = 0 THEN
      DELETE FROM public.bn_uprating_execution_batch WHERE batch_id = v_batch_id;
      RETURN jsonb_build_object('status','ERROR','code','E_NO_RETRYABLE_ITEMS',
        'message','There are no eligible items to retry. Remaining failures need to be corrected at source.','data',NULL);
    END IF;

    UPDATE public.bn_uprating_execution_batch SET item_count = v_retry_items WHERE batch_id = v_batch_id;
    UPDATE public.bn_uprating_execution_session
       SET planned_batch_count = planned_batch_count + 1, status='IN_PROGRESS',
           row_version = row_version + 1, updated_at = now()
     WHERE session_id = es.session_id;
    UPDATE public.bn_uprating_run SET status='EXECUTING', row_version = row_version + 1,
           updated_at = now() WHERE run_id = r.run_id RETURNING * INTO r;

    v_batch_res := public._bn_uprating_execute_batch_items(v_batch_id, p_actor_user_id, v_actor_name,
      r.run_reference, r.target_effective_date, p_correlation_id);
    v_roll := public._bn_uprating_rollup_session(es.session_id);

    v_new := CASE WHEN v_roll->>'status' = 'COMPLETED' THEN 'COMPLETED' ELSE 'PARTIAL' END;
    UPDATE public.bn_uprating_run
       SET status = v_new,
           executed_item_count = (v_roll->>'applied_item_count')::int,
           failed_item_count = (v_roll->>'failed_item_count')::int,
           applied_delta_total_minor = (v_roll->>'applied_delta_total_minor')::bigint,
           execution_completed_at = now(), row_version = row_version + 1, updated_at = now()
     WHERE run_id = r.run_id RETURNING * INTO r;

    PERFORM public._bn_uprating_run_event(r.run_id,'RETRY_EXECUTED','Failed items retried',
      v_retry_items || ' item(s) retried. Applied ' || (v_batch_res->>'applied_count') ||
      ', still failing ' || (v_batch_res->>'failed_count') || '.',
      v_prev, v_new, p_actor_user_id, p_correlation_id);

    v_result := jsonb_build_object('status','OK','code',NULL,
      'message', CASE WHEN v_new='COMPLETED' THEN 'Retry complete. All approved changes are now applied.'
                      ELSE 'Retry finished. Some items still could not be applied.' END,
      'data', jsonb_build_object('run_id', r.run_id,'status', r.status,'row_version', r.row_version,
        'session_id', es.session_id,'retry_batch_no', v_batch_no,'retried_item_count', v_retry_items,
        'batch_result', v_batch_res,'session', v_roll));
  END IF;

  INSERT INTO public.bn_uprating_command_audit(command_name, run_id, policy_id, policy_version_id,
    previous_status, new_status, actor_user_id, actor_name, reason_code, justification,
    payload, result_status, correlation_id, idempotency_key)
  VALUES (p_command_name, r.run_id, r.policy_id, r.policy_version_id, v_prev, v_new,
    p_actor_user_id, v_actor_name, NULLIF(p_payload->>'reason_code',''),
    NULLIF(p_payload->>'justification',''), p_payload, v_result->>'status',
    p_correlation_id, p_idempotency_key);

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.bn_uprating_command_idempotency(idempotency_key, command_name, payload_hash,
      result_json, actor_user_id, correlation_id)
    VALUES (p_idempotency_key, p_command_name, v_hash, v_result, p_actor_user_id, p_correlation_id)
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN v_result;
END; $function$;

-- ---------- Execution reads ----------
CREATE OR REPLACE FUNCTION public.bn_uprating_run_execution_v1(p_actor_user_id uuid, p_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  r public.bn_uprating_run%ROWTYPE;
  es public.bn_uprating_execution_session%ROWTYPE;
  s public.bn_uprating_execution_schedule%ROWTYPE;
BEGIN
  PERFORM public._bn_uprating_require(p_actor_user_id,'read',false);
  SELECT * INTO r FROM public.bn_uprating_run WHERE run_id = p_run_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','ERROR','code','E_NOT_FOUND','message','That uprating run could not be found.','data',NULL);
  END IF;
  SELECT * INTO es FROM public.bn_uprating_execution_session WHERE run_id = p_run_id;
  IF es.session_id IS NOT NULL THEN
    SELECT * INTO s FROM public.bn_uprating_execution_schedule WHERE schedule_id = es.schedule_id;
  END IF;

  RETURN jsonb_build_object('status','OK','code',NULL,'message',NULL,'data', jsonb_build_object(
    'run_id', r.run_id,'run_reference', r.run_reference,'run_status', r.status,
    'has_session', es.session_id IS NOT NULL,
    'session', CASE WHEN es.session_id IS NULL THEN NULL ELSE jsonb_build_object(
      'session_id', es.session_id,'status', es.status,'batch_size', es.batch_size,
      'planned_item_count', es.planned_item_count,'planned_batch_count', es.planned_batch_count,
      'completed_batch_count', es.completed_batch_count,'applied_item_count', es.applied_item_count,
      'failed_item_count', es.failed_item_count,'skipped_item_count', es.skipped_item_count,
      'approved_delta_total_minor', es.approved_delta_total_minor,
      'applied_delta_total_minor', es.applied_delta_total_minor,
      'target_effective_date', es.target_effective_date,
      'input_fingerprint', es.input_fingerprint,
      'started_by_name', es.started_by_name,'started_at', es.started_at,
      'completed_at', es.completed_at,'row_version', es.row_version,
      'planned_execution_at', s.planned_execution_at,'time_zone', s.time_zone) END,
    'batches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'batch_id', b.batch_id,'batch_no', b.batch_no,'batch_kind', b.batch_kind,
        'status', b.status,'item_count', b.item_count,'applied_count', b.applied_count,
        'failed_count', b.failed_count,'skipped_count', b.skipped_count,
        'applied_delta_minor', b.applied_delta_minor,'executed_by_name', b.executed_by_name,
        'executed_at', b.executed_at) ORDER BY b.batch_no)
      FROM public.bn_uprating_execution_batch b WHERE b.session_id = es.session_id),'[]'::jsonb),
    'failure_summary', COALESCE((
      SELECT jsonb_agg(x ORDER BY x->>'failure_code')
        FROM (SELECT jsonb_build_object('failure_code', i.failure_code,
                 'label', public._bn_uprating_ref_label('EXECUTION_FAILURE_CODE', i.failure_code),
                 'count', count(*),'retryable', bool_or(i.is_retryable)) AS x
                FROM public.bn_uprating_execution_item i
               WHERE i.session_id = es.session_id AND i.status='FAILED'
               GROUP BY i.failure_code) q),'[]'::jsonb)));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_uprating_execution_items_v1(
  p_actor_user_id uuid, p_run_id uuid, p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  es public.bn_uprating_execution_session%ROWTYPE;
  v_status text; v_batch uuid; v_search text; v_total int; v_rows jsonb;
BEGIN
  PERFORM public._bn_uprating_require(p_actor_user_id,'read',false);
  SELECT * INTO es FROM public.bn_uprating_execution_session WHERE run_id = p_run_id;
  IF es.session_id IS NULL THEN
    RETURN jsonb_build_object('status','OK','code',NULL,'message',NULL,
      'data', jsonb_build_object('rows','[]'::jsonb,'total',0,'session_id',NULL));
  END IF;
  v_status := NULLIF(trim(COALESCE(p_filters->>'status','')),'');
  v_batch  := NULLIF(p_filters->>'batch_id','')::uuid;
  v_search := NULLIF(trim(COALESCE(p_filters->>'search','')),'');

  SELECT count(*) INTO v_total FROM public.bn_uprating_execution_item i
   WHERE i.session_id = es.session_id
     AND (v_status IS NULL OR i.status = v_status)
     AND (v_batch IS NULL OR i.batch_id = v_batch)
     AND (v_search IS NULL OR i.award_reference ILIKE '%'||v_search||'%');

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'award_reference'),'[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object(
      'execution_item_id', i.execution_item_id,'batch_id', i.batch_id,
      'batch_no', b.batch_no,'batch_kind', b.batch_kind,
      'award_reference', i.award_reference,'award_component_code', i.award_component_code,
      'attempt_no', i.attempt_no,'status', i.status,
      'status_label', public._bn_uprating_ref_label('EXECUTION_ITEM_STATUS', i.status),
      'approved_base_amount_minor', i.approved_base_amount_minor,
      'approved_amount_minor', i.approved_amount_minor,
      'approved_delta_minor', i.approved_delta_minor,
      'applied_amount_minor', i.applied_amount_minor,
      'applied_delta_minor', i.applied_delta_minor,
      'expected_row_version', i.expected_row_version,
      'observed_row_version', i.observed_row_version,
      'applied_row_version', i.applied_row_version,
      'failure_code', i.failure_code,
      'failure_label', public._bn_uprating_ref_label('EXECUTION_FAILURE_CODE', i.failure_code),
      'failure_reason', i.failure_reason,'is_retryable', i.is_retryable,
      'applied_at', i.applied_at) AS x
      FROM public.bn_uprating_execution_item i
      JOIN public.bn_uprating_execution_batch b ON b.batch_id = i.batch_id
     WHERE i.session_id = es.session_id
       AND (v_status IS NULL OR i.status = v_status)
       AND (v_batch IS NULL OR i.batch_id = v_batch)
       AND (v_search IS NULL OR i.award_reference ILIKE '%'||v_search||'%')
     ORDER BY i.award_reference, i.attempt_no
     LIMIT GREATEST(COALESCE(p_limit,50),1) OFFSET GREATEST(COALESCE(p_offset,0),0)) q;

  RETURN jsonb_build_object('status','OK','code',NULL,'message',NULL,
    'data', jsonb_build_object('rows', v_rows,'total', v_total,'session_id', es.session_id));
END; $function$;

CREATE OR REPLACE FUNCTION public.bn_uprating_execution_queue_v1(
  p_actor_user_id uuid, p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_total int; v_rows jsonb;
BEGIN
  PERFORM public._bn_uprating_require(p_actor_user_id,'read',false);
  SELECT count(*) INTO v_total FROM public.bn_uprating_run r
   WHERE r.status IN ('EXECUTING','PARTIAL','COMPLETED')
      OR (r.status='APPROVED' AND r.current_schedule_id IS NOT NULL);

  SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object(
      'run_id', r.run_id,'run_reference', r.run_reference,'run_name', r.run_name,
      'status', r.status,
      'status_label', public._bn_uprating_ref_label('RUN_STATUS', r.status),
      'target_effective_date', r.target_effective_date,
      'planned_item_count', COALESCE(es.planned_item_count,0),
      'applied_item_count', COALESCE(es.applied_item_count,0),
      'failed_item_count', COALESCE(es.failed_item_count,0),
      'planned_batch_count', COALESCE(es.planned_batch_count,0),
      'completed_batch_count', COALESCE(es.completed_batch_count,0),
      'applied_delta_total_minor', COALESCE(es.applied_delta_total_minor,0),
      'approved_delta_total_minor', COALESCE(es.approved_delta_total_minor,0),
      'planned_execution_at', s.planned_execution_at,
      'execution_started_at', r.execution_started_at,
      'execution_completed_at', r.execution_completed_at) AS x
      FROM public.bn_uprating_run r
      LEFT JOIN public.bn_uprating_execution_session es ON es.run_id = r.run_id
      LEFT JOIN public.bn_uprating_execution_schedule s ON s.schedule_id = r.current_schedule_id
     WHERE r.status IN ('EXECUTING','PARTIAL','COMPLETED')
        OR (r.status='APPROVED' AND r.current_schedule_id IS NOT NULL)
     ORDER BY COALESCE(r.execution_started_at, s.planned_execution_at, r.updated_at) DESC
     LIMIT GREATEST(COALESCE(p_limit,25),1) OFFSET GREATEST(COALESCE(p_offset,0),0)) q;

  RETURN jsonb_build_object('status','OK','code',NULL,'message',NULL,
    'data', jsonb_build_object('rows', v_rows,'total', v_total));
END; $function$;

-- ---------- Actions surface (Epic 0-3) ----------
CREATE OR REPLACE FUNCTION public.bn_uprating_run_actions_v1(p_actor_user_id uuid, p_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r public.bn_uprating_run%ROWTYPE; v_write boolean; v_decide boolean; v_admin boolean;
  v_block int := 0; v_actions jsonb := '[]'::jsonb; v_pre boolean;
  a public.bn_uprating_run_approval%ROWTYPE; s public.bn_uprating_execution_schedule%ROWTYPE;
  v_ready jsonb; v_exec jsonb; v_maker boolean := false;
BEGIN
  PERFORM public._bn_uprating_require(p_actor_user_id,'read',false);
  SELECT * INTO r FROM public.bn_uprating_run WHERE run_id = p_run_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','ERROR','code','E_NOT_FOUND','message','That uprating run could not be found.','data',NULL);
  END IF;
  v_write  := COALESCE((public.bn_uprating_check_actor_permission(p_actor_user_id,'write',true)->>'ok')::boolean,false);
  v_decide := COALESCE((public.bn_uprating_check_actor_permission(p_actor_user_id,'decide',true)->>'ok')::boolean,false);
  v_admin  := COALESCE((public.bn_uprating_check_actor_permission(p_actor_user_id,'admin',true)->>'ok')::boolean,false);
  v_pre := r.status IN ('DRAFT','PARAMETERISED','ELIGIBILITY_SNAPSHOT','EXCLUSIONS_APPLIED','DRY_RUN');
  IF r.current_snapshot_id IS NOT NULL THEN
    SELECT count(*) INTO v_block FROM public.bn_uprating_run_exception
     WHERE snapshot_id = r.current_snapshot_id AND resolution_status='OPEN' AND is_blocking;
  END IF;

  v_actions := v_actions || jsonb_build_object('command','BN_UPRATING_UPDATE_RUN','label','Edit run',
    'available', v_write AND r.status='DRAFT',
    'reason', CASE WHEN NOT v_write THEN 'You do not have permission to edit runs.'
                   WHEN r.status<>'DRAFT' THEN 'Only a draft run can be edited.' ELSE NULL END);
  v_actions := v_actions || jsonb_build_object('command','BN_UPRATING_PARAMETERISE_RUN','label','Lock parameters',
    'available', v_write AND r.status='DRAFT',
    'reason', CASE WHEN NOT v_write THEN 'You do not have permission to lock run parameters.'
                   WHEN r.status<>'DRAFT' THEN 'Parameters are already locked.' ELSE NULL END);
  v_actions := v_actions || jsonb_build_object('command','BN_UPRATING_BUILD_POPULATION',
    'label', CASE WHEN r.current_snapshot_id IS NULL THEN 'Build population' ELSE 'Rebuild population' END,
    'available', v_decide AND r.status IN ('PARAMETERISED','ELIGIBILITY_SNAPSHOT','EXCLUSIONS_APPLIED','DRY_RUN'),
    'reason', CASE WHEN NOT v_decide THEN 'You do not have permission to build the population.'
                   WHEN r.status='DRAFT' THEN 'Lock the run parameters first.'
                   WHEN NOT v_pre THEN 'The run is locked while it is in approval, scheduling or execution.' ELSE NULL END);
  v_actions := v_actions || jsonb_build_object('command','BN_UPRATING_RESOLVE_EXCEPTION','label','Resolve exceptions',
    'available', v_decide AND v_pre AND r.current_snapshot_id IS NOT NULL AND v_block > 0,
    'reason', CASE WHEN NOT v_decide THEN 'You do not have permission to resolve exceptions.'
                   WHEN NOT v_pre THEN 'The run is locked while it is in approval, scheduling or execution.'
                   WHEN r.current_snapshot_id IS NULL THEN 'Build the population first.'
                   WHEN v_block = 0 THEN 'There are no open blocking exceptions.' ELSE NULL END);
  v_actions := v_actions || jsonb_build_object('command','BN_UPRATING_SIMULATE','label','Run simulation',
    'available', v_decide AND v_pre AND r.current_snapshot_id IS NOT NULL AND v_block = 0
                 AND COALESCE(r.frozen_policy_type,'') NOT IN ('FORMULA_DRIVEN','MANUAL_IMPORT'),
    'reason', CASE WHEN NOT v_decide THEN 'You do not have permission to simulate.'
                   WHEN NOT v_pre THEN 'The run is locked while it is in approval, scheduling or execution.'
                   WHEN r.current_snapshot_id IS NULL THEN 'Build the population first.'
                   WHEN v_block > 0 THEN 'Resolve all blocking exceptions first.'
                   WHEN COALESCE(r.frozen_policy_type,'') IN ('FORMULA_DRIVEN','MANUAL_IMPORT')
                        THEN 'This policy method cannot be simulated automatically in this release.'
                   ELSE NULL END);

  v_ready := public._bn_uprating_approval_readiness(p_run_id, p_actor_user_id);
  v_actions := v_actions || jsonb_build_object('command','BN_UPRATING_SUBMIT_RUN_FOR_APPROVAL','label','Submit for approval',
    'available', COALESCE((v_ready->>'can_submit')::boolean,false),
    'reason', v_ready->'blockers'->0->>'message');

  SELECT * INTO a FROM public.bn_uprating_run_approval
   WHERE run_id = r.run_id AND status='PENDING' ORDER BY cycle_no DESC LIMIT 1;
  IF a.approval_id IS NOT NULL THEN
    v_maker := a.submitted_by = p_actor_user_id
      OR EXISTS (SELECT 1 FROM public.bn_uprating_simulation x
                  WHERE x.simulation_id = r.current_simulation_id AND x.simulated_by = p_actor_user_id);
  END IF;
  v_actions := v_actions || jsonb_build_object('command','BN_UPRATING_APPROVE_RUN','label','Record approval decision',
    'available', v_admin AND r.status='AWAITING_APPROVAL' AND a.approval_id IS NOT NULL AND NOT v_maker,
    'reason', CASE WHEN NOT v_admin THEN 'You do not have permission to decide uprating approvals.'
                   WHEN r.status<>'AWAITING_APPROVAL' THEN 'This run is not awaiting an approval decision.'
                   WHEN v_maker THEN 'You prepared or submitted this run, so an independent officer must decide it.'
                   ELSE NULL END);

  SELECT * INTO s FROM public.bn_uprating_execution_schedule
   WHERE run_id = r.run_id AND status IN ('PLANNED','DUE') ORDER BY schedule_version DESC LIMIT 1;
  v_actions := v_actions || jsonb_build_object('command','BN_UPRATING_SCHEDULE_EXECUTION','label','Schedule execution',
    'available', v_admin AND r.status='APPROVED' AND s.schedule_id IS NULL,
    'reason', CASE WHEN NOT v_admin THEN 'You do not have permission to schedule execution.'
                   WHEN r.status<>'APPROVED' THEN 'Only an approved run may be scheduled.'
                   WHEN s.schedule_id IS NOT NULL THEN 'This run already has an active execution schedule.'
                   ELSE NULL END);
  v_actions := v_actions || jsonb_build_object('command','BN_UPRATING_RESCHEDULE_EXECUTION','label','Reschedule execution',
    'available', v_admin AND r.status='APPROVED' AND s.schedule_id IS NOT NULL,
    'reason', CASE WHEN NOT v_admin THEN 'You do not have permission to schedule execution.'
                   WHEN s.schedule_id IS NULL THEN 'There is no active execution schedule.' ELSE NULL END);
  v_actions := v_actions || jsonb_build_object('command','BN_UPRATING_CANCEL_EXECUTION_SCHEDULE','label','Cancel schedule',
    'available', v_admin AND r.status='APPROVED' AND s.schedule_id IS NOT NULL,
    'reason', CASE WHEN NOT v_admin THEN 'You do not have permission to schedule execution.'
                   WHEN r.status<>'APPROVED' THEN 'Execution has started, so the schedule can no longer be cancelled.'
                   WHEN s.schedule_id IS NULL THEN 'There is no active execution schedule.' ELSE NULL END);

  v_exec := public._bn_uprating_execution_readiness(p_run_id, p_actor_user_id);
  v_actions := v_actions || jsonb_build_object('command','BN_UPRATING_EXECUTE_BATCH',
    'label', CASE WHEN COALESCE((v_exec->>'has_session')::boolean,false) THEN 'Execute next batch' ELSE 'Start execution' END,
    'available', COALESCE((v_exec->>'can_execute')::boolean,false),
    'reason', v_exec->'blockers'->0->>'message');
  v_actions := v_actions || jsonb_build_object('command','BN_UPRATING_RETRY_FAILED','label','Retry failed items',
    'available', COALESCE((v_exec->>'can_retry')::boolean,false),
    'reason', CASE WHEN NOT v_admin THEN 'You do not have permission to retry execution failures.'
                   WHEN NOT COALESCE((v_exec->>'has_session')::boolean,false) THEN 'This run has not been executed yet.'
                   WHEN COALESCE((v_exec->>'retryable_failures')::int,0) = 0 THEN 'There are no eligible items to retry.'
                   ELSE NULL END);

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'run_id', r.run_id,'status', r.status,'row_version', r.row_version,
    'simulation_state', r.simulation_state,'blocking_exceptions', v_block,
    'approval_cycle_count', r.approval_cycle_count,
    'has_active_schedule', s.schedule_id IS NOT NULL,
    'has_execution_session', COALESCE((v_exec->>'has_session')::boolean,false),
    'pending_batches', COALESCE((v_exec->>'pending_batches')::int,0),
    'retryable_failures', COALESCE((v_exec->>'retryable_failures')::int,0),
    'actions', v_actions));
END; $function$;

-- ---------- Grants ----------
REVOKE ALL ON FUNCTION public._bn_uprating_run_command_epic2(text,uuid,jsonb,uuid,uuid,integer,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_uprating_apply_award(uuid,uuid,text,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_uprating_execute_batch_items(uuid,uuid,text,text,date,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_uprating_rollup_session(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bn_uprating_execution_readiness(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bn_uprating_run_command_v1(text,uuid,jsonb,uuid,uuid,integer,uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_uprating_execution_readiness_v1(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_uprating_run_execution_v1(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_uprating_execution_items_v1(uuid,uuid,jsonb,integer,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_uprating_execution_queue_v1(uuid,jsonb,integer,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_uprating_run_actions_v1(uuid,uuid) TO authenticated, service_role;