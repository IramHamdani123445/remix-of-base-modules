# Internal Audit Module — WAVE 0
## Target Architecture Freeze / Architecture Decision Record (ADR)

Date: 2026-08-27
Status: **READY FOR REVIEW — no code, schema, RLS, RPC, configuration or data was changed**
Input: `docs/audit/2026-08-27-internal-audit-stage1-gap-register.md` (Stage 1A, structural/pre-E2E)

All statements below are measured against the live database and the shipped
React module on this date. Evidence commands are recorded inline.

---

## 0. Measured baseline (Wave 0 re-verification)

| Measurement | Value |
|---|---|
| `ia_*` tables in `public` | **102** |
| `ia_*` tables with RLS enabled | **0** |
| `ia_*` tables with any policy | **0** |
| `ia_*` tables where `anon` holds SELECT | **102** |
| `ia_*` tables where `anon` holds INSERT | **102** |
| `ia_*` tables where `authenticated` holds INSERT/UPDATE/DELETE | **102** |
| `ia_*` database routines | **48** (47 distinct, `ia_record_communication_stage` overloaded) — 47 are `SECURITY DEFINER` |
| Omni-Comms event definitions total | **80** (BENEFITS, COMPLIANCE, FINANCE, LEGAL, OMNI, PLATFORM, REGISTRATION) |
| Omni-Comms event definitions for Internal Audit | **0** |
| `ia_notification_triggers` (private IA catalogue) | 16 |

Non-zero row counts (everything else is 0):
`ia_auto_plan_candidates` 76 · `ia_planning_score_explanations` 76 ·
`ia_department_functions` 43 · `ia_audit_settings` 19 · `ia_notification_triggers` 16 ·
`ia_departments` 13 · `ia_risk_categories` 11 · `ia_audit_universe` 10 · `ia_holidays` 10 ·
`ia_document_templates` 9 · `ia_planning_parameters` 9 · `ia_audit_engagements` **8** ·
`ia_checklist_templates` 8 · `ia_plan_change_log` 7 · `ia_planning_scoring_weights` 6 ·
`ia_activity_types` 5 · `ia_risk_criteria` 5 · `ia_risk_criteria_weights` 5 ·
`ia_risk_impact_levels` 5 · `ia_risk_likelihood_levels` 5 · `ia_audit_config` 4 ·
`ia_risk_band_frequency_policy` 4 · `ia_risk_classification_thresholds` 4 ·
`ia_annual_plans` 3 · `ia_auditors` 3 · `ia_control_effectiveness_levels` 3 ·
`ia_availability_conflicts` 2 · `ia_plan_artifacts` 2 · `ia_risk_assessments` 2 ·
`ia_audit_queries` 1 · `ia_distribution_recipients` 1 · `ia_risk_config_master` 1 ·
`ia_risk_scoring_models` 1.

`ia_department_audits` = **0 rows**. Confirmed.

---

## 1. ADR-01 — Canonical Audit Spine

### Decision
**`ia_audit_engagements` is the single authoritative operational Audit record.**
**`ia_department_audits` is declared LEGACY and is retired as an operational spine.**

Term used in the UI and documentation: **Audit** (an engagement *is* the audit).
"Engagement" survives only as the table/technical name.

### Justification (repository evidence)
- `ia_department_audits` = 0 rows; `ia_audit_engagements` = 8 rows and is the
  record every shipped screen (`EngagementDetail`, `useEngagementData`,
  `useEngagementExecution`, `useEngagementClosure`, `EngagementBuilder`) reads.
- All modern governed commands are engagement-keyed:
  `ia_launch_engagement`, `ia_close_engagement`, `ia_evaluate_engagement_closure`,
  `ia_can_close_engagement`, `ia_can_issue_report`, `ia_can_start_engagement`,
  `ia_check_engagement_completeness`, `ia_engagement_progress`,
  `ia_enforce_engagement_execution_gate`, `ia_transition_execution_status`.
- `ia_department_audits` has no governed command of its own and no launch/QA/report path.
- There is **no business requirement** for two audit records. A department audit
  and an engagement are the same real-world object.

### Tables carrying BOTH `department_audit_id` and `engagement_id` (dual-spine debt)
| Table | Columns present | Wave-1 treatment |
|---|---|---|
| `ia_activities` | `department_audit_id`, `annual_plan_id`, `engagement_id` | keep `engagement_id`; deprecate `department_audit_id` |
| `ia_evidence` | `department_audit_id`, `annual_plan_id`, `engagement_id` | same |
| `ia_findings` | `department_audit_id`, `annual_plan_id`, `engagement_id` | same |
| `ia_follow_ups` | `department_audit_id`, `annual_plan_id`, `engagement_id` | same |
| `ia_working_papers` | `department_audit_id`, `annual_plan_id`, `engagement_id` | same |
| `ia_communications` | `department_audit_id`, `annual_plan_id`, `engagement_id` | same |
| `ia_preparation_checklists` | `department_audit_id`, `engagement_id` | same |
| `ia_preparation_documents` | `department_audit_id`, `engagement_id` | same |
| `ia_audit_engagements` | `department_audit_id` (back-pointer), `annual_plan_id` | back-pointer retained read-only for history |
| `ia_audit_checklists` | `audit_id` (third naming variant) | rename/alias to `engagement_id` semantics |

`annual_plan_id` on child tables is a **denormalised convenience key**. Decision:
keep it, but it must be **derived from the engagement**, never independently set —
it is a reporting shortcut, not a second parent.

### Migration implications (Wave 1, not executed now)
1. Since `ia_department_audits` is empty, **no data migration is required** —
   only reference hygiene. This is the cheapest possible moment to do it.
2. For each child table: make `engagement_id` NOT NULL for new rows (via governed
   command + check constraint on rows created after the cut date), mark
   `department_audit_id` as deprecated (comment + no writes), keep the column so
   any future historical import is not lost.
3. Add FK `child.engagement_id → ia_audit_engagements(id)` where absent.
4. Add a guard so `annual_plan_id` on a child must equal the engagement's plan.
5. `ia_department_audits` retained as a labelled legacy table (table comment
   `DEPRECATED — superseded by ia_audit_engagements (ADR-01, 2026-08-27)`),
   privileges reduced to service role only. **No DROP** in Wave 1.
6. Any UI still writing `department_audit_id` is repointed.

### Target traceability chain (frozen)

```text
Audit Universe (Office → Department → Function)
        ↓
Risk Assessment  →  Risk Register
        ↓
Annual Plan (ia_annual_plans)
        ↓  plan approval
Audit / Engagement (ia_audit_engagements)      ← CANONICAL SPINE
        ↓
Preparation (ia_preparation_checklists / _documents)
        ↓
Audit Programme / RCM (ia_rcm_processes → ia_rcm_risks → ia_rcm_controls
                       → ia_audit_procedures → ia_rcm_tests)
        ↓
Activities / Fieldwork (ia_activities)
        ↓
Control Tests (ia_control_tests → ia_control_test_results)
        ↓
Evidence (ia_evidence) + Working Papers (ia_working_papers)
        ↓
Findings (ia_findings) → Recommendations (ia_recommendations)
        ↓
Management Responses (ia_management_responses)
        ↓
Corrective Actions (ia_action_tracking → _updates / _milestones)
        ↓
Draft Report (ia_audit_reports)
        ↓
Quality Review (ia_quality_reviews + ia_quality_review_checklist)
        ↓
Final Report Issued (ia_audit_reports.issued_at)
        ↓
Audit Closure (ia_audit_closure)
        ↓
Follow-Up / Action Monitoring (ia_follow_ups)
        ↓
Annual Plan Closure (ia_annual_plans.closure_summary, ia_plan_carry_forward)
```

---

## 2. ADR-02 — Phase-1 Audit Universe (unchanged, deliberately)

The agreed Phase-1 model stands and is **not** redesigned:

```text
Office → Department → Function → Process → Risk → Control → Audit Procedure / Test
```

- **Auditable scope** = Department and Function only (`ia_departments`,
  `ia_department_functions`). Planning, engagements, findings and follow-ups
  scope to these.
- **Process** belongs to methodology/RCM (`ia_rcm_processes`), not to planning scope.
- Phase-2 configurable Audit Universe remains **deferred**.

### Single Phase-2 forward-compatibility decision recorded now
Child tables bind scope with hard FKs to `ia_departments` / `ia_department_functions`.
A configurable Phase-2 universe would otherwise require rewriting every child.

**Decision:** all *new* Wave-1/2 scope-bearing structures must additionally carry a
neutral pair `(auditable_subject_type, auditable_subject_id)` alongside the
existing department/function FKs, populated as `('DEPARTMENT'|'FUNCTION', <id>)`.
No existing column is changed in Phase 1. Phase 2 then extends the enum instead
of restructuring. Cost now: near zero. Cost later if skipped: a full re-key.

---

## 3. ADR-03 — Authoritative Lifecycle Matrix

Legend for actor codes: **HIA** Head of Internal Audit · **LA** Lead Auditor ·
**ATM** Audit Team Member · **QR** Quality Reviewer · **MR** Management Respondent · **SYS** system/scheduler.

### 3.1 Annual Plan (`ia_annual_plans.status`)
| From | To | Actor | Guard |
|---|---|---|---|
| — | Draft | LA/HIA | plan header created |
| Draft | Submitted | LA/HIA | ≥1 engagement, resourcing complete |
| Submitted | Approved | HIA/Board | maker ≠ checker |
| Submitted | Rejected | HIA/Board | reason mandatory |
| Rejected | Draft | LA/HIA | — |
| Approved | Under Revision | HIA | material change detected (`ia_detect_material_plan_changes`) |
| Under Revision | Approved | HIA/Board | re-approval, version increment |
| Approved | Closed | HIA | every engagement has a disposition (§3.13) |

### 3.2 Audit / Engagement (`status` + `execution_status`)
| From | To | Actor | Guard |
|---|---|---|---|
| Planned | Scheduled | LA | plan Approved |
| Scheduled | Launched | LA/HIA | `ia_check_launch_readiness` PASS, team assigned, no availability conflict |
| Launched | In Preparation | LA | — |
| In Preparation | Fieldwork | LA | preparation checklist complete, programme exists |
| Fieldwork | Reporting | LA | all activities Completed; all control tests concluded |
| Reporting | Under Quality Review | LA | draft report exists, findings ≥ Review, responses accounted for |
| Under Quality Review | Rework | QR | rework requested |
| Rework | Under Quality Review | LA | resubmitted |
| Under Quality Review | Report Issued | HIA/LA | **QA signed off** (mandatory) |
| Report Issued | Closed | HIA | §3.12 gate, zero open actions |
| Report Issued | Closed – Actions Pending | HIA | §3.12 gate, ≥1 open action |
| any pre-Fieldwork | Cancelled | HIA | reason mandatory |
| any pre-Reporting | Carried Forward | HIA | reason + target plan (`ia_plan_carry_forward`) |

### 3.3 Preparation
Not Started → In Progress → Complete. Actor LA/ATM. Complete requires all
mandatory checklist items ticked and mandatory documents requested.

### 3.4 Audit Programme / RCM
Draft → Under Review → Approved → Locked (at Fieldwork end).
Actor: ATM/LA author, LA/HIA approve. Locked programme is amendable only via a
logged amendment event.

### 3.5 Activities
Not Started → In Progress → Completed → Reviewed.
Reviewed only by someone other than the performer where SoD applies.

### 3.6 Control Tests
Planned → In Progress → Concluded(Pass | Fail | Partial | Not Applicable) → Reviewed.
A Fail or Partial **must** either raise a finding or record a documented rationale.

### 3.7 Findings
Draft → Under Review (LA) → Released for Response (LA) → Response Received (MR)
→ Auditor Review (LA) → **Agreed | Disputed** → (Disputed → Escalated → Resolved
or Retained-with-Disagreement) → Final → Reported → Closed.
A Disputed finding **may still be reported**; management's position is preserved
verbatim in the final report.

### 3.8 Management Responses
Requested → Draft (MR) → Submitted (MR) → Under Auditor Review (LA) →
Accepted | Returned for Clarification → (Returned → Submitted) → Final.
Position field: Agree | Partially Agree | Disagree (mandatory).

### 3.9 Corrective Actions — see §5.

### 3.10 Reports
Draft → In Review → QA Requested → QA Rework → QA Signed Off → Issued → Distributed.
`Issued` is terminal-forward: an issued report is immutable; corrections require a
new version with a superseding reference.

### 3.11 Quality Review
Requested → In Review → Rework Requested → Resubmitted → Signed Off.
**Self-review prohibited:** reviewer ≠ lead auditor ≠ preparer. Where the HIA must
review their own audit, this is recorded as a **logged SoD exception**, never a
silent default.

### 3.12 Audit Closure gate (frozen)
Closure requires ALL of:
1. every activity Completed/Reviewed;
2. every control test concluded;
3. no finding in Draft or Under Review;
4. every reportable finding has an accounted management response (received, or
   formally recorded as not provided within the deadline);
5. **mandatory QA signed off**;
6. **final report issued**;
7. actor holds `close_department_audit` and is not the sole preparer.

Terminal states: **Closed** (no open corrective action) and
**Closed – Actions Pending** (≥1 open corrective action). Open actions and
follow-ups do **not** block closure.

### 3.13 Annual Plan Closure
Every engagement in the plan must carry exactly one disposition:
Closed · Closed – Actions Pending · Cancelled (reason) · Carried Forward (reason + target plan).
Any engagement still at Planned/Scheduled with no disposition **blocks** closure.
Closure writes a reconciliation summary: planned / completed / carried forward /
cancelled / completion rate / open actions carried across the year boundary.

### 3.14 Follow-Up
Scheduled → Due → In Verification → Implemented | Partially Implemented | Not Implemented
→ (Not/Partially → action reopened with revised target) → Verified Closed.
Follow-up **continues after** audit closure and after plan closure.

---

## 4. ADR-04 — Report / QA Governance

```text
Draft Report → Review → QA Requested → (Rework ⇄ Resubmit) → QA Sign-Off
            → Final Report Issued → Distribution → Closure
```

- Final report issuance **must not precede QA sign-off**. `ia_can_issue_report`
  becomes the sole issuance gate and must require a signed-off
  `ia_quality_reviews` row for the engagement.
- Report content must be composed from live records (objectives, scope,
  methodology, findings + severity, recommendations, management responses
  including disagreement, action plans, overall conclusion/rating). No hardcoded
  or template-only content.
- Corrective actions remaining open never block issuance; they route the audit to
  **Closed – Actions Pending**.

---

## 5. ADR-05 — Corrective Action Model

Target lifecycle:

```text
Open → In Progress → Completed by Management → Verification Required
     → Verified → Closed
side states: Overdue (derived) · Returned/Rejected · Reopened · Cancelled(reason)
```

Required attributes (current `ia_action_tracking` columns marked ✓, gaps marked ✗):

| Attribute | Present today |
|---|---|
| source finding (`finding_id`) | ✓ |
| source recommendation (`recommendation_id`) | ✓ |
| source response (`response_id`) | ✓ |
| engagement (`engagement_id`) | ✓ |
| action description | ✓ |
| responsible person | ✓ **free text only** |
| accountable department | ✗ |
| **original target date** (immutable) | ✗ (only `target_date`) |
| current target date | ✓ (`target_date`) |
| extension history / reason / requested by / approved by / approved date | ✗ |
| progress status | ✓ (`status` / `action_status`, ungoverned) |
| progress updates | table `ia_action_plan_updates` exists (0 rows, unwired) |
| evidence links | ✓ (`evidence_ids`) |
| management completion submission | ✗ |
| auditor verification (`verified_by`, `verification_date`) | ✓ but `verified_by` is text |
| rejection / reopening | ✗ |
| closure authority | ✗ |

**Rule frozen:** `original_target_date` is written once at action creation and is
never updated. Every date change creates an extension record
(`requested_by`, `reason`, `approved_by`, `approved_at`, `previous_date`, `new_date`).
Deadline history is audit evidence and must survive plan closure and year end.

---

## 6. ADR-06 — Person-Based Ownership Model

Responsibility currently stored as **free text** (measured):

| Table | Free-text ownership columns | Target reference |
|---|---|---|
| `ia_findings` | `department_head_name`, `owner_role`, `created_by`, `updated_by` | department head → `profiles.id` via `ia_departments.head_profile_id`; author → `profiles.id` |
| `ia_management_responses` | `responsible_person`, `submitted_by` | `profiles.id` (respondent), department FK |
| `ia_action_tracking` | `responsible_person`, `verified_by`, `created_by`, `updated_by` | owner → `profiles.id`; verifier → `ia_auditors.id`/`profiles.id` |
| `ia_follow_ups` | `responsible_party`, `responsible_name` | `profiles.id` + assigned auditor `ia_auditors.id` |
| `ia_working_papers` | `prepared_by`, `reviewed_by`, `approved_by` | `ia_auditors.id` / `profiles.id` |
| `ia_audit_reports` | `prepared_by`, `reviewed_by`, `approved_by`, `issued_by` | `profiles.id` |
| `ia_annual_plans` | `plan_owner`, `prepared_by`, `submitted_by`, `approved_by`, `rejected_by`, `closed_by` | `profiles.id` |
| `ia_audit_engagements` | `approved_by`, `closed_by`, `launched_by` | `profiles.id` |
| `ia_department_audits` (legacy) | `lead_auditor_name`, `closed_by`, `closure_approved_by` | n/a — legacy |

**Decision:** add `*_profile_id uuid references profiles(id)` (or `ia_auditors.id`
for audit-side roles) **alongside** the existing text column. Text is retained as
a display snapshot ("name at the time"); the id is the routable identity. New
writes must populate the id; text becomes derived.

This is the precondition for: My Audit Work · Management Actions · QA Queue ·
Head of IA Attention · Follow-Up Queue · Plan Closure Blockers.

---

## 7. ADR-07 — Security Model

### 7.1 Measured current state — the single most serious finding
Every one of the **102** `ia_*` tables:
- has **RLS disabled** and **zero policies**;
- grants **SELECT and INSERT to `anon`** (unauthenticated);
- grants **INSERT/UPDATE/DELETE to `authenticated`**.

Any unauthenticated caller holding the publishable key can read and write audit
findings, evidence, reports and closures directly via the data API. This is not a
theoretical exposure. **Wave 1 must fix `anon` first, before anything else.**

### 7.2 Table classification (102 tables)

**A. ACTIVE OPERATIONAL — audit business records (RLS + governed writes)**
`ia_annual_plans`, `ia_audit_engagements`, `ia_activities`, `ia_control_tests`,
`ia_control_test_results`, `ia_evidence`, `ia_working_papers`, `ia_findings`,
`ia_recommendations`, `ia_management_responses`, `ia_action_tracking`,
`ia_action_plan_updates`, `ia_action_plan_milestones`, `ia_follow_ups`,
`ia_audit_reports`, `ia_quality_reviews`, `ia_quality_review_checklist`,
`ia_audit_closure`, `ia_audit_queries`, `ia_document_requests`,
`ia_preparation_checklists`, `ia_preparation_documents`, `ia_audit_checklists`,
`ia_rcm_processes`, `ia_rcm_risks`, `ia_rcm_controls`, `ia_rcm_tests`,
`ia_audit_procedures`, `ia_audit_programs`, `ia_time_logs`,
`ia_discussion_threads`, `ia_discussion_comments`, `ia_plan_versions`,
`ia_plan_version_engagements`, `ia_plan_amendments`, `ia_plan_carry_forward`,
`ia_plan_artifacts`, `ia_approval_actions`, `ia_risk_register`,
`ia_risk_assessments`, `ia_risk_assessment_factors`, `ia_risk_reviews`,
`ia_risk_mitigation_actions`, `ia_engagement_risk_overrides`,
`ia_auto_plan_candidates`, `ia_planning_score_explanations`,
`ia_planning_assumptions`, `ia_planning_wizard_state`,
`ia_resource_recommendations`, `ia_availability_conflicts`,
`ia_auditor_workload`, `ia_leave_requests`.

**B. MASTER / REFERENCE — read-wide, write by configuration authority**
`ia_departments`, `ia_department_functions`, `ia_audit_universe`, `ia_auditors`,
`ia_activity_types`, `ia_risk_categories`, `ia_holidays`,
`ia_control_effectiveness_levels`, `ia_risk_impact_levels`,
`ia_risk_likelihood_levels`, `ia_distribution_recipients`,
`ia_distribution_templates`, `ia_mitigation_templates`, `ia_checklist_templates`,
`ia_checklist_template_items`, `ia_document_section_library`.

**C. CONFIGURATION — configuration authority only**
`ia_audit_config`, `ia_audit_settings`, `ia_planning_parameters`,
`ia_planning_scoring_weights`, `ia_risk_config_master`, `ia_risk_criteria`,
`ia_risk_criteria_weights`, `ia_risk_scoring_models`,
`ia_risk_classification_thresholds`, `ia_risk_band_frequency_policy`,
`ia_execution_gate_config`, `ia_escalation_rules`, `ia_sla_rules`,
`ia_notification_triggers`, `ia_document_templates`,
`ia_document_template_sections`, `ia_document_template_settings`,
`ia_template_policy_matrix`, `ia_audit_plan_templates`, `ia_audit_plan_profiles`,
`ia_audit_plan_functions`, `ia_org_document_foundation`,
`ia_plan_workflow_bindings`, `ia_config_change_requests`.

**D. AUDIT / LOG — append-only, no client writes, no client deletes**
`ia_change_events`, `ia_engagement_execution_log`, `ia_plan_change_log`,
`ia_plan_distribution_logs`, `ia_auto_notification_log`, `ia_notification_logs`,
`ia_notification_queue`, `ia_communication_stages`, `ia_communications`.

**E. LEGACY — deprecate, service-role only, do not delete**
`ia_department_audits` (dual spine, ADR-01).

**F. DEAD / UNUSED — candidate for removal after Wave 2 confirmation**
`ia_notification_queue` + `ia_notification_logs` + `ia_auto_notification_log`
(superseded by Omni-Comms, ADR-09) and `ia_communications` /
`ia_communication_stages` if the Omni-Comms cutover fully replaces them.
No table is dropped in Wave 1.

### 7.3 Target access architecture

```text
Authenticated User
  → Governed Command (SECURITY DEFINER RPC)
    → Authentication check (auth.uid() present)
    → Permission check (ia_actor_can / registry)
    → Business scope check (assigned auditor / owning department / HIA)
    → Record state + valid transition check
    → Maker-checker check where required
    → Business mutation
    → Immutable audit event (ia_change_events)
    → Communication intent (Omni-Comms outbox)
```

Rules frozen:
1. `anon` gets **no** privilege on any `ia_*` table.
2. `authenticated` gets **SELECT only**, scoped by RLS, on classes A/B/C/D.
3. **No** direct `INSERT/UPDATE/DELETE` from the browser on class A, D or E.
   Every mutation of a finding, response, action, report, QA record, closure,
   evidence or working paper goes through a governed command.
4. Class B/C writes may remain table writes **only** while gated by RLS policies
   requiring the relevant configuration permission — preferred is a governed
   command for anything with downstream lifecycle impact.
5. Class D is append-only: INSERT by definer functions only; no UPDATE/DELETE for
   anyone but the service role.
6. Read scoping baseline: HIA and QR see all; LA/ATM see audits they are assigned
   to plus all master/reference/config; MR sees findings, responses, actions and
   follow-ups for their own department only.

---

## 8. ADR-08 — Permission Model (one vocabulary)

### 8.1 Measured conflict
Three vocabularies exist today:
1. `src/hooks/useInternalAuditPermissions.ts` → `INTERNAL_AUDIT_PERMISSION_MAP`,
   35 capabilities mapped onto registry `module:action` pairs — **this is correct
   and is adopted as canonical.**
2. `src/config/auditRouteConfig.ts` → route guards use
   `view_audit_assignments`, `create_audit_plans`, `approve_audit_plans`,
   `configure_audit_system`, `generate_reports`. Of these,
   **`view_audit_assignments` and `generate_reports` do not exist in the map**
   (the map defines `view_audit_readonly`). Confirms GAP-13.
3. `src/platform/audit/auditPermissions.ts` → `core.admin.audit.*` — this is the
   **platform activity-log** permission set, unrelated to Internal Audit business.
   Decision: leave untouched, but never use it for IA screens; rename usage sites'
   comments so the two are not confused.

### 8.2 Registry actions verified present in the database
`internal_audit:view` · `audit_plans:{view,create,edit,submit,delete}` ·
`plan_approval:{view,approve,reject}` ·
`audit_engagements:{view,create,edit,assign,launch,close}` ·
`activity_workbench:{view,execute}` · `control_testing:{view,execute}` ·
`evidence_management:{view,create,edit}` · `working_papers:{view,create,edit}` ·
`findings_recommendations:{view,create,edit,approve}` ·
`management_responses:{view,create,edit}` ·
`action_tracking:{view,create,edit,close}` ·
`follow_up_tracker:{view,create,edit,close}` ·
`audit_report_center:{view,create,issue}` · `quality_review:{view,create,approve}` ·
`plan_closeout:{view,approve,close}` · `audit_configuration:{view,configure}` ·
`audit_risk_configuration:{view,edit,configure}` ·
`risk_register:{view,create,edit}` · `risk_assessment:{view,create,edit}`.

Gaps to add in Wave 1 (needed by the frozen lifecycle):
`audit_report_center:review` (QA request), `quality_review:rework`,
`action_tracking:verify`, `action_tracking:extend`, `action_tracking:reopen`,
`management_responses:submit` (management-side), `findings_recommendations:dispute`,
`audit_engagements:cancel`, `audit_engagements:carry_forward`.

### 8.3 Persona → capability map

| Capability | HIA | LA | ATM | QR | MR |
|---|---|---|---|---|---|
| view_audit_readonly | ✓ | ✓ | ✓ | ✓ | ✓ (own dept) |
| create/edit/submit_audit_plans | ✓ | ✓ | – | – | – |
| approve/reject_audit_plans | ✓ | – | – | – | – |
| create/edit_department_audits, assign_auditors | ✓ | ✓ | – | – | – |
| launch_department_audit | ✓ | ✓ | – | – | – |
| execute_audit_activities | ✓ | ✓ | ✓ | – | – |
| upload_audit_evidence, create_working_papers | ✓ | ✓ | ✓ | – | – |
| enter/edit_audit_findings | ✓ | ✓ | ✓ | – | – |
| approve_audit_findings (release for response) | ✓ | ✓ | – | – | – |
| record_management_response | – | – | – | – | ✓ |
| review/accept management response | ✓ | ✓ | – | – | – |
| create_audit_actions | ✓ | ✓ | – | – | – |
| progress_audit_actions (management progress) | – | – | – | – | ✓ |
| action verify / reject / reopen | ✓ | ✓ | ✓* | – | – |
| action extension approval | ✓ | ✓ | – | – | – |
| close_audit_actions | ✓ | ✓ | – | – | – |
| manage/resolve_audit_followups | ✓ | ✓ | ✓ | – | – |
| draft_audit_reports | ✓ | ✓ | ✓* | – | – |
| issue_audit_reports | ✓ | – | – | – | – |
| record_quality_review | – | – | – | ✓ | – |
| approve_quality_review (sign-off) | ✓† | – | – | ✓ | – |
| close_department_audit | ✓ | – | – | – | – |
| approve_audit_closeouts, close_annual_plan | ✓ | – | – | – | – |
| configure_audit_system / risk settings | ✓ | – | – | – | – |
| manage_risk_register / assessments | ✓ | ✓ | ✓* | – | – |

`*` where explicitly assigned. `†` only via a **logged SoD exception**.

One vocabulary must be used by menu, route guard, screen hook, button gate and
RPC. Route config is repointed onto the canonical names in Wave 1.

---

## 9. ADR-09 — Audit Event Model

Single immutable store: **`ia_change_events`** (class D, append-only, written only
by governed commands).

Required payload: `event_code`, `entity_type`, `entity_id`, `engagement_id`,
`annual_plan_id`, `actor_profile_id`, `actor_label`, `occurred_at`, `old_value`
(jsonb), `new_value` (jsonb), `reason`, `correlation_id`, `source_command`.

Mandatory events:
plan created · plan submitted · plan approved · plan rejected · plan revised
(material) · plan version created · plan closed · carry-forward recorded ·
engagement created · engagement launched · team assigned/changed ·
preparation completed · programme approved · activity completed ·
control test concluded · evidence uploaded · evidence deleted (blocked
post-closure) · working paper reviewed/approved · finding created ·
finding edited · finding severity changed · finding released for response ·
finding disputed · dispute resolved · management response submitted ·
response accepted/returned · corrective action created · action assigned ·
action progressed · deadline extension requested/approved/rejected ·
management completion submitted · verification passed/rejected ·
action reopened · action closed · follow-up scheduled/verified ·
report drafted · QA requested · QA rework requested · QA signed off ·
report issued · report distributed · audit closed · audit closed–actions pending ·
audit cancelled · SoD exception recorded.

`updated_at` is **not** an audit trail and must never be cited as one.

---

## 10. ADR-10 — Communications Architecture

### 10.1 Measured current state — three paths, none delivering

| Path | What it is | What it actually does |
|---|---|---|
| `ia_fire_notification` (SQL, SECURITY DEFINER) | private IA trigger | inserts `ia_auto_notification_log` with `delivery_status='Queued'`, `channel='in_app'`; **no dispatcher, no worker, no cron**. Table = 0 rows. |
| `src/services/auditNotificationService.ts` | client service | invokes the `send-notification` edge function with a raw recipient email. Referenced by `useAuditDataExtended2.ts` only. Bypasses templates, branding, queue, retry and audit. |
| `src/services/iaNotificationService.ts` | client service | calls `dispatchInAppNotification()` (canonical resolver) → in-app only, 9 event codes. Closest to correct, still not the Omni-Comms façade. |
| `ia_notification_triggers` | private catalogue | 16 event codes (PLAN_SUBMITTED, PLAN_APPROVED, PLAN_REJECTED, PLAN_REVISION_SUBMITTED, ENGAGEMENT_STARTED, ENGAGEMENT_COMPLETED, FINDING_CREATED, ACTION_ASSIGNED, ACTION_OVERDUE, ACTION_COMPLETED, REPORT_ISSUED, CLOSURE_APPROVED, …) with recipient flags but no binding to any dispatcher. |
| Omni-Comms | canonical platform spine | **0 Internal Audit event definitions** out of 80 (BENEFITS, COMPLIANCE, FINANCE, LEGAL, OMNI, PLATFORM, REGISTRATION). |

Answers to the specific questions asked:
- **Which events produce email today?** Only whatever `useAuditDataExtended2.ts`
  routes through `send-notification`; every other IA event produces nothing.
- **Which only create logs?** All `ia_fire_notification` events — and the log is empty.
- **Does `send-notification` reach the configured provider?** It is the legacy
  notification function, outside the Omni-Comms provider/release governance; it
  is not covered by Omni-Comms delivery evidence, retries or failure surfacing.
- **Duplicates possible?** Yes — no idempotency key on any IA path.
- **Retries?** None on any IA path.
- **Failure visible?** No. Nothing transitions out of `Queued`, and the client
  service only `console.error`s.

### 10.2 Target (frozen)

```text
Business Event (governed command)
   → Communication Intent (omni_comms_business_event_outbox, same transaction)
   → Omni-Comms resolution (event definition → template → branding → recipients)
   → Queue / Dispatcher
   → Email / In-App / configured channel
   → Delivery Result
   → Retry / Failure / Escalation
   → Communication Audit Evidence (visible per audit / finding / action)
```

Rules frozen:
1. Internal Audit registers as an Omni-Comms module (`INTERNAL_AUDIT`) with its
   own event definitions — **no parallel IA communication framework**.
2. Business transactions must commit even when the provider is unavailable; the
   communication is then `Failed / Retryable`.
3. Recipients resolve from identity (ADR-06), not free-text email, wherever an
   identity exists.
4. `ia_fire_notification`, `ia_notification_queue`, `ia_notification_logs`,
   `ia_auto_notification_log` and `auditNotificationService.ts` are retired in
   Wave 4 — after Omni-Comms coverage exists, not before.
5. `ia_notification_triggers` becomes a **configuration** surface that maps onto
   Omni-Comms event definitions; it stops being an execution path.

---

## 11. ADR-11 — Operational Read Models (definitions only, nothing built)

Each is a governed read (RPC or view) returning a drill-down target
`(entity_type, entity_id, engagement_id, route)` so no user has to search.

| Read model | Grain | Key inputs | Primary persona |
|---|---|---|---|
| `ia_rm_my_audit_work` | one row per actionable item | assigned engagements, activities due/overdue, findings awaiting review, responses awaiting review, QA rework, follow-ups due | LA / ATM |
| `ia_rm_management_actions` | one row per commitment | findings awaiting response, open/due-soon/overdue actions, completion evidence requested, returned actions | MR |
| `ia_rm_hia_attention` | one row per governance exception | plans awaiting approval, delayed audits, high-risk delays, high/critical findings, disputed findings, overdue responses/actions, audits ready for QA, ready for closure, plan closure blockers | HIA |
| `ia_rm_qa_queue` | one row per engagement | awaiting QA, rework review, ready for sign-off | QR |
| `ia_rm_followup_queue` | one row per follow-up | due, overdue, verification outcome | LA / ATM |
| `ia_rm_closure_blockers` | one row per blocking reason | §3.12 gate evaluation per engagement | HIA / LA |
| `ia_rm_plan_status` | one row per engagement in plan | disposition, progress, dates | HIA |
| `ia_rm_findings_register` | one row per finding | severity, status, department, response state | all |
| `ia_rm_action_register` | one row per action | owner, original vs current target, extensions, status | all |
| `ia_rm_overdue_actions` | subset of action register | overdue only, ageing bands | HIA / MR |
| `ia_rm_committee_pack` | aggregate | plan status + findings + actions + closure summary | HIA |
| `ia_rm_plan_closure_summary` | one row per plan | planned/completed/carried/cancelled/rate/open actions | HIA |

Common filter contract for all: plan, department, function, engagement, owner,
auditor, severity, risk, status, due-date range, overdue flag, due-soon flag.
Common export contract: on-screen → filter → print → PDF → Excel.

---

## 12. GAP-01 … GAP-20 Reassessment

| ID | Still valid | Revised severity | Architecture decision | Dependency | Wave | Notes |
|---|---|---|---|---|---|---|
| GAP-01 No report surface | **Y** | S1 | ADR-04; report authoring inside the engagement workspace, not a standalone screen | ADR-01 | 2 | `AuditReportTab.tsx` exists, never mounted |
| GAP-02 No QA surface | **Y** | S1 | ADR-04; QA tab + QA queue; self-review blocked | ADR-06, ADR-08 | 2 | new component required |
| GAP-03 RLS off on all tables | **Y — worse than reported** | **S0** | ADR-07; measured 102 tables, and **`anon` holds SELECT+INSERT on all of them** | none | **1, first task** | Stage 1A did not report the `anon` grant |
| GAP-04 Closure unreachable | **Y** | S1 | gate is correct (ADR-03 §3.12); the missing surfaces are the defect | GAP-01, GAP-02 | 2 | clean audit must reach 100% |
| GAP-05 Notifications never delivered | **Y** | S1 | ADR-10; retire `ia_fire_notification` | Omni-Comms coverage | 4 | private log, 0 rows |
| GAP-06 Bypasses Omni-Comms | **Y** | S1 | ADR-10; register `INTERNAL_AUDIT` module — measured **0 of 80** event definitions | ADR-06 | 4 | three competing paths, not two |
| GAP-07 No dispute model | **Y** | S1 | ADR-03 §3.7/§3.8; add position + dispute/escalation states, preserved in report | ADR-04 | 2 | `ia_management_responses` has no position column |
| GAP-08 No work queues | **Y** | S1 | ADR-11 read models | **ADR-06 identity** | 3 | cannot be built before ownership is routable |
| GAP-09 Competing audit spines | **Y** | **S1** (raised from S2) | **ADR-01: `ia_audit_engagements` canonical; `ia_department_audits` legacy** | none | **1** | 0 rows ⇒ cheapest to fix now; blocks RLS design if left |
| GAP-10 Control testing/RCM unreachable | **Y** | S2 | ADR-03 §3.4/§3.6; wire the imported tab, add RCM chain | ADR-01 | 2 | dead import at `EngagementDetail.tsx:32` |
| GAP-11 Event catalogue 16 vs ~35 | **Y** | S2 | ADR-10 §10.2 + ADR-09 event list | GAP-06 | 4 | catalogue becomes configuration, not execution |
| GAP-12 No retry/idempotency | **Y** | S2 | resolved by adopting Omni-Comms rather than by patching the IA path | GAP-06 | 4 | — |
| GAP-13 Two permission vocabularies | **Y** | S2 | ADR-08; `INTERNAL_AUDIT_PERMISSION_MAP` is canonical; route config repointed | none | **1** | plus a third, unrelated `core.admin.audit.*` set |
| GAP-14 Unsafe client mutations | **Y** | **S0 in combination with GAP-03** | ADR-07 governed command boundary | GAP-03 | **1** | with `anon` INSERT this is exploitable today |
| GAP-15 Plan closure unexercised | **Y** | S2 | ADR-03 §3.13 | GAP-04 | 2/3 | `ia_close_annual_plan` exists |
| GAP-16 No realistic portfolio | **Y** | S3 | deliberately deferred to Stage 1B | Waves 1–4 | Stage 1B | seeding earlier would mask defects |
| GAP-17 Stale architecture doc | **Y** | S3 | `docs/AUDIT-ARCHITECTURE-AUDIT.md` superseded by this ADR | none | 1 (doc header) | 17 asserted routes do not exist |
| GAP-18 No export/print | **Y** | S3 | ADR-11 export contract | ADR-11 | 3/5 | committee pack cannot be produced today |
| GAP-19 No immutable trail | **Y** | **S1** (raised from S3) | ADR-09 | GAP-14 | **1** | without it, Wave 1 security cannot be evidenced |
| GAP-20 Dead code / orphan pages | **Y** | S4 | cleanup with the spine migration | ADR-01 | 1/2 | `ExecutiveDashboard.tsx`, `AuditPreparation.tsx`, dead tab import |

New issue found in Wave 0, not in Stage 1A:
**GAP-21 (S0) — `anon` holds SELECT and INSERT on all 102 `ia_*` tables.**
Unauthenticated read/write of audit findings, evidence and reports via the data
API. Wave 1, first task, ahead of RLS design.

---

## 13. Revised Implementation Waves

```text
WAVE 1 — Trust, Security & Canonical Foundation
  1. Revoke all anon privileges on ia_* (GAP-21)            ← first, standalone
  2. Canonical spine: ia_audit_engagements (GAP-09)
  3. Table classification applied; legacy labelled (GAP-09/20)
  4. RLS + read policies per class (GAP-03)
  5. Governed command boundary; remove client writes (GAP-14)
  6. One permission vocabulary + missing registry actions (GAP-13)
  7. Immutable audit events (GAP-19)
  8. Person references alongside free text (ADR-06)
  9. Persona PASS/DENY tests against the API, not the UI
        ↓
WAVE 2 — Complete Executable Audit Lifecycle
  RCM/control testing wiring (GAP-10) · finding + dispute model (GAP-07)
  report lifecycle (GAP-01) · quality review (GAP-02) · closure incl. clean
  audit at 100% (GAP-04) · plan closure proof (GAP-15)
        ↓
WAVE 3 — Action Management, Follow-Up & Work Queues
  action lifecycle + original/extension deadline history (ADR-05)
  follow-up + cross-year continuity · read models & queues (GAP-08)
  drill-down, filters, export (GAP-18)
        ↓
WAVE 4 — Omni-Comms, Email, Reminders & Escalation
  register INTERNAL_AUDIT events (GAP-06) · full catalogue (GAP-11)
  durable intent, retries, idempotency, failure visibility (GAP-05/12)
  retire ia_fire_notification + auditNotificationService (class F cleanup)
        ↓
STOP — STAGE 1B: real 20-record business E2E discovery (GAP-16)
        ↓
WAVE 5 — Remediate only the validated Stage-1B gaps
        ↓
STAGE 3 — Final full certification
```

**Two deviations from the proposed sequence, justified by repository evidence:**
1. **GAP-09 (canonical spine) moves into Wave 1**, not Wave 5. `ia_department_audits`
   is empty *today*; writing RLS policies, governed commands and audit events
   against two spines would double the Wave-1 surface and force a re-do later.
2. **GAP-21 / `anon` revocation precedes everything**, including RLS design. It is
   a one-statement class of fix with the largest risk reduction in the programme.

---

## 14. Migration Implications Summary

| Change | Data risk | Reversible | Wave |
|---|---|---|---|
| Revoke `anon` on `ia_*` | none (no legitimate anonymous audit access) | yes | 1 |
| Deprecate `ia_department_audits` | **none — 0 rows** | yes (comment + grants only) | 1 |
| `engagement_id` NOT NULL for new child rows | none (children are empty) | yes | 1 |
| RLS enable + policies | read regressions if scope is wrong → mitigated by persona tests | yes | 1 |
| Revoke `authenticated` write on class A/D | breaks any screen still writing directly → must land with the governed commands in the same wave | yes | 1 |
| Add `*_profile_id` columns | additive only | yes | 1 |
| Add action `original_target_date` + extension table | additive; backfill `original_target_date = target_date` (0 rows today) | yes | 3 |
| Add response `position` + dispute states | additive | yes | 2 |
| Register `INTERNAL_AUDIT` Omni-Comms events | additive | yes | 4 |
| Drop legacy notification tables | deferred until Omni-Comms proven | n/a | post-4 |

---

## 15. Risks & Technical Debt

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | Revoking `authenticated` writes before governed commands exist breaks working screens | Wave 1 regression | ship revocation and commands per entity, in the same migration set, with regression checks per screen |
| R2 | RLS read scope too tight ⇒ blank screens; too loose ⇒ no SoD | trust failure either way | persona-based API tests (not UI) as the acceptance gate |
| R3 | 102 tables, 48 routines — Wave 1 is large | schedule | classification (§7.2) allows class-by-class delivery; class A and D first |
| R4 | Phase-2 configurable universe still constrained by hard department/function FKs | future rework | ADR-02 neutral subject pair on all new structures |
| R5 | Omni-Comms cutover before IA lifecycle exists would generate events with no business meaning | wasted work | Wave 4 deliberately after Wave 2/3 |
| R6 | Seeding a realistic portfolio too early masks defects | false certification | portfolio deferred to Stage 1B, as instructed |
| R7 | Three permission vocabularies including an unrelated platform set | accidental mis-gating | ADR-08 canonical map; lint rule candidate in Wave 1 |
| R8 | `docs/AUDIT-ARCHITECTURE-AUDIT.md` overstates readiness | misinformed sign-off | superseded by this ADR; header correction in Wave 1 |
| R9 | Free-text ownership retained alongside ids may drift | reporting inconsistency | text is a display snapshot only; queues read the id |

---

WAVE 0 ARCHITECTURE: READY FOR REVIEW
