# Internal Audit — Phase E, Gate E4.0
## Fresh Post-Cutover Communication Canary — Evidence Pack

Status: **PASSED**
Executed: 2026-09-01 22:05 – 22:17 UTC
Environment: TEST (non_production), controlled pilot, live delivery disabled.

---

## 1. Purpose

Prove that a **freshly created, post-cutover** Internal Audit business event
travels the entire Omni-Comms spine — outbox → ingest → render → release
authorization → dispatch → provider acceptance — with **no manual intervention
and no historical job reuse**.

---

## 2. Defect found and corrected

### DEF-E2E-002 — Deployment certification did not advance the privileged dispatch activation

**Symptom.** Every freshly rendered job was held, and the dispatcher reported
`release_snapshot_missing`. The underlying authorization denial was
`certification_revision_mismatch`.

**Root cause.** `certify_deployment` recorded the runtime certification in
`omni_comms_runtime_certification` but never advanced
`omni_comms_dispatch_activation.certified_revision`. After a redeploy the
activation row stayed pinned to the previous revision
(`03fcd61c75a933ebf3e750d52d925c34b1efea81`) while both channel release controls
and the observed runtime were at `1ac766266983a142bd8cfa6f82b4d911686b4de9`.
`omni_comms_priv_evaluate_dispatch_authorization` compares those two values, so
**no new communication could ever dispatch after a deployment** until the
activation was advanced out of band.

**Correction.** `supabase/functions/omni-comms-release-control/index.ts` —
after a successful `omni_comms_priv_record_runtime_certification`, the
`certify_deployment` action now also calls
`omni_comms_priv_set_dispatch_certified_from(revision, project_ref)`, using the
project ref read server-side from `platform_environment_marker`. The result and
any error are reported back as `dispatch_activation` /
`dispatch_activation_error`. Governance is unchanged: the action still requires
platform-administrator certification authority, and the database function still
refuses unless the revision is uniformly observed across runtime, dispatcher and
certification record.

**Verification.**

| Field | Before | After |
|---|---|---|
| `omni_comms_dispatch_activation.certified_revision` | `03fcd61c…` | `1ac76626…` |
| `certified_from` | 2026-08-29 20:46:56Z | 2026-09-01 22:08:57Z |
| `dispatch_activation_error` | — | `null` |

Authority test: `ROHIT` (platform administrator) → 200.
`ADMIN` and `HIA` → 403 `certification_authority_required`. Governance intact.

---

## 3. Canary execution

Fresh Annual Plan `2029-CANARY-C` — plan `1f378d20-5003-4931-a735-5e6848ba6239`.

| Step | Actor | Command | Result |
|---|---|---|---|
| Create plan header | LEAD | `ia_create_plan_header` | 200 |
| Complete engagement (function, lead auditor, effort) | LEAD | `ia_persist_plan_engagements` | 200, updated 1 |
| Submit for approval | LEAD | `ia_submit_annual_plan` | 200, version 2, workflow started |
| Committee approval | HIA | `ia_decide_annual_plan` | 200, Approved, SoD override **false** |

All steps executed through **governed canonical RPCs only**. Direct DML on
`ia_audit_engagements` was attempted and correctly **refused**
(`permission denied for table`), confirming the Internal Audit security closure
still holds.

---

## 4. Pipeline trace (unattended)

| Stage | Mechanism | Time (UTC) | Outcome |
|---|---|---|---|
| Business event emitted | `INTERNAL_AUDIT.PLAN.APPROVED` → `omni_comms_business_event_outbox` | 22:10:56 | pending |
| Ingest | cron `omni-comms-business-event-ingest-every-minute` | 22:15 | claimed 1, processed 1, blocked 0 |
| Render + release snapshot | `omni_comms_priv_persist_rendered_messages` | 22:15 | 2 jobs created, both `ready`, **hold_reason null** |
| Dispatch | cron `omni-comms-dispatch-every-minute` | 22:16 | both jobs `completed` |

No manual pump, no ticket minting, no operator release. Fully automatic.

---

## 5. Delivery evidence

Correlation ID: `internal_audit:plan_approved:1f378d20-5003-4931-a735-5e6848ba6239:2`

| Channel | Message status | Attempt | Attempt status | Provider message id | Provider HTTP | Response category | Release version | Certified commit at claim |
|---|---|---|---|---|---|---|---|---|
| email | delivered | 1 | accepted | `509c0b86-58c6-441b-867e-4815082e900c` | 200 | accepted | 34 | `1ac76626…` |
| in_app | delivered | 1 | accepted | `1af12529-ac3f-413a-bcc1-a51874534e60` | — | internal_projection | 14 | — |

Recipient: `audit.hia@mishainfotech.com` — an Internal Audit test mailbox on the
approved pilot allowlist. No external or citizen recipient was contacted.

---

## 6. Estate hygiene

The single remaining pre-certification email job
`963237dd-eccf-440c-80d9-8bf0b2b677e3` was retired through the governed
`retire_held_job` action (reason `superseded_pre_production_pilot_job`). Nothing
was deleted: request, message and history remain and an immutable cancellation
event was appended. No provider was contacted.

Post-canary estate: zero stale email jobs blocking the dispatcher scan.

---

## 7. Gate outcome

**Gate E4.0 — PASSED.**

A brand-new Internal Audit business event, created after the cutover and
approved through governed commands only, was rendered, authorized, dispatched
and accepted by the provider on the email channel and delivered on the in-app
channel, unattended, within one scheduler cycle, under a valid controlled-pilot
release and a matching deployment certification.
