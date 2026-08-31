# Compliance Analytics — Enterprise Intelligence & Trend Workspace

Rebuild `/compliance/workbench/analytics` as a longitudinal analysis workspace (trends, segmentation, effectiveness), distinct from the Executive Workbench (current state) and the Manager/Inspector/Legal dashboards (operational).

## What exists today

The current page is thin: `ComplianceAnalytics.tsx` renders 5 legacy widgets (KPI cards, violation trend, risk donut, officer table, export) with direct client queries. It will be replaced.

Reusable canonical sources found in the backend:

| Area | Canonical source | Usable history |
|---|---|---|
| Violations | `ce_violations`, `ce_violation_types`, `ce_v_violation_trends`, `ce_v_violation_ageing`, `ce_v_violation_type_mix` | 262,413 rows, Dec 2025 – Aug 2026 |
| C3 filing | `cn_c3_reported`, `cn_c3_missing`, `ce_v_c3_compliance_summary` | 1987 – Sep 2026 (deep) |
| Payments | `cn_payment`, `cn_payment_header`, `ce_v_employer_payment_status` | Feb 2024 – Aug 2026 (407 rows, thin) |
| Arrears | `ce_v_employer_arrears_summary`, `ce_v_employer_arrears_report`, `ce_v_ledger_period_balances` | balances by period |
| Risk | `ce_risk_profiles`, `ce_risk_score_history` (band-change events), `ce_risk_bands`, `ce_risk_policy_factors` | history from Apr 2026, 1,086 events |
| Inspections | `ce_inspections`, `ce_inspection_findings` | 24 rows (low volume) |
| Arrangements | `ce_payment_arrangements`, `ce_arrangement_breaches`, `ce_v_arrangement_health` | 28 rows |
| Legal | `ce_legal_referrals`, `ce_legal_escalations` | 18 rows, from Jul 2026 |
| Zone / sector / size | `ce_zones` (3), `er_master.office_code`, `sector_code`, `industrial_code`, `males_employed + females_employed` | present |

## Backend work

One new RPC, `ce_compliance_analytics_v1(p_from, p_to, p_zone, p_risk_band, p_violation_type, p_sector, p_size_tier, p_inspector)`, returning a single `jsonb` payload — same pattern as the existing `ce_legal_workbench_analytics` and `ce_inspector_workboard_analytics` RPCs (SECURITY INVOKER, pinned `search_path`, server-side aggregation only).

Payload sections: `kpis`, `compliance_trend`, `violation_flow`, `violation_type_trend`, `c3_behaviour`, `payment_behaviour`, `arrears_trend`, `arrears_ageing`, `risk_band_trend`, `risk_migration`, `risk_drivers`, `enforcement_outcomes`, `resolution_time`, `inspection_effectiveness`, `arrangement_performance`, `legal_trend`, `zone_comparison`, `sector_comparison`, `size_comparison`, `persistent_employers`, `improving_employers`, `observations`, plus a `availability` map marking each section `ok | no_data | insufficient_history | unavailable`.

Every percentage carries its numerator and denominator in the payload so the UI can show the definition in the tooltip. Reused definitions only — C3 lateness from `posting_status` + `cn_c3_missing` (as `ce_v_c3_compliance_summary` does), resolution time from `resolved_at - discovered_date` (as the Violation Resolution Time report does), risk bands from `ce_risk_bands`.

Sections that cannot be honestly computed will be returned as `unavailable` with a reason rather than fabricated: no "overall compliance" composite (not canonically defined — the trend chart shows filing and payment series only), no opening/closing arrears bridge (outstanding balance per period instead), risk migration limited to the window where `ce_risk_score_history` exists (Apr 2026 onward), and inspection/arrangement/legal panels flagged low-volume.

## Frontend work

- `src/hooks/compliance/useComplianceAnalytics.ts` — React Query hook over the RPC, filter state, period comparison (previous comparable window), availability handling. Mirrors `useLegalWorkbenchAnalytics.ts`.
- `src/components/compliance/analytics/workspace/` — new panel components: `AnalyticsFilterBar`, `StrategicKpiStrip` (value + previous period + pp delta + sparkline), `ComplianceTrendPanel`, `ViolationFlowPanel`, `ViolationTypeTrendPanel`, `C3BehaviourPanel`, `PaymentBehaviourPanel`, `ArrearsPanel`, `RiskMigrationPanel`, `EnforcementEffectivenessPanel`, `InspectionEffectivenessPanel`, `ArrangementPerformancePanel`, `LegalTrendPanel`, `SegmentComparisonPanel` (zone / sector / size tabs), `PersistentEmployersTable`, `ImprovingEmployersPanel`, `KeyObservations`.
- `src/pages/compliance/dashboards/ComplianceAnalytics.tsx` — rewritten to the prescribed hierarchy: filters → KPI strip → compliance trend → violations new vs resolved → key observations, then progressively C3/payment, arrears, risk, enforcement, inspection, arrangements, legal, zone/sector/size, watchlists.

Styling copies the existing enhanced workbenches exactly (`PageHeader`, card radius, KPI card height, chart title/subtitle pattern, Recharts tooltip styling, legend treatment, empty states). No new colour vocabulary.

Drill-downs reuse existing routes (`/compliance/violations`, `/compliance/reports/*`, employer and case detail, zone filter on reports) — no new pages, no invented links.

Access is gated with the existing Compliance RBAC capability check already used by the Executive Workbench, so enterprise-wide financial/risk analytics are not exposed to restricted roles.

## Verification

Filter round-trips, period-over-period arithmetic spot-checked against direct SQL, zero-category rendering for risk bands and statuses, error vs zero distinction, drill-down routes resolve, responsive layout, clean console, and a desktop screenshot of the finished page.
