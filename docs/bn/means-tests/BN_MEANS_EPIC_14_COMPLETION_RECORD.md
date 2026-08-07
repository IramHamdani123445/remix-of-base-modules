# BN Means-Test Assessments — Epic 14 Completion Record

Final end-to-end completion and technical certification of the Means-Test
Assessment module. This record closes Epics 0–14.

## Module classification

**FUNCTIONALLY COMPLETE AND TECHNICALLY CERTIFIED — CONTROLLED UAT READY.**

The module is not dark-launched as a whole. Availability is decided by the
database module/route/action registry; individual actions remain
backend-governed and fail closed.

## Journey certification

| Journey | Scope | Result |
| --- | --- | --- |
| Journey A | New claim: create → household/income/assets/deductions → evidence → submit → verify → calculate → approve → activate | PASS |
| Journey B | Clarification: verification query → information request → response → re-verification (no auto-verify) | PASS |
| Journey C | Adjustment: request → independent approval → recalculation, stale-calculation refusal | PASS |
| Journey D | Activation and Eligibility publication of the canonical `means.*` bundle | PASS |
| Journey E | Reassessment: schedule → successor → supersession | PASS |
| Journey F | Change of circumstances recorded without mutating the active calculation | PASS |
| Journey G | Rejection and Appeals hand-off (governed hand-off, never a Means command) | PASS |
| Journey H | Risk/Fraud boundary: referral is a hand-off only; no Means-side enforcement | PASS |

## Cross-cutting certification

- **Single command boundary** — every mutation routes through
  `meansCommandService` into `bn_means_*_command_v1` (execute, evidence,
  submission, verification, activation, lifecycle). No UI or page performs
  `supabase.from(...)`.
- **State machine** — all journeys traverse `BN_MEANS_TRANSITIONS` only;
  `SUPERSEDED`, `CLOSED` and `CANCELLED` are non-reversible.
- **Maker-checker** — submission, verification, adjustment approval and
  final approval all reject self-service (`SELF_VERIFICATION_DENIED`,
  `SELF_APPROVAL_DENIED`).
- **Immutable history** — verification works against the frozen submitted
  version (`FROZEN_VERSION_MISSING` / `FROZEN_VERSION_TAMPERED`);
  corrections create new records, never edits.
- **Concurrency** — every command carries `p_expected_row_version`;
  staleness surfaces as `STALE_ROW_VERSION` / `VERSION_CONFLICT`.
- **Idempotency** — deterministic canonical payload hashing; replays report
  `REPLAYED`, changed payloads are refused with
  `IDEMPOTENCY_PAYLOAD_MISMATCH`.
- **Fact contract** — activation publishes exactly the `means.*` keys in
  `meansFactContract.ts`; the legacy `MEANS_TEST_PASSED` placeholder is not
  reintroduced. Non-active, expired, retired-policy or non-PASS assessments
  are refused.
- **Boundaries** — Eligibility, Award, Payment, Mortality, Appeals,
  Risk/Fraud and Communications are reached only through governed
  hand-offs; the module never writes an award, payment or notification.
- **Deep links** — operational queue rows carry a backend
  `deep_link_section`, mapped to a workspace tab by `meansSectionToTab`.
- **Legacy reconciliation** — every `BN_MT_*` command is aliased, retired or
  replaced by a governed hand-off; direct award creation stays prohibited.

## Certification tests

- `src/__tests__/bn/means-tests/meansEpic14Journeys.test.ts` — journeys A–H,
  idempotency, staleness, permission and deep-link certification.
- `src/__tests__/bn/means-tests/meansEpic14Certification.test.ts` —
  architecture and documentation hygiene guards.
- Full Means-Test regression: `bunx vitest run src/__tests__/bn/means-tests`.

## Remaining follow-on (outside Means-Test)

- Risk/Fraud module implementation consumes the hand-off contract already
  certified here.
