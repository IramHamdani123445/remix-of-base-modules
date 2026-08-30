# Omni-Comms — User Notification Experience ("My Communications")

Baseline HEAD: `a5bfa5065a3497f57a3f4e969972c5646a62fb81`.
Certified dispatch, authorization, provider, release-control, held-job
reevaluation, immutable-recipient, scheduler and delivery architecture is
**unchanged** by this phase. Everything below is read-side user experience
plus two new governed read RPCs.

---

## 1. Rebaselined header behaviour (before this phase)

`src/components/Header.tsx` carried three interactive indicators:

| Control | Component | Meaning of its badge |
|---|---|---|
| Calendar | `MeetingCalendarModal` trigger | today's meetings |
| Radio | `OmniCommsHeaderShortcut` | **operator** attention: actionable held dispatch jobs (currently 3) |
| Bell | `InAppNotificationBell` | mixed: unread `in_app_notifications` (both `omni_comms` and `legacy` rows) **plus** workflow pending approvals |

Problem: a normal user had no place that means "messages the Board sent to
me". The Radio icon is an operations console entry point, not an inbox, and
the Bell conflated three unrelated concerns in one number.

## 2. The three separate concerns

| Concern | Question it answers | Surface | Audience |
|---|---|---|---|
| **My Communications** | "What has the Board sent to me?" | `MessagesSquare` icon → `/my-communications` | every signed-in user |
| **Workflow tasks / approvals** | "What must I action?" | remains on the Bell today; target home is a Tasks surface (§10) | approvers, officers |
| **Omni Operations** | "Is the communication platform healthy?" | `Radio` icon → Omni Operations | administrators / operators |

Each has its own count. No count is ever the sum of two concerns.

## 3. Source of truth

`in_app_notifications` rows where `source = 'omni_comms'`, joined to their
Omni evidence via `omni_comms_message_id` / `omni_comms_request_id`. Those
columns are written by the certified dispatcher
(`omni_comms_priv_dispatch_deliver_in_app`), so the inbox is a *projection of
delivered Omni messages*, never an independent message store.

Two new governed read RPCs (`SECURITY DEFINER`, `auth.uid()`-scoped, granted
to `authenticated` only, no user-id parameter — a crafted request cannot ask
for another user's inbox):

* `omni_comms_in_app_my_unread_count()` → the authoritative badge figure.
* `omni_comms_in_app_list_my_communications(p_limit, p_offset, p_unread_only)`
  → paged inbox enriched with event code/name, communication class, module,
  business entity reference, attachment presence and `total_count`.

Writes are unchanged: engagement still flows through the existing governed
`omni_comms_in_app_record_engagement` / `..._mark_all_read` RPCs, which emit
`callback_opened` / `callback_clicked` message events. Verified: opening a
communication in the new inbox produced `callback_opened` on message
`f8652276…` with `actor_type = recipient`.

## 4. User inbox fields

Title, body, received time (relative + exact on hover), communication class
in plain words ("Official notice", "Reminder", "Update"), originating module,
severity when not routine, attachment indicator, read state and read time,
action state, and the action link when the target is a safe internal route
(`isSafeInternalActionUrl`). Provider names, dispatch jobs, hold reasons,
recipient hashes and release snapshots are **not** exposed to users.

## 5. Unread count and realtime

Badge = `omni_comms_in_app_my_unread_count()`. Refetched on a 60s interval and
invalidated immediately by a Supabase realtime channel filtered to
`user_id=eq.<auth uid>` on the projection table. The realtime payload is used
only as an invalidation signal; the data itself always comes back through the
governed RPC.

## 6. Header design after this phase

`My Communications (MessagesSquare)` · `Omni Operations (Radio)` · `Bell`.
The user icon comes first because it is the one every user needs; the Radio
badge continues to mean operator attention only.

## 7. Existing bell — migration map

`in_app_notifications` today:

| `source` | rows | unread | users | newest |
|---|---|---|---|---|
| `legacy` | 1050 | 460 | 6 | 2026-08-26 |
| `omni_comms` | 22 | 21 | 5 | 2026-08-30 |

| Bell responsibility | Destination |
|---|---|
| unread `omni_comms` notifications | **already migrated** — My Communications |
| governed engagement (`recordEngagement`, `markAllOmniUnread`) | reused unchanged by My Communications |
| `legacy` notifications (1050 rows, 6 users) | retire by producer: each remaining legacy producer must emit an Omni event instead; the projection then arrives with `source = 'omni_comms'` |
| workflow pending approvals (`usePendingApprovalCount`) | move to a Tasks surface (§10) — **not** into My Communications |

## 8. Recommended home for workflow approvals

Approvals are work items with an owner, a due date and an outcome; they are
not communications. Recommended target: a dedicated "My Tasks" surface backed
by the existing pending-approval sources, with its own header indicator. Omni
should *notify about* an approval (with a deep link) but must not own the
task list.

## 9. Old-bell retirement report

Retirement is safe only when all four conditions hold:

1. Every legacy producer writing `source = 'legacy'` has an Omni event
   definition and emits through the façade. **Open** — 1050 legacy rows exist.
2. Workflow approvals have moved to their own surface. **Open** (§8).
3. My Communications has run alongside the bell for one full operating cycle
   with matching counts for the `omni_comms` slice. **In progress** — starts now.
4. No route or component depends on `InAppNotificationBell` for approvals.

Until then the bell stays, so nothing regresses. Recommended order:
migrate legacy producers → move approvals → observe → remove the bell.

## 10. What was NOT touched

Dispatch, authorization, provider adapters, release control, held-job
reevaluation, immutable recipient snapshots, schedulers and delivery
evidence remain exactly as certified. The new RPCs are read-only and the new
UI performs no runtime-table writes.
