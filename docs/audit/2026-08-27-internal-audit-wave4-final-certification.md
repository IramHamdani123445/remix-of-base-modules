# Internal Audit — Wave 4 Final Certification (Omni-Comms Cutover)

Date: 2026-08-27
Scope: prove the existing Internal Audit Omni-Comms cutover end to end. No new architecture introduced; this pass is evidence-only plus defect registration.
Verification method: live database interrogation (registry + runtime), scheduler scenario execution, repository-wide legacy-sender scan, full regression stack.

---

## 1. Structural registry state (PASS)

| Control | Expected | Observed | Result |
|---|---|---|---|
| Active IA event definitions | 39 | 39 | PASS |
| Published event contracts | 39 | 39 | PASS |
| Template families | 39 | 39 | PASS |
| Published template versions (Email + In-App) | 78 max, ≥ 1/channel | 77 | PASS (one family is In-App only by design) |
| Active event routes | 77 | 77 (email 38, in_app 39) | PASS |
| Routes without a bound template family | 0 | 0 | PASS |
| Active producer bindings | 39 | 39 | PASS |

No orphan routes, no unbound families, no duplicate event codes.

## 2. Reminder & escalation policy state (PASS)

14 active policy rows across three obligation kinds:

- `action`: +14, +7, 0 (DUE_SOON), −7 (OVERDUE), −30 and −60 (ESCALATED, with escalation roles)
- `management_response`: +7, +1, 0, −1, −7
- `follow_up`: +7, 0, −7

Escalation ladder is monotonic: −30 escalates to department head + lead auditor, −60 adds head of internal audit.

## 3. Scheduler behavioural certification

All scenarios executed against `public.ia_comms_generate_reminders(date, integer)` on the certification action `ACT-2026-00008`.

| # | Scenario | Evidence | Result |
|---|---|---|---|
| 1 | Single-run lease | Second concurrent lease acquisition on `ia-comms-reminder-scheduler-daily` returned `false` | PASS |
| 2 | Escalation at 30 days overdue | Emitted `INTERNAL_AUDIT.ACTION.ESCALATED` / `overdue_30`; recipients: action owner + lead auditor | PASS (partial recipients — see DEF-1) |
| 3 | Escalation at 60 days overdue | Emitted `overdue_60`; head of internal audit **not** attached | FAIL — DEF-1 |
| 4 | Stop on completion | Action set to `Closed`, same 30-day window re-run → `emitted: 0` | PASS |
| 5 | Owner reassignment | Owner changed → next reminder addressed only the new owner (`kmanning@…`), prior owner dropped | PASS |
| 6 | Deadline extension | Target date +45 → `due_today` fired at the new date, and the old date produced `emitted: 0` | PASS |
| 7 | Idempotency / re-run | Identical re-run same day → `emitted: 0, deduplicated: 1`; no duplicate outbox row | PASS |
| 8 | Recipient resolution failure | `ia_comms_profile_fact` returns NULL for unresolvable/NULL profiles; scheduler records `outcome = blocked`, `reason = RECIPIENT_RESOLUTION_FAILED` (never silent) | PASS |
| 9 | Emission target | Every emission lands in `omni_comms_business_event_outbox` with an `omni-event-v2:` idempotency key — no direct provider call from the scheduler | PASS |

## 4. Delivery-path governance (BLOCKED — not a code defect)

`omni_comms_channel_release_control` currently holds:

| Channel | Release state | Permitted caller modules |
|---|---|---|
| email | suspended | BENEFITS |
| print | suspended | BENEFITS |
| in_app | (no release row) | — |

Consequence: Internal Audit emissions are correctly accepted into the outbox but **cannot** reach provider dispatch. End-to-end delivery, bounce/failure, retry-and-recover and delivery-evidence controls therefore cannot be certified in this pass. This is the platform's intended safety posture; going live for INTERNAL_AUDIT is a governed release decision (propose → second-person approve → activate) and was deliberately **not** executed unilaterally.

## 5. Single-architecture control (FAIL)

Repository-wide scan for legacy senders inside Internal Audit surfaces found four surfaces still bypassing the canonical entrypoint:

| Surface | Legacy call |
|---|---|
| `src/services/auditCommunicationService.ts` (lines 292, 348) | direct `fetch(/functions/v1/send-notification)` |
| `src/components/audit/CommunicationStageDialog.tsx` (154–185) | `sendActualEmail` → `send-notification` |
| `src/components/audit/DocumentRequestsTab.tsx` (129, 184, 202) | `supabase.functions.invoke('send-notification')` |
| `src/components/audit/PlanDistributionTab.tsx` (227) | `supabase.functions.invoke('send-notification')` with PDF attachment |

Automated producers (`iaNotificationService`, `auditNotificationService`, reminder scheduler) are fully cut over; these four are **manual, user-initiated** surfaces. They remain a second live sending path, so the "one architecture" control fails.

Note: `PlanDistributionTab` sends a PDF attachment. The Omni-Comms request contract has no attachment slot for Internal Audit today, so cutting it over as-is would silently drop the attached plan document. Attachment support is a prerequisite, not a refactor.

## 6. Regression stack

- Build: **OK** (`build 2026-08-27T19:02:32Z`)
- Typecheck (`tsgo --noEmit`): **clean**
- Vitest: **6461 passed / 31 failed / 368 files**. All 31 failures sit in legacy Communication-Hub suites (`CommHubP3*`, `readinessReadOnly`, `runtime-comm-resolver-cutover`, `workspaceLayout`) and are pre-existing — no code was modified in this pass. Zero Internal Audit or Omni-Comms IA failures.

## 7. Defect register

| ID | Severity | Defect | Required fix |
|---|---|---|---|
| DEF-1 | High | Head of Internal Audit never receives 60-day escalations; department head frequently unresolved. Root cause: no `ia_auditors` row carries a head role (`roles = {Auditor}` only) and 9 of 13 `ia_departments` have no `head_profile_id`. Unresolved escalation roles are dropped silently. | Designate a Head of Internal Audit, backfill department heads, and make the scheduler log an explicit `ESCALATION_ROLE_UNRESOLVED` outcome instead of silently omitting the recipient. |
| DEF-2 | High | Four manual IA surfaces still send via `send-notification` (section 5). | Cut over `CommunicationStageDialog`, `DocumentRequestsTab`, `auditCommunicationService`; `PlanDistributionTab` blocked on DEF-3. |
| DEF-3 | Medium | Omni-Comms request contract carries no attachment payload for IA, blocking audit-plan PDF distribution cutover. | Add a governed attachment reference (storage object + checksum) to the IA event contract before cutting over plan distribution. |
| DEF-4 | Medium | `in_app` has no `omni_comms_channel_release_control` row, and email permits `BENEFITS` only. | Create the in-app release record and run the governed release proposal/approval for INTERNAL_AUDIT on email + in-app. |

---

## Verdict

Structure, policy, scheduler behaviour, idempotency, dedupe, reassignment, extension, stop-on-completion and recipient-failure handling are all certified. Two internal controls fail: single sending architecture (DEF-2/DEF-3) and escalation completeness (DEF-1); end-to-end delivery evidence is blocked by governance posture (DEF-4).

**WAVE 4 RESULT: PARTIAL**
**NOT READY FOR STAGE 1B**
