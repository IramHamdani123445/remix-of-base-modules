# Claim-arrival notifications for workbasket roles

When a claim lands in a workbasket, every signed-in user who holds a role that owns
that basket gets an in-app notification ("New claim BN-… arrived in Eligibility
Review"), with a popup toast and a click-through to the claim.

## What already exists (verified)

- `bn_claim_queue_assignment` is written by `routeClaimToWorkbasket` on intake and on
  every status change, so basket arrival is already a single, reliable event
  (columns: `claim_id`, `workbasket_id`, `is_active`, `assigned_at`, `due_at`, `priority`).
- `in_app_notifications` already exists with `user_id`, `title`, `body`, `link`,
  `module`, `notification_type`, `priority`, `related_record_id`, `metadata`, `source`.
- `InAppNotificationBell` already subscribes to realtime INSERTs filtered by
  `user_id` and shows a 5-second popup plus an unread badge — no new UI plumbing needed.
- Basket → role: `bn_workbasket_role` (with `bn_workbasket.assigned_role` as the
  legacy fallback for baskets with no role rows).
- Role → user: `v_bn_user_effective_roles` (`user_id`, `role_name`, `source` — covers
  direct, bundle and delegated roles).

So the only missing link is: assignment row created → notification rows created for the
right users.

## Change

### 1. Database: fan-out on basket arrival

A `SECURITY DEFINER` function plus an `AFTER INSERT` trigger on
`bn_claim_queue_assignment` (only when `is_active` is true and `completed_at` is null):

- Resolve the basket's roles from `bn_workbasket_role`, falling back to
  `bn_workbasket.assigned_role` when the basket has no role rows.
- Resolve users from `v_bn_user_effective_roles` for those roles, **distinct per user**
  (a user holding two owning roles gets one notification, not two).
- Insert one row per user into `in_app_notifications`, with wording specific to the
  basket and the workflow step the claim has reached — never a generic "new claim":
  - title: the basket's own action phrase, e.g. `Eligibility review required`,
    `Documents to verify`, `Awaiting your approval`, `Ready for payment issue`.
    The phrase comes from a per-basket message template held on the workbasket
    configuration (new optional `notify_title` / `notify_body` columns on
    `bn_workbasket`), falling back to `Action required in <basket name>` when a
    basket has no phrase configured — so every basket can be worded by an admin.
  - body: `<claim number> — <benefit/product> · <what this basket must do>`, plus
    `Due <date>` when `due_at` is set. Tokens available to the template:
    `{claim_number}`, `{benefit}`, `{status}`, `{step}`, `{basket_name}`, `{due_date}`,
    `{priority}`.
  - `link`: deep link to the work surface that basket uses — the claim's step tab
    (e.g. `/bn/claims/<claim_id>?step=<workflow_step>`), not just the claim header —
    with `action_label` matching the action (`Review eligibility`, `Verify documents`,
    `Approve claim`, …).
  - `module`: `BENEFITS`, `notification_type`: `BN_WORKBASKET_ARRIVAL`,
    `source`: `benefits.workbasket`, `priority` derived from assignment priority/overdue
  - `related_record_id`: the claim id; `metadata`: basket code, workflow step, the role
    that granted visibility, and the assignment id.
- A user holding roles on several baskets therefore receives a distinctly worded
  message per basket, matching the work that basket owns.

- Idempotent: skip when a `BN_WORKBASKET_ARRIVAL` notification already exists for the
  same user + assignment id, so re-routing or replay never double-notifies.
- Self-exclusion: the actor who caused the move is not notified when they are the only
  recipient path — the notification is for the *receiving* team.
- Never blocks routing: the whole fan-out is wrapped so any failure is logged and the
  assignment still commits.

### 2. Queue-side counters (small UI touch)

`/bn/queue` basket buttons gain an "N new" marker for assignments created since the
user last opened that basket (stored per user in local state via the existing basket
count query). No layout redesign.

### 3. Read/act behaviour

Clicking the notification opens the claim and marks it read — existing bell behaviour,
no change. Notifications for a claim that has already moved on remain in history but
carry the basket it referred to.

## Not in scope

- No new notification table, no new email/SMS/Omni-Comms channel, no template seeding.
  This is in-app only, on the existing platform surface.
- No change to routing logic, status→step mapping, or workbasket resolution.
- No per-user mute/preference screen (can follow later if wanted).

## Technical detail

Migration: `bn_notify_workbasket_arrival()` (SECURITY DEFINER, `search_path = public`)
+ trigger `zz_bn_claim_queue_assignment_notify` on `bn_claim_queue_assignment`;
grants unchanged apart from what the definer function needs on `in_app_notifications`.
Frontend: `src/pages/bn/claims/ClaimQueue.tsx` (new-arrival marker) and a small helper
in `src/hooks/bn/useBnWorkbasket.ts`. The bell (`InAppNotificationBell.tsx`) is reused
unchanged.

## Verification

- Move a test claim through Intake → Eligibility → Decision and confirm each receiving
  role's user gets exactly one notification per hop, with the correct basket name.
- Confirm a user holding two owning roles receives one notification.
- Re-run the routing repair script and confirm no duplicate notifications appear.
- Confirm the bell popup fires live (realtime) without a page refresh.
