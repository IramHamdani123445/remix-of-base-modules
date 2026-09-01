# Step 11 — Parity verification & cutover

Read-only verification of the mirrored target project, plus the exact procedure
for the cutover freeze.

## 1. Run the parity sweep

```bash
MIRROR_TARGET_DATABASE_URL=... scripts/mirror/parity-check.sh
```

Then the exact per-table counts on both sides (this is the authoritative check —
`n_live_tup` is only an estimate and hid 139 empty tables on the first pass):

```sql
select c.relname,
       (xpath('/row/c/text()',
              query_to_xml(format('select count(*) as c from public.%I', c.relname),
                           false, true, '')))[1]::text::bigint
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;
```

Diff the two outputs. Any table where the target is behind gets re-streamed:

```bash
TARGET_DATABASE_URL="$MIRROR_TARGET_DATABASE_URL" STATE_DIR=/tmp/mirror-fix \
  scripts/mirror/stream-table-data.sh /tmp/reload_tables.txt
```

`STATE_DIR` must contain a pre-created `truncated.ok` so the script does **not**
re-truncate the whole target.

## 2. Results of the 2026-08-26 sweep

| Area | Outcome |
| --- | --- |
| Tables / views / functions | 1,730 / 93 / 2,013 — identical to source |
| Triggers / enums / RLS policies | 765 / 93 / 179 — identical |
| Indexes | 4,079, 0 invalid |
| Row parity | 139 tables had loaded empty; re-streamed 645,940 rows, 0 failures |
| Functions | 4 ported (`omni_comms_priv_business_event_health`, `omni_comms_priv_scheduler_issue_purpose_ticket`, `omni_comms_priv_scheduler_consume_purpose_ticket`, `omni_comms_provider_credential_source`) + grants; 3 superseded signatures dropped |
| Sequences | 35 fast-forwarded with `setval`; 46/46 now at or ahead of source |
| Storage | 6 new objects copied, 1 superseded object deleted; 184/184 objects, 46/46 policies |
| Auth | admin API OK, magic-link token issuance OK, 55 users + 55 identities |
| Storage signing | signed URL returned HTTP 200 and full bytes |
| REST | PostgREST reachable with target keys |

### Known, accepted deltas

- **Append-only log tables** (`system_audit_trail`, `system_business_events`,
  `system_technical_logs`, `system_performance_metrics`, `system_error_logs`,
  `system_security_logs`, `unauthorized_access_logs`, `login_security_events`)
  drift by a few dozen rows because the source is still live. They are re-streamed
  during the freeze.
- **`public.testcustomer`** (100,000 scratch rows) is not mirrored. It has no
  application usage beyond the generated types file.

## 3. Cutover procedure (when the decision is made)

1. Announce a short freeze; stop schedulers/cron and keep Omni-Comms sending off.
2. Re-stream the drifting log tables (list above) with the same script.
3. Re-run the exact-count diff — expect zero differences.
4. Re-run the sequence `setval` sync.
5. Repoint the application to the target URL / anon key, redeploy.
6. Smoke test: real login, one signed document download, one read-only report,
   one Omni-Comms preview (no dispatch).
7. Keep the source project read-only and untouched for the agreed rollback window;
   rollback = repoint the app back, nothing else.
