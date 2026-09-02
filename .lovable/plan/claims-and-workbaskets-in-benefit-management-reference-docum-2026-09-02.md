# Claims and Workbaskets in Benefit Management — Reference Document

Rewrite and expand `docs/benefits/claims-workbaskets-roles-notifications.md` into a verified reference for two readers: the configurator who sets up products, workflow templates and workbaskets, and the officer who works claims daily. Every table, column, function and file name is checked against the live database and current code before it is written; nothing describes intended behaviour.

## Document structure (12 sections)

1. **How to read this** — the two audiences, and the convention that configurator-only detail is marked.
2. **The workbasket catalogue** — `bn_workbasket` field by field (`basket_code`, `basket_name`, `assigned_role`, `product_category`, `country_code`, `priority_rules`, `max_capacity`, `is_active`, `supervisor_role`, `manager_role`, `allow_auto_reassign`, `escalation_target_basket_id`, `default_escalation_policy_id`, `notify_title`, `notify_body`, `notify_action_label`), plus `bn_workbasket_role` (`role_name`, `is_primary`) and how it differs from the single `assigned_role` used by routing.
3. **Lifecycle diagram** — one ASCII diagram: claim status → workflow step → workbasket → assignment.
4. **How a claim reaches a basket** — `claimStatusStepMap.stepForClaimStatus` and its three outcomes STEP / HOLD / TERMINAL; template resolution via `bn_product_version_workflow` (channel → default → legacy `bn_product_version.workflow_template_id`) and `bn_product_channel_config`; the two step vocabularies inside `bn_workflow_template.steps_config` (`step`/`role`/`sla_days` vs `step_code`/`step_name`/`assigned_role`/`sla_hours`/`workbasket_id`); the resolution order in `resolveClaimWorkbasket` (step `workbasket_id` → `assigned_role`/`role` → `STEP_ROLE_TO_BASKET_ROLE` → `STEP_NAME_TO_BASKET_ROLE`); `due_at` from `sla_hours` or `sla_days`, and that fallback-table routing yields no SLA.
5. **Assignment records** — `bn_claim_queue_assignment` columns (`is_active`, `assigned_to`, `assigned_at`, `priority`, `due_at`, `picked_at`, `completed_at`); close-old/open-new in one operation so a claim is never active in two baskets; unclaimed vs picked.
6. **Routing on every status change** — `routeClaimAfterStatusChange`, its call sites, non-blocking behaviour (a routing failure never reverses a valid status change; the reason is surfaced), and `scripts/bn/repair-claim-workbasket-routing.ts` with when to run it.
7. **Roles and access — three separate things** — workflow step roles, basket roles (`bn_workbasket.assigned_role`), and module permissions (`bn_claim_queue`, `bn_claim_worklist` in `app_modules` / `role_permissions`); why holding a basket role alone is not enough; `bn_workbasket_permission_gaps()` and `bn_sync_workbasket_queue_permissions()`; how `ClaimQueue` scopes via `useMyWorkbaskets`, `useMyEffectiveRoles`, `bn_workbaskets_for_user(p_user_id)` and the oversight "All baskets" rule.
8. **Notifications** — trigger `zz_bn_claim_queue_assignment_notify` and function `bn_notify_workbasket_arrival()`; the fire condition (new active assignment, no `completed_at`); message composition from `notify_title` / `notify_body` / `notify_action_label` and the blank-field behaviour; the `in_app_notifications` row (`user_id`, `notification_type = 'BN_WORKBASKET_ARRIVAL'`, `is_read`, `metadata`); `useBasketArrivalAlerts` unread counts and clearing; where a configurator sets the three fields (`WorkbasketConfig`).
9. **The lifecycle stage by stage** — one row per status (DRAFT, SUBMITTED, INTAKE_REVIEW, ELIGIBILITY_CHECK, EVIDENCE_REVIEW, CALCULATION, DECISION, APPROVED, AWARD_SETUP, PAYMENT_QUEUE, IN_PAYMENT, PENDING_INFO, SUSPENDED, CLOSED, DENIED, WITHDRAWN) giving step, basket and permitted roles, with actions read from `bn_claim_transition_rule` (`action_code`, `action_label`, `allowed_roles`, `requires_maker_checker`, `requires_evidence_complete`, `requires_calculation`, `requires_eligibility_pass`, `next_workbasket_id`); button labels come from `action_label`.
10. **After approval** — `bn_entitlement` → `bn_payment_instruction` → `bn_payment_batch` → issue; "Begin Payment" only changes status and moves no money; the Payables Queue is a control point.
11. **When a claim goes wrong** — symptom / cause / proving query for: no owner, stuck in Intake Review, officer cannot open the queue, step names an inactive or missing basket, `due_at` is null.
12. **Technical annex** — registry of tables, RPCs, services, hooks and screens, plus known gaps stated plainly.

## Verification approach

- Each named column is confirmed with an `information_schema.columns` query; each function with `pg_proc`; each file path by reading it.
- The status table in section 9 is generated from actual `bn_claim_transition_rule` rows rather than written from memory.
- Every "how to check this yourself" snippet is a read-only SELECT and is executed once before inclusion.

## Scope

Documentation only — one markdown file changes, no code or database changes, no screenshots.
