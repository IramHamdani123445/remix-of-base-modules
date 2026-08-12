# Omni-Comms Email — Test & Verify Full Closure

## What the live system actually shows (verified now, read-only)

- Provider account `omni_pilot_sandbox` (`2657949e-…`) holds two secret references:
  `api_key` → `edge_env` (`OMNI_COMMS_RESEND_PILOT_SANDBOX`), `webhook_signing` → `vault`.
- Latest technical delivery `2d76b7c5-…` was **accepted** by Resend (HTTP 200),
  provider message `780bae2e-…`, attempt count 1.
- **The webhook is now working.** Two callbacks for that exact message arrived on
  12 Aug 07:12 (`email.sent`, `email.delivered`) and both are
  `signature_verified = true`. The only rejection (`signature_mismatch`) is from
  11 Aug, i.e. before the secret was corrected — it is stale history, not the
  current state.
- **The real remaining defect:** those two verified callbacks were stored as
  `scope = 'unmatched'`, `processing_result = 'ignored'`, with no provider
  account attribution — the receiver did not match them back to the technical
  delivery via `provider_message_id`. So Test & Verify cannot see its proof.
- Callback health aggregates with `ev.acct = ac.id OR ev.acct IS NULL`, so any
  unattributed event counts for **every** account.
- The webhook function still reads a global `OMNI_COMMS_RESEND_WEBHOOK_SECRET`
  fallback.

Conclusion: closure is very likely achievable **without sending a new email**.
One controlled send is held in reserve only if callback proof cannot be
established from the current delivery.

## Plan

### 1. Full deployed-truth audit (read-only)
Capture and report: latest preflight run (id, binding, fingerprint, status,
blockers, staleness), latest delivery (id, fingerprint, target, status, attempts,
provider message id, idempotency key, status code), and callback evidence
(events, verified count, types, timestamps, rejection reason).

### 2. Callback matching fix (the blocker)
In `omni-comms-webhook-resend`: match an inbound event to a technical delivery by
`provider_message_id` **before** business matching; set
`scope = 'channel_test'`, `processing_result = 'recorded'`, and persist the owning
`provider_account_id` (derived delivery → binding → account) into the bounded
payload summary. Business path untouched.

### 3. Strict, account-scoped secret resolution
- `webhook_signing` resolves strictly by `storage_mode`: `vault` → vault only
  (missing ⇒ `webhook_signing_secret_missing`); `edge_env` → that named
  deployment secret only. No vault-then-env fallback.
- Account-scoped URLs (`?account=<id>`) must never verify with the global
  secret; missing account secret ⇒ `webhook_account_secret_missing`.
- Global `OMNI_COMMS_RESEND_WEBHOOK_SECRET` is retained only for callbacks with
  no `account` parameter (legacy), which are recorded as
  `webhook_account_missing` and never count as account readiness proof.

### 4. Callback health account isolation
Rewrite `omni_comms_channel_callback_health` to drop the `acct IS NULL` clause;
health per account counts only evidence genuinely associated with that account,
and "healthy" requires the latest relevant verified callback to be newer than the
latest rejection. History (including the 11 Aug rejection) stays immutable and
visible.

### 5. Evidence repair for the existing verified callbacks
Deterministic, non-destructive re-projection of the two 12 Aug verified events
onto their technical delivery and provider account (append-only ledger respected:
correction recorded, nothing deleted). This is what flips callback proof without
a new email.

### 6. Test & Verify readiness model
Three distinct proofs kept separate: Configuration preflight / Provider delivery /
Signed callback. Callback proof requires a signature-verified callback for the
**current** delivery — generic health never substitutes. Delivery Setup keeps
"configured" semantics and stays 11/11 while a callback test fails; the failure
renders as `CONFIGURED — VERIFICATION FAILING`.

### 7. Schema drift audit
Inspect deployed `pg_constraint`, triggers and function overloads for
`omni_comms_channel_test_run`, `…_test_delivery`, `…_attempt`, `…_event`,
`omni_comms_test_recipient`, `omni_comms_channel_setting`,
`omni_comms_webhook_event`, and the secret-ref objects. Remove only proven
duplicate/obsolete legacy rules; confirm the canonical status contracts
(delivery: pending/dispatching/accepted/failed/outcome_unknown; attempts:
claimed/accepted/failed/outcome_unknown; recipient purposes:
controlled_pilot/internal_test/certification; policy: test_only/pilot_ready)
agree across DB, services and UI.

### 8. Webhook self-service UI
Delivery callbacks card shows: exact account-scoped URL with copy action,
provider account, registration status, expected events, signing-secret status and
storage source, callback health, last accepted/rejected, last rejection reason —
no secret values, write-only "Replace signing secret". Signature-mismatch
guidance points at the webhook's own signing secret, never at the API key and
never at a full-access key.

### 9. Fresh preflight, then at most one send
Run a new preflight against the current Benefits binding and approved
`internal_test` recipient; require `passed` / no blockers. Configure controlled
approval: enabled, one recipient, 1-hour window, max 1 delivery, 3600 s spacing,
`live_delivery_enabled = false`. Produce the server-derived pre-send checklist.
**Send only if callback proof cannot be established from the existing delivery**,
and then exactly once, with identity and idempotency key assigned before INSERT
and attempt evidence persisted before the provider call. On
`outcome_unknown`/`failed`: stop and report.

### 10. Error-message audit and tests
Every known operator error (invalid recipient purpose, policy test state,
sending-only credential, immutable identity, stale status CHECK, credential
shadowing, webhook secret missing, signature mismatch, missing account, stale
preflight, idempotency mismatch, max deliveries, min interval) gets plain-English
text, an exact fix action, and the technical code behind expandable details.
Regression tests added for recipient contract, strict credential source, webhook
account routing, account-isolated health, signed-callback matching, business
non-interference, and readiness 1/3 → 2/3 → 3/3. Run full Omni-Comms suite,
typecheck and the architecture guard.

## Safety
Max 1 new technical email (only if unavoidable); 0 business emails; 0 claims; 0
Release Control changes; live delivery stays disabled. If a correct signing
secret must come from the Resend console, work stops before sending and returns
the exact UI action.

Closes with the requested `OMNI-COMMS TEST & VERIFY FULL CLOSURE` report and
stops before Go Live.
