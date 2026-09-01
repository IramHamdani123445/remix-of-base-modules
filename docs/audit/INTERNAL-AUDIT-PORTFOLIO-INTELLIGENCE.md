# Internal Audit — Annual Plan Portfolio Intelligence

An Annual Audit Plan is a **portfolio of audit engagements**. The Plan Workspace
(`/audit/audit-plans/:id` → **Portfolio** tab) now states that explicitly.

## Server-owned read models

All portfolio truth comes from three governed `SECURITY DEFINER` commands. The
browser performs no aggregation of its own.

| Command | Purpose |
| --- | --- |
| `ia_annual_plan_portfolio_summary(p_plan_id)` | Composition, capacity, resourcing gaps, readiness display, version pointers |
| `ia_annual_plan_coverage(p_plan_id)` | Department / function coverage analysis and uncovered high-risk areas |
| `ia_annual_plan_version_diff(p_plan_id)` | Working copy versus last submitted version |

All three refuse anonymous callers and respect `COALESCE(is_active, true)` as the
current working-portfolio rule.

## Portfolio summary content

- Total engagements; by risk (Critical / High / Medium / Low / Unrated)
- By quarter (Q1–Q4 and Unscheduled), by department, by function
- Planned hours, planned days
- Available audit capacity, buffer, net capacity, utilisation %, remaining capacity
- Gaps: unscheduled, missing lead, missing reviewer, lead/reviewer conflict, with
  the specific engagements listed
- Readiness status and current / previous submitted version

**Readiness is display only.** `ia_annual_plan_readiness` remains the single
authority for whether a plan may be submitted; the portfolio never computes
submission truth independently.

## Coverage analysis

One row per department/function: department, function, risk rating, whether the
current plan covers it, the engagement, quarter, effort and last audit date.

Highlighted:
- Critical / High auditable areas not covered by the current plan
- Departments with no planned audit at all

This is **advisory planning intelligence**. Nothing is added to the plan
automatically.

## Version comparison

Compares the current working copy against the most recent
`ia_plan_versions` snapshot: engagements added, removed and modified
(name, quarter, risk, effort hours/days, lead, reviewer, planned dates), plus
baseline / current / delta effort. Historical snapshots remain immutable.

## Front end

- `src/hooks/audit/useAuditPortfolio.ts`
- `src/components/audit/plan/PlanPortfolioPanel.tsx`
