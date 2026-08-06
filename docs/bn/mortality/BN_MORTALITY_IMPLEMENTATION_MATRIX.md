# BN Mortality — Implementation Matrix (Phase M1 parity proof)

Scope: death-event spine. Survivors is reached **only** through the governed
handoff boundary; no Survivors implementation exists in this programme.

Canonical sources
- Command catalogue (browser): `src/types/bn/mortality/mortalityCommandCatalog.ts`
- Command catalogue (edge mirror, generated): `supabase/functions/bn-benefits-query/_generated_command_catalog.ts`
- Command catalogue (database): `public.bn_mortality_command_definition` (26 rows)
- Governed entry point: `public.bn_mortality_execute_command_v2`
- Read model: `public.bn_mortality_available_actions_v1(p_event_id, p_actor_user_id)`

## M1 — source-to-database parity

| Layer | Count | Enforced by |
|---|---|---|
| Browser canonical catalogue | 26 | `mortalityCommandCatalogParity.test.ts` |
| Edge generated mirror | 26 | same parity test (field-by-field) |
| Database command definitions | 26 | CI step "Command catalogue seeded by migration (M1)" |
| Commands marked implemented | 26 | `mortalityGovernanceClosure.test.ts` |

### Defect found and closed in M1

`bn_mortality_check_actor_permission` resolved a caller's roles with
`join user_roles ur on ur.role_id = rp.role_id`. `public.user_roles` has no
`role_id` column — it stores the role **name** in `role`. The gate short-circuited
on the dark-launch check, so the defect was invisible while
`actions_enabled = false`, but every mutation would have failed with a SQL error
the moment Mortality was activated. The gate now joins
`role_permissions → roles → user_roles.role` and returns `CAPABILITY_DENIED`
as designed.

## Command → action → state matrix

| Command | Module action | From states | To state | Maker source |
|---|---|---|---|---|
| DRAFT_SAVE | `draft_save` | – / DRAFT | DRAFT | – |
| REGISTER_REPORT | `write` | – / DRAFT | REPORTED | – |
| CANCEL | `cancel` | DRAFT, REPORTED | CANCELLED | – |
| MATCH_PERSON | `match_person` | REPORTED+ | (no change) | – |
| MARK_DUPLICATE | `mark_duplicate` | DRAFT, REPORTED | DUPLICATE | – |
| ASSIGN | `assign` | REPORTED+ | (no change) | – |
| ATTACH_EVIDENCE | `write` | DRAFT+ | (no change) | – |
| SUBMIT_FOR_VERIFICATION | `write` | REPORTED | VERIFICATION_PENDING | – |
| PLACE_PROVISIONAL_HOLD | `decide` | REPORTED, VERIFICATION_PENDING, CONFLICT, IMPACT_REVIEW, APPROVAL_PENDING | PROVISIONALLY_HELD | – |
| RELEASE_HOLD | `release_hold` | PROVISIONALLY_HELD | VERIFICATION_PENDING | – |
| RECORD_CONFLICT | `write` | VERIFICATION_PENDING | CONFLICT | – |
| RESOLVE_CONFLICT | `resolve_conflict` | CONFLICT | VERIFICATION_PENDING | – |
| CONFIRM_VERIFICATION | `verify` | VERIFICATION_PENDING | VERIFIED | SUBMIT_FOR_VERIFICATION |
| REJECT_REPORT | `decide` | VERIFICATION_PENDING | REJECTED | SUBMIT_FOR_VERIFICATION |
| PREPARE_IMPACT | `prepare_impact` | VERIFIED, IMPACT_REVIEW | IMPACT_REVIEW | – |
| SUBMIT_IMPACT | `submit_impact` | IMPACT_REVIEW | APPROVAL_PENDING | – |
| RETURN_IMPACT | `return_impact` | APPROVAL_PENDING | IMPACT_REVIEW | – |
| APPROVE_IMPACT | `approve_impact` | APPROVAL_PENDING | CONFIRMED | SUBMIT_IMPACT |
| TERMINATE_AWARD | `decide` | CONFIRMED, FOLLOW_ON_PROCESSING | FOLLOW_ON_PROCESSING | APPROVE_IMPACT |
| CREATE_PAD_OVERPAYMENT | `decide` | CONFIRMED+ | (no change) | APPROVE_IMPACT |
| INITIATE_SURVIVOR_ASSESSMENT | `write` | CONFIRMED+ | (no change) | – |
| INITIATE_FUNERAL_GRANT | `write` | CONFIRMED+ | (no change) | – |
| COMPLETE_FOLLOWON | `complete_followon` | FOLLOW_ON_PROCESSING | COMPLETED | – |
| REFER_LEGAL | `decide` | CONFIRMED+ | (no change) | APPROVE_IMPACT |
| REVERSE_CONFIRMATION | `reverse` | VERIFIED+ | REVERSED | CONFIRM_VERIFICATION |
| CLOSE_EVENT | `decide` | COMPLETED, REJECTED, CANCELLED, DUPLICATE | CLOSED | – |

## M2 — operational query model

`bn_mortality_available_actions_v1` is the single source of truth for action
availability. It returns, per command: availability, required capability, valid
from-states, maker-checker requirement, recorded maker (user, step, timestamp),
integration readiness, data readiness and machine-readable reason codes
(`ACTIONS_DISABLED`, `CAPABILITY_DENIED`, `INVALID_STATE`, `MAKER_CHECKER_REQUIRED`,
`SELF_APPROVAL_PROHIBITED`, `INTEGRATION_NOT_READY`).

## M5 — handoff lifecycle

`bn_cross_module_handoff` carries the full lifecycle
(`PENDING → ACCEPTED → LINKED → COMPLETED`, plus `FAILED` and `CLOSED`).
`bn_cross_module_handoff_execute_v1` is the only mutation path and is
service-side only, so no module can impersonate another. Mortality raises four
handoff types: `POTENTIAL_OVERPAYMENT` (bn_overpayments),
`POTENTIAL_SURVIVOR_ASSESSMENT` (bn_survivors), `FUNERAL_GRANT_INTAKE`
(bn_claims) and `LEGAL_ESTATE_REFERRAL` (legal).

## M6/M7/M8 — certification gates

| Gate | Artifact | Marker |
|---|---|---|
| Effective grants | `supabase/verify/bn_mortality_effective_grants.sql` | `BN_MORT_GRANTS_RESULT: PASS` |
| Seeded lifecycle harness | `supabase/tests/bn/mortality_integration.sql` | `BN_MORT_HARNESS_RESULT: PASS` |
| Residue + dark launch | same file, post-rollback block | `BN_MORT_POSTFLIGHT_RESULT: PASS` |
| PG15 workflow | `.github/workflows/bn-mortality-integration.yml` | job `mortality-certification` |

The harness runs in one transaction, always rolls back, refuses to run unless
`platform_environment_marker.environment_kind = 'CI'`, and asserts the negative
security matrix (`E_ACTIONS_DISABLED`, `E_CAPABILITY_DENIED`, `E_SELF_APPROVAL`,
`E_OUTSTANDING_REQUIRED_ACTIONS`, `ROW_VERSION_CONFLICT`,
`E_IDEMPOTENCY_PAYLOAD_MISMATCH`, idempotent replay) alongside the happy path.

Activation remains operator-initiated: `bn_mortality` stays
`rollout_state = internal_pilot`, `actions_enabled = false`.
