# Omni-Comms — Internal Convergence Wave 5

**Objective:** close the last internal Omni-Comms development work, so that if
the four external prerequisites remain unavailable there is no major internal
wave left.

Continues from `Omni_Comms_Internal_Convergence_Wave4.md`.

---

## 1. Baseline re-established

Live TEST database at the start of this wave:

| Measure | Value |
|---|---|
| Runnable dispatch backlog | 0 |
| Actionable holds | 0 |
| Failed | 0 |
| Retrying | 0 |
| Permanent historical holds | 20 (`historical_job_not_authorized`) |
| Cancelled (superseded pilot / snapshot) | 28 |
| Completed | 58 |

No queue remediation was required in this wave.

---

## 2. What Wave 5 closed

### 2.1 Legal (three paths)

Legal was the largest remaining island. All three paths reached a person
without the Hub.

| Path | Before | After |
|---|---|---|
| Judicial rule engine (`lgNotificationRuleEngine`) | direct `in_app_notifications` write; email leg was a permanent no-op | emits `LEGAL.JUDICIAL.EVENT_NOTIFIED`; the in-app row is retained as a compatibility record; the dead email stub was deleted |
| Referral information request (`legalReferralUnifiedService`) | `send-transactional-email` + in-app | emits `LEGAL.REFERRAL.INFO_REQUESTED`; no provider call remains |
| Referral information response (`legalReferralUnifiedService`, `legalReferralCollaborationService`) | `send-transactional-email` + in-app | emits `LEGAL.REFERRAL.INFO_RESPONDED`; no provider call remains |

Ownership boundary held: rule evaluation, the generated-document queue and
`lg_case_task` remain owned by Legal. Omni owns only the act of informing a
person.

### 2.2 Compliance employer audit communications

`auditCommunicationService.send()` was **misclassified in Wave 4 as Internal
Audit**. It is the Compliance employer audit / visit communication surface
(`ce_audit_communication*`, consumed by the Compliance communication composer,
panel and visit orchestrator). It called the platform notification function
directly for both email and SMS.

It now hands the approved communication to
`complianceAuditCommunicationProducer` under
`COMPLIANCE.AUDIT.COMMUNICATION_ISSUED`. Compliance retains the communication
record, approval gating, rendered snapshots and the per-recipient delivery
ledger; the ledger now records "handed to the Hub", not "a provider accepted
it". A `hub_handover` lifecycle event captures outcome, blockers and request id.

### 2.3 Benefits residual provider path

`bnNotificationIntegrationService.dispatchExternal` still contained a live
provider call body. Its only caller chain begins at `dispatchBnNotification`,
quarantined in Wave 3, so nothing depended on it. The body was removed and the
function now refuses, so the bypass cannot be resurrected by a future caller.

---

## 3. Events registered (evaluate-only)

All four are `active` with a producer binding whose only allowed mode is
`shadow`. Nothing new is delivered to anyone.

| Event code | Module | Producer |
|---|---|---|
| `LEGAL.REFERRAL.INFO_REQUESTED` | LEGAL | `legalCommunicationProducer.emitLegalInfoRequested` |
| `LEGAL.REFERRAL.INFO_RESPONDED` | LEGAL | `legalCommunicationProducer.emitLegalInfoResponded` |
| `LEGAL.JUDICIAL.EVENT_NOTIFIED` | LEGAL | `legalCommunicationProducer.emitJudicialEventNotice` |
| `COMPLIANCE.AUDIT.COMMUNICATION_ISSUED` | COMPLIANCE | `complianceAuditCommunicationProducer.emitAuditCommunicationIssued` |

---

## 4. Compatibility records — explicit, bounded

Because every business binding is evaluate-only, removing the legacy
`in_app_notifications` rows would silently remove notifications officers rely
on today. They are therefore retained and labelled in code as **compatibility
records**: they write no provider traffic and create no task.

Retirement trigger is identical for all of them: **the owning module's in-app
delivery is certified live in the Hub**. At that point the compatibility write
is deleted in a single sweep with the legacy bell.

Remaining compatibility records: Legal (C12–C14), Platform gate approvals
(C10).

---

## 5. Verdict

| Area | Status |
|---|---|
| Internal application convergence | READY |
| Benefits | READY |
| Registration | READY |
| Compliance | READY |
| Legal | READY |
| Finance | READY |
| Document communications | READY |
| Approval alerts | READY |
| My Communications | READY |
| My Tasks | READY |
| Active unapproved business communication bypasses | 0 |
| Unknown producers | 0 |
| Runnable backlog | 0 |
| Actionable holds | 0 |
| Failed | 0 |
| Retrying | 0 |
| Permanent historical holds | 20 |
| External prerequisites remaining | 4 |
| System-wide production | NO-GO |

### External prerequisites (unchanged, all outside the platform)

1. Production provider credentials (email and SMS).
2. Verified production sender domain.
3. Approved production recipient policy (allowlist exit authorisation).
4. Live production backend environment marker and release snapshot.

**No major internal Omni-Comms development wave remains.** The work still
outstanding is activation: flipping each module's channel bindings from
evaluate-only to live once the four prerequisites are supplied, then deleting
the compatibility records listed in section 4.
