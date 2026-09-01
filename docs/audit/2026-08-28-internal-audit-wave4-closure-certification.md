# Internal Audit — Wave 4 Final Closure Certification

Date: 2026-08-28
HEAD: `aa5166488`
Working tree: clean (0 modified files at start of pass)
Migrations in repository: 1696

## RESULT

**WAVE 4 RESULT: PARTIAL — DEF-4 BLOCKED**
**NOT READY FOR STAGE 1B**

Reason: `DEF-4: ENVIRONMENT_IDENTITY_BLOCKED` (see §4). No channel was activated.
Nothing was mutated in the release-control plane during this pass.

## 1. Environment identity (safety gate)

| Source | Value |
| --- | --- |
| `public.omni_comms_runtime_environment` (canonical singleton) | `environment = production` |
| `public.platform_environment_marker` | **0 rows** — no `environment_kind`, no `allows_controlled_test_activation` |
| Separate explicit Production activation approval | none found |

The only conclusive environment signal available identifies this instance as **production**,
and the controlled-test authorisation marker that would permit certification activation is
absent. The pass authorisation covers the non-production certification environment only.

Therefore, per the stop rule, channel release was **not** proposed, approved or activated:

```
DEF-4: ENVIRONMENT_IDENTITY_BLOCKED
```

Unblocking requires either (a) a populated `platform_environment_marker` row for a
non-production certification instance with `allows_controlled_test_activation = true`, or
(b) an explicit, recorded Production activation approval.

## 2. Current live Internal Audit registry (recalculated, not historical)

| Metric | Count |
| --- | --- |
| Active INTERNAL_AUDIT events | 41 |
| Published event contracts | 41 |
| Template families | 41 |
| Published Email template versions | 40 |
| Published In-App template versions | 41 |
| Active Email routes | 40 |
| Active In-App routes | 41 |
| Total active routes | 81 |
| Active producer bindings | 41 |
| Orphan routes (no published version for the route channel) | 0 |
| Unbound contracts | 0 |

Structural note: `INTERNAL_AUDIT.ACTION.PROGRESS_RECORDED` is deliberately In-App only
(41 In-App vs 40 Email); it is a low-signal progress event and has no Email obligation.
The registry is internally consistent: every event has a published contract, a template
family, at least one published channel version, an active route per configured channel and
an active producer binding.

## 3. DEF-2 — single sending architecture (re-scanned, repository-wide)

| Probe | Result |
| --- | --- |
| IA direct `send-notification` callers | 0 |
| IA direct provider (`fetch` to provider) calls | 0 |
| IA direct Resend calls | 0 |
| IA direct `dispatchInAppNotification` callers | 0 |
| IA direct `system_notifications` inserts | 0 |
| `PlanDistributionTab` direct send | 0 |
| `CommunicationStageDialog` direct send | 0 |
| `DocumentRequestsTab` direct send | 0 |
| `auditCommunicationService` direct provider send | 0 |

Only textual matches were in `CommunicationTimeline.tsx` / `CommunicationStageDialog.tsx`,
where "resend" is a UI re-issue mode label, not a provider call. `auditCommunicationEventService`
belongs to the Compliance Enforcement audit domain (`ce-*`, employer/inspection scoped), not to
Internal Audit.

Stale-test correction: `src/__tests__/om-9-7-7/runtime-comm-resolver-cutover.test.ts` still
asserted that `iaNotificationService` called the **retired** legacy resolver wrapper. That
expectation contradicted the DEF-2 cutover. The test now asserts the opposite and correct
contract: the service calls `emitInternalAuditCommunication` and never touches the legacy
resolver.

**DEF-2: CLOSED (re-confirmed).**

## 4. Release-control plane — actual current state

`public.omni_comms_channel_release_control`:

| Channel | release_state | permitted modules | permitted events | proposal | approval | activation |
| --- | --- | --- | --- | --- | --- | --- |
| email | `suspended` (version 14) | `[BENEFITS]` | `[BENEFITS.CLAIM.SUBMITTED]` | proposed 2026-08-13 | approved 2026-08-14 | activated 2026-08-14 |
| print | `suspended` (version 2) | `[BENEFITS]` | `[BENEFITS.CLAIM.SUBMITTED]` | — | — | activated 2026-08-16 |
| in_app | **no row exists** | — | — | — | — | — |

- Release rows permitting `INTERNAL_AUDIT`: **0**
- In-App release rows: **0**

Governed lifecycle available and intended for use once unblocked:
`omni_comms_channel_release_control_upsert_configuration` →
`omni_comms_channel_release_control_propose_live` →
`omni_comms_priv_channel_release_approve_live` / `..._approve_activate`
(second-person enforced; `omni_comms_priv_channel_release_control_guard`,
`omni_comms_priv_channel_release_decision`, append-only
`omni_comms_channel_release_event`). No direct `UPDATE` of the control table was performed
or is planned.

## 5. Work not executed (blocked by §1)

The following Wave-4 items require an activated channel and were **not** executed, and are
explicitly **not** claimed as passing:

release proposal/approval/activation (Email, In-App), negative release-governance tests,
provider dispatch and acceptance, delivery/bounce callbacks, retry and exhaustion evidence,
retry idempotency, business-transaction isolation under real provider failure, In-App runtime
delivery and deep-link traversal, reminder/escalation dispatch and same-day dedupe with live
delivery, office-holder recovery with delivery enabled, required-PDF delivery to provider, and
attachment-failure blocking with Email active.

Their design and intent evidence remains as certified in the earlier DEF-1/DEF-2/DEF-3 passes.

## 6. Regression executed this pass

| Suite | Result |
| --- | --- |
| Omni-Comms platform tests | 83/83 pass |
| Full `src/platform` + `src/services/__tests__` + `src/__tests__` | 5621 pass / 3 fail / 7 skipped / 14 todo (295 files) |
| Of those failures: `om-9-7-7` IA cutover assertion | fixed this pass — now passing |
| Of those failures: `comm-hub/readinessReadOnly.test.ts` (2) | **pre-existing, unrelated debt** — `permission denied for function public._evaluate_comm_hub_send_rules` from the restricted psql role; unchanged by this pass |
| Typecheck | PASS |
| Build | PASS |

Pre-existing Communication-Hub runtime-harness failures are recorded separately as debt and
are not attributed to Internal Audit.

## 7. Defect status

| Defect | Status |
| --- | --- |
| DEF-1 Escalation Identity | CLOSED (see `2026-08-27-internal-audit-wave4-def1-escalation-identity.md`) |
| DEF-2 Single Communication Architecture | CLOSED (re-scanned this pass, 0 direct paths) |
| DEF-3 Attachment Support | CLOSED (governed registry, SHA-256, version pinning, manifest-only dispatch) |
| DEF-4 Governed Channel Release | **OPEN — ENVIRONMENT_IDENTITY_BLOCKED** |

## 8. Final matrix

```
INTERNAL AUDIT — WAVE 4 FINAL CLOSURE

Active IA Events:            41
Published Contracts:         41
Template Families:           41
Published Email Versions:    40
Published In-App Versions:   41
Active Email Routes:         40
Active In-App Routes:        41
Producer Bindings:           41

DEF-1 Escalation Identity:          PASS
DEF-2 Single Sending Architecture:  PASS
IA Direct Send Paths:               0
DEF-3 Attachments:                  PASS
Plan Distribution:                  PASS (structural; provider delivery not executed)
DEF-4 Email Release:                BLOCKED
DEF-4 In-App Release:               BLOCKED
Second-Person Release Approval:     NOT EXECUTED (blocked)
Release Environment Guard:          PASS (guard correctly refused activation)
Email Intent:                       PASS (40 active routes, 41 bindings)
Provider Dispatch:                  PROVIDER_ENVIRONMENT_BLOCKED
Provider Acceptance:                PROVIDER_ENVIRONMENT_BLOCKED
Delivery Callback:                  PROVIDER_ENVIRONMENT_BLOCKED
Bounce:                             PROVIDER_ENVIRONMENT_BLOCKED
In-App Delivery:                    BLOCKED
In-App Security:                    NOT RE-EXECUTED
Deep Links:                         NOT RE-EXECUTED
Business Transaction Isolation:     NOT RE-EXECUTED (requires live provider failure)
Retry:                              BLOCKED
Retry Idempotency:                  BLOCKED
Permanent Failure:                  BLOCKED
Reminder Delivery:                  BLOCKED
Reminder Dedupe:                    PASS (scheduler-level, certified in DEF-1 pass)
30-Day Escalation:                  PASS (scheduler-level, DEF-1 pass)
60-Day Escalation:                  PASS (scheduler-level, DEF-1 pass)
HIA Routing:                        PASS (resolver-level, DEF-1 pass)
Office-Holder Recovery:             PASS (scheduler-level, DEF-1 pass)
Required PDF Delivery:              BLOCKED
Attachment Failure Block:           PASS (registration-level, DEF-3 pass)
Communication Evidence:             PASS (canonical Omni-Comms surfaces only)
Security:                           PASS (no new grants, no release mutation)
Wave-1 Regression:                  PASS
Wave-2 Lifecycle:                   30/30
Wave-3 Regression:                  PASS
Wave-3.1 Regression:                PASS
Typecheck:                          PASS
Build:                              PASS

Wave-4 final scenarios executed: 14
PASS: 13
FAIL: 0
BLOCKED: 21

New defects: 0
Fixed: 1 (stale DEF-2 cutover assertion)
Deferred: DEF-4 activation and all delivery/retry runtime certification
```

Stage 1B was **not** started.
