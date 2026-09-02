# Internal Audit — Phase E, Gate E0: Pre-E2E Estate Closure

Environment: TEST. Date: 2026-09-02.
Purpose: bring the Internal Audit estate to a clean, terminal baseline before the
final full-system end-to-end certification, using **governed commands only** —
no direct SQL mutation of business state.

## 1. Method

All closures were executed over the client path (PostgREST) using a real
Head of Internal Audit persona session, through the governed commands:

| Command | Use |
|---|---|
| `ia_evaluate_plan_closure` | read-only readiness / disposition requirements |
| `ia_close_annual_plan` | plan closure with per-audit dispositions |
| `ia_cancel_engagement` | terminal disposition of orphaned / soft-deleted audits |

Standing disposition reason recorded on every closure:

> Pre-E2E controlled test-estate closure — superseded by the final Internal Audit
> full-system E2E certification.

## 2. Annual plan closure result

| Metric | Before | After |
|---|---|---|
| Annual plans | 14 | 14 |
| Plans in `Closed` | 2 | **14** |
| Plans requiring disposition | 12 | 0 |

Every plan closed through `ia_close_annual_plan`; the command's own gate reported
`pending: 0` for each, i.e. no audit was left undispositioned.

Plans closed this gate: 2025-2026 (W3-CERT), three 2026-2027 plans plus
"Audit Plan 2026-2027" and the empty 2026-2027 header, IA-UT-20260902-PLAN-1 (2027),
two 2027-2028 plans, 2028 Risk-Based, IA-FINAL-E2E-2029-01 (2029), and
IA-TX-20260902 (2031). Already closed beforehand: 2027 Risk-Based, CERT
communication plan (2099-2100).

## 3. Audit (engagement) estate

| Execution status | Active | Soft-deleted |
|---|---|---|
| Cancelled | 53 | 2 |
| Carried Forward | 17 | 0 |
| Closed | 4 | 0 |
| Closed – Actions Pending | 3 | 0 |
| Planned (non-terminal) | **0** | 2 |

Eleven Phase-D reparenting fixtures pointed at annual plans that no longer exist
(orphaned `annual_plan_id`). All were terminated through `ia_cancel_engagement`.

## 4. Defect found and fixed at this gate

**DEF-E0-01 — soft-deleted audits could never reach a terminal state.**
`ia_cancel_engagement` filtered its lookup on `is_active = true`, and
`ia_evaluate_plan_closure` ignores inactive rows. An audit that had been
soft-deleted while still `Planned` was therefore unreachable by *every* governed
disposition command, yet continued to appear as open work in inventory queries.

Fix: `ia_cancel_engagement` now resolves the audit without the `is_active`
filter (cancellation is a terminal disposition and must stay reachable), records
the prior `is_active` value in the audit event payload, and keeps every existing
authorisation, reason, terminal-state and auditee-notification rule unchanged.
`EXECUTE` remains revoked from `PUBLIC`/`anon`.

## 5. Accepted residual

Two soft-deleted audits (`ENG-2026-2027-001`, `IA-TX-20260902-PLANENG-02`) remain
at `execution_status = 'Planned'`. Their parent plans are now `Closed`, and the
closed-plan immutability guard (`ia_guard_closed_plan_engagement`) correctly
refuses further mutation of historical audits. This is governed behaviour, not a
defect; both rows are soft-deleted and excluded from every live work surface.

Open findings, corrective actions and follow-ups that remain (18 `Responded`
findings, 10 non-closed actions, 2 scheduled follow-ups) all belong to
now-closed historical plans and are retained deliberately as prior-audit history
and corrective-action-continuity inputs for the Phase E lifecycle.

## 6. Gate verdict

Gate E0: **PASS** — the annual-plan estate is fully closed, no active audit is in
a non-terminal state, and the single governance defect found while proving it
(DEF-E0-01) has been fixed through a governed migration.
