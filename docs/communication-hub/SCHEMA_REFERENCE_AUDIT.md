# Communication Hub — Schema Reference Audit (Gate 2)

Audit of every Gate 2 defect candidate against the deployed schema captured in
`DEPLOYED_SCHEMA_CONTRACT.md` / `_schema_*.txt`. Each item lists status
(**BROKEN**, **CLEAN**, or **VERIFIED_ELSEWHERE**) and — when broken — the
exact repair that was applied.

## A. Legacy attestation ordering — **BROKEN → REPAIRED**

`communication_hub_legacy_evidence_attestation` has no `created_at` column;
its canonical timestamp is `attested_at`. Two admin RPCs relied on the missing
column, causing Baseline Convergence to raise `column "created_at" does not
exist` at runtime.

| Function | Before | After |
|---|---|---|
| `diagnose_comm_hub_legacy_attestation_fingerprint` | `ORDER BY created_at DESC LIMIT 1` | `ORDER BY attested_at DESC, id DESC LIMIT 1` |
| `correct_comm_hub_legacy_baseline_attestation` | `ORDER BY created_at DESC LIMIT 1` | `ORDER BY attested_at DESC, id DESC LIMIT 1` |

Repair migration: applied this checkpoint. Behaviour unchanged when the
existing partial unique index `uq_clea_active_per_lineage_cert` holds
(exactly one ACTIVE attestation per lineage/certification); the tie-breaker
by `id` guards against multi-row cases in fixtures.

## B. Fingerprint helper — **CLEAN**

Deployed body of `_comm_hub_fingerprint_evidence_core_v2` already:

- raises `FINGERPRINT_CORE_NULL` on null input;
- calls `extensions.digest(p_core::text,'sha256')` directly;
- performs no `pg_extension` probe and no table lookup;
- is declared `IMMUTABLE` truthfully;
- output is `'sha256-v2:' || encode(...,'hex')` (unchanged).

No migration required.

## C. Current template resolver — **CLEAN (with reservation)**

`get_comm_hub_current_evidence_snapshot` (178 lines) resolves the same
template the runtime uses via `core_template.active_version_id` chain (see
`_schema_routines.txt`). No independent "latest PUBLISHED" scan in the
deployed body.

Reservation: Gate 3 runtime-contract RPC will assert this invariant at
runtime rather than by manual inspection.

## D. Baseline resolver — **CLEAN**

`_chrc_get_production_baseline` (34 lines) reads active evidence authority
from the attestation table when `LEGACY_ATTESTED_BASELINE` is the authority
and validates event certification / ORE / lineage links. No repair needed
beyond A.

## E. Assessment fail-closed — **CLEAN**

`assess_comm_hub_revalidation_requirement` (112 lines) returns structured
blockers on unresolved current evidence — no broad exception swallowing that
implies "no drift". Deployed body inspected line-by-line, no bare
`EXCEPTION WHEN OTHERS` swallowing a snapshot failure.

## F. Evidence-key contract — **VERIFIED_ELSEWHERE**

Canonical `evidence_core_v2` keys are produced by
`_comm_hub_evidence_core_v2` and re-hashed by
`_comm_hub_fingerprint_evidence_core_v2`. Because both writer and comparator
use the same helper, key drift within Postgres is impossible. TS side must
NOT hash independently; a runtime probe covering this is added in Gate 3.

## G. Change-level precedence — **CLEAN**

`_chrc_derive_stages` (57 lines) computes required stages via an ordered
precedence chain, not a `DISTINCT`-collapsing set. Level ordering matches the
epic spec (`NONE < NON_SENDING_ONLY < CONTROLLED_EMAIL <
FULL_CONTENT_AND_DELIVERY < FULL_MANUAL_PRODUCTION < AUTOMATED_CANARY`).

## Deferred to later checkpoints

Gates 3 through 11 (runtime contract RPC, Edge Function hardening, wizard
rework, CI, test matrix, operator UI reorg, Gate 11 stop-point report) are
scheduled as sequential checkpoints. This checkpoint intentionally lands the
minimum change that unblocks Workstream 1 (Baseline Convergence) and
publishes the schema-truth artefacts that every subsequent gate depends on.
