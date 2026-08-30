# Omni-Comms — System-Wide Adoption & Production Certification

**Audit date:** 2026-08-30 (UTC)
**Repository HEAD:** `f809b8d0db34627da645503e535a8be87ffbf679`
**Backend audited:** Test/development instance (`platform_environment_marker = non_production`)
**Method:** read-only database reconciliation + repository static audit. No delivery
was activated, no release control was widened, no allowlist was removed.

---

## 1. Verdict

> **NO-GO for system-wide production go-live.**
> **GO (retained) for the certified controlled pilot scope only** — Internal Audit
> email and in-app, within the pilot recipient allowlist, in the non-production
> environment.

The sending spine itself is healthy and proven: dispatch, rendering, provider
acceptance, signed provider webhooks, delivery callbacks, hold re-evaluation and
audit eventing all work end-to-end today. What blocks go-live is **scope and
environment**, not mechanism: the platform is certified for one module, one
environment and one allowlisted recipient set, and the certified revision no
longer matches the code in the repository.

---

## 2. Evidence of a working spine (what is already proven)

| Area | Measured today | Reading |
|---|---|---|
| Requests / messages / jobs | 102 / 111 / 106 | Spine in real use |
| Runnable jobs waiting now | **0** | No stuck queue |
| Scheduler | `omni-comms-scheduler` ran 14:51Z across email, in_app, sms, whatsapp | Worker alive, all channels scanned |
| Post-activation email | 17 completed, avg 193 s, max 510 s | Within a one-minute-cron cadence |
| Post-activation in-app | 22 completed, avg 565 s | Acceptable |
| Provider acceptance | 50 `provider_accepted` events | Real provider hand-off |
| Provider webhooks | 315 `sent`, 307 `delivered`, 27 `delayed`, 5 `bounced` — **all `signature_verified = true`** | Signed, verified callback loop |
| Message eventing | 21 distinct event types, incl. `dispatch_hold_reevaluated` (33) | Full lifecycle audit trail |
| Cron estate | 30 active jobs incl. dispatch-every-minute and hold-reevaluation | Automation live |

Unsigned webhook rows exist only as historical noise (3 Resend, 16 Twilio Voice,
all with `normalized_event_type = null`, none since 2026-08-26) — rejected at the
boundary, never processed.

---

## 3. P0 blockers (must clear before any production go-live)

**P0-1 — Delivery is licensed to one module only.**
`permitted_caller_modules` for both `email` and `in_app` is `[INTERNAL_AUDIT]`.
Benefits, Compliance, Legal, Finance and Registration producers exist and emit,
but cannot deliver. Widening this is a release-control decision, not a code change.

**P0-2 — No production environment is certified.**
The singleton environment marker is `non_production`, and both channels sit in
`controlled_pilot` with a release window that lapses **2026-09-03**. There is no
certified production instance, so "go-live" has no target today.

**P0-3 — Certified-revision drift.**
Certified commit `03fcd61c` (2026-08-28) ≠ current HEAD `f809b8d0`. Governance
treats the drift as uncertified; recertification against HEAD is mandatory before
release-state changes.

**P0-4 — Recipient allowlist still enforced.**
14 allowlisted hashes for email, 11 for in-app; 37 `recipient_blocked` events
recorded. Real business recipients are blocked by design. Removal is a controlled
release step that must follow P0-1..P0-3, never precede them.

**P0-5 — Email senders are bound to a sandbox account.**
`benefits_department`, `compliance` and `ia_department_sender` all bind to
provider account `omni_pilot_sandbox` (`sandbox_mode = true`,
`verification_status = pending`). Only `secureserve.biz` is a verified Resend
domain. A verified, non-sandbox production account and binding is required before
external delivery.

---

## 4. P1 blockers (adoption and convergence)

**P1-1 — Producer bindings cover three modules.**
Active bindings: `INTERNAL_AUDIT` 90, `BENEFITS` 68, `EMPLOYER_REGISTRATION` 1.
Event definitions exist for `COMPLIANCE` (2), `LEGAL` (2), `FINANCE` (2),
`REGISTRATION` (3) with **no** producer bindings — those modules are defined but
not adopted.

**P1-2 — Legacy in-app duality.**
`in_app_notifications` holds 1,050 `legacy`-source rows against 22 `omni_comms`
rows. Direct writers still present: `lgNotificationRuleEngine`,
`legalReferralUnifiedService`, `legalReferralCollaborationService`,
`gateApprovalNotifications`, `rulesAdminService`, `bnCommunicationAdapter`,
`bnNotificationIntegrationService`. (Read-only surfaces — the bell,
NotificationCenter, `useAdminData`, `useWorkflowPendingApprovals` — are not
bypasses.)

**P1-3 — Remaining ungoverned provider paths (client-initiated).**
`useEmailDeliveryConfig.sendDocumentEmail` → `send-notification`;
`gateApprovalNotifications` → `send-notification`;
`EmailCampaigns` / `EmailLogs` → `send-email-campaign`;
`wizSettingsService` → `c3-template-test-send`.
The `ProviderSettings` test-send bypass remains **closed**.

**P1-4 — Held backlog.**
33 held jobs: 30 permanent-historical (`historical_job_not_authorized`,
pre-activation, correctly excluded from operator attention) and 3 actionable
(`recipient_not_allowlisted`). The actionable three clear automatically once P0-4
is lifted, or on allowlisting.

---

## 5. Ordered path to go-live

1. Recertify the deployed runtime against HEAD (clears P0-3).
2. Provision and verify a non-sandbox production email provider account; rebind
   `benefits_department`, `compliance`, `ia_department_sender` (clears P0-5).
3. Stand up and mark the production environment; extend or reissue the release
   window (clears P0-2).
4. Bind the next producer wave — Compliance, Legal, Finance, Registration — and
   widen `permitted_caller_modules` one module at a time, each with its own
   controlled-pilot pass (clears P0-1, P1-1).
5. Retire the allowlist per channel only after a clean pilot pass (clears P0-4,
   and the 3 actionable holds with it).
6. Convert the seven legacy in-app writers to `sendCommunication()` and retire the
   four remaining ungoverned provider paths (clears P1-2, P1-3).

## 6. Explicitly not performed

No synthetic volume/load injection, no release-state mutation, no allowlist
change, no environment promotion. Each is a governed production action and is
outside a read-only certification audit.
