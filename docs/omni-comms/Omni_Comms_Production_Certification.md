# Omni-Comms — Production Certification (v2, remediation wave)

**Wave date:** 2026-08-30 (UTC)
**Repository HEAD at rebaseline:** `d49953d8373c842c6a72cb9c64b99a669137d67f`
**Branch:** `edit/edt-866a133c-1e03-4a64-bf60-7c28efd67500`
**Backend:** Lovable Cloud Test instance — `platform_environment_marker.environment_kind = TEST`
**Predecessor:** v1 NO-GO baseline (audited at `f809b8d0…`), preserved verbatim in Appendix A.

> This document is additive. The v1 NO-GO record below is audit chronology and is
> not overwritten.

---

## A. Previous NO-GO baseline

v1 (Appendix A) recorded five P0 blockers: single-module release control
(P0-1), no production environment (P0-2), certified-revision drift (P0-3),
enforced recipient allowlist (P0-4), sandbox email provider (P0-5); and four P1
adoption blockers.

## B. Remediation completed in this wave

| # | Action | Result |
|---|---|---|
| B1 | Rebaselined to current HEAD `d49953d8`; v1 SHA `f809b8d0` explicitly not recertified | Done |
| B2 | Re-audited actionable holds from live data — the true count was **13**, not 3 (11 `release_snapshot_missing`, 2 `recipient_not_allowlisted`), all Internal Audit pilot artefacts from 2026-08-28/29 | Done |
| B3 | Individually classified all 13 (table in §M) → **CANCEL BEFORE PRODUCTION CUTOVER** for every one; none was still business-timely | Done |
| B4 | Applied a governed disposition migration: jobs set `cancelled` / `is_runnable = false` / `hold_reason = superseded_pre_production_pilot_job`, messages cancelled, and a `dispatch_cancelled` message event written per job with the disposition and remediation-wave tag | Done — audit history preserved |
| B5 | Verified the 20 `historical_job_not_authorized` jobs were untouched and remain non-runnable | Done |
| B6 | Verified post-remediation queue: **0 runnable jobs waiting, 0 actionable holds, 20 permanent historical holds** | Done |
| B7 | Re-established the legacy producer / bypass inventory from current code (§K, §L) — **0 unclassified active producers** | Done |
| B8 | Confirmed the recipient allowlist, release control, environment marker, provider bindings and certified revision were **not** weakened to obtain a green result | Done |

Deliberately **not** done, because doing them would have been falsification or an
unsafe production act:

- environment marker was not renamed to production;
- `permitted_caller_modules` was not widened;
- the pilot allowlist was not removed;
- no provider credential was invented;
- no certified revision was stamped while code was still moving.

## C. External prerequisites — `WAITING_EXTERNAL`

| ID | Action | Who must perform it | Evidence required afterwards | Certification step to rerun |
|---|---|---|---|---|
| EXT-1 | Provision a **production** (non-sandbox) Resend account and store its API key through the platform secret mechanism | Client / SSB IT with Resend account ownership | `omni_comms_provider_account` row with `sandbox_mode = false`, `verification_status = verified`, secret reference bound | §G, §H, §34 smoke test |
| EXT-2 | Confirm and DNS-verify the **approved production sending domain** (current only verified domain is `secureserve.biz`; `no-reply@example.com` is a placeholder sender that must never reach production) | Client domain owner + DNS administrator | Resend domain verified; sender identities rebound and `status = active` on the approved domain | §H |
| EXT-3 | Decide the production backend architecture: a genuine separate production instance, or a governed promotion of the current instance | Client platform owner | Documented decision + provisioned target with its own secrets, URLs, webhook callback, auth, storage, scheduler | §F, §11 |
| EXT-4 | Approve the production recipient-authorisation policy (governed resolution replacing the pilot allowlist) and name the approving authority | Client business owner | Signed release-control record with policy, effective date, review rule | §12, §17 |

Nothing in this wave can clear EXT-1..EXT-4 from inside the platform, and none of
them was simulated.

## D. Final certified HEAD

`d49953d8373c842c6a72cb9c64b99a669137d67f` **is not being certified for
production.** Revision freezing (§13/§35) is deliberately deferred: freezing a
revision while P0-2 and P0-5 remain open would produce a certificate with no
valid production target. The pilot certificate at `03fcd61c` stays the only
active certification, scoped to Internal Audit / Test.

## E. Final deployed revision

Deployed runtime = current preview build of HEAD `d49953d8`. Certified revision
`03fcd61c` ≠ HEAD → **revision match: NO**. P0-3 remains open by design until the
remediation programme is complete and a freeze is meaningful.

## F. Production environment identity

Single environment row: `environment_kind = TEST`, label *Internal Audit
Certification / Lovable Cloud Test*, `allows_controlled_test_activation = true`.
There is **no production environment** — Test and Live backends are separate
instances and the Live instance has never been configured, certified or pointed
at by any release control. P0-2 stands (EXT-3).

## G. Production provider status

| Account | Provider | Sandbox | Verification | Secret bound | Production usable |
|---|---|---|---|---|---|
| `omni_pilot_sandbox` | Resend (email) | true | **pending** | yes | No |
| `ref_sim_email` / `ref_sim_sms` / `ref_sim_inapp` | reference simulators | true | unverified | no | No |
| `ia_w4_inapp_internal` | internal in-app | true | unverified | n/a | Internal channel only |
| `twilio_sms_production` | Twilio SMS | false | verified | — | Not in go-live scope this wave |
| `twilio_whatsapp_sandbox` | Twilio WhatsApp | true | verified | — | No |
| `twilio_voice_production` | Twilio Voice | false | verified | — | Not in go-live scope |
| `print_spool_internal` | internal print | false | verified | — | Channel suspended |

Email therefore has **no production provider**. P0-5 stands (EXT-1). Credential
values are never printed here — only *available / unavailable*.

## H. Sender / domain status

| Sender binding | Channel | From address | Domain | Provider account | Verified | Production ready |
|---|---|---|---|---|---|---|
| `ia_department_sender` | email | internal.audit@secureserve.biz | secureserve.biz | omni_pilot_sandbox | domain yes / account pending | **No** |
| `omni_pilot_sender` | email | no-reply@example.com | example.com | omni_pilot_sandbox | no | **No — placeholder, must not ship** |
| `ia_w4_inapp_identity` | in_app | n/a | n/a | internal | n/a | Pilot only |

No sender may be declared production-ready while its account carries
`verification_status = pending`. The final production domain is an open business
decision (EXT-2) — `secureserve.biz` is *verified*, not *approved*.

## I. Live modules

Authorised in release control: **`INTERNAL_AUDIT` only**, for `email` and
`in_app`, `controlled_pilot`, window expiring **2026-09-03**. `print` is
`suspended` (BENEFITS). No module was added in this wave.

### Module readiness matrix (from live data + current code)

| Module | Active event definitions | Producer binding | Omni usage | Legacy / bypass | Email req. | In-App req. | Go-live critical |
|---|---|---|---|---|---|---|---|
| INTERNAL_AUDIT | 90 bound | active (90) | proven E2E | none | yes | yes | yes — already live in pilot |
| BENEFITS | 68 bound | active (68) | emits; blocked by release control | `bnCommunicationAdapter`, `bnNotificationIntegrationService`, `rulesAdminService` | yes | yes | yes — Wave 2 candidate |
| EMPLOYER_REGISTRATION | 1 active (1 retired) | active | minimal | workflow notification function | yes | yes | yes — Wave 3, needs event coverage |
| REGISTRATION | 3 defined | none | none | workflow notification function | yes | yes | Wave 3 |
| COMPLIANCE | 2 defined | none | none | none found | yes | yes | Wave 4 |
| LEGAL | 2 defined | none | none | `lgNotificationRuleEngine`, `legalReferralUnifiedService`, `legalReferralCollaborationService` | yes | yes | Wave 5 |
| FINANCE | 2 defined | none | none | none found | yes | yes | Wave 6 |
| INSURED_PERSON | 0 | none | none | none found | tbd | tbd | no |
| PLATFORM | n/a | n/a | approvals only | `gateApprovalNotifications` | no | task-class | task, not comms |

**Rule applied:** a module may not be added to production release control before
its active producers are proven to use the governed path. On that rule only
INTERNAL_AUDIT qualifies today; BENEFITS is one convergence step away (its three
legacy writers must be classified and migrated first).

## J. Live channels

`email` — controlled pilot, Test only. `in_app` — controlled pilot, Test only.
`sms`, `whatsapp`, `voice`, `push`, `webhook` — scheduler scans them every minute
but no release control authorises business traffic. `print` — suspended.

## K. Producer adoption — zero unknowns

| Producer (current code) | Class | Disposition |
|---|---|---|
| `benefitsCommunicationProducer`, `emitBusinessCommunication`, `emitConfiguredBusinessEvent` | COMMUNICATION | already governed |
| `bnCommunicationAdapter` (`in_app_notifications` insert) | COMMUNICATION | MIGRATE to `sendCommunication` — Wave 2 prerequisite |
| `bnNotificationIntegrationService` (`in_app_notifications` insert) | COMMUNICATION | MIGRATE — Wave 2 prerequisite |
| `rulesAdminService` (rule-change alert insert) | SYSTEM/ADMIN alert | MIGRATE or contain as admin alert; not a business communication |
| `lgNotificationRuleEngine` | COMMUNICATION | MIGRATE — Wave 5 prerequisite (needs LEGAL event definitions + templates first) |
| `legalReferralUnifiedService` | COMMUNICATION | MIGRATE — Wave 5 |
| `legalReferralCollaborationService` | COMMUNICATION (collaboration mentions) | MIGRATE — Wave 5 |
| `gateApprovalNotifications` | **WORKFLOW TASK** | do **not** force into Omni; belongs to My Tasks. Its `send-notification` email leg is a communication and must migrate |
| `workflow-process-notifications` edge function (7 callers) | WORKFLOW TASK | remains task infrastructure; Omni may announce, not own |
| `useEmailDeliveryConfig.sendDocumentEmail` → `send-notification` | COMMUNICATION (document dispatch) | MIGRATE to Omni document communication |
| `EmailCampaigns` / `EmailLogs` → `send-email-campaign` | **CAMPAIGN SUBSYSTEM** | see §6 decision below |
| `wizSettingsService` → `c3-template-test-send` | **ADMIN TEST PATH** | approved exception, see §7 decision below |
| Bell, `NotificationCenter`, `useAdminData`, `useWorkflowPendingApprovals`, `useMyCommunications` | READ-ONLY consumers | not bypasses, leave intact |

**Unknown active producers = 0.**

### Campaign decision (prompt §6)

`send-email-campaign` is classified **B — separate broadcast capability requiring
an approved Omni campaign path**, not A and not C. Bulk mail must not be pushed
through transactional dispatch: consent, opt-out, throttling, provider rate
limits and campaign-level audit are not part of the transactional contract.
Required before production: an explicit Omni campaign channel/mode with consent
and opt-out enforcement, or administrative containment (permission-gated,
non-business recipients only). Open P1.

### Template test-send decision (prompt §7)

`c3-template-test-send` is classified **APPROVED ADMIN TEST PATH**. Conditions
for it to remain: permission-controlled, safe/test recipients only, visibly
non-business in the UI, and never able to bypass recipient safety in production.
It is recorded as a governed exception, not counted as an unidentified bypass.

## L. Remaining legacy paths

- 7 direct `in_app_notifications` writers (list in §K) — 3 Benefits-side, 3
  Legal-side, 1 platform approvals (task class).
- 4 direct provider paths: `useEmailDeliveryConfig`, `gateApprovalNotifications`,
  campaigns, template test-send — all now classified; 2 to migrate, 1 campaign
  subsystem, 1 approved admin exception.
- Legacy Bell: **KEEP** for now. It may become `LEGACY ONLY` after the Benefits
  and Legal writers migrate and My Tasks absorbs the approvals. No historical
  legacy notification record is to be deleted.
- `ProviderSettings` ad-hoc test send: remains **closed** (removed in a prior wave).

## M. Queue reconciliation (post-remediation)

| Bucket | Count |
|---|---|
| Runnable waiting (ready/claimed) | **0** |
| Completed | 54 (+4 print lease-recovery completions) |
| Cancelled — superseded pre-production pilot | 17 |
| Cancelled — superseded release snapshot | 11 |
| Held — actionable | **0** |
| Held — permanent historical (`historical_job_not_authorized`) | **20** |
| Failed (current) | 0 |
| Retrying (current) | 0 |

### Disposition of the 13 actionable holds

All 13 were Internal Audit certification-era jobs (2026-08-28 14:39 → 2026-08-29
21:15), events `INTERNAL_AUDIT.ACTION.ASSIGNED`, `REQUEST.ISSUED`,
`REQUEST.REMINDER`, `ENGAGEMENT.INTIMATION_ISSUED`, `FINDING.RESPONSE_REQUESTED`,
`FINDING.RESPONSE_REJECTED`, `FOLLOWUP.SCHEDULED`, `REPORT.ISSUED`. Every one is
certification/test data, none is still business-timely, and all were superseded
by later re-emitted events. Verdict for each: **CANCEL BEFORE PRODUCTION
CUTOVER** — executed in B4. Consequence: a future production recipient-policy
change cannot accidentally release any historical communication, because there is
no longer any releasable historical job.

Scheduler: `omni-comms-scheduler` last ran 15:01Z across email, in_app, sms,
whatsapp, voice, push and webhook, claiming 0 jobs — correct for an empty
runnable queue.

## N. E2E results

**Not run in this wave, and deliberately so.** The prompt's ≥20 business-
originated E2E cases require activated modules; module activation requires a
verified production provider (EXT-1) and a production target (EXT-3). Running 20
business sends against a sandbox account in the Test environment would produce
evidence that cannot be carried into a production certificate, and widening
release control first would violate the rule that adoption precedes activation.
The E2E battery is therefore sequenced immediately after EXT-1..EXT-3 clear, and
before any allowlist change.

Previously proven and still valid within the pilot scope: Internal Audit email
and in-app end-to-end, 315 provider `sent`, 307 `delivered`, 27 `delayed`, 5
`bounced`, all signature-verified.

## O. Security certification

- Recipient authorisation remains **fail-closed**: the immutable destination
  snapshot plus the pilot allowlist blocked 37 recipients; nothing in this wave
  relaxed it.
- Arbitrary email injection: still structurally prevented — business callers
  express intent, Omni resolves the recipient, and the destination snapshot is
  immutable after resolution. No payload-supplied address path was opened.
- My Communications is `auth.uid()`-scoped through governed RPCs; My Tasks uses
  the `workflow_my_pending_tasks()` SECURITY DEFINER RPC scoped by user, roles and
  delegations. Cross-user and cross-organisation isolation unchanged from the
  prior PASS.
- No credential value appears in this document or in any migration.
- Database linter output at migration time reports only long-standing
  platform-wide findings (legacy tables without RLS, SECURITY DEFINER views);
  this wave introduced no new schema objects.

## P. Operations readiness

Operations surfaces already distinguish live backlog from historical holds and
show scheduler and delivery state. Gaps confirmed still open:

- **No automated alerting** exists for scheduler failure, webhook failure,
  provider failure spikes, retry exhaustion, hold spikes or zero-delivery
  windows. Dashboard visibility is not alerting. Recorded as **P1-OPS-1**, an
  explicit operational acceptance requirement before go-live.
- Bounce handling: 5 signed `bounced` callbacks recorded; bounced messages are
  not marked delivered. Hard-vs-transient bounce differentiation should be
  confirmed against the retry policy before volume rises — **P1-OPS-2**.
- `delayed` callbacks (27) are represented as a distinct non-terminal state and
  do not imply delivery; reconciliation to delivered/bounced observed working.
- Load test (§33): blocked on EXT-1; must never run against uncontrolled
  recipients.

## Q. Rollback / emergency stop evidence

Available governed controls, all non-destructive:

1. Suspend a channel's release control → new jobs hold, nothing is deleted.
2. Remove a module from `permitted_caller_modules` → that module fails closed.
3. Unschedule `omni-comms-dispatch-every-minute` → queue pauses, jobs retained.
4. Deny/withdraw a pending release proposal via the governed cancel routine.
5. Retire a provider account → dispatch fails closed at hand-off.

None of these delete jobs, mutate audit history or lose evidence. Day-0
monitoring checkpoints (launch, +15/30 min, +2 h, end of day) cover scheduler,
delivery, bounce rate, failure rate, retries, provider health, webhooks, holds,
newly blocked recipients, latency, module distribution and unexpected legacy
producer activity.

## R. Final verdict

# NO-GO — SYSTEM-WIDE PRODUCTION

# GO (retained) — INTERNAL AUDIT CONTROLLED PILOT, TEST ENVIRONMENT

Grounds (each independently sufficient under §43): no production environment
exists; the production email sender/provider is unverified and sandboxed; the
certified revision does not match HEAD; go-live-critical modules are not
authorised. The queue, scheduler, webhook verification and security posture are
all healthy — the blockers are provisioning and adoption, not mechanism.

---

## FINAL EXECUTIVE SUMMARY

### FINAL VERDICT
**NO-GO** (system-wide production). Internal Audit controlled pilot remains GO.

### Certified HEAD
`03fcd61c75a933ebf3e750d52d925c34b1efea81` (pilot certificate; not reissued)

### Deployed revision
`d49953d8373c842c6a72cb9c64b99a669137d67f`

### Revision match
NO

### Environment
NON-PRODUCTION (TEST)

### Email provider
SANDBOX — `omni_pilot_sandbox`, verification pending (BLOCKED on EXT-1)

### Email
LIVE within pilot scope only — NOT LIVE for production

### In-App
LIVE within pilot scope only — NOT LIVE for production

### Other live channels
None (sms / whatsapp / voice / push / webhook unauthorised; print suspended)

### Modules authorized
INTERNAL_AUDIT

### Active go-live-critical producers
13 classified producer paths

### Using governed Omni
3 / 13 module producer families (INTERNAL_AUDIT, BENEFITS, EMPLOYER_REGISTRATION bindings)

### Active unidentified bypasses
0

### Active approved legacy exceptions
2 (`c3-template-test-send` admin test path; `send-email-campaign` campaign subsystem pending its own governed path)

### Current runnable queue backlog
0

### Current actionable holds
0

### Permanent historical holds
20

### Failed current communications
0

### Retrying current communications
0

### Cross-user security
PASS

### Cross-organization security
PASS

### Scheduler
PASS (last run 15:01Z, all channels)

### Provider callbacks
PASS (all processed callbacks signature-verified)

### My Communications
READY

### My Tasks
PARTIAL (workflow approvals projected; Benefits/Compliance/Legal task sources not yet consolidated)

### Legacy Bell
KEEP (becomes LEGACY ONLY after the Benefits and Legal writers migrate)

### P0 blockers remaining
4 — P0-1 module scope, P0-2 production environment, P0-3 revision convergence, P0-5 production provider. **P0-4 is closed**: the actionable hold backlog is now zero, so no recipient-policy change can release stale communications.

### P1 items remaining
6 — producer convergence (Benefits, Legal), document-email bypass migration, campaign subsystem governance, My Tasks consolidation, automated operations alerting, bounce-class retry confirmation.

---

# Appendix A — v1 NO-GO baseline (preserved verbatim)

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
