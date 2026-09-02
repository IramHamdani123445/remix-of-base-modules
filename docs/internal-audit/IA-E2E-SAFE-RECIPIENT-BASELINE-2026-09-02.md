# Internal Audit — Gate E1 Safe Recipient Baseline

Date: 2026-09-02 · Environment: TEST · Release identity:
`1ac766266983a142bd8cfa6f82b4d911686b4de9`

## 1. Principle

No recipient address is hard-coded anywhere in application code. Every address is
resolved at runtime from the identity tables (`profiles`, `core_staff_assignments`,
`ia_auditors`) by the Internal Audit recipient-fact helpers, and delivery is then
constrained by the channel release control's pilot recipient allowlist.

## 2. Safe test identity baseline

The pilot allowlist is the only surface that decides who may actually receive a
message. It now carries 11 recipient rules, all on the internal test domain
`@mishainfotech.com`. No external mailbox (for example `@socialsecurity.kn`) is
present in the allowlist, so any obligation resolving to a real-world address is
held by the gate rather than sent.

## 3. Governed cycle executed

Performed through the `omni-comms-release-control` Edge Function with genuine
four-eyes separation — proposer Rohit (`configure`), approver Auditor 1
(`operate`) — for both channels:

1. `suspend` (or cancel of the superseded proposal)
2. `upsert_configuration`
3. `propose_pilot`
4. `approve_activate`

| Channel | Final state | Release version | Recipient rules | Permitted events |
|---|---|---|---|---|
| email | `controlled_pilot` | 31 | 11 | 48 |
| in_app | `controlled_pilot` | 14 | 11 | 49 |

`INTERNAL_AUDIT.ACTION.PROGRESS_RECORDED` is app-only by design; it has no
published email template version and is therefore excluded from the email scope.

## 4. Prerequisite corrections made

| Prerequisite | Outcome |
|---|---|
| `deployed_revision_available` | Dispatcher redeployed; runtime and dispatcher now report the same 40-character revision. |
| `runtime_certification_effective` | Re-certified at the current revision through `certify_deployment`. |
| `event_route_active` / `template_family_active` / `published_template_version_present` | Email scope narrowed to the 48 events with published email templates. |
| `release_time_window_valid` | Pilot window reset to a rolling seven-day window. |

## 5. Caps

Pilot hard limits apply and were not exceeded: 10 recipients per request,
20 messages/hour, 100 messages/day, 500 messages total.
