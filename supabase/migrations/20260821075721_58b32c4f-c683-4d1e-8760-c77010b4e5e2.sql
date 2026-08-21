DO $$
DECLARE
  session_record record;
BEGIN
  FOR session_record IN
    SELECT pid
    FROM pg_stat_activity
    WHERE application_name = 'postgrest'
      AND usename = 'authenticator'
      AND pid <> pg_backend_pid()
  LOOP
    PERFORM pg_terminate_backend(session_record.pid);
  END LOOP;
END
$$;