# Internal Audit — Wave 4 Closure Evidence

Date: 2026-08-28 (UTC)
Build revision: `c969821569fc4ae4842934414ba0e270c2c13401` (`build_artifact`, guard passing)
Environment: TEST / `non_production`
Secrets: no secret operations performed.

## DEF-16 — Final database recipient allowlist enforcement (CLOSED)

`public.omni_comms_priv_evaluate_dispatch_authorization` now independently
enforces the effective governed release recipient allowlist and fails closed
with the bounded reason `recipient_not_allowlisted`.

Direct SQL proof (`supabase/tests/omni-comms/def16_dispatch_recipient_allowlist.sql`,
executed read-only, all assertions passed):

| Probe | Result |
| --- | --- |
| Known allowlisted email hash | AUTHORIZED |
| Upper-case hash (case contract) | AUTHORIZED |
| Unknown hash | `recipient_not_allowlisted` |
| NULL / empty / whitespace / malformed hash | `recipient_not_allowlisted` |
| Email-allowlisted hash evaluated for `in_app` | BLOCKED (no cross-channel leak) |
| Module out of pilot scope | `module_not_in_pilot_scope` |
| Mode `immediate` | `mode_not_queued` |
| Live `resend_email` adapter | `provider_not_certification_safe` |
| Unapproved revision | `runtime_revision_not_approved` |
| Pre-certification job timestamp | `historical_job_not_authorized` |
| `omni_comms_priv_dispatch_claim_email` routes through the gate | proven |
| `omni_comms_priv_persist_rendered_messages` routes through the gate | proven |

## Authenticated certification persona

Persona: `w4-cert-auditor@certification.invalid` (`a57999a8…`), signed in via a
real browser session (no service-role emission).

Governed provisioning required to make the persona a legitimate producer:

- `IA_TEAM_MEMBER` role granted `internal_audit:view` and `omni_comms:operate`
  (the exact permissions `omni_comms_priv_authorize_runtime_actor` requires).
- Staff profile created and an ACTIVE PRIMARY assignment to the
  `INTERNAL_AUDIT` department (`8ebc900a…`) of the pilot organisation.

Two prior emissions were correctly refused before provisioning:
`permission_denied` (no capability) and `producer_event_not_authorized`
(no department context → department-scoped producer binding not matched).

## Fresh runtime canary — real Internal Audit business path

Path: `auditNotificationService.notifyActionAssigned` →
`emitInternalAuditCommunication` → `emitConfiguredBusinessEvent` →
`emitBusinessCommunication` → `sendCommunication` → `omni-comms-runtime`.
No direct provider call, no direct queue insert.

Accepted request `f397296a-e754-4af7-8b8c-a03d5bf96976`, created
`2026-08-28T13:09:31Z` — after `RUNTIME_DISPATCH_CERTIFIED_FROM`
(`2026-08-28T12:43:03Z`), so it is a genuinely fresh, non-historical obligation.

| Channel | Message | Job | `is_runnable` | Hold reason |
| --- | --- | --- | --- | --- |
| email | `3d03ff44…` | `35b285b5…` | false | `provider_credentials_unavailable` |
| in_app | `b53c3080…` | `2ad38e49…` | false | `recipient_not_allowlisted` |

Both holds are correct, governed, fail-closed outcomes:

- The in-app hold is DEF-16 working end to end at enqueue time: this canary
  supplied only an email destination, so no allowlisted `user_reference`
  identity existed for the in-app leg.
- The email hold reflects that no certification-safe sender/credential is bound
  for the pilot; the live `resend_email` adapter remains refused by the
  authorization gate.

## Verdict

- DEF-16: CLOSED and permanently regression-covered.
- Authenticated business-path emission through Omni-Comms only: PROVEN.
- Fail-closed dispatch authority: PROVEN (0 historical jobs released).
- Actual channel delivery: NOT YET CERTIFIED — requires (a) an allowlisted
  in-app `user_reference` recipient on the emitting business command and
  (b) a certification-safe email sender binding for the pilot.

Regression: 2325/2325 Omni-Comms tests pass (1 pre-existing unhandled
`AbortError` in a legacy activity-automation probe, unrelated to this work).
