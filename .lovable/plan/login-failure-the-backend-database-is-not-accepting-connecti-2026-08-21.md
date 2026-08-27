# Login failure — the backend database is not accepting connections

## What is actually happening

Your credentials are not the problem. The backend database is currently refusing new connections, so sign-in cannot complete.

Evidence gathered just now:

- Auth service logs show repeated failures: `error finding user: context canceled`, `error finding refresh token: failed to connect to host=localhost user=supabase_auth_admin ... dial tcp [::1]:5432: operation was canceled`, and 504 `request_timeout` on `/token` and `/user`.
- A trivial database query (`select 1`) from my side also times out with `Connection terminated due to connection timeout`.
- The browser console shows `resolve-auth-email timed out after 500ms`.
- The same symptom explains the inbound Voice webhook hanging instead of returning TwiML.

So: every path that needs the database (login, token refresh, RPCs, edge functions) is stalling. This is a database availability/connection-saturation problem, not an application bug and not a wrong password.

## Recovery plan

1. Confirm the database is unreachable rather than merely slow (retry a minimal query, check backend status).
2. Restart the backend database service to clear stuck sessions and exhausted connection slots.
3. Wait for it to come back, then re-run the minimal query and confirm the auth endpoint responds.
4. Sign in as `admin@secureserve.gov` through the preview to prove login works end to end.
5. Inspect what saturated the connections: long-running or `idle in transaction` sessions, and any lock held on `omni_comms_inbound_voice_call` (the table that was timing out before the outage).
6. If the cause is a connection leak from a recent code path (most likely candidate: the inbound Voice / IVR functions opening a client per request and holding a transaction), fix that path and add a statement timeout so a stuck query can never wedge the pool again.
7. Re-test the inbound Voice webhook once the database is healthy, since its hang was the earliest symptom of this same fault.

## Technical notes

- Step 2 uses the backend restart operation; it is disruptive for a few seconds and drops in-flight requests, which is expected during recovery.
- If compute is the underlying limit rather than a leak, the follow-up is a compute size increase — that is a separate decision I will bring back to you with the connection statistics from step 5.
- No schema changes and no application code changes are made in steps 1-5; only step 6 would touch code, and only if the evidence points at a specific function.
