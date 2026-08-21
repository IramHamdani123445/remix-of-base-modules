# Dashboard & Login Path Query Optimisation

The backend is currently rejecting all database connections (`EAUTHQUERY`), so no slow-query measurements can be taken yet. This plan starts the moment the backend answers again, and is measurement-first: nothing gets "optimised" before the data says it is slow.

## Step 1 — Measure (blocking gate)

1. Poll the backend until it accepts connections.
2. Pull the ranked slow-query list (`pg_stat_statements`: total time, mean time, call count, rows).
3. Filter to the login/dashboard path only:
   - `get_user_accessible_modules` (the menu RPC behind the stuck sidebar)
   - `dashboard_v_*` views (admin KPIs, financial summary, contribution trend, benefits distribution, compliance distribution, registration pipeline, active alerts, recent activity, sector compliance, employer compliance alerts, payment arrangement risk, legal escalation summary)
   - `ce_violations`, `ce_inspections`, `cl_head` recent-list reads
4. Record a baseline table (query, mean ms, calls, total ms) so the improvement is provable.

If the measured list shows something outside these areas dominating total time, report it before continuing rather than optimising the wrong thing.

## Step 2 — Diagnose each top offender

For each of the top offenders, run `EXPLAIN (ANALYZE, BUFFERS)` and classify the cause:

- sequential scan on a large table that a filter could index
- view aggregating full history when only recent periods are displayed
- per-row subquery / correlated lookup inside a view
- permission recursion inside the menu RPC (role → module → permission joins evaluated per row)

## Step 3 — Fix, one cause at a time

Expected fix shapes (final set decided by Step 2 evidence):

- **Indexes** matching the actual predicates, e.g. `ce_violations(status, is_deleted, created_at desc)`, `ce_inspections(status, scheduled_date)`, `cl_head(date_entered desc)`, and whatever the menu RPC's join columns turn out to be. Added as a migration, `CREATE INDEX` (concurrently where safe).
- **View rewrites** where a dashboard view scans all history to display a bounded window — push the date bound into the view instead of aggregating everything.
- **Menu RPC hardening** — if `get_user_accessible_modules` is the top cost, restructure its permission resolution so module access resolves in a single set-based pass rather than per-module evaluation. Behaviour and returned rows stay identical.
- **Materialisation** only as a last resort, and only for a view proven expensive and tolerant of staleness.

Each change is applied as its own migration and re-measured immediately.

## Step 4 — Verify

- Re-run the same slow-query snapshot and compare against the Step 1 baseline.
- Re-run `EXPLAIN ANALYZE` on each touched query to confirm the plan changed as intended.
- Load the app, sign in, and confirm the sidebar renders without hitting its timeout path and dashboard widgets settle.
- Run the test suite and confirm the build is clean.

## Out of scope

- No frontend behaviour or UI changes; the client-side dashboard cache unification is already in place.
- Compliance/arrears, Omni-Comms and other modules are excluded from this pass, as chosen.
- No schema/data model changes beyond indexes and view definitions.

## Technical notes

- Menu path: `useDynamicNavigation` → `supabase.rpc('get_user_accessible_modules')`, 8s client abort. Anything above ~2s mean here is the direct cause of the stuck-sidebar symptom.
- Dashboard path: `src/services/dashboardDataService.ts` issues `select('*')` against `dashboard_v_*` views with no row bound — cost lives in the view definitions, not the client calls.
- All fixes ship as migrations; no edits to auto-generated backend client files.
