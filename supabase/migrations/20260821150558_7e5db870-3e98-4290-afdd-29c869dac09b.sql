SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE usename = 'supabase_read_only_user'
  AND state = 'active'
  AND query_start < clock_timestamp() - interval '30 seconds'
  AND application_name = 'mgmt-api';

NOTIFY pgrst, 'reload schema';