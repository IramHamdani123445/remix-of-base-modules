# Internal Audit — Auditor ↔ Auditee Communication Completeness Certification

**Scope:** Final pre-E2E business gap pass. Workflow state *and* communication obligation across the
full Internal Audit lifecycle (Planning → Scheduling → Fieldwork → Findings → Reporting → Closure →
Follow-up).

**Rebase baseline**

| Item | Value |
| --- | --- |
| Repository HEAD | `59babf901efaa079ee47e7596745a16392591ec0` |
| Catalogued IA events | 41 (all `active`) |
| Published event contracts | 41 (1 published version each) |
| Routes | Email + In-App active on 40 events; `ACTION.PROGRESS_RECORDED` is In-App only |
| Producer bindings | 2 active bindings per event (queued + immediate modes) |
| Reminder policies | 14 active rows across `management_response`, `action`, `follow_up` |
| Personas | 9 `@mishainfotech.com` IA personas provisioned |
| Certification date | 2026-08-28 (UTC) |

**Status: NOT CERTIFIED — 3 blockers, 3 high, 3 medium defects open.**
Final full E2E has **not** been started, per instruction.

---

## 1. Communication spine — what is proven working

Two live smoke tests were emitted through the governed spine
(`ia_comms_emit` → outbox → `omni_comms_request` → message → dispatch job → provider), to the real
MIPL auditee persona `audit.mgmt.benefits@mishainfotech.com`:

| Event | Request | Email | In-App |
| --- | --- | --- | --- |
| `INTERNAL_AUDIT.ENGAGEMENT.INTIMATION_ISSUED` | `1ff08d52-a7ff-4b95-af1a-b76967feb91a` — completed | delivered, provider msg `074f8677-…` — subject *“Notice of internal audit — Benefits Payments Assurance 2027”* | delivered `1f5d5073-…` |
| `INTERNAL_AUDIT.REQUEST.ISSUED` | `653aca90-5710-472a-847d-d49f3f727efd` — completed | delivered, provider msg `24707e5c-…` — subject *“Information requested for audit REQ-GAPCERT-2”* | delivered `643cd08f-…` |

Conclusion: the platform, routes, templates, sender identity, allowlist and dispatch authority for
auditee-facing communication are **operational**. Every defect below is a *business wiring or
business semantics* defect, not a platform defect.

---

## 2. Auditor ↔ Auditee communication map

Legend — **Auto** = raised by a governed command/scheduler; **Manual** = operator must click;
**None** = catalogued but no business call site.

### Planning
| Lifecycle moment | Event | Direction | Trigger | Verdict |
| --- | --- | --- | --- | --- |
| Plan submitted | `PLAN.SUBMITTED` | Auditor → HIA | Auto (`useAuditAnnualPlanFlow`) | OK |
| Plan approved | `PLAN.APPROVED` | Auditor → Auditee head + team | Auto (`auditNotificationService`) | Payload defect (§4.1) |
| Plan rejected / revision / conflict | `PLAN.REJECTED`, `PLAN.REVISION_REQUESTED`, `PLAN.TEAM_CONFLICT` | Internal | Auto | Payload defect |
| Plan distributed | `PLAN.DISTRIBUTED` | Auditor → Auditee | Auto (`planDistributionCommunicationService`) | OK |
| Plan closed | `PLAN.CLOSED` | Auditor → Auditee head | Auto | Payload defect |

### Scheduling / intimation
| Lifecycle moment | Event | Trigger | Verdict |
| --- | --- | --- | --- |
| Engagement **scheduled** | — | — | **BLOCKER (§4.2)** — no `Scheduled` state exists and nothing is emitted |
| Formal intimation | `ENGAGEMENT.INTIMATION_ISSUED` | **Manual** only (`CommunicationStageDialog` → `PLAN_INTIMATION`) | **BLOCKER** — intimation is discretionary |
| Engagement launched | `ENGAGEMENT.LAUNCHED` | Auto via `iaNotificationService` (not from `ia_launch_engagement`) | §4.4 |
| **Rescheduled** | — | — | **BLOCKER (§4.3)** — no distinct event |
| **Postponed / cancelled** | — | — | **BLOCKER** — no event; `execution_status = 'Cancelled'` is silent |
| Entrance meeting | `ENGAGEMENT.ENTRANCE_MEETING` | Manual | Acceptable (meeting notice is operator-scheduled) |

### Fieldwork / information requests
| Lifecycle moment | Event | Direction | Trigger | Verdict |
| --- | --- | --- | --- | --- |
| Information request issued | `REQUEST.ISSUED` | Auditor → Auditee | Manual (`DocumentRequestsTab`, `QUERY_CYCLE`, `notifyQuerySent`) | OK |
| Request reminder | `REQUEST.REMINDER` | Auditor → Auditee | Manual reminder mode | OK |
| Request fulfilled | `REQUEST.FULFILLED` | Auditee → Auditor | Auto (`DocumentRequestsTab`) | OK |
| Request overdue | `REQUEST.OVERDUE` | Auditor → Auditee | **None** | §4.6 |
| Auditee reply received | — | Auditee → Auditor | Mapped onto `REQUEST.REMINDER` | **Semantic defect (§4.5)** |

### Findings and responses
| Lifecycle moment | Event | Trigger | Verdict |
| --- | --- | --- | --- |
| Finding raised | `FINDING.RAISED` | Auto (`notifyFindingCreated`) | Payload defect |
| Response formally requested | `FINDING.RESPONSE_REQUESTED` | **None** | **§4.7** — reminder policies exist for an obligation never issued |
| Response submitted | `FINDING.RESPONSE_SUBMITTED` | Auto (`AuditResponsesTab`) | OK |
| Response accepted / rejected | `FINDING.RESPONSE_ACCEPTED`, `FINDING.RESPONSE_REJECTED` | **None** (`ia_review_management_response` is silent) | §4.4 |
| Severity changed | `FINDING.SEVERITY_CHANGED` | **None** (`ia_change_finding_severity` is silent) | §4.4 |

### Reporting
| Lifecycle moment | Event | Trigger | Verdict |
| --- | --- | --- | --- |
| Draft circulated | `REPORT.DRAFT_CIRCULATED` | Manual + `notifyReportGenerated` | OK |
| QA requested / cleared | `REPORT.QA_REQUESTED`, `REPORT.QA_CLEARED` | **None** | §4.4 |
| Report issued | `REPORT.ISSUED` | Manual (`FINAL_REPORT_ISSUE`); `ia_issue_report` is silent | §4.4 |

### Actions, closure and follow-up
| Lifecycle moment | Event | Trigger | Verdict |
| --- | --- | --- | --- |
| Action assigned | `ACTION.ASSIGNED` | Auto (`AuditActionsTab`) | OK — 14 requests observed |
| Due soon / overdue / escalated | `ACTION.DUE_SOON`, `ACTION.OVERDUE`, `ACTION.ESCALATED` | Auto — `ia_comms_generate_reminders` (daily 08:15) | OK — certified delivery |
| Progress, completion, verification, extension, closure | `ACTION.PROGRESS_RECORDED`, `COMPLETION_SUBMITTED`, `VERIFIED`, `VERIFICATION_REJECTED`, `EXTENSION_REQUESTED`, `EXTENSION_DECIDED`, `CLOSED` | **None** — `ia_action_*` commands are silent | §4.4 |
| Fieldwork completed | `ENGAGEMENT.FIELDWORK_COMPLETED` | Auto (`notifyClosurePending`) | Payload defect |
| Engagement closed | `ENGAGEMENT.CLOSED` | **None** (`ia_close_engagement` silent) | §4.4 |
| Follow-up scheduled / outcome / carried forward | `FOLLOWUP.*` | **None** for issuance; reminder policy exists for `FOLLOWUP.SCHEDULED` | §4.4 / §4.7 |

**Emission reality check.** Of 41 catalogued IA events, only **2** have ever produced a request in
this database: `ACTION.ASSIGNED` (14) and `ACTION.DUE_SOON` (2).

---

## 3. Critical scheduling test — result

Question: *does moving an engagement to “Scheduled” automatically emit a formal intimation?*

**Answer: No — and the state does not exist.** `ia_audit_engagements.execution_status` only takes
`Planned`, `In Progress`, `Closed`, `Closed – Actions Pending`, `Carried Forward`, `Cancelled`.
There is no scheduling command, no `Scheduled`/`Rescheduled`/`Postponed` state and no automatic
intimation. Intimation exists solely as an operator-initiated communication stage.

---

## 4. Gap register

| ID | Severity | Defect |
| --- | --- | --- |
| **DEF-S1B-44** | **BLOCKER** | **Contract payload key mismatch.** Contracts are `additionalProperties: false`; `ia_comms_contract_payload` strips unknown keys, and the resulting payload then fails required-field validation. Business call sites emit legacy keys (`planTitle`, `findingTitle`, `question`, `actionSummary`, `auditTitle`, `engagementRef`) where contracts require `subjectName`, `engagementTitle`, `scopeSummary`, `plannedStartDate`, `plannedEndDate`, `requestSummary`, `dueDate`, `severity`, `raisedOn`, `versionNumber`, `overallOpinion`. **Proven:** identical events emitted with legacy keys were blocked with `payload_schema_violation` (requests `de503f34-…`, `8b49c140-…`); re-emitted with contract keys they delivered end-to-end. Effect: most auditee-facing communications would silently fail closed in the final E2E. |
| **DEF-S1B-45** | **BLOCKER** | **No scheduling state and no automatic intimation.** Formal notice to the auditee is discretionary and manual (§3). |
| **DEF-S1B-46** | **BLOCKER** | **No rescheduling / postponement / cancellation communication.** No distinct events exist, so a date change or a cancelled audit reaches the auditee only informally. |
| **DEF-S1B-47** | **HIGH** | **Reply-received semantics.** `notifyQueryResponse` publishes an auditee reply as `INTERNAL_AUDIT.REQUEST.REMINDER` with occurrence `response_received` — an inbound business fact is announced to the auditor as a chase-up. No `REQUEST.RESPONSE_RECEIVED` event exists. |
| **DEF-S1B-48** | **HIGH** | **Governed commands are communication-silent.** No `ia_*` lifecycle command (launch, issue report, transition finding, review response, change severity, close engagement, schedule follow-up, all `ia_action_*`) emits a communication. Only `ia_comms_generate_reminders` and `ia_comms_emit_role` reference the spine. Obligations therefore depend on UI code paths and are lost for API/RPC-driven transitions. |
| **DEF-S1B-49** | **HIGH** | **Response obligation never formally issued.** `FINDING.RESPONSE_REQUESTED` has five reminder policies (D-7, D-1, due, +1, +7 with lead-auditor / department-head escalation) but no issuance call site, so reminders chase an obligation the auditee was never formally served. |
| **DEF-S1B-50** | **MEDIUM** | `REQUEST.OVERDUE` and all `FOLLOWUP.*` issuance events have no producer call site; `FOLLOWUP.SCHEDULED` reminders have the same orphan-obligation problem as DEF-S1B-49. |
| **DEF-S1B-51** | **MEDIUM** | Manual stage map collapses distinct business acts: `DOC_REQUEST` and `QUERY_CYCLE` both map to `REQUEST.ISSUED`, and `TEAM_AND_SCOPE_NOTICE` reuses `ENGAGEMENT.LAUNCHED`. Auditee cannot distinguish a document call-up from an audit query in the record. |
| **DEF-S1B-52** | **LOW** | `ia_communication_stages` (operator timeline) stores no `omni_comms_request_id`, so the operator-visible timeline and the governed delivery evidence cannot be reconciled per row. |

---

## 5. Recommended remediation order (before final full E2E)

1. **DEF-S1B-44** — normalise every IA producer call site to contract vocabulary, and make
   `ia_comms_contract_payload` fail loudly (return a blocker) when a required contract field is
   absent instead of silently emitting a payload that will be rejected downstream.
2. **DEF-S1B-45 / 46** — add a `Scheduled` execution state with a governed scheduling command that
   emits `ENGAGEMENT.INTIMATION_ISSUED`, plus new catalogued
   `ENGAGEMENT.RESCHEDULED` and `ENGAGEMENT.POSTPONED` (or `CANCELLED`) events with routes,
   contracts and templates.
3. **DEF-S1B-48** — move emission inside the governed commands so obligations follow state, not UI.
4. **DEF-S1B-47 / 49 / 50** — add `REQUEST.RESPONSE_RECEIVED`; issue `FINDING.RESPONSE_REQUESTED`
   and `FOLLOWUP.SCHEDULED` at the moment the obligation is created; wire `REQUEST.OVERDUE`.
5. **DEF-S1B-51 / 52** — split the stage map and persist the request id on the stage row.

**Stop point respected:** no lifecycle development performed, no persona defect reopened, no final
full E2E started.
