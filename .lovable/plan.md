# Fix: saving a Legal Reference signs the user out

## What was checked

- The screen is `/bn/config/country/legal-refs`, which renders the shared `LegalReferenceManagement` component.
- Save itself is a plain insert/update on `core_legal_reference`. That table has row-level security off and full grants for signed-in users, and its only trigger is a timestamp touch — so the write itself is not an authorization problem.
- Session timeouts are 8 hours absolute / 30 minutes idle, so an idle timeout is not what fires on save.
- Every successful mutation in the app runs a global audit hook. That hook calls the auth service's "get current user" endpoint (`resolveUserIdentity` in the global audit interceptor) on a 60-second cache. When that call comes back as an authorization failure — which the backend has been returning intermittently on slow/expired tokens — the auth client clears the session and emits a signed-out event. The security policy provider then redirects to the login screen.

This is the most likely cause, but it is not yet proven for this exact screen, so the first step of the work is to reproduce and confirm it rather than assume it.

## Plan

1. **Reproduce and capture evidence**
   - Save a legal reference in the running preview while recording network and auth events.
   - Confirm whether the logout is preceded by a failing `/auth/v1/user` call from the audit interceptor, and record its status and body.
   - If the evidence points somewhere else instead, stop and report the real cause before changing code.

2. **Stop background audit calls from destroying the session**
   - Resolve the acting user from the already-loaded auth context/session rather than calling the auth "get user" endpoint on every mutation.
   - When identity cannot be resolved, log the audit entry with whatever identity is known and never let that failure influence session state.
   - Keep the audit record content unchanged so existing audit evidence stays comparable.

3. **Make a transient auth hiccup non-destructive**
   - Distinguish a genuine signed-out event from a transient/expired-token failure: attempt a single session refresh before treating the user as logged out.
   - Only redirect to the login screen after the session is confirmed gone, so a slow backend no longer throws the user out mid-task.

4. **Verify**
   - Save a new legal reference and edit an existing one; confirm the record persists, the toast appears, the list refreshes and the session stays intact.
   - Confirm an audit record is still written for both create and update.
   - Repeat one save on another configuration screen to confirm the fix is module-wide, since the audit hook is global.

## Technical notes

- Files in scope: `src/services/globalAuditInterceptor.ts` (identity resolution), `src/App.tsx` mutation cache hook (caller), and `src/contexts/SupabaseAuthContext.tsx` / `src/contexts/SecurityPolicyContext.tsx` (signed-out handling and login redirect).
- No database migration is expected; `core_legal_reference` grants and triggers are already correct.
- No change to the legal reference screen, its service, or its data shape.
