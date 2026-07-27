# Communication Hub — Deployed Schema Contract

**Source**: live database inspection at repository commit head. Pipe-delimited
dumps of `information_schema` / `pg_catalog` are committed alongside this file
so any subsequent SQL work can be diffed against real deployed structure
rather than inferred conventions.

| Artifact | File | Rows |
|---|---|---|
| Tables in scope (`communication_*`, `comm_hub_*`, `core_template*`, `notification_*`, revalidation, readiness) | `_schema_tables.txt` | 86 |
| Columns (name / data type / udt / nullable / default) | `_schema_columns.txt` | 1763 |
| Routines (name / arg identity / return type / language / definer / volatility) | `_schema_routines.txt` | 302 |
| Enum types + labels | `_schema_enums.txt` | 29 |
| Indexes | `_schema_indexes.txt` | 289 |
| Triggers | `_schema_triggers.txt` | 71 |
| RLS on/off per table | `_schema_rls.txt` | 85 |

## Canonical timestamps by table (Gate 2A input)

Use ONLY the exact column name deployed. Do not assume `created_at` on
records that use domain-specific timestamps.

| Table | Canonical event timestamp | Also has `created_at`? |
|---|---|---|
| `communication_hub_legacy_evidence_attestation` | `attested_at` | **NO** |
| `communication_hub_event_certification` | `certified_at` / `activated_at` (see dump) | see dump |
| `communication_controlled_live_certification` | `certified_at` | see dump |
| `communication_manual_production_observation` | `observation_started_at`, `dispatched_at`, `confirmed_at` | see dump |
| `communication_hub_revalidation_cycle` | `initiated_at`, `updated_at` | check dump |
| `communication_hub_revalidation_send_authorisation` | `issued_at`, `consumed_at`, `expires_at` | check dump |
| `communication_hub_revalidation_stage_result` | `recorded_at` | check dump |

Full list is authoritative in `_schema_columns.txt`. Any SQL that adds an
`ORDER BY <ts>` on these tables MUST first confirm the column name against
that file.

## Notes on Gate 1 completion

- Grants dump returned empty via `information_schema.role_table_grants`
  filter; this is expected on this database — most Comm Hub tables inherit
  privileges via role membership / default privileges rather than explicit
  per-table grants. Grant surface is re-verified via the runtime health
  check RPC delivered in Gate 3.
- The `pg_extension` probe once suspected in the fingerprint helper is
  already absent; see `_schema_routines.txt` for the deployed body of
  `_comm_hub_fingerprint_evidence_core_v2` (IMMUTABLE, direct
  `extensions.digest` call, `FINGERPRINT_CORE_NULL` on null input).
