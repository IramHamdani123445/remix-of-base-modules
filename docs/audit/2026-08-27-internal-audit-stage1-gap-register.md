# Internal Audit Module — Stage 1
## Complete Business-Process E2E Discovery, Gap Register & Operating-Model Assessment

Date: 2026-08-27
Disposition: **NOT CERTIFIABLE — Stage 1 halted at lifecycle stage "Audit Report"**
Remediation: **NOT STARTED** (discovery pass only, per execution rule)

---

## 0. Evidence basis and honest scope statement

This pass was executed as a code-and-database forensic assessment of the live
project database and the shipped React module, walking the authoritative
Internal Audit lifecycle in order.

What was executed:
- Full inventory of the 104 `ia_*` tables with live row counts.
- Inventory of all `ia_*` database routines (44) and inspection of the closure,
  progress and notification routines.
- Inventory of every registered `/audit/*` route and every rendered tab in the
  audit execution workspace.
- Inspection of the permission model, the menu permission contract, the
  notification trigger catalogue and the notification dispatch path.

What could **not** be executed, and why (this is itself a Stage 1 finding):
- The 20-audit realistic annual plan and the five deep E2E journeys (Audits A–E)
  could not be run to completion. The lifecycle is **structurally interrupted**
  at the Audit Report stage: the report authoring/issuance surface and the
  quality-review surface are not reachable in the application (GAP-01, GAP-02),
  while server-side closure requires both. No audit — including a clean,
  zero-finding audit — can reach Closed through the UI today.
- Persona-based permitted/denied testing cannot produce meaningful evidence
  because every `ia_*` table has Row Level Security disabled with zero policies
  (GAP-03); enforcement is client-side only, so "denied" is a UI state, not a
  system state.

Per the execution rule, no fix, workaround or migration was applied.

---

## 1. Current-state inventory (measured)

### 1.1 Data volume — the module is effectively unused
| Area | Table | Rows |
|---|---|---|
| Departments | `ia_departments` | 13 |
| Functions | `ia_department_functions` | 43 |
| Audit universe | `ia_audit_universe` | 10 |
| Risk assessments | `ia_risk_assessments` | 2 |
| Risk register | `ia_risk_register` | 0 |
| Annual plans | `ia_annual_plans` | 3 |
| Department audits | `ia_department_audits` | **0** |
| Engagements | `ia_audit_engagements` | 8 |
| Auditors | `ia_auditors` | 3 |
| Activities / control tests / evidence / working papers | — | **0 / 0 / 0 / 0** |
| Findings / recommendations / responses | — | **0 / 0 / 0** |
| Actions / follow-ups | — | **0 / 0** |
| Reports / quality reviews | — | **0 / 0** |
| Notification queue / logs / auto log | — | **0 / 0 / 0** |
| Notification triggers (catalogue) | `ia_notification_triggers` | 16 |

The entire execution, reporting, response and follow-up half of the module has
never held a single production record.

### 1.2 Routes actually registered (35, deduplicated)
Present: dashboard, departments, functions, department-view, risk-register,
risk-assessment, entity-summary, risk-matrix, risk-settings, audit-plans (+ detail),
plan-approval, audits (+ detail), audit-reports, report-builder, queries,
auditors, workload, time-tracking, leave, config, document-templates, templates,
five `/audit/reports/*` analytical reports.

Absent as routes (execution lives only as tabs inside one engagement):
evidence, working papers, findings, management responses, action tracking,
follow-up tracker, control testing, activity calendar, activity workbench,
RCM, quality review, plan closeout, executive dashboard, committee reports,
letter generation, communication centre, SLA rules.

### 1.3 Execution workspace tabs actually rendered
overview, preparation, activities, evidence, working-papers, findings,
responses, actions, follow-ups, timeline, closure.

Not rendered: **control tests** (component imported, never mounted — dead code),
**audit report** (component exists, never imported), **quality review**
(no component at all).

---

## 2. GAP REGISTER

Severity: **S1** blocks the audit lifecycle · **S2** breaks the operating model ·
**S3** governance/assurance weakness · **S4** hygiene.

| ID | Sev | Lifecycle stage | Gap | Reproduction | Root cause / location |
|---|---|---|---|---|---|
| GAP-01 | S1 | Audit Report | No report authoring or issuance surface in the audit workspace. `AuditReportTab.tsx` exists (with print) but is never imported or routed. `ia_audit_reports` has 0 rows. | Open any audit → no Report tab. | `src/pages/audit/EngagementDetail.tsx` — tab absent |
| GAP-02 | S1 | Quality Review | No quality-review surface anywhere. Only `ExecutiveDashboard` reads `ia_quality_reviews`; nothing writes it. | No `/audit/quality-review` route, no tab. | Missing feature |
| GAP-03 | S1 | Whole module | **All 104 `ia_*` tables have RLS disabled and zero policies.** Any authenticated user can read/write every audit record, including findings and evidence, via the data API. Segregation of duties is cosmetic. | `pg_class.relrowsecurity = false` for all `ia_*`. | No RLS migration ever applied |
| GAP-04 | S1 | Audit Closure | Closure is unreachable for **every** audit, including clean audits: `ia_evaluate_engagement_closure` requires `report_not_issued = false` and `quality_review_pending = false`, and neither can be satisfied through the UI (GAP-01/02). Audit B (clean close to 100%) fails. | Call the evaluator on any of the 8 engagements. | Server gate correct; UI missing |
| GAP-05 | S1 | Communications | Notifications are **never delivered**. `ia_fire_notification` inserts into `ia_auto_notification_log` with `channel='in_app'`, `delivery_status='Queued'` and returns. There is no dispatcher, no worker, no cron, no provider call. Log is empty. | Read the routine body; `ia_auto_notification_log` = 0 rows. | `supabase/migrations/20260325182018_*.sql` |
| GAP-06 | S1 | Communications | The IA notification path **bypasses the mandated Omni-Comms façade** (`sendCommunication` / business-event outbox) and maintains a private queue + log, in direct conflict with the project's canonical communication architecture. | No `omni_comms` reference anywhere under the audit module. | Architecture drift |
| GAP-07 | S1 | Management Response | **Disputed findings are not modellable.** `ia_management_responses` has no agreement/disagreement flag, no auditor-review status, no escalation or resolution fields. Audit D (dispute → auditor review → escalation → final report) cannot be executed; a disagreement can only be typed into free text. | Column list of `ia_management_responses`. | Schema gap |
| GAP-08 | S1 | Actionable work | **No work queues exist.** There is no "My Audit Work" and no "Management Actions" view. Every open commitment is discoverable only by opening audits one at a time. Neither an auditor, a department head nor the Head of Internal Audit can answer "what needs attention, by whom, by when". | Route list; no cross-engagement queue. | Missing feature |
| GAP-09 | S2 | Planning ↔ Execution | **Duality of audit records.** The documented traceability chain is Plan → `ia_department_audits` → activities, but the implementation runs on `ia_audit_engagements`. `ia_department_audits` has 0 rows while 8 engagements exist, and findings/follow-ups carry *both* `department_audit_id` and `engagement_id`. Two competing spines. | Row counts + column lists. | Unretired legacy model |
| GAP-10 | S2 | Fieldwork | Control testing is unreachable: `AuditControlTestsTab` is imported but never mounted; `ia_control_tests`, `ia_rcm_risks`, `ia_rcm_controls`, `ia_audit_procedures` are all empty and have no UI entry point. RCM is therefore decorative. | `EngagementDetail.tsx` line 32 import with no `TabsContent`. | Incomplete wiring |
| GAP-11 | S2 | Communications coverage | The trigger catalogue holds **16** events against the **~35** business events required by the operating model. Missing at minimum: plan submitted, plan materially revised, department informed of planned audit, information/document request, audit query raised/answered, finding released for response, response due / overdue / submitted, auditor review required, target date approaching, revised target date approval, action verification required, action rejected/reopened, action closed, draft/final report issued, QA requested, rework requested, QA completed, closed-with-actions-pending, audit cancelled, plan ready for closure, plan closed. | `ia_notification_triggers` contents. | Incomplete catalogue |
| GAP-12 | S2 | Communications reliability | No retry, no retry count, no failure surfacing, no idempotency key on the notification path. Duplicate triggers of the same workflow event would insert duplicate rows. Failures are invisible to authorised users because nothing ever transitions out of `Queued`. | Routine body + table shape. | Design gap |
| GAP-13 | S2 | Permissions | The sidebar gates on capability names that are **not in the registered capability map** (e.g. `view_audit_assignments`), while `INTERNAL_AUDIT_PERMISSION_MAP` defines `view_audit_readonly`. Menu visibility and screen gating use two different vocabularies. | `auditMenuItems.ts` vs `useInternalAuditPermissions.ts`. | Contract mismatch |
| GAP-14 | S2 | Governance | Command-level authority is enforced only in the newer closure/action RPCs (`ia_actor_can`). Creation and mutation of findings, evidence, working papers, responses and reports go straight to the table from the client with no server authority check — and with RLS off (GAP-03) there is no backstop. | Tab components use direct `supabase.from(...)` writes. | Missing server commands |
| GAP-15 | S2 | Plan Closure | Annual plan closure (`ia_close_annual_plan`) requires a disposition per engagement, but with closure unreachable (GAP-04) no plan can be legitimately closed. Audit E (carry forward) can create a `ia_plan_carry_forward` record but the follow-on plan linkage has never been exercised (0 rows). | Function body + empty tables. | Downstream of GAP-04 |
| GAP-16 | S3 | Master data | The plan portfolio required for a realistic assessment does not exist: 3 plans, 8 engagements, no 2027 risk-based plan, 2 risk assessments against 43 functions, 0 risk register entries. Risk-based planning is therefore unproven — candidate generation has no risk input to consume. | Row counts. | Seeding gap |
| GAP-17 | S3 | Documentation | `docs/AUDIT-ARCHITECTURE-AUDIT.md` asserts all 34 modules exist and are "✅ Functional" with routes such as `/audit/findings`, `/audit/quality-review`, `/audit/plan-closeout`, `/audit/executive-dashboard`. **17 of those routes are not registered.** The document materially misstates readiness. | Route list vs document. | Stale document |
| GAP-18 | S3 | Output | No export/print of the audit file. Only `window.print()` inside the unreachable report tab. No CSV/PDF export of findings, actions, follow-ups, the plan or the committee pack. Committee reporting cannot be produced from the system. | Grep of the execution components. | Missing feature |
| GAP-19 | S3 | Traceability | `ia_engagement_execution_log` / `ia_change_events` are empty and only the closure and launch commands write events. Evidence upload, finding edit, response submission and action progression leave no immutable trail. | Empty tables + client-side writes. | Missing audit trail |
| GAP-20 | S4 | Hygiene | Orphan pages compiled but unreachable: `ExecutiveDashboard.tsx`, `AuditPreparation.tsx` (no routes). Dead import of `AuditControlTestsTab`. | Route grep. | Cleanup |

### Phase-2 forward-compatibility observation
The Phase-1 hierarchy (Office → Department → Function → Process → Risk → Control
→ Procedure) is implemented as **hard foreign keys to `ia_departments` /
`ia_department_functions`** on findings, follow-ups, the risk register and the
audit universe. A configurable Phase-2 universe will require either a generic
`auditable_entity` spine or a polymorphic subject reference. Recording this now
so Phase 2 is not blocked later — **no change proposed in this stage**.

---

## 3. E2E test evidence (lifecycle walk)

| Stage | Result | Evidence |
|---|---|---|
| Configuration | PASS (partial) | `ia_audit_config` 4 rows; risk settings screens routed |
| Departments | PASS | 13 departments |
| Functions | PASS | 43 functions |
| Audit universe | PASS (thin) | 10 entities, department-level only |
| Risk assessment | WEAK | 2 assessments for 43 functions; risk register empty |
| Risk-based planning | UNPROVEN | Candidate generation exists; no risk inputs to consume |
| Annual plan | PARTIAL | 3 plans; no realistic 2027 portfolio (GAP-16) |
| Plan approval | PRESENT | Workflow routines and screens exist; not exercised end to end |
| Engagement | PARTIAL | 8 engagements; competing `ia_department_audits` spine empty (GAP-09) |
| Preparation | PRESENT | Tab renders; no records |
| Programme / RCM | **FAIL** | No reachable surface (GAP-10) |
| Fieldwork / activities | PRESENT | Tab renders; 0 records |
| Control testing | **FAIL** | Unreachable (GAP-10) |
| Evidence | PRESENT | Tab renders; 0 records |
| Working papers | PRESENT | Tab renders; 0 records |
| Findings | PRESENT | Tab renders; 0 records |
| Recommendations | PRESENT | Card conversion to action exists |
| Management response | **FAIL (dispute)** | No agreement/dispute model (GAP-07) |
| Corrective action plan | PRESENT | Status lifecycle wired; no verification workflow |
| Audit report | **BLOCKING FAIL** | No surface (GAP-01) |
| Quality review | **BLOCKING FAIL** | No surface (GAP-02) |
| Audit closure | **BLOCKED** | Gate cannot be satisfied (GAP-04) |
| Follow-up of open actions | PARTIAL | Tab-only; no cross-audit queue (GAP-08) |
| Annual plan closure | **BLOCKED** | Downstream of closure (GAP-15) |
| Executive / committee reporting | **FAIL** | Page unrouted; no export (GAP-18, GAP-20) |

Audits A–E disposition: **A, B, C, D, E all NOT EXECUTABLE** in the current
build. A/B/C stop at Report; D additionally lacks the dispute model; E depends
on plan closure. No temporary test-only workaround was applied.

---

## 4. Process guide observations

1. The lifecycle order encoded in the workspace (overview → preparation →
   activities → evidence → working papers → findings → responses → actions →
   follow-ups → closure) is **professionally correct**; the defect is missing
   stages (programme/control testing, report, quality review), not wrong order.
2. Responsibility is expressed as free-text names (`responsible_person`,
   `department_head_name`, `submitted_by`) rather than user references. Work
   therefore cannot be routed to a person, which is the root cause of GAP-08.
3. Approvals are meaningful only where a server command exists (plan approval,
   launch, engagement closure, plan closure). Everywhere else "approval" is a
   status value the actor sets on themselves — no maker-checker.
4. Segregation of duties cannot be asserted at all while RLS is off (GAP-03).
5. Communication is currently a log-shaped illusion: events are recorded as
   intent and never leave the database. A transient provider failure cannot
   corrupt a business transaction — but only because no provider is ever called.

---

## 5. Recommended remediation waves (for approval — not started)

**Wave 1 — Make the lifecycle completable (S1, blocking)**
GAP-01 report surface · GAP-02 quality review surface · GAP-10 control
testing/RCM wiring · GAP-04 verified clean-audit close to 100%.

**Wave 2 — Make the system trustworthy (S1 governance)**
GAP-03 RLS + policies on all `ia_*` tables · GAP-14 server-side commands for
finding/evidence/response/report writes · GAP-13 permission vocabulary
reconciliation · GAP-19 immutable event trail.

**Wave 3 — Make the operating model real (S1/S2)**
GAP-08 "My Audit Work" and "Management Actions" queues · person-referenced
ownership · GAP-07 disputed-finding model with visible management position.

**Wave 4 — Communications as business workflow (S1/S2)**
GAP-05 + GAP-06 retire the private IA queue and route every audit event through
the Omni-Comms façade · GAP-11 complete the ~35-event catalogue with recipient
roles · GAP-12 retries, idempotency, failure visibility.

**Wave 5 — Closure, portfolio and reporting (S2/S3)**
GAP-09 retire one of the two audit spines · GAP-15 plan closure and carry-forward
proof · GAP-16 realistic 2027 portfolio and risk inputs · GAP-18 export/print ·
GAP-17/GAP-20 documentation and dead-code cleanup.

---

## 6. Certification disposition

**NOT CERTIFIED — Category: Structurally Incomplete.**

The module has a credible planning and fieldwork skeleton and genuinely good
server-side closure governance, but it cannot today operate a professional
Internal Audit function: no audit can be reported, quality-reviewed or closed;
no communication is ever delivered; no user can see their outstanding work; and
no access control is enforced in the database.

Stage 1 ends here. Remediation awaits explicit approval of the wave sequence.
