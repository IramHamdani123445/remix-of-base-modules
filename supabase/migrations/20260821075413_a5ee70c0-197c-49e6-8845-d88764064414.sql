ALTER ROLE authenticator SET statement_timeout = '120s';
ALTER ROLE authenticator SET lock_timeout = '30s';
NOTIFY pgrst, 'reload schema';