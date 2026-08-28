# Internal Audit — Wave 4 DEF-4 Part 2

## Runtime Certification: Canary Emission Evidence

Date: 2026-08-28
Environment: `TEST` (`platform_environment_marker`, `allows_controlled_test_activation = true`)
Runtime classification: `non_production`

---

## 1. Rebase of truth (§8) — PASS

| Item | Value |
| --- | --- |
| Email release | `c8c6e2c4` v17, `controlled_pilot`, scope `{INTERNAL_AUDIT}` / `{queued}` |
| In-app release | `efe71427` v3, `controlled_pilot`, scope `{INTERNAL_AUDIT}` / `{queued}` |
| Print release | `suspended` (unchanged) |
| Allowlist | 7 hashed `@certification.invalid` targets per channel |
| Historical IA outbox rows | 8, all `blocked`, 0 released |

Advisory A-1 remains OPEN: repository HEAD does not match the pilot `approved_commit`
`efd35fa6…`.

---

## 2. Defects found and corrected this pass

### DEF-10 — Internal Audit producer bindings scoped to the wrong department (CLOSED)

All 41 `INTERNAL_AUDIT` rows in `omni_comms_producer_event_binding` carried
`department_id = c28f40f8…` (BENEFITS), while the Internal Audit module context
resolves to `8ebc900a…` (INTERNAL_AUDIT). Every real producer emission was rejected
with `producer_event_not_authorized` (403).

Correction: 41 additive, correctly-scoped bindings inserted
(`integration_reference = 'W4-RUNTIME-CERT-DEF10'`). Reversible; no existing row mutated.

### DEF-11 — Internal Audit event routes scoped to the wrong department (CLOSED)

Same root cause in `omni_comms_event_route`: 40 email + 41 in-app active IA routes were
all bound to the BENEFITS department, so an authorized IA emission resolved zero channels
and returned `no_channel_configured`.

Correction: routes cloned verbatim (template family, sender identity, policies, priority)
under `department_id = 8ebc900a…`. Additive only.

### DEF-12 — Simulation adapters treated as credential-bearing (CLOSED)

`senderResolver.ts` exempted only `print_spool` from the secret-reference check, so the
credential-free simulation and internal adapters (`simulation_email`, `simulation_in_app`,
`simulation_sms`, `internal_in_app`) raised `provider_credentials_unavailable` and the
email leg was dropped from the eligible channel set.

Correction: the credential-free adapter set now covers internal and simulation adapters.
Every external, credential-bearing adapter (`resend`, `twilio*`, `firebase_push`,
`outbound_webhook`) is deliberately excluded and still requires a configured secret.

---

## 3. Canary emission through the real Internal Audit producer — PASS

Emitted via the deployed UI with an authenticated session, calling the real
`emitInternalAuditCommunication` façade — no direct runtime invocation, no synthetic
payload path.

| Field | Value |
| --- | --- |
| Event | `INTERNAL_AUDIT.ACTION.ASSIGNED` |
| Entity | `ia_action_tracking` `ACT-2026-00008` (`0a4cbc85…`) |
| Recipient | `w4-cert-auditor@certification.invalid` (`a57999a8…`), allowlist hash-matched |
| Request | `f30fd7c7-b29d-42af-b411-c91c2e42d20a` |
| Producer event binding | `bba84c18-bc85-4f05-98d4-ed1d8a44c4a0` |
| Department source | `module_context` → `8ebc900a…` (INTERNAL_AUDIT) |
| Mode | `queued` |
| Status | `completed`, zero blockers |
| Eligibility | `eligible`, resolved channels `["email", "in_app"]` |

### Multi-channel fan-out from a single business event (§32) — PASS

| Channel | Message | Rendered checksum | Dispatch job |
| --- | --- | --- | --- |
| in_app | `57ea9686…` | `sha256:0e084f58…` | `610a237b…` |
| email | `a921d90d…` | `sha256:394aa522…` | `f981d804…` |

One `communication_request`, two channel messages, two dispatch jobs, distinct rendered
checksums per channel. Internal Audit supplied only the business event; template
selection, branding, sender identity, provider binding and routing were all resolved by
Omni-Comms.

---

## 4. Architecture conformance (§1–§7) — PASS

Repository-wide scan confirms no Internal Audit code contains a provider SDK call, direct
email send, direct notification insert, or template selection. All IA surfaces
(`CommunicationStageDialog`, `DocumentRequestsTab`, `PlanDistributionTab`,
`AuditActionCentre`) emit through `emitInternalAuditCommunication` /
`emitInternalAuditStageCommunication`.

`src/services/auditCommunicationService.ts` does contain direct `send-notification` calls,
but is consumed only by `src/components/compliance/**` — Compliance module scope, outside
this certification. Recorded as a Compliance-module backlog item, not an IA defect.

---

## 5. Runtime delivery attempt (§13, §21, §24) — BLOCKED BY DESIGN

Both dispatch jobs persisted as:

```
status = held, is_runnable = false, attempt_count = 0
hold_reason = runtime_privileged_certification_pending
```

`renderOrchestrator.resolveHoldReason()` returns
`runtime_privileged_certification_pending` as its terminal default: **this build emits no
runnable dispatch job under any configuration**. Provider-attempt evidence — adapter
invocation, delivery attempt rows, retry/backoff, failure classification, in-app bell
render — is therefore unreachable without lifting that gate in
`omni-comms-runtime`.

Lifting it is a release-scope change. The instruction for this pass was
**NO FURTHER RELEASE-SCOPE CHANGES**, so the gate was left intact and certification stops
here, with the queue-and-hold chain fully proven and the dispatch chain unproven.

---

## 6. Certification status

| Section | Result |
| --- | --- |
| §1–§7 architecture boundary | PASS |
| §8 rebase of truth | PASS (advisory A-1 open) |
| §9 historical backlog quarantine | PASS — 8 blocked, 0 released, 0 authorized jobs |
| Canary emission through real producer | PASS |
| §32 multi-channel fan-out | PASS |
| §13/§21/§24 provider dispatch, retry, failure | NOT CERTIFIED — held by design |
| Attachment, reminder, escalation runtime proofs | NOT REACHED |

Internal Audit Wave 4 is certified **up to and including governed queueing**. Runtime
delivery certification requires an explicit decision to enable runnable dispatch jobs for
the controlled pilot.
