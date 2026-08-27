ALTER ROLE authenticator SET statement_timeout = '15s';
ALTER ROLE authenticator SET lock_timeout = '5s';

SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE usename = 'authenticator'
  AND state = 'active'
  AND query_start < clock_timestamp() - interval '30 seconds'
  AND query ILIKE '%Recursively get the base types of domains%';

NOTIFY pgrst, 'reload schema';