# Compliance → Trend Analysis: Enterprise Time-Series Page

Rebuild `/compliance/reports/trends` as a chart-only historical trend workspace. No KPI cards, no tables, no queues, no workflow actions.

## What the data can honestly support

I checked the live compliance data before deciding which charts are buildable.

| Trend | Source | History available | Verdict |
|---|---|---|---|
| Case volume (opened/closed) | `ce_cases.opened_date` / `closed_date` | 72 cases, Jul 2023 – Aug 2026; only 2 closed | Build, low volume |
| Open case backlog (point-in-time) | same, `opened <= period_end AND (closed IS NULL OR closed > period_end)` | derivable | Build |
| Closure-to-intake ratio | same | derivable | Build, correctly labelled |
| Case resolution time | closed cases | 2 closed rows | Build, but flagged `insufficient_history` |
| Violation detection | `ce_violations.discovered_date` | 262,415 rows, Nov 2025 – Sep 2026 | Build (strongest series) |
| Violations opened vs resolved | `discovered_date` / `resolved_at` | 11 resolved | Build, resolved series flagged thin |
| C3 filing compliance rate | `cn_c3_reported` / `cn_c3_missing`, as `ce_v_c3_compliance_summary` defines it | deep history | Build |
| Outstanding exposure | `ce_employer_financial_ledger` (additive, `posted_at`/`effective_date`, debit/credit, running balance) | 394 entries, from Jul 2026 only | Build, window limited to Jul 2026 onward, labelled |
| Recovery / collections | `cn_payment.payment_date` | 407 rows, Feb 2024 – Aug 2026 | Build as its own chart (not mixed with exposure) |
| Enforcement escalation | `ce_notices.created_at` (1,451, from Jan 2024), `ce_payment_arrangements` (28), `ce_arrangement_breaches.detected_at` (17), `ce_legal_referrals` (18) | real event dates | Build with series selector |
| Employer risk band trend | `ce_risk_score_history` (`calculated_at`, `previous_band`/`new_band`, 2,086 events) | from Apr 2026 | Build, window starts Apr 2026 |
| Case-type comparison | `ce_cases.case_type` | dirty vocabulary (see below) | Build after label normalisation |

`ce_case_risk_snapshots` is empty and `ce_ledger_periods` holds only current balances, so neither is used for history. No chart will fabricate a snapshot: anything outside its real history window returns `insufficient_history`, not zero.

## Backend

One new RPC, `ce_trend_analytics_v1(p_from date, p_to date, p_grain text, p_compare text, p_zone text[], p_case_type text[], p_violation_type text[])`, SECURITY INVOKER with pinned `search_path`, returning a single `jsonb` payload — same shape and conventions as the existing `ce_compliance_analytics_v1` / `ce_legal_workbench_analytics` RPCs.

Rules inside the RPC:

- A `generate_series` period spine at the requested grain drives every series, so zero-activity periods render as 0 rather than being skipped, and every point carries `period_start` (sort key) and `period_label` (display only).
- Each section returns `{ status: 'ok' | 'no_data' | 'insufficient_history' | 'unavailable', reason, history_from, points: [...] }`. The UI never plots a null section as zero.
- Comparison series (`previous_period` / `previous_year`) are computed server-side on aligned period offsets and returned alongside the current series.
- All aggregation is server-side; no row-level fetch to the browser. Supporting indexes: `ce_violations(discovered_date)`, `ce_violations(resolved_at)`, `ce_cases(opened_date)`, `ce_cases(closed_date)`, `ce_notices(created_at, notice_type)`, `ce_risk_score_history(calculated_at)`, `ce_employer_financial_ledger(effective_date)`, `cn_payment(payment_date)`.

## Metric definitions (shown in each tooltip/help)

- **Cases Created / Closed** — count of `ce_cases` by `opened_date` / `closed_date` in period.
- **Open Case Backlog** — cases open at period end (point-in-time), not today's open cases grouped by creation month.
- **Closure-to-Intake Ratio** — closed in period ÷ created in period. Explicitly *not* called Resolution Rate; a true cohort resolution rate is not computed because closed volume (2) cannot support it, and that omission is stated on the chart.
- **Resolution Time** — median (primary) and mean (optional series) of `closed_date - opened_date`, plotted against the *closure* period.
- **Violation Detection** — violations by `discovered_date`, split by canonical type from `ce_violation_types`.
- **C3 Filing Compliance %** — on-time filings ÷ expected filings for the period, reusing the `ce_v_c3_compliance_summary` definition; numerator and denominator both returned and shown.
- **Outstanding Exposure** — cumulative ledger debits minus credits at period end from `ce_employer_financial_ledger`, XCD via `formatCurrency`.
- **Recovery** — `cn_payment` amounts by `payment_date`.
- **Enforcement Escalation** — counts of notices (by stage), arrangements created, breaches detected, referrals submitted, by real event date.
- **Risk Band Trend** — employers per band at period end, reconstructed forward from `ce_risk_score_history` band transitions; series starts Apr 2026.

## Frontend

- `src/hooks/compliance/useTrendAnalytics.ts` — React Query over the RPC, URL-synced filter state, availability handling (mirrors `useComplianceAnalytics.ts`).
- `src/components/compliance/reports/trends/` — `TrendControlBar` (Period: 12/24/36 months, 5 years, custom · Granularity: monthly/quarterly/yearly · Compare: none/previous period/previous year · Zone · Case Type), `TrendChartCard` (shared shell: title, definition tooltip, per-chart controls, expand dialog, loading/no-data/error/insufficient-history states, chart-level fault isolation), and the twelve chart components.
- `src/pages/compliance/reports/TrendReports.tsx` — rewritten to the prescribed order and layout: Case Volume (full) → Backlog + Throughput (2-col) → Resolution Time (full) → Violation Detection + Opened vs Resolved (2-col) → Compliance Rate (full) → Exposure + Recovery (2-col) → Enforcement Escalation (full) → Risk Trend (full) → Case-Type Comparison (full). Charts stack on tablet/mobile.
- Subtitle changed to "Historical Compliance trends across workload, resolution, violations, financial exposure and enforcement". No forecasting, no predictive language.
- Lines use straight segments (`type="linear"`), not decorative smoothing. Series are distinguished by dash pattern and marker shape as well as colour; comparison overlays use a muted dashed variant.
- Labels come from a central mapping — `ce_violation_types.name`, a case-type label map that also normalises the mixed vocabulary currently in the data (`LATE_C3_SUBMISSION`, `ARREARS_CASE`, `arrears`, `Filing Compliance` all resolve to one business label), and `ce_zones.zone_name`. No enum codes and no `replace(/_/g,' ')` on charts.
- Clicking a data point navigates to the existing related report (e.g. violations report filtered to that period); no record tables are added here.
- Export button relabelled **Export Trend Data** and wired to the Excel exporter it actually calls, exporting the currently visible period, grain, filters and comparison. Optional per-chart image export from the expand dialog.

## Verification

Chronological ordering by `period_start` at every grain; zero-period fill; error vs zero distinction (force a section failure and confirm it renders an error, not a 0 line); case volume and violation counts reconciled against direct SQL; backlog spot-checked at three period ends; previous-year overlay alignment; currency formatting; label mapping shows no raw codes; filters propagate to all charts and to export; responsive layout at desktop/tablet/mobile; clean console; screenshots of the full page, each section, the previous-year comparison and an expanded chart.
