-- Controlled, resumable, idempotent backfill runner for violation routing.
CREATE TABLE IF NOT EXISTS public.ce_violation_routing_backfill_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_key text NOT NULL,
  batch_no int NOT NULL,
  batch_size int NOT NULL,
  routed int NOT NULL DEFAULT 0,
  failed int NOT NULL DEFAULT 0,
  remaining bigint NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ce_violation_routing_backfill_log TO authenticated;
GRANT ALL ON public.ce_violation_routing_backfill_log TO service_role;
ALTER TABLE public.ce_violation_routing_backfill_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ce_vrbl_read ON public.ce_violation_routing_backfill_log;
CREATE POLICY ce_vrbl_read ON public.ce_violation_routing_backfill_log FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.fn_ce_route_unassigned_backfill(
  p_batch_size int DEFAULT 2000,
  p_max_batches int DEFAULT 10,
  p_run_key text DEFAULT 'default'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_start bigint; v_remaining bigint; v_res jsonb;
  v_routed int := 0; v_failed int := 0; v_i int := 0; v_batch int;
BEGIN
  SELECT count(*) INTO v_start FROM ce_violations
   WHERE coalesce(is_deleted,false)=false
     AND assigned_queue_id IS NULL AND assigned_to_user_id IS NULL
     AND status NOT IN ('RESOLVED','CLOSED','CANCELLED');
  v_remaining := v_start;

  WHILE v_i < GREATEST(1, p_max_batches) AND v_remaining > 0 LOOP
    v_i := v_i + 1;
    v_res := public.fn_ce_route_unassigned_violations(GREATEST(1, LEAST(p_batch_size, 20000)));
    v_batch := coalesce((v_res->>'routed')::int,0);
    v_routed := v_routed + v_batch;
    v_failed := v_failed + coalesce((v_res->>'failed')::int,0);

    SELECT count(*) INTO v_remaining FROM ce_violations
     WHERE coalesce(is_deleted,false)=false
       AND assigned_queue_id IS NULL AND assigned_to_user_id IS NULL
       AND status NOT IN ('RESOLVED','CLOSED','CANCELLED');

    INSERT INTO public.ce_violation_routing_backfill_log
      (run_key, batch_no, batch_size, routed, failed, remaining)
    VALUES (p_run_key, v_i, p_batch_size, v_batch,
            coalesce((v_res->>'failed')::int,0), v_remaining);

    -- no progress => stop (all remaining are permanently unroutable)
    EXIT WHEN v_batch = 0;
  END LOOP;

  RETURN jsonb_build_object(
    'run_key', p_run_key, 'starting_unassigned', v_start,
    'batches', v_i, 'routed', v_routed, 'failed', v_failed,
    'remaining', v_remaining);
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_ce_route_unassigned_backfill(int,int,text) TO service_role;