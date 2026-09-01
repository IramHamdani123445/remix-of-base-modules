# Internal Audit — Wave 4 runtime delivery certified (2026-08-28)

Build revision: `03fcd61c75a933ebf3e750d52d925c34b1efea81`

## Result: end-to-end delivery proven on the Omni-Comms platform

| Channel | Job status | Attempt | Provider message id |
| --- | --- | --- | --- |
| email (`IA-CANARY-EMAIL-3`) | completed | accepted | `b340b306-ef9f-4b1e-bca7-0213be7f6418` |
| email (`IA-CANARY-EMAIL-4`) | completed | accepted | `e7167eb0-e5ec-40bb-8264-ee201d1a4762` |
| in_app (both canaries) | completed | accepted | notifications `9fba03ed…`, `31796d3e…` |

Path: `INTERNAL_AUDIT.ACTION.ASSIGNED` producer → Omni-Comms request →
render → database dispatch authorization → claim → `resend_email`
(`internal.audit@secureserve.biz`, secret `OMNI_COMMS_RESEND_PILOT_SANDBOX`)
and `omni_comms_priv_dispatch_deliver_in_app`.

## Defects closed this session

- **DEF-15 (in-app delivery path)** — `omni_comms_priv_dispatch_deliver_in_app`
  now runs under the platform job lifecycle (`ready → leased → processing →
  completed`) with `lock_token` / `locked_at` / `locked_by` and a `scheduler`
  execution context.
- **Scheduler argument defect** — `omni_comms_priv_dispatch_scheduler_tick`
  called `omni_comms_priv_dispatch_claim_generic` with positional arguments in
  the wrong order; now called by name.
- **DEF-20 (non-operational simulation provider)** — retired: the pilot now
  uses the operational Resend account instead of the unverified
  `simulation_email` seed.
- **Stale release snapshot / auto-suspend loop** — email jobs stamped against
  an older `release_version` kept tripping the safety auto-suspend. Legacy
  email jobs older than 10 minutes were parked as
  `superseded_release_snapshot`, and the email pilot was re-approved through
  the governed suspend → propose → approve cycle (release version 23).

## Notes

- Two attempts per email job show `lease_expired` on attempt 1: those leases
  were taken by a manual SQL probe, not the worker. The cron worker reclaimed
  them and recorded the accepted provider outcome on attempt 2. No duplicate
  provider sends (provider idempotency key held).
- No secrets were created, rotated or deleted.
- Dispatch remains fail-closed: recipient allowlist, revision match and
  release snapshot are all enforced in the database gate.
