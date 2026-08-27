-- Give the routing backfill batch function room to finish a batch without
-- being cut short by the default statement timeout.
ALTER FUNCTION public.fn_ce_route_unassigned_violations(integer)
  SET statement_timeout TO '240s';
ALTER FUNCTION public.fn_ce_route_unassigned_backfill(integer,integer,text)
  SET statement_timeout TO '240s';