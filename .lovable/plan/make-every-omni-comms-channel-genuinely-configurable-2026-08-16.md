# Make every Omni-Comms channel genuinely configurable

Today only Email is fully configurable end-to-end. SMS has a real Twilio adapter but is still declared "not implemented", Release Control is hard-coded to Email, and the provider list itself lives in code — so operators cannot add, edit, or retire a provider without a code change.

This plan turns channels and providers into managed, editable configuration with one shared shape.

## 1. Provider registry becomes data, not code

- Add a governed provider-definition store in the backend: provider adapter definitions (adapter key, label, channel, status, notes) plus their credential requirements (purpose, display name, required flag, secret-reference pattern) and optional per-provider settings schema (e.g. region, sending domain, messaging service).
- The existing code catalogue is demoted to a **seed + capability truth**: code still declares which adapters have a real server-side implementation (`deliveryImplemented`, `verificationImplemented`). Operators can never fake an implementation; they can only register, configure, edit, enable or retire definitions.
- Seed the store from the current catalogue (Resend, SMTP, Twilio, local SMS gateway, Meta WhatsApp, Firebase, in-app, print) so nothing is lost.

## 2. One provider administration experience for all channels

Rework the Providers tab (shared across every channel workspace) into full management:

- List with search, sorting, paging, status chips (Implemented / Config-only / Retired), icon-based row actions.
- Create / edit provider registration: choose adapter, name it, map each credential purpose to an Edge secret reference (validated against the pattern), set provider-specific settings.
- Verify credentials (where a verifier exists), enable/disable, retire with reason — every change written to the Omni-Comms audit trail.
- Fail-closed messaging: a config-only adapter can be fully configured but shows "no delivery adapter deployed" and cannot be bound to live sending.

Accounts, Identities, Endpoints, Bindings and Policies already share one shell — they inherit the same treatment so each channel gets the identical CRUD experience driven by its capability matrix.

## 3. Runtime adapter registry (server side)

- Introduce a single dispatch adapter interface (`send`, `verifyCredentials`, `normalizeTarget`, `mapProviderStatus`) in the shared Edge layer.
- Register Resend (email) and Twilio (SMS) against it; route test delivery, business dispatch and webhook status callbacks through the registry instead of channel `if` branches.
- Adding a future provider then means: one adapter file + one seeded definition row — no changes to dispatch, test delivery, or the UI.

## 4. Generalise governance beyond Email

- Release Control / delivery gates become per-channel records instead of an Email-only contract, so SMS (and later channels) get their own toggle, approval workflow and audit history in the Control Center.
- Channel capability matrix updated: SMS marked delivery-implemented (Twilio), release-control enabled for SMS.
- Control Center shows one row per configured channel with its gate state, health and last activity.

## 5. Channel rollout order

| Channel | Configuration | Delivery |
|---|---|---|
| Email | already live | Resend (live) |
| SMS | live after this work | Twilio (gate-controlled) |
| WhatsApp | configurable (Meta definitions) | adapter later |
| Push | configurable (FCM definitions) | adapter later |
| In-app | configurable | internal surface later |
| Print / Webhook / Voice | registration only, clearly labelled | later |

## 6. Verification

- Tests: provider CRUD service, secret-reference validation, adapter registry routing, capability matrix (no channel can claim delivery without a registered adapter), release-control generalisation.
- Manual proof: register a second Email provider, edit it, retire it; configure Twilio SMS and run one approved technical test send.

## Technical notes

- No provider secret value ever enters the database or the frontend — only secret reference names; values stay in Edge secrets and are read server-side.
- Existing tables and RPCs are extended, not duplicated; the sending spine, idempotency and audit contracts are unchanged.
- Migrations follow the standard grants + RLS order; all new RPCs are `omni_comms_priv_*` with tenant access checks.
