-- Two overloads made every cron call ambiguous ("function is not unique"),
-- so the delivery worker never ran. The purpose-aware variant is canonical.
DROP FUNCTION IF EXISTS public.omni_comms_priv_scheduler_issue_ticket();