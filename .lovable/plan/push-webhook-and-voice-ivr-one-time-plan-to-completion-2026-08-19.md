# Push, Webhook and Voice/IVR — one-time plan to completion

Three channels are declared in the catalogue but have no real delivery: **Push**, **Webhook**, **Voice/IVR**. Everything below stays inside the existing Omni-Comms spine: business modules still call only `sendCommunication()`, the runtime still resolves template/branding/routing, and dispatch still goes through the shared adapter registry with release control, idempotency, attempts, callbacks and audit.

No new parallel communication system, no new template store, no provider secrets in the database or the browser.

---

## 1. Push (web + iOS + Android)

Push is a **device-token channel**, not an address channel. It needs a device register, which we do not have yet.

### What must exist

**Device register** — one governed table `omni_comms_push_device`:
- owner (auth user id and/or insured person / employer reference)
- platform: `ios` | `android` | `web`
- token (FCM registration token; APNs handled by FCM, so one token type)
- app identifier / bundle, app version, device model, locale, timezone
- state: `active` | `stale` | `revoked`, last_seen_at, last_success_at, failure_count
- unique on (token), RLS so a user only sees their own rows, plus service-role access for the worker

**Registration path** — an authenticated RPC `omni_comms_push_device_register` called by the client after the user grants notification permission, and `..._deregister` on sign-out/permission revoke. The client never writes the table directly.

**Token hygiene** — FCM returns `UNREGISTERED` / `INVALID_ARGUMENT` for dead tokens; the worker marks those rows `revoked` automatically. Tokens unused for N days become `stale`. This is what keeps push from silently rotting.

### Platform specifics
- **Android**: FCM token from the app. Needs the Firebase service account (server key) as an Edge secret.
- **iOS**: also an FCM token, but the APNs auth key (.p8, key id, team id, bundle id) must be uploaded into the Firebase project. Without it iOS delivery fails silently — this is the single most common go-live failure.
- **Web**: FCM JS SDK token + VAPID public key + a `firebase-messaging-sw.js` service worker at the site root. This messaging worker is separate from any app-shell worker and must not be merged with one.

### Content model
Template channel `push` authoring fields: title, body, optional image URL, deep-link/action URL (validated as a safe internal route or https), collapse key, priority, badge, sound, TTL, plus data payload keys. Preview shows an Android and an iOS notification shade rendering.

### Delivery
- Adapter `firebase_push` (already catalogued, currently config-only) implemented server-side against FCM HTTP v1 with OAuth from the service account.
- Recipient resolution: `omni_comms_priv_resolve_push_devices` expands one recipient into their active device tokens; one delivery leg per message, one attempt per token batch, per-token outcomes normalised into the attempt record.
- Multicast up to 500 tokens per call, fail-closed if no active device (message ends `undeliverable_no_device`, not silently "sent").
- Release control gate for `push`, same as Email/SMS.

---

## 2. Webhook (machine-to-machine)

Webhook is an **endpoint channel**: the recipient is a configured subscriber system, not a person.

### What must exist
- **Subscriber endpoints** on the existing channel-endpoint model (`omni_comms_channel_endpoint`, endpoint_type `business_webhook`): target URL (https only, no private/loopback ranges), HTTP method, custom headers, timeout, expected success codes, signing secret reference, active/suspended state.
- **Signing**: HMAC-SHA256 over `timestamp.body`, sent as `X-OmniComms-Signature: t=<ts>,v1=<hex>` plus `X-OmniComms-Event`, `X-OmniComms-Delivery-Id`, `X-OmniComms-Idempotency-Key`. Secret stored as an Edge secret reference only. Publish a short verification snippet for subscribers.
- **Content model**: the "template" for webhook is a governed **JSON payload contract** — a versioned JSON body with the same token substitution as other channels, plus a declared schema version. Preview renders the resolved JSON.
- **Delivery**: adapter `outbound_webhook` (new catalogue entry). Success = 2xx within timeout. Retries use the existing retry policy with exponential backoff and jitter; 4xx (except 408/429) is terminal, 5xx/timeout retries. Circuit-breaker: consecutive failures suspend the endpoint and raise an operational alert in Control Center.
- **Evidence**: response status, truncated response body, latency and attempt count recorded on the delivery attempt; no callback webhook needed since the response is synchronous.

---

## 3. Voice / IVR

Voice is an **addressed channel** like SMS, but the "content" is speech and the delivery is a call with a lifecycle.

### What must exist
- **Provider**: Twilio Programmable Voice adapter `twilio_voice` (reuses the existing Twilio account/credential model — no second Twilio product).
- **Identity**: a voice-capable caller ID (E.164 number owned/verified on the account), plus optional caller name.
- **Content model**, two authoring modes:
  1. **Text-to-Speech** — script text, language/locale, voice name, speech rate, and a `<Say>`-based flow. Best default for notifications.
  2. **Audio file** — a pre-recorded, archived audio asset played via `<Play>` (stored in the existing documents bucket, served by signed URL).
- **IVR interaction** (optional per template): a `gather` step — prompt, expected digits, timeout, retries, per-digit outcome mapping (e.g. `1 = acknowledged`, `2 = request callback`, `9 = repeat`). Outcomes are recorded as **structured response events** on the message, so Benefits can see "beneficiary pressed 1 — acknowledged".
- **Call flow serving**: an edge function `omni-comms-voice-twiml` returns signed, single-use TwiML for a specific delivery attempt; Twilio's request signature is verified, so nobody can pull a script by guessing a URL.
- **Callbacks**: extend the existing `omni-comms-webhook-twilio` function to accept voice status callbacks (`initiated / ringing / answered / completed / busy / no-answer / failed`) plus recording and gather results. Answering machine detection maps to a distinct normalised outcome.
- **Governance specific to Voice**: quiet-hours window per tenant/department (no calls outside it — held, not dropped), max attempts per recipient per day, and a compliance note that call recording, if enabled, requires an announced-consent prompt. Cost per call is higher than SMS, so per-day volume caps apply by default.

---

## 4. Cross-cutting work (done once, serves all three)

- **Capability catalogue**: flip `push`, `webhook`, `voice` from declared to implemented, with the right capability shape (device / endpoint / addressed), and their tabs derived from capabilities.
- **Adapter registry**: register `firebase_push`, `outbound_webhook`, `twilio_voice` against the existing `send / verifyCredentials / normalizeTarget / mapProviderStatus` contract — no channel `if` branches in the worker.
- **Scheduler**: extend the single dispatch tick to claim push, webhook and voice jobs alongside email/SMS/WhatsApp/in-app/print.
- **Release control**: one independent gate per new channel; each activates only through the existing two-person approval.
- **Control Center**: one row per new channel with gate state, provider health, queue depth and last activity.
- **Templates**: the Business Catalogue gets push, webhook and voice cells for existing Benefits events, seeded the same way Print/SMS/WhatsApp were.
- **Registries**: add every new table, RPC, edge function and adapter to the Omni-Comms object catalogue before creation, per the boundary rules.

---

## 5. What I need from you before go-live

| Channel | Required from you |
|---|---|
| Push (Android) | Firebase project + service account JSON |
| Push (iOS) | APNs auth key (.p8), key ID, team ID, app bundle ID |
| Push (Web) | VAPID public key; confirmation the site can host a messaging service worker |
| Push (all) | Confirmation of which app(s) will register devices — is there a mobile app today, or web-only first? |
| Webhook | Nothing external; you'll add subscriber endpoints in the UI. Tell me the first consumer system. |
| Voice | Twilio number that is voice-enabled; confirm TTS vs recorded audio for the first use case; quiet-hours policy for St. Kitts & Nevis |

---

## 6. Suggested build order

1. **Webhook** — no external accounts, entirely internal, proves the endpoint channel shape.
2. **Push web-first** — device register + FCM web, then add iOS/Android once app credentials arrive.
3. **Voice/IVR** — largest surface (TwiML serving, gather outcomes, quiet hours), and reuses the Twilio credentials already proven by SMS/WhatsApp.

Each ships behind its own release-control gate and each ends with a Benefits `BENEFITS.CLAIM.APPROVED` end-to-end proof before activation.

## Technical notes

- No provider secret ever lands in the database or the frontend — only secret reference names read server-side.
- Device tokens are personal data: masked in all admin surfaces, never logged in full, deleted on user deletion.
- Webhook target URLs are validated against private/loopback/metadata ranges to prevent SSRF.
- Voice TwiML URLs are signature-verified and single-use per attempt.
