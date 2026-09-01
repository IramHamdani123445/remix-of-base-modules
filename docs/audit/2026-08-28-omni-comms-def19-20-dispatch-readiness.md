# Omni-Comms — DEF-19 closure and DEF-20 finding (2026-08-28)

Build revision: `c969821569fc4ae4842934414ba0e270c2c13401`

## Closed

- **DEF-19 — recipient identity & adapter propagation into the database gate.**
  `omni_comms_priv_persist_rendered_messages` now derives the recipient target
  hash (channel-normalised) and the resolved provider adapter itself and passes
  both to `omni_comms_priv_evaluate_dispatch_authorization`.
- **DEF-19b — release snapshot at decision.** The same RPC now stamps
  `release_control_id`, `release_decision_at`, `release_version_at_decision`,
  `release_state_at_decision`, `release_fingerprint_at_decision` and
  `release_expires_at_decision` on every authorised job, from the effective
  release control row. Without this the claim gate denied every job with
  `release_snapshot_missing`.
- Job authorisation events now carry non-PII diagnostics
  (`recipient_hash_head`, `adapter_used`, `hash_error`, `database_decision`).

### Evidence

Fresh business-path canary (`INTERNAL_AUDIT.ACTION.ASSIGNED`, persona
`w4-cert-auditor@certification.invalid`):

| channel | job status | is_runnable | database_decision | release state at decision |
| --- | --- | --- | --- | --- |
| email | ready | true | authorized | controlled_pilot |
| in_app | ready | true | authorized | controlled_pilot |

Earlier canaries appeared unchanged only because the producer idempotency key
was identical — those runs were replays, not new emissions.

## Open — DEF-20 (decision required)

The email claim gate refuses the authorised job with
`provider_account_not_operational`. Cause: the only email-capable simulation
account (`simulation_email`, id `067beb79…`) is `data_origin = 'reference_seed'`
and `verification_status = 'unverified'`. The claim transaction deliberately
rejects reference-seed accounts and unverified credentials.

Certification therefore cannot complete on simulation credentials without one
of these governed choices:

1. Provision a tenant-owned provider account bound to the simulation adapter
   (`data_origin` = tenant-configured) and verify it, or
2. Certify email against a real provider account (e.g. the controlled role
   mailboxes) with the pilot allowlist still enforcing recipients.

No credential, adapter or seed data was altered. Dispatch remains fail-closed.
