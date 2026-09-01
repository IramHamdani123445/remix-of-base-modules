# Omni-Comms — Internal Convergence Wave 4

Continues `Omni_Comms_Internal_Convergence_Wave3.md`.

Scope: complete every convergence step that can legitimately be completed
**before** production credentials, sender-domain approval and the Live backend
are supplied. No external prerequisite was simulated, assumed or bypassed.

---

## 1. What changed

### 1.1 Finance document communications (Stage 6/7)

Two real business communications already existed in the Cashier screens and
called the platform notification function directly from the browser:

| Business fact | Screen | Previous path | Now |
|---|---|---|---|
| Invoice issued | Create Invoice | direct provider invocation | `FINANCE.INVOICE.ISSUED` |
| Receipt issued | Payment Data Entry | direct provider invocation | `FINANCE.PAYMENT.RECEIPT_ISSUED` |

- New producer: `src/platform/omni-comms/integrations/business/financeDocumentProducer.ts`.
- `sendDocumentEmail` (`src/hooks/useEmailDeliveryConfig.ts`) now supplies
  **business facts only**. All client-side subject building, HTML body
  fallbacks, template fetching and PDF assembly were deleted: template,
  version, branding, letterhead, signature, sender identity, approval,
  queueing, dispatch and retry are Hub concerns.
- The recipient remains the authoritative address resolved server-side by
  `resolve_payer_email`. No arbitrary address can be typed into the send path.
- Invoice and receipt are kept as **distinct events**, not collapsed into a
  generic `DOCUMENT.SEND` — they are different business facts with different
  traceability.

### 1.2 Platform approval alerts and workflow decisions (Stage 8)

| Business fact | Source | Now |
|---|---|---|
| Delivery-gate change requested / approved / rejected | `gateApprovalNotifications.ts` | `PLATFORM.APPROVAL.GATE_*` |
| Applicant told of a review decision | `useApplicationsReview.ts` | `PLATFORM.WORKFLOW.DECISION_NOTIFIED` |

- New producer: `src/platform/omni-comms/integrations/business/platformApprovalAlertProducer.ts`.
- **Ownership boundary held.** Omni owns only the message informing a person.
  Task creation, assignment, completion and approval state remain owned by the
  workflow engine and surface through My Tasks. Neither producer creates,
  mutates or closes a task.
- The legacy in-app row and the `notification_logs` row are **retained as
  compatibility records** per the no-premature-removal rule. They write no
  provider traffic; they are not a second sending path.

### 1.3 Registry

Migration registered five event definitions (draft → active) plus producer
bindings for `FINANCE` and `PLATFORM`, all with `allowed_modes = {shadow}`.

**Delivery authority was not widened.** Every new emission is evaluate-only:
resolved, evaluated, recorded, and *not* dispatched. Fail-closed by design
until each module is certified for live delivery.

---

## 2. Queue truth (live, this wave)

| Measure | Count |
|---|---|
| Runnable backlog | 0 |
| Actionable holds | 0 |
| Failed | 0 |
| Retrying | 0 |
| Permanent historical holds | 20 (`historical_job_not_authorized`) |
| Cancelled pilot artifacts (Wave 3 disposition) | 28 |
| Completed | 58 |

---

## 3. Verification

- Build: OK.
- Typecheck: clean.
- Omni-Comms suites: 95/95 pass across 11 files, including the architecture
  guard that forbids any provider reference inside a producer.
- Full suite: 6842 pass, 30 pre-existing environment-dependent legacy failures
  (unchanged from Wave 3, none in Omni-Comms).

---

## 4. Final verdict

| Area | Status |
|---|---|
| Internal application convergence | PARTIAL |
| Benefits | READY |
| Registration | READY |
| Compliance | PARTIAL |
| Legal | PARTIAL |
| Finance | READY |
| Document communications | READY |
| Approval alerts | READY |
| My Communications | READY |
| My Tasks | PARTIAL |
| Active unapproved business communication bypasses | 3 (Legal rule engine, legal referral collaboration, audit communication service) |
| Unknown producers | 0 |
| Runnable backlog | 0 |
| Actionable holds | 0 |
| Failed | 0 |
| Retrying | 0 |
| Permanent historical holds | 20 |
| External prerequisites remaining | 4 (production provider credentials, approved sender domain, production recipient policy, Live backend environment) |
| System-wide production | NO-GO |

The Internal Audit controlled pilot remains **GO**. System-wide go-live stays
NO-GO purely on the four external prerequisites above — no internal platform
work is blocking it in Finance, Document communications or Approval alerts.
