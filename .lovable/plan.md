# BN Award Suspension — Execution & Reinstatement (controlled slice)

Scope: execution of an approved suspension, future-dated scheduling, and the
reinstatement lifecycle with arrears. No Life Certificates, Medical Reviews,
Overpayments, Mortality, Appeals, Means Tests, Uprating or Risk work.

## Source inspection findings (verified against the live Test database)

| Area | What exists today | Reuse decision |
|---|---|---|
| Suspension RPCs | `bn_award_suspension_propose_v1`, `_approve_v1`, `_reject_v1`, `_withdraw_v1` (SECURITY DEFINER, dark-launched) | Preserved unchanged |
| `bn_award_suspension_event` | Has `proposed_by_user_id`, `workflow_instance_id`, `correlation_id`, `row_version`, status check `PROPOSED/APPROVED/REJECTED/WITHDRAWN/ACTIVE/RESUMED`, partial unique open-case index | Extend forward-only |
| `bn_award` | `status`, `start_date`, `end_date`, `base_amount`, `frequency`, `metadata`. **No `row_version` column** | Add `row_version` (forward-only) |
| `bn_award_status_event` | Exists: `from_status`, `to_status`, `event_date`, `reason_code`, `remarks`, `entered_by` | Reused as the operational status event |
| Approval / workflow | `bn_approval_policy`, `core_workflow_definition/step/transition/instance/task/action_log`, `BN_AWARD_SUSPENSION` definition seeded | Reused; no new workflow engine |
| Idempotency | `core_command_receipt` (actor + command + key + payload hash) | Reused |
| Payments | `bn_payment_schedule` (status `SCHEDULED`/`READY` live), `bn_payment_instruction` (already has `hold_reason`/`hold_by`/`hold_at`, `exception_code`, `cancelled_*`, `batch_id`), `bn_batch_item`, `bn_payment_batch`, `bn_payment_exception` (0 rows) | Reused; **no new hold table** |
| Entitlement | `bn_entitlement` with rates, `suspended_at/by`, effective dates | Read for arrears |
| Calculation trace | `bn_calc_run`, `bn_calc_trace` | Reused for the arrears snapshot |
| Communication | `omni_comms_request` outbox (idempotency, correlation, caller module/entity) | Reused as the transactional intent |
| Scheduler | `bn-escalation-runner` edge function pattern (plus other cron-invoked functions) | New `bn-award-suspension-runner` follows the same pattern |
| Permissions | `app_modules.bn_award_suspension` (`actions_enabled=false`, `show_in_menu=true`); actions: `view, propose, approve, reject`-via-approve, `resume_propose`, `resume_approve`, `reverse`, `audit` | Extend with execute / payment actions |
| Unsafe mutation | `awardServicingService.updateAwardStatus()` — remaining caller is the stage-advance helper at line 369 plus legacy console (already guarded by a regression test) | Keep guard, add execution-path test, record migration plan |

No genuine schema blocker. Proceeding.

## 1. Database (forward-only migration, nothing activated)

New columns / objects only where required:

- `bn_award.row_version integer not null default 1` (optimistic concurrency).
- `bn_award_suspension_event`: `executed_at`, `executed_by_user_id`,
  `execution_status` (`NOT_DUE|SCHEDULED|EXECUTING|EXECUTED|FAILED`),
  `execution_attempts`, `last_execution_error`, `reinstatement_of_id`,
  `case_kind` (`SUSPENSION|REINSTATEMENT`), `arrears_calc_run_id`.
- Status vocabulary extended: add `EXECUTION_FAILED` and reinstatement states.
- `bn_award_suspension_payment_impact` — the only new table: one row per
  affected payment record (schedule / instruction / batch item), with
  `impact_action` (`HELD|EXCEPTION_RAISED|NO_ACTION|RELEASED|RETAINED`) and a
  link back to the suspension case. Guarantees suspension→payment traceability;
  it is a link/evidence table, not a duplicate hold model.

New RPCs (SECURITY DEFINER, `search_path=public`, `authenticated`+`service_role`
grants, `anon` revoked, all gated on `_bn_susp_assert_module_enabled()`):

- `bn_award_suspension_preview_payment_impact_v1` (read-only, no writes)
- `bn_award_suspension_execute_v1`
- `bn_award_reinstatement_propose_v1`
- `bn_award_reinstatement_approve_v1`
- `bn_award_reinstatement_reject_v1`
- `bn_award_reinstatement_withdraw_v1`
- `bn_award_reinstatement_calculate_arrears_v1` (idempotent, writes calc trace)
- `bn_award_reinstatement_execute_v1`
- `bn_award_suspension_due_for_execution_v1` (service_role only, scheduler feed)

Every command takes suspension id, `p_expected_row_version`,
`p_idempotency_key`, `p_correlation_id`, optional narrative; actor is
`auth.uid()` only; results are stored in `core_command_receipt`.

## 2. Suspension state machine

```text
PROPOSED --approve--> APPROVED --execute (due)--> ACTIVE
   |                     |            \--fail--> EXECUTION_FAILED --retry--> ACTIVE
   |                     \--not due--> APPROVED (execution_status=SCHEDULED)
   \--reject--> REJECTED    \--withdraw (policy)--> WITHDRAWN
ACTIVE --reinstatement executed--> RESUMED
```

Execution validates: authenticated, `bn_award_suspension.execute` permission,
module actions enabled, case locked `FOR UPDATE` and `APPROVED`, award locked
and still `ACTIVE`, effective date due (`suspended_from <= current_date`),
row version match, reason/policy configured, payment impact resolvable.
All effects in one transaction; any mandatory failure rolls back, leaving the
award untouched and the case retryable.

## 3. Payment hold rules (based on the real model)

| Payment state | Treatment |
|---|---|
| `bn_payment_schedule` future/unpaid (`SCHEDULED`, `READY`) | Hold — status `HELD`, impact row `HELD` |
| `bn_payment_instruction` not batched, unpaid | Set `hold_reason/hold_by/hold_at`, status `HELD` |
| Instruction already in a batch, not issued | Exception (`SUSPENSION_HOLD_REQUIRED`) + operational task |
| Batch issued / EFT generated / cheque printed / paid | Never mutated — exception `SUSPENSION_AFTER_ISSUE` for recovery review |
| Failed / returned | No action; recorded `NO_ACTION` with reason |
| Period straddling the effective date | Exception for manual proration |

Nothing is deleted; issued financial history is immutable; Finance handoff stays
behind the existing adapter/outbox boundary.

## 4. Future-dated execution

Approved-but-not-due cases get `execution_status=SCHEDULED`. New edge function
`bn-award-suspension-runner` (service-role, modelled on `bn-escalation-runner`)
polls `bn_award_suspension_due_for_execution_v1` and calls the execute command
with a deterministic idempotency key per (case, attempt-day), so repeat runs
never duplicate status events, holds, exceptions, audits or communications.
Failures set `EXECUTION_FAILED` with the error and stay visible and retryable.

## 5. Reinstatement lifecycle

```text
(award SUSPENDED) REINSTATEMENT_PROPOSED --approve--> REINSTATEMENT_APPROVED
      --execute--> award ACTIVE, suspension case RESUMED
      --reject--> REINSTATEMENT_REJECTED   --withdraw--> REINSTATEMENT_WITHDRAWN
```

Reinstatement rows live in `bn_award_suspension_event` with
`case_kind='REINSTATEMENT'` and `reinstatement_of_id` pointing at the active
suspension — reusing the same workflow definition family, approval policy and
maker-checker rules (admins not exempt). Validations: award suspended, active
suspension exists, no open reinstatement, valid effective date, narrative and
evidence present, reason permits reinstatement, arrears computable.

Execution transaction: award → `ACTIVE` + row_version++, suspension → `RESUMED`,
`bn_award_status_event` written, arrears calculated and persisted, arrears
payment intent created through the payment boundary, only safe holds released
(exception-flagged items retained), audits + `omni_comms_request` intents,
receipt finalized.

## 6. Arrears calculation (server-authoritative)

Computed in SQL from `bn_entitlement` rates, `bn_award.base_amount`/`frequency`
and payment history: suspended period → gross payable → minus payments already
made/recovered → minus excluded periods and policy deductions → net arrears,
rounded by configured currency rules. Persisted as a versioned
`bn_calc_run` + `bn_calc_trace` snapshot linked from the case. Insufficient
policy data yields `REVIEW_REQUIRED` (never an assumed full-period payout).
React only displays the persisted result.

## 7. Permissions

New `module_actions` for `bn_award_suspension`: `execute`, `reject` (explicit),
`withdraw`, `view_payment_impact`, `resolve_payment_exception`, plus existing
`resume_propose` / `resume_approve` and a new `resume_execute`. Enforced in
every RPC via `has_permission`; UI gating is presentation only.

## 8. UI (`src/pages/bn/servicing/award-suspension/**`)

Extends the existing read-only workspace — no new namespace, no `/benefits/*`:
worklist and details preserved, plus execution panel (immediate / scheduled /
failed / retry), payment-impact preview and affected-records table, exceptions
list, reinstatement proposal + approval panels, arrears preview, and audit
timeline. All states covered: loading, empty, error, permission denied,
read-only, feature disabled, proposed, pending approval, approved-awaiting-
execution, scheduled, active, rejected, withdrawn, reinstatement pending/
approved, resumed, execution failed, stale-version conflict. A thin
`awardSuspensionCommandService.ts` calls only the new RPCs.

## 9. Unsafe mutation

No award-suspension component may import or call `updateAwardStatus()`;
the existing regression test is extended to the new files. Remaining caller
(stage-advance helper in `awardServicingService.ts`) is documented with a
controlled migration plan rather than silently broken.

## 10. Communication

Transactional `omni_comms_request` intents (no direct sends, no DB dispatch) for:
suspension proposed / approved / rejected / effective / execution failed,
reinstatement proposed / approved / effective, arrears created, manual payment
exception created.

## 11. Tests

Vitest unit + contract tests for the command service, permission gating,
feature-disabled, stale version, execution failure and reinstatement UI states;
SQL integration script `supabase/tests/bn/award_suspension_execution.sql`
covering execution, not-due, scheduler replay, concurrency, already-suspended,
hold success, unstoppable-payment exception, rollback cases, reinstatement
validation, arrears, no-arrears, review-required, safe hold release, replay;
plus the full end-to-end scenario (propose → other-user approve → execute →
holds → reinstate → approve → arrears → execute → active → audit chain).

## 12. Rollout & evidence

Stays dark-launched: `actions_enabled=false`, production feature flag off, menu
unchanged. Evidence document
`docs/bn/BN_AWARD_SUSPENSION_EXECUTION_AND_REINSTATEMENT.md` records schema,
commands, state machines, permissions, payment rules, scheduler, arrears,
communication, tests, deployment status and residual risks, with separate
readiness statements for developer testing, controlled UAT, pilot and production.

Stop after this slice — Life Certificates are not started.
