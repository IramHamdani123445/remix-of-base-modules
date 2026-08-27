alter role authenticator set work_mem = '128MB';
alter role authenticator set statement_timeout = '180s';
alter role authenticator set lock_timeout = '30s';
notify pgrst, 'reload schema';