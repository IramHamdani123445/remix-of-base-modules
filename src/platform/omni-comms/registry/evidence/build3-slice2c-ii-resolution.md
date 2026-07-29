# Slice 2c-ii — Resolution Pipeline Evidence (Batch C)

## Status classification

| Stream | State |
| --- | --- |
| Batch A — schema and security posture | Verified |
| Batch B — resolver wiring and architecture | Verified |
| Batch C — sandbox-verifiable controls and privileged harness | Verified |
| Privileged Edge runtime integration | Pending external privileged execution |
| Overall Slice 2c-ii | Conditionally complete, not yet runtime-verified |

**The code and database security boundary are verified. Runtime resolution
behaviour remains pending execution in an environment with service-role
access and a capability-bearing test JWT.**

**Runtime marker not yet produced.** The success marker
`BUILD 3 SLICE 2C-II EDGE RESOLUTION INTEGRATION OK` MUST NOT be printed
anywhere until the privileged integration harness has executed every
scenario successfully against a live project.

## Deployed private RPC signatures

| RPC | Identity args | Returns |
| --- | --- | --- |
| `public.omni_comms_priv_runtime_resolution_snapshot` | `uuid, uuid, uuid, text, text[]` | `jsonb` |
| `public.omni_comms_priv_finalize_resolution` | `uuid, uuid, uuid, jsonb, jsonb, text[], text` | `jsonb` |
| `public.omni_comms_priv_load_persisted_resolution` | `uuid, uuid, uuid` | `jsonb` |
| `public.omni_comms_priv_next_event_sequence` | `uuid` | `bigint` |
| `public.omni_comms_priv_send_communication` (Slice 2b — preserved) | (Slice 2b contract) | `jsonb` |

All are `SECURITY DEFINER`, owned by `postgres`, with a pinned
`search_path` under `pg_catalog[,public|extensions]`.

## Security grants

| RPC | anon | authenticated | service_role | public |
| --- | --- | --- | --- | --- |
| `omni_comms_priv_runtime_resolution_snapshot` | ❌ | ❌ | ✅ | ❌ |
| `omni_comms_priv_finalize_resolution` | ❌ | ❌ | ✅ | ❌ |
| `omni_comms_priv_load_persisted_resolution` | ❌ | ❌ | ✅ | ❌ |
| `omni_comms_priv_next_event_sequence` | ❌ | ❌ | ✅ | ❌ |
| `omni_comms_priv_send_communication` | ❌ | ❌ | ✅ | ❌ |

## Canonical shared layout and assignment surfaces

Resolution reads assignments and layouts exclusively via the Build 1
shared RPCs (`omni_comms_assignment_*`, `omni_comms_resolve_render_manifest`).
Direct `.from('comm_asset_assignment')` reads are forbidden from `src/**`
by Rule 11 `OMNI_RESOLVER_RUNTIME_BOUNDARY`.

## Edge orchestration path

`supabase/functions/omni-comms-runtime/index.ts` orchestrates:
JWT auth → server-authoritative fingerprint → replay check
(`load_persisted_resolution`) → fresh resolution
(`runtime_resolution_snapshot` + resolver modules) → atomic finalization
(`finalize_resolution`). No provider endpoints are contacted.

## Resolver precedence

Route → Recipient → Template → Layout → Asset → Sender → Channel
eligibility. Department overrides organisation; version pins override
latest published; blockers short-circuit downstream resolution and are
persisted with the request.

## Blocked-request policy

A request whose resolution yields any blocker transitions to `blocked`,
persists a `runtime_blocked` event, and creates NO message,
dispatch-job, or delivery-attempt rows.

## Replay policy

Identical fingerprint replays return the persisted resolution snapshot
without re-resolving current configuration. No duplicate recipients or
events are created. Mismatched fingerprints raise the controlled
`idempotency_payload_mismatch` code.

## Sandbox limitations

- The sandbox psql role has no EXECUTE grant on the service_role-only
  RPCs, so runtime behaviour cannot be exercised here.
- No service-role key is available in the sandbox.
- No capability-bearing JWT is available in the sandbox.
- Runtime scenarios are therefore covered by the privileged harness
  described below, not by the SQL verifier.

## Exact tests executed (sandbox)

```
bunx vitest run src/__tests__/omni-comms/
bun run check:omni-comms-architecture
bunx tsgo --noEmit
bun run build
psql -f scripts/omni-comms/verify-build3-slice2c-ii-resolution.sql
psql --single-transaction -f scripts/omni-comms/rollback/build3-slice2c-ii-resolution-rollback.sql   # rolls back
```

## SQL verifier result

The verifier prints only `BUILD 3 SLICE 2C-II RESOLUTION VERIFY OK` on
success. This marker certifies schema, signatures, grants and security
posture only. **It does not certify runtime resolution semantics.**

## Architecture negative-fixture result

14 in-memory fixtures (see
`src/__tests__/omni-comms/build3-slice2c-ii-batch-c.test.ts`) exercise
Rule 11 `OMNI_RESOLVER_RUNTIME_BOUNDARY`, Rule 2
`OMNI_LEGACY_TABLE_REFERENCE`, and Rule 9 `OMNI_SEND_FACADE_BOUNDARY`.
Each fixture asserts detection by the intended rule id and is not merely
a syntax failure.

## Privileged integration harness

```
bunx tsx scripts/omni-comms/integration/run-edge-resolution.ts
```

### Required environment variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OMNI_COMMS_TEST_USER_JWT` (must carry `omni_comms.*` capability)
- `OMNI_COMMS_TEST_ORGANIZATION_ID`
- `OMNI_COMMS_TEST_DEPARTMENT_ID`

The harness refuses to run without them and exits non-zero with
`PRIVILEGED EDGE RESOLUTION INTEGRATION NOT EXECUTED`. The success marker
`BUILD 3 SLICE 2C-II EDGE RESOLUTION INTEGRATION OK` is emitted only when
every privileged runtime assertion succeeds.

## Conditions required to certify Slice 2c-ii fully

1. Provision the five environment variables above in a privileged
   environment (never in the sandbox / preview).
2. Run the harness; observe the success marker.
3. Attach the harness log to this evidence file.
4. Only then may the readiness manifest advance Slice 2c-ii from
   `Pending` to `Verified` and progress to Slice 2c-iii.
