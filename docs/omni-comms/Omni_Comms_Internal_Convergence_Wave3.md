# Omni-Comms — Internal Convergence + Production Cutover Readiness (Wave 3)

**Date:** 2026-08-30 · **Baseline commit:** `5ff598de8a5c67e8dceb2d9276c1c0163ec19deb`
**Backend:** Lovable Cloud **Test** (`platform_environment_marker.environment_kind = TEST`)

---

## STAGE 1 — Operational truth (re-verified, no regression)

| Check | Value |
|---|---|
| Runnable jobs waiting | 0 |
| Actionable holds | 0 |
| Permanent historical holds | 20 (untouched) |
| Cancelled jobs that are still runnable | **0** — stale pilot jobs cannot become releasable |
| Current failures | 0 |
| Current retries | 0 |
| Active cron jobs (scheduler, reevaluator, workers) | 30 |

No regression. The 20 permanent historical jobs were not modified.

---

## A. Internal convergence completed this wave

**Stage 2 — Benefits.** Each legacy writer was traced to its actual callers
before any change:

| Path | Class | Reachability found | Action taken |
|---|---|---|---|
| `bnClaimOmniCommsService` → `benefitsCommunicationProducer` | COMMUNICATION | live (Claim Workbench Communication tab) | none — already canonical |
| `bnNotificationIntegrationService.dispatchBnNotification` | COMMUNICATION | **unreachable** — only caller was `useBnNotifications`, which had no UI consumer | hook deleted; dispatcher **quarantined** (throws, dead body removed). It can no longer write `in_app_notifications` / `notification_logs` |
| `bnCommunicationAdapter.triggerClaimCommunication` | COMMUNICATION | **not called by any screen**; only reachable from `retryCommunication` on a historical `bn_communication_log` row | **quarantined behind a servicing token**: refuses every caller except operator retry of a pre-existing legacy log. New Benefits communications must use Omni |
| `rulesAdminService` in-app insert | **TASK** (maker-checker rule approval; creates `workflow_instances`) | live | correctly *not* migrated — belongs to My Tasks, per the task/communication separation |

Result: **no active Benefits business communication writer bypasses Omni.**
Read-only servicing (history, letter status, manual dispatch marking) is
unchanged, so operator behaviour on historical records is preserved.

Verification: typecheck clean, build OK, **2651 tests passed / 140 files**
(Omni-Comms + Benefits suites).

**Stage 11 — Campaigns.** Confirmed as `SEPARATE GOVERNED BROADCAST CAPABILITY`.
Not routed through transactional `sendCommunication`. Remains NOT LIVE until
consent, opt-out, suppression, throttling, provider limits, campaign audit and
bounce handling exist. Does not block transactional go-live.

**Stage 12 — `c3-template-test-send`.** Revalidated as an approved administrative
exception. Conditions restated and unchanged: permission-controlled, test
recipients only, TEST-labelled, no arbitrary production recipient, audited, and
incapable of bypassing production recipient governance.

---

## B. Remaining legacy business writers

| Writer | Class | Status | Blocker to migrating |
|---|---|---|---|
| `lgNotificationRuleEngine` | COMMUNICATION | active | LEGAL has 2 event definitions and **0** producer bindings — needs an event map + templates first (Stage 5) |
| `legalReferralUnifiedService` | COMMUNICATION | active | same |
| `legalReferralCollaborationService` | mixed COLLABORATION / COMMUNICATION | active | must be classified item-by-item; collaboration items belong to My Tasks and must not be converted into communications |
| `rulesAdminService` | TASK | active by design | none — task class |
| `bnCommunicationAdapter` (retry servicing only) | legacy servicing | quarantined | none |

Compliance, Finance, Registration and Employer Registration have **no** direct
notification-table writers in current code; their gap is *absence of producer
adoption*, not bypass.

---

## C. Remaining direct provider bypasses

| Path | Class | Disposition |
|---|---|---|
| `useEmailDeliveryConfig.sendDocumentEmail` → `send-notification` | COMMUNICATION (document dispatch) | MIGRATE — blocked: no document-dispatch event definition exists yet. Not invented this wave |
| `gateApprovalNotifications` → `send-notification` | TASK + COMMUNICATION leg | task stays in My Tasks; the alert leg must move to Omni — blocked on a PLATFORM task-alert event definition |
| `EmailCampaigns` / `EmailLogs` → `send-email-campaign` | CAMPAIGN | approved separate subsystem, not live |
| `wizSettingsService` → `c3-template-test-send` | ADMIN TEST | approved exception |

**Unknown / unclassified = 0.** Unapproved *active* business provider bypasses
= 2 (document email, approval alert leg), both with a named blocker.

---

## D. My Tasks readiness

`/my-tasks` exists and is server-scoped through the `workflow_my_pending_tasks()`
SECURITY DEFINER RPC (user, roles, delegations). Covers platform workflow
approvals — which includes the Benefits rule-approval maker-checker instances.
**PARTIAL**: assigned reviews and overdue surfacing across Benefits, Compliance,
Legal and Audit task tables are not yet consolidated into the single projection.

## E. Bell state

**KEEP (legacy).** Cannot yet be demoted to LEGACY ONLY: three Legal writers
still depend on it, and My Tasks does not yet have full task-source parity. No
historical legacy notification records were deleted.

---

## F. Live backend readiness checklist

Preferred architecture: a **separate Live backend**. Test must not be promoted
by editing its environment marker.

| Item | Requirement |
|---|---|
| Database | Apply the full migration history to Live; verify object parity; no Test data copied |
| Auth | Providers, redirect URLs, email templates, JWT/signing keys configured independently |
| Storage | Buckets and policies recreated; files do not sync |
| Realtime | Publications re-enabled for the tables the app subscribes to |
| Secrets | Set directly in Live — **never copied from Test** |
| Provider accounts | Production provider rows created in Live with production credentials |
| Webhook URL | Live callback endpoint registered with the provider; signature secret Live-specific |
| Cron / schedulers | All 30 jobs re-created against Live, verified running |
| Runtime revision | Exact frozen candidate deployed |
| Frontend env | Live URL, publishable key, project ref |
| Public URLs | Custom domain routing confirmed |
| Environment marker | Set to PRODUCTION **in Live only**, after the above |
| Backup / recovery | Backup schedule and a tested restore path before first business send |

---

## G. `WAITING_EXTERNAL` items

**`WAITING_EXTERNAL_PROVIDER`** — no production provider exists; `omni_pilot_sandbox`
is `sandbox_mode = true`, `verification_status = pending`.
*Required:* a production Resend account + API key supplied through the secret
store. *Evidence:* provider row with `sandbox_mode = false`, verification
`verified`, secret bound, webhook registered and signature-verified, capacity
stated. *Unlocks:* Stages 15, 18, 19, 24; closes P0-5.

**`WAITING_EXTERNAL_DOMAIN_APPROVAL`** — `secureserve.biz` is technically verified
but not business-approved; `no-reply@example.com` is a placeholder that must
never be active in production.
*Required:* written approval of the production sender domain and the role-based
From identities. *Evidence:* approved domain, DNS/provider verified, sender
identities bound and active. *Unlocks:* Stage 16, module pilots.

**`WAITING_EXTERNAL_RECIPIENT_POLICY_APPROVAL`** — the pilot allowlist is still the
active control and has **not** been removed.
*Required:* formal approval of the production recipient-authorisation policy
(internal = active user/role/assignment; external = authoritative business data;
no caller-supplied addresses; ambiguous → fail closed; immutable destination
snapshot; recipient source audited; tenant isolation).
*Evidence:* signed release-control record with policy, approver, effective date,
review rule. *Unlocks:* Stage 17, allowlist retirement; closes P0-4 permanently.

**`WAITING_EXTERNAL_LIVE_BACKEND`** — no Live environment is configured.
*Required:* decision and provisioning per §F. *Evidence:* Live instance with its
own secrets, auth, storage, cron, webhook and PRODUCTION marker.
*Unlocks:* Stages 14, 18–24; closes P0-2.

---

## Stages deliberately not executed

Stages 3–8 (Registration/Employer, Compliance, Legal, Finance, document email,
approval alert) require new event definitions, templates and recipient policies.
Creating them without the approved recipient policy and a production target
would mean inventing business events and shipping producers that fail closed on
first use. They are sequenced immediately after the four `WAITING_EXTERNAL`
items clear. Stages 18–24 (module pilots, 20+ business E2E, production release
control, smoke) depend on the same prerequisites. Stage 21 revision freeze is
deferred — freezing a revision with no production target produces a meaningless
certificate.

---

# VERDICT

# NO-GO (system-wide production)

Internal Audit Email + In-App controlled pilot in Test remains **GO** and proven.
Open: P0-1 (module scope), P0-2 (Live backend), P0-3 (revision freeze), P0-5
(production provider). P0-4 stays closed — there is still no stale releasable
communication. P1: Legal convergence, document-email and approval-alert
migration, My Tasks consolidation, campaign governance, automated operations
alerting, bounce-class retry confirmation.
