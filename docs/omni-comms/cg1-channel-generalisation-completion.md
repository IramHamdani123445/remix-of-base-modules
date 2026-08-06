# CG1 — Channel Generalisation: Completion Report

Baseline commit: `c7bc54d36a5095435a0fd911ce95f1e71d85829f`
Scope: UI/application layer only. **Migration-free and RPC-free** — no SQL migration, no new
RPC, no delivery adapter, no send, no Release Control live activation.

## 1. Clarifications applied

| # | Clarification | Where it lives | Outcome |
|---|---|---|---|
| 1 | Channel/endpoint pairing is not a DB inconsistency; the UI mirrors `omni_comms_priv_normalize_channel_endpoint` | `domain/channelCatalogue.ts`, `channelReferenceData.ts` | Capability model mirrors the server contract; no defect raised |
| 2 | `schemaSupported` ≠ `uiApplicable` | `OmniCommsChannelCapability` | Two independent flags + mandatory truthful `reason`; tabs derived from `uiApplicable` only |
| 3 | Endpoints added to SMS and WhatsApp | catalogue capability matrix (single source) | SMS `delivery_callback` / `inbound_callback`, WhatsApp `business_webhook`; rail and tests read the derived matrix — never redefined |
| 4 | Push identities stay hidden | `push.capabilities.identities = cap(true, false, PUSH_IDENTITY_REASON)` | Representable, deliberately not exposed |
| 5 | In-App and Print stay narrow | `in_app`, `print` matrices | Provider Accounts and Bindings remain `uiApplicable: false` (`NOT_IN_PRODUCT_WORKFLOW`) |
| 6 | Release Control is Email-only | `OmniCommsChannelsPage` + matrix | Summary/mutation contracts invoked for Email only; every other channel `RELEASE_CONTROL_EMAIL_ONLY` |
| 7 | Non-Email Test Centre is configuration/preflight-only | `ChannelTestCentreTab` copy | No provider contact, callback verification, delivery acceptance or delivery-readiness claim |
| 8 | Email readiness preserved verbatim | `channelReadiness.ts` → `projectEmailReadiness(...)` | Generic layer delegates for Email; Email projection unchanged |
| 9 | Two readiness concepts | `configurationReadiness` / `deliveryReadiness` | Valid state rendered: “Configuration ready · Delivery adapter not installed” |
| 10 | No fake zeros | catalogue + summary rendering | Explicit loading / unavailable / not-configured states |
| 11 | Page stays a coordinator | `loadChannelConfigurationSummary(...)`, `loadChannelCatalogueCounts(...)` | Channel-aware composition lives in the bounded application service |
| 12 | Migration-free, RPC-free | — | No migration and no new RPC were required; no missing secure projection found |

## 2. Delivered scope

- Canonical channel capability matrix with derived tab lists (`deriveTabsFromCapabilities`).
- Channel-aware coordinator (`OmniCommsChannelsPage`) — selection and rendering only.
- Generic configuration summary service with genuine catalogue counts.
- Capability-gated tabs; out-of-capability `?tab=` falls back to Overview and rewrites the URL.
- Cross-channel resource clearing on channel change.
- UX2 resource-manager reuse across channels.
- Selected-channel policy loading.
- Truthful non-Email readiness (configuration vs delivery).
- Planned Webhook and Voice states (`databaseSupported: false`, no configurable resources).

## 3. Evidence

Tests — `bunx vitest run` on the CG1 surfaces: **143 passed / 143**
- `cg1-channel-generalisation.test.ts` — 25
- `c1-channel-catalogue.test.ts` — 18
- `c1-channels-workspace.test.ts` — 34
- `architecture-boundaries.test.ts` — 66 (zero unbaselined façade violations)

Screenshots captured on the running preview:
- Channel catalogue
- SMS workspace (no Release Control rail item)
- SMS → Endpoints tab (new capability, empty-state, preflight-only copy)
- In-App workspace (narrow applicability retained)
- Voice workspace (planned: “Configuration readiness unknown” + “Delivery adapter not installed”)

## 4. Posture

- No delivery adapter added or activated.
- No communication sent.
- Live delivery and Release Control live remain disabled.
- **CG1 CLOSED. Stopping here as instructed.**
