-- Recovery: PostgREST (the Data API) builds its schema cache using the `authenticator`
-- role. With ~1851 relations in this database the cache-loading queries exceed the
-- previous 15s statement_timeout / 5s lock_timeout, so every schema reload fails and
-- all Data API requests hang indefinitely.
-- Prior settings (for reversibility): statement_timeout=15s, lock_timeout=5s.
ALTER ROLE authenticator SET statement_timeout = '120s';
ALTER ROLE authenticator SET lock_timeout = '30s';
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';