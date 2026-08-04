-- Verification queries for the BN Award Suspension defect-correction pass.
-- Read-only.

-- 1. Hold-release boundary signature now carries the effective date.
SELECT pg_get_function_identity_arguments(oid) AS args
  FROM pg_proc WHERE proname = '_bn_susp_release_holds';

-- 2. Restricted operational error log exists and is not reachable by clients.
SELECT grantee, privilege_type
  FROM information_schema.role_table_grants
 WHERE table_name = 'bn_susp_operational_error_log'
 ORDER BY grantee, privilege_type;

-- 3. No raw SQLERRM is persisted on cases: stored values must be approved codes.
SELECT DISTINCT last_execution_error
  FROM public.bn_award_suspension_event
 WHERE last_execution_error IS NOT NULL;

-- 4. Communication boundary: the suspension flow no longer writes queued rows.
SELECT count(*) AS suspension_rows_in_bn_communication_log
  FROM public.bn_communication_log
 WHERE context ? 'module' AND context->>'module' = 'bn_award_suspension';

-- 5. Every executed reinstatement has persisted calculation evidence.
SELECT e.id, e.arrears_calc_run_id, r.id AS calc_run_exists,
       (SELECT count(*) FROM public.bn_calc_trace t WHERE t.calc_run_id = r.id) AS trace_steps
  FROM public.bn_award_suspension_event e
  LEFT JOIN public.bn_calc_run r ON r.id = e.arrears_calc_run_id
 WHERE e.case_kind = 'REINSTATEMENT' AND e.execution_status = 'EXECUTED';

-- 6. No suspended-period payment was both released and re-paid via arrears.
SELECT pi.suspension_id, count(*) AS released_inside_suspended_period
  FROM public.bn_award_suspension_payment_impact pi
  JOIN public.bn_award_suspension_event s ON s.id = pi.suspension_id
 WHERE pi.phase = 'REINSTATEMENT' AND pi.impact_action = 'RELEASED'
   AND coalesce((pi.detail->>'period_end')::date, (pi.detail->>'due_date')::date)
       < (pi.detail->>'effective_date')::date
 GROUP BY pi.suspension_id;

-- 7. Straddling periods carry an open proration exception.
SELECT pi.record_id, pi.exception_id, e.status
  FROM public.bn_award_suspension_payment_impact pi
  LEFT JOIN public.bn_payment_exception e ON e.id = pi.exception_id
 WHERE pi.reason = 'STRADDLES_REINSTATEMENT_REQUIRES_PRORATION';

-- 8. Execution grants remain narrow.
SELECT p.proname, r.rolname
  FROM pg_proc p, aclexplode(p.proacl) a, pg_roles r
 WHERE p.proname IN ('bn_award_suspension_execute_v1',
                     'bn_award_suspension_execute_scheduled_v1',
                     'bn_award_reinstatement_execute_v1')
   AND a.grantee = r.oid AND a.privilege_type = 'EXECUTE'
   AND r.rolname IN ('anon','authenticated','service_role')
 ORDER BY 1,2;
