# Make every Omni-Comms channel genuinely configurable

> **AMENDED 2026-08-16 — subordinate implementation note.**
>
> The authoritative architecture, sequencing, provider-neutral routing/failover model, Communication 360 requirements and Benefits non-breaking migration rules now live in:
>
> `.lovable/plan/omni-comms-master-provider-neutral-non-breaking-2026-08-16.md`
>
> This file remains useful for its provider-administration implementation detail. Where this file describes a single initial provider, an Email-first limitation, an older channel implementation state, or a rollout sequence that conflicts with the master plan, the master plan wins. In particular: providers are replaceable adapters; multiple providers per channel are required; routing/failover belongs centrally; Control Center must become all-channel; and existing working Benefits Email must not be broken during migration.

Today only Email is fully configurable end-to-end. SMS has a real Twilio adapter but is still declared "not implemented", Release Control is hard-coded to Email, and the provider list itself lives in code — so operators cannot add, edit, or retire a provider without a code change.

> Historical note: portions of the paragraph above reflect the state when this plan was originally written. The live code has since advanced (including SMS implementation/release-control work). Treat the master plan plus the canonical channel capability catalogue as current truth.

This plan turns channels and providers into managed, editable configuration with one shared shape.

## 1. Provider registry becomes data, not code

- Add a governed provider-definition store in the backend: provider adapter definitions (adapter key, label, channel, status, notes) plus their credential requirements (purpose, display name, required flag, secret-reference pattern) and optional per-provider settings schema (e.g. region, sending domain, messaging service).
- The existing code catalogue is demoted to a **seed + capability truth**: code still declares which adapters have a real server-side implementation (`deliveryImplemented`, `verificationImplemented`). Operators can never fake an implementation; they can only register, configure, edit, enable or retire definitions.
- Seed the store from the current catalogue (Resend, SMTP, Twilio, local SMS gateway, Meta WhatsApp, Firebase, in-app, print) so nothing is lost.
- **Master-plan amendment:** the registry is extensible and must not be treated as a closed provider list. Multiple provider accounts can serve the same channel and routing selects among eligible bindings centrally.

## 2. One provider administration experience for all channels

Rework the Providers tab (shared across every channel workspace) into full management:

- List with search, sorting, paging, status chips (Implemented / Config-only / Retired), icon-based row actions.
- Create / edit provider registration: choose adapter, name it, map each credential purpose to an Edge secret reference (validated against the pattern), set provider-specific settings.
- Verify credentials (where a verifier exists), enable/disable, retire with reason — every change written to the Omni-Comms audit trail.
- Fail-closed messaging: a config-only adapter can be fully configured but shows "no delivery adapter deployed" and cannot be bound to live sending.

Accounts, Identities, Endpoints, Bindings and Policies already share one shell — they inherit the same treatment so each channel gets the identical CRUD experience driven by its capability matrix.

**Master-plan amendment:** add a shared Routing surface for provider pool, priority/weight, health eligibility, fallback policy, shadow mode and effective-routing preview. Provider-specific settings remain metadata-driven subsections rather than separate provider products.

## 3. Runtime adapter registry (server side)

- Introduce a single dispatch adapter interface (`send`, `verifyCredentials`, `normalizeTarget`, `mapProviderStatus`) in the shared Edge layer.
- Register Resend (email) and Twilio (SMS) against it; route test delivery, business dispatch and webhook status callbacks through the registry instead of channel `if` branches.
- Adding a future provider then means: one adapter file + one seeded definition row — no changes to dispatch, test delivery, or the UI.
- **Master-plan amendment:** extend the common contract with health/capability/callback semantics and normalize attempt outcomes so cross-provider failover can be safe. An accepted or unknown-after-submission attempt must not trigger blind fallback.

## 4. Generalise governance beyond Email

- Release Control / delivery gates become per-channel records instead of an Email-only contract, so SMS (and later channels) get their own toggle, approval workflow and audit history in the Control Center.
- Channel capability matrix updated: SMS marked delivery-implemented (Twilio), release-control enabled for SMS.
- Control Center shows one row per configured channel with its gate state, health and last activity.
- **Master-plan amendment:** the Control Center must become an all-channel operational summary including provider pool/routing health. Each channel keeps an independent gate. An optional organization-wide emergency stop, if added, is separately governed and audited.

## 5. Channel rollout order

| Channel | Configuration | Delivery |
|---|---|---|
| Email | already live | Resend (live); preserve current production path while abstraction is introduced |
| SMS | shared configuration | Twilio initial adapter; business-dispatch parity and multi-provider readiness |
| WhatsApp | shared configuration | first adapter can be Meta; provider-neutral contract and own gate required |
| Push | configurable | adapter later |
| In-app | configurable | internal surface later |
| Print / Letter | shared physical-channel configuration | internal/external production provider adapters, postal/dispatch evidence |
| Webhook / Voice | planned | later |

This table describes sequencing only. It does not grant a provider permanent special status.

## 6. Verification

- Tests: provider CRUD service, secret-reference validation, adapter registry routing, capability matrix (no channel can claim delivery without a registered adapter), release-control generalisation.
- Manual proof: register a second Email provider, edit it, retire it; configure Twilio SMS and run one approved technical test send.
- **Master-plan amendment:** before live fallback, prove shadow routing, provider conformance, normalized outcomes, duplicate suppression, forced safe failover and unknown-outcome reconciliation.
- Existing Benefits Email remains on its proven path until the relevant migration slice has passed provider-free certification, controlled live proof and rollback validation.

## Technical notes

- No provider secret value ever enters the database or the frontend — only secret reference names; values stay in Edge secrets and are read server-side.
- Existing tables and RPCs are extended, not duplicated; the sending spine, idempotency and audit contracts are unchanged unless the master plan explicitly approves an extension.
- Migrations follow the standard grants + RLS order; all new privileged RPCs remain governed and tenant-checked.
- No new parallel business-module communication queue/log/template subsystem may be introduced.
