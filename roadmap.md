
## Compliance Workbench Queue Filtering & Sorting (Aug 31)
- [ ] /compliance/workbench/queues — enterprise filters, quick chips, sortable headers, counts, empty/error states
- [ ] /compliance/workbench/review-queue — review filters, waiting-time, default urgency sort, server-side paging
- [ ] /compliance/workbench/reassignment — work-item filters + sortable officer workload, preserve reassignment controls

## Internal Audit — Post-UAT Wave 2 Corrective (Aug 31 / Sep 1)
- [x] Working-paper storage path contract corrected to `internal-audit/<engagement>/<class>/<owner>/<file>`
- [x] Compensating-rollback primitive + regression tests (20 passing)
- [ ] Live upload proof + respondent RLS denial proof — BLOCKED: cannot mint a session as a specific auth user (workspace admin only)
- [ ] Follow-Up runtime verification

## Compliance — Legal Review / Handover Queue Enterprise Upgrade (Sep 1)
- [ ] Confirm canonical purpose of /compliance/enforcement/legal-queue vs Recommendation Queue / Pack Preparation / Approved Escalations
- [ ] Server-side RPC: search, filters, sorting, pagination (25/50/100/200), scoped counts (replace .limit(100))
- [ ] KPI strip + Requires Attention (config-driven SLA, no hardcoded deadlines)
- [ ] Status tabs: Action Required / Tracking / History with business labels only
- [ ] Enterprise table register, drill-downs (Employer 360, Case, Referral, Legal Intake)
- [ ] Approval review dialog + maker-checker (server-side), rejection context, returned-by-Legal rework
- [ ] Transactionally safe submit-to-Legal (RPC), double-submission prevention
- [ ] URL state preservation, error state, RBAC separation (view/approve/submit)
- [ ] E2E lifecycle verification + completion report

## Compliance — Approved Escalations Enterprise Register (Sep 1)
- [x] Ref data, register view + governed RPCs (register/detail) with financial masking
- [x] `useApprovedEscalationRegister` hook (URL state, facets, KPIs, attention)
- [x] `EscalationDetailDialog` + rewritten `ApprovedEscalationsPage`
- [ ] Playwright end-to-end verification

## Compliance — Returned From Legal Rework Queue (Sep 1, requested) — DONE
- [x] Analyse `legalHandoffService.listReturns/resolveReturn`, `ce_legal_returns`, referral status coupling
- [x] Server-side register RPC `ce_legal_return_register_v1`: referral/employer/case/legal refs, reason, required action, owner, rework age/SLA, pack readiness
- [x] Governed `ce_legal_return_complete_rework_v1` (pack-readiness gated, identity-required, no SYSTEM fallback) + resubmission via `ce_legal_pack_submit_v1`
- [x] Rework owner/tasks (`ce_legal_return_assign_v1`), repeat-return history, pack version retention, referral RETURNED status coherence
- [x] Enterprise UI: KPIs, Requires Attention, filters/sort/pagination, detail workspace, error/empty states, RBAC split


## Compliance — Legal Referral Launcher Eligibility Workspace (Sep 1, requested)
- [ ] Establish canonical referral paths (Recommend Legal vs Wizard vs Quick Forward) and whether Launcher is retained/consolidated
- [ ] Canonical eligibility service/RPC (shared with Case Detail, Wizard, Recommendation Queue)
- [ ] Candidate register RPC replacing `.limit(50)`: search, filters, sorting, paging, counts, exposure, violation/enforcement context
- [ ] Duplicate-referral prevention + context-sensitive primary action per state
- [ ] Eligibility preview + server-side revalidation before initiation, audit trail, RBAC/maker-checker
- [ ] Enterprise UI + E2E verification

## Compliance — Legal Recommendation Queue Enterprise Workspace (Sep 1) — DONE
- [x] Analyse legalEscalationService/generateRecommendations, approveLegalReferral/rejectLegalReferral, ce_legal_recommendations
- [x] Server-side register RPC: search, filters, sort, paging, KPIs, rule explainability, linked referral state
- [x] Review/Approve + structured Reject dialogs (no prompt()), maker-checker surfaced, identity-required (no SYSTEM fallback)
- [x] Resolve duplicate "Create Referral" vs approval-minted referral; context-sensitive next action to Legal Pack
- [x] Enterprise UI: KPIs, Requires Attention, table register, URL state, error/empty states, RBAC split

