# Permanently stabilize sign-in and scheduled workloads

## Confirmed problem

- The password is reaching authentication, but authentication cannot obtain a database connection; recent attempts return HTTP 500/504 after 15–26 seconds.
- This is a backend availability failure, not an invalid-password response.
- Four scheduled jobs repeatedly overlap: the email queue every 5 seconds plus Omni-Comms ingest, dispatch, and print every minute. Their calls are taking 126–150 seconds and timing out, while new runs continue to start.
- Dashboard aggregate views add sustained load, with thousands of calls averaging roughly 2.5–2.8 seconds.

## Recovery and permanent fix

1. Pause only the four unhealthy scheduled workers through a reviewed migration. Preserve all queue, delivery, and audit records.
2. Allow in-flight calls to drain, restart Lovable Cloud if still needed, and prove authentication plus a minimal database query are responsive.
3. Replace overlapping schedules with bounded, staggered execution:
   - slower polling intervals;
   - one active run per worker;
   - short outbound timeouts;
   - cheap no-op behavior when queues are empty.
4. Restore workers one at a time and measure each before enabling the next.
5. Reduce dashboard query amplification after login by confirming shared caching and preventing duplicate eager loads of the expensive aggregate views.
6. Test the supplied admin account through the actual login screen, confirm dashboard/sidebar loading, and check fresh auth/database/function logs for new timeouts.

## Safety

- No password, role, permission, message, queue item, or audit record will be changed.
- No communication will be sent during recovery.
- The canonical Omni-Comms sending spine remains intact; only scheduler frequency and overlap protection change.
