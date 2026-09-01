# Compliance & Enforcement — Implementation Audit (Pre-Requirements Baseline)

No code changes yet. This is the current-state audit you asked for, based on reads of the routes file, the compliance settings/admin pages, the violation-scan edge function, the jobs hook, and live database/schedule queries.

## 1. Requirement-area matrix (verified current state)

| Requirement Area | Existing Page | Existing Route | Existing DB/Table | Existing Service/Function | Current Behaviour | Gap | Recommended Change | Configuration Location |
|---|---|---|---|---|---|---|---|---|
| Compliance Settings | `settings/ComplianceSettings.tsx` (403 lines) | `/compliance/settings` (`/compliance/admin/settings` redirects here) | `ce_settings`, `ce_compliance_policies` | mixed direct queries | Settings hub exists | Needs confirmation that each saved key is consumed at runtime | Extend as the single policy hub; add "used by" traceability | `ce_settings` / `ce_compliance_policies` |
| Rule Engine (Detection) | `settings/RuleEngine.tsx` (1339 lines) | `/compliance/admin/settings/rule-engine` | `ce_detection_rules`, `ce_rule_variable_mappings`, `ce_rule_history`, `ce_rule_change_requests`, `ce_rule_simulation_runs` | `supabase/functions/ce-violation-scan` reads `ce_detection_rules` | Rules are genuinely read by the scanner | Some rule parameters have hard-coded fallbacks in the function (`repeat_threshold ?? 3`, `min_employee_delta ?? 3`) | Move fallbacks into rule defaults seeded in DB; fail loudly when a required parameter is absent | `ce_detection_rules.parameters` |
| Calculation Rules | none of its own | `/compliance/admin/calculation-rules` → **redirects** to Rule Engine | `ce_calculation_rules` | penalty/estimation logic in `ce-violation-scan` and penalty jobs | Redirect exists because calculation rules are a Rule Engine tab | CR-003 "last 3 periods" estimation basis is hard-coded in the edge function | Add a Calculation Rules tab surface (or keep redirect) and read the period count from the rule row | `ce_calculation_rules.parameters` |
| Escalation Rules | none of its own | `/compliance/admin/escalation-rules` → **redirects** to Rule Engine | `ce_escalation_rules`, `ce_legal_escalation_policies`, `ce_legal_escalation_policy_rules` | `ce-escalation-review`, `JOB-ESCALATION-ENGINE` | Redirect; escalation config split across Rule Engine and Risk Policy → Legal Escalation tab | Two entry points for the same policy family | Consolidate on Risk & Escalation Policy; keep the redirect as an alias | `ce_escalation_rules` / `ce_legal_escalation_policies` |
| Violation Types | `settings/ViolationTypes.tsx` | `/compliance/admin/settings/violation-types` | violation type tables | — | Present | Verify each type is referenced by at least one detection rule | Add a "used by rules" column | violation-type table |
| Risk Rule Policy | `settings/RiskRulePolicy.tsx` + `risk-policy/*` tabs | `/compliance/admin/settings/risk-policy` (both `risk-scoring` routes redirect here) | `ce_risk_policies`, `ce_risk_policy_factors`, `ce_risk_bands`, `ce_risk_config`, `ce_risk_profiles` | `ce-risk-recalculation` (`JOB-RISK-RECLASS`) | 4 tabs: factors/weights, policies, bands, legal escalation | `RiskScoringConfig.tsx` still exists as a second surface | Retire/redirect `RiskScoringConfig` to the canonical page | `ce_risk_policies` + `ce_risk_policy_factors` |
| Risk Operations | `admin/RiskOperations.tsx` | `/compliance/admin/risk-operations` | `ce_risk_score_history`, `ce_risk_profiles` | `ce-risk-recalculation` | Operational recalculation surface | — | Keep | n/a (operational) |
| Schedule Settings | `admin/ScheduleSettings.tsx` | `/compliance/admin/schedule-settings` | `ce_automation_jobs` | read-only view | **Read-only display of `schedule_cron`** | The displayed cron is not what actually runs — see §4 | Bind job schedule to the real scheduler, or label clearly and drive pg_cron from this table | `ce_automation_jobs.schedule_cron` |
| Communication Trigger Rules | `admin/CommTriggerRulesPage.tsx` (422 lines, fully built) | **no route registered** — only linked from `VisitTriggerSuggestions.tsx` to `/compliance/admin/comm-trigger-rules` | `ce_audit_comm_trigger_rules`, `ce_audit_comm_approval_policies`, `ce_audit_communication_schedule_policies` | `ce-audit-communication-dispatch`, `ce-audit-communication-event-hook` | **Dead link — 404 / falls through** | Route missing | Register the route and add it to the compliance admin menu | `ce_audit_comm_trigger_rules` |
| Workflow Mapping | `admin/WorkflowMappingPage.tsx` | `/compliance/admin/workflow-mapping` | workflow mapping tables + `ce_apply_status_transition` | `ceWorkflowStatusService.requestTransition()` | Live; lint script enforces the chokepoint | — | Keep; extend for new statuses only | workflow mapping table |
| Legal Handoff Rules | `admin/LegalHandoffRulesPage.tsx` | `/compliance/admin/legal-handoff-rules` | `ce_legal_handoff_rules` | legal referral services | Present | Confirm the referral path actually evaluates these rows | Wire evaluation into the referral service if absent | `ce_legal_handoff_rules` |
| Payment Arrangement Rules | `admin/PaymentArrangementRulesPage.tsx` | `/compliance/admin/payment-arrangement-rules` | `ce_arrangement_policies` | `ce-breach-monitor` / `JOB-BREACH-DETECTION` | Present and job is enabled | Breach thresholds/grace periods need parameter review | Push all breach timings into `ce_arrangement_policies` | `ce_arrangement_policies` |
| Waiver / Override | `admin/WaiverRulesPage.tsx` | `/compliance/admin/waiver-rules` | `ce_waiver_rules` | waiver services | Present | Approval-level enforcement to verify | Enforce approval levels server-side | `ce_waiver_rules` |
| Feature Toggles | `admin/FeatureTogglesPage.tsx`, `FeatureToggleDiagnosticsPage.tsx` | `/compliance/admin/feature-toggles`, `/compliance/admin/feature-toggle-diagnostics` | feature-flag table via `isComplianceDbFlagEnabled` | `useComplianceFeatureFlags`, `ComplianceFeatureGate` | Working, gates several routes | Not every module route is gated | Apply gates consistently | flags table |
| Compliance Jobs / Violation Scanning | Job Configuration + History + `ScheduleSettings` | `/compliance/admin/automation/jobs`, `/automation/history` | `ce_automation_jobs`, `ce_automation_job_runs`, `ce_job_run_log` | `useComplianceJobs.ts`, 26 `ce-*` edge functions | Scan runs (last run 2026-08-24) | Most enabled jobs are not on the real scheduler | See §4 | `ce_automation_jobs` |

## 2. Placeholder pages and duplicate route trees

- `src/pages/compliance/Routes.tsx` is a **second, unmounted compliance router** (no import anywhere outside itself). It still renders `PlaceholderPage` for My Work Queue, Feature Toggles and Payment Arrangement Rules — all of which are fully implemented and routed in `AppRoutes.tsx`. It is the most likely source of the "placeholder even though the component exists" impression. Recommendation: delete it or reduce it to a re-export.
- `CommTriggerRulesPage.tsx` is complete but unreachable (no route).
- `RiskScoringConfig.tsx` duplicates the Risk & Escalation Policy surface.

## 3. Redirect explanation (as asked)

`/compliance/admin/calculation-rules` and `/compliance/admin/escalation-rules` are explicit `Navigate` aliases to the Rule Engine (AppRoutes lines 1631-1632); `/compliance/admin/risk-scoring` and `/compliance/admin/settings/risk-scoring` alias to `risk-policy` (lines 1636-1637). They are deliberate consolidation aliases, not missing screens — but the target pages do not deep-link to the matching tab, so the user lands on the default tab and perceives the screen as missing.

## 4. Scheduled jobs — configured vs actually executing

`ce_automation_jobs` has 7 enabled jobs; live `cron.job` has only 5 compliance entries.

| Job (enabled in UI) | `schedule_cron` shown | Actually in pg_cron? |
|---|---|---|
| JOB-VIOLATION-SCAN | `0 2 * * *` | Yes, but as `17 2 * * *` — UI value is not the truth |
| JOB-BREACH-DETECTION | `0 6 * * *` | No |
| JOB-RISK-RECLASS | `0 5 1 * *` | No |
| EMP-COMPLIANCE-REFRESH | `0 2 * * *` | No (never run) |
| JOB-ESCALATION-ENGINE | `0 7 * * *` | No |
| JOB-OVERDUE-DETECTION | `0 6 * * *` | No |
| JOB-NOTICE-GENERATION | none | No |

Additional pg_cron entries with no `ce_automation_jobs` counterpart: `ce-detection-event-runner`, `ce-audit-communication-dispatch-every-5min`, `ce-audit-comm-reminder-escalation`.

This is the single biggest correctness gap: **schedule configuration in the UI does not drive execution.**

## 5. Hard-coded policy values found so far

In `supabase/functions/ce-violation-scan/index.ts`:
- `rule.parameters?.repeat_threshold ?? 3` (line 1042)
- `rule.parameters?.min_employee_delta ?? 3` (line 1081)
- CR-003 estimation fixed to the **last 3 periods** (`.slice(0, 3)`, line 1205)
- 30-minute stale-run watchdog and live-window cutoffs (lines 149-328)
- `PAGE_SIZE = 1000` pagination (operational, acceptable)

## 6. Open verification items (to confirm during implementation, not asserted here)

- Which `ce_settings` keys are written by the UI but never read by any service or edge function.
- Whether `ce_legal_handoff_rules` and `ce_waiver_rules` rows are actually evaluated at referral/waiver time.
- Audit-trail coverage: `ce_rule_history` and `ce_rule_change_requests` exist for the Rule Engine; equivalent history for risk policy, arrangement policy, waiver and handoff rules is not yet confirmed.
- RBAC/approval enforcement on each admin save path (server-side, per the no-RLS architecture rule).

## 7. Proposed implementation sequence

1. **Route and surface hygiene** — register the Comm Trigger Rules route + menu entry, delete the unmounted `pages/compliance/Routes.tsx`, redirect `RiskScoringConfig` to the canonical risk policy page, make the consolidation aliases deep-link to the right tab.
2. **Scheduler truth** — make `ce_automation_jobs` the single source of schedule truth and reconcile pg_cron to it (or make the page read pg_cron), so enabling/disabling a job in the UI actually changes execution.
3. **De-hard-code the detection/calculation engine** — seed every rule parameter in `ce_detection_rules` / `ce_calculation_rules`, remove `??` fallbacks, fail loudly on missing parameters.
4. **Runtime-consumption sweep** — trace every configuration table to its consumer; list and fix settings stored but ignored.
5. **Governance layer** — uniform change-history and server-side approval/RBAC enforcement across all compliance configuration saves.
6. **Then** map your new client-approved requirements onto this baseline and extend the existing admin pages only.

Send the client-approved requirements next and I will map them onto this matrix before any code changes.
