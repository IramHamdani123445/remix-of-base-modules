# BN Award Suspension — Execution and Reinstatement Closure

Scope: Benefits award suspension execution and reinstatement only. No Life
Certificates, Overpayments or Means Test work is included in this slice.

## 1. Command surface (server-side, transactional)

All state changes go through security-definer RPCs. The browser never mutates
`bn_award`, `bn_award_suspension_event`, `bn_award_suspension_payment_impact`
or workflow tasks directly.

| RPC | Purpose |
| --- | --- |
| `bn_award_suspension_propose_v1` | Raise a suspension case (maker). |
| `bn_award_suspension_approve_v1` | Approve a suspension case (checker). |
| `bn_award_suspension_reject_v1` | Reject with reason code and narrative. |
| `bn_award_suspension_withdraw_v1` | Proposer withdraws a proposed case. |
| `bn_award_suspension_execute_v1` | Manual execution: award mutation, payment holds, audit, receipt. |
| `bn_award_suspension_execute_scheduled_v1` | System execution used by the runner (system actor identity). |
| `bn_award_suspension_due_for_execution_v1` | Returns approved / previously failed cases whose effective date has arrived. |
| `bn_award_suspension_preview_payment_impact_v1` | Payment impact preview (permission-gated). |
| `bn_award_suspension_payment_impact_list_v1` | Paged payment-impact ledger read. |
| `bn_award_reinstatement_propose_v1` | Propose reinstatement of an executed suspension. |
| `bn_award_reinstatement_approve_v1` | Approve reinstatement (checker, non-proposer). |
| `bn_award_reinstatement_reject_v1` | Reject reinstatement with reason. |
| `bn_award_reinstatement_withdraw_v1` | Proposer withdraws. |
| `bn_award_reinstatement_calculate_arrears_v1` | Arrears v2 calculation with persisted calc run. |
| `bn_award_reinstatement_execute_v1` | Return award to active and record arrears outcome. |

Private helpers (`_bn_susp_*`, `_bn_reinst_decide`) have `EXECUTE` revoked from
`PUBLIC`, `anon` and `authenticated`.

## 2. Approval and execution separation

Approval and execution are distinct commands with distinct permissions:

- `bn_award_suspension.propose` / `.approve` / `.execute`
- `bn_award_suspension.resume_propose` / `.resume_approve` / `.resume_execute`
- `bn_award_suspension.view_payment_impact` (money figures only)

Maker–checker is enforced server-side (`E_SELF_APPROVAL_FORBIDDEN`) and mirrored
in the UI, which hides approve/reject controls from the proposer. Reinstatement
permissions are no longer inherited from suspension permissions.

## 3. Scheduler

`supabase/functions/bn-award-suspension-runner/index.ts` executes future-dated
suspensions:

1. Calls `bn_award_suspension_due_for_execution_v1` (status `APPROVED` or
   `EXECUTION_FAILED`, effective date reached, award still `ACTIVE`).
2. Skips items with five or more prior attempts, leaving them for manual review.
3. Calls `bn_award_suspension_execute_scheduled_v1` per item with the stable key
   `suspension_execute_scheduled:<case id>:<effective date>`.
4. Logs a batch summary (`scanned`, `executed`, `replayed`, `failed`).

The runner computes no business outcome; a failure inside the command is
persisted by the command itself as `EXECUTION_FAILED` with the error text, so a
crashed batch never leaves an award half-mutated.

## 4. Idempotency

- Client keys are **stable**, derived from `(command, entity id, row version)`.
  Two rapid clicks produce the same key and replay the stored receipt instead of
  executing twice.
- The payload is hashed separately: a reused key with a different payload is
  rejected with `E_IDEMPOTENCY_PAYLOAD_MISMATCH` rather than silently replayed.
- Scheduler receipts are stored against the system actor identity
  (`00000000-0000-0000-0000-000000000000`) so retries across different worker
  invocations still deduplicate.

## 5. Arrears correctness (v2)

Corrections applied over v1:

- Paid amounts use `greatest(paid_from_schedules, paid_from_instructions)`
  instead of summing both, which previously double-counted payments.
- Outstanding `bn_overpayment` balances are deducted from net arrears.
- Overlapping or ambiguous suspended periods force `REVIEW_REQUIRED`; execution
  then reinstates the award and records a review item without raising payment.
- Every calculation persists a `bn_calc_run` plus `bn_calc_trace` steps, so any
  figure shown to a user is reproducible from stored evidence.
- A unique index on `bn_award_suspension_payment_impact` prevents duplicate
  arrears rows for the same case and period.

## 6. Payment boundary and data access

Payment impacts are written only through the approved payment helper inside the
execution transaction. Reads are restricted:

- `bn_award_suspension_preview_payment_impact_v1` and the arrears calculation
  require `view_payment_impact`.
- The ledger is exposed only through the paged
  `bn_award_suspension_payment_impact_list_v1`; the table carries no client
  grants.
- The reinstatement panel does not request arrears at all without the
  permission, and states plainly that figures are withheld.

## 7. Workflow task handling

`_bn_reinst_decide` validates that the supplied `p_task_id` belongs to the case
being decided and is currently `OPEN`, returning `E_TASK_NOT_FOR_CASE` or
`E_TASK_NOT_OPEN`. This prevents closing an unrelated or already-closed task.

## 8. UI validation

- Reinstatement proposal requires a valid effective date (not future-dated), a
  reason code matching `^[A-Z][A-Z0-9_]{2,39}$`, and a narrative of at least ten
  characters; the blocking reason is shown next to the disabled button.
- Reinstatement lifecycle states use the server vocabulary
  (`REINSTATEMENT_PROPOSED` / `REINSTATEMENT_APPROVED`), fixing a defect where
  approve, reject and execute controls never appeared.
- Execution is disabled until the reinstatement effective date has arrived.
- `REVIEW_REQUIRED` arrears are called out before execution and reflected in the
  success message.

## 9. Communication boundary

No suspension or reinstatement code sends email or SMS, enqueues a notification,
or selects a template. Notifications remain the responsibility of the
communication façade; this slice only writes audit and case events.

## 10. Tests

`src/__tests__/bn/servicing/awardSuspensionClosure.test.ts` covers:

- stability of idempotency keys across repeated invocations and their change on
  row-version advance;
- typed, shielded mapping of `E_TASK_NOT_FOR_CASE`, `E_TASK_NOT_OPEN`,
  `E_IDEMPOTENCY_PAYLOAD_MISMATCH`, `E_FORBIDDEN`, `E_STALE_ROW_VERSION` and
  unknown SQLSTATE text;
- `EXECUTION_FAILED` results being treated as failures without an exception;
- payment-impact reads going through the paged RPC and failing closed on
  permission errors;
- reinstatement proposal payload propagation.

## 11. Residual items

- The scheduler must be attached to a cron trigger in the target environment;
  until then the runner is invoked on demand.
- Live-environment grant verification for the new RPCs is performed at publish
  time, consistent with the Phase 0 security closure.
