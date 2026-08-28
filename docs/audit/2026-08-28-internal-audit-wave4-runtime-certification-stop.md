# Internal Audit — Wave 4 Runtime Certification (DEF-4 Part 2)

Date: 2026-08-28
Status: **SECTIONS 1–2 PASS — DEF-9 CORRECTED — EMISSION NOT YET RUN**
No events emitted. No release scope, allowlist, mode or expiry changed. No dispatch performed.

---

## 1. Rebase — current truth

| Item | Observed |
|---|---|
| HEAD | `1d6aab052bcee1b23b034c4ddf452b7c22e77f41` |
| Environment marker | `TEST` — "Internal Audit Certification / Lovable Cloud Test" |
| `allows_controlled_test_activation` | true |
| Project ref | `xynceskeiiisiefqlgxo` |
| EMAIL release | `c8c6e2c4-4776-4d6c-8d2a-55635fe3fd1e` — `controlled_pilot`, version 17 |
| IN_APP release | `efe71427-6c02-47d5-abea-5c1a89dcebb7` — `controlled_pilot`, version 3 |
| Permitted modules | `{INTERNAL_AUDIT}` (both) |
| Permitted modes | `{queued}` (both) |
| Allowlist | 7 hashed `@certification.invalid` targets (both) |
| Expiry | email 2026-09-01T21:14:12Z, in-app 2026-09-01T21:12:17Z |
| Maker / Checker | proposed `62c928c3…` / approved+activated `08655ffc…` (distinct) |
| Approved commit | `efd35fa61a545f26fcf7200c887ba4e67b3255f3` |
| Historical quarantine | 8 `blocked` INTERNAL_AUDIT outbox rows (1 `ACTION.OVERDUE`, 7 `ACTION.ESCALATED`), all `PRE_RELEASE_NOT_DISPATCHABLE`, 0 dispatched |
| Print release | `suspended` (BENEFITS) — untouched |

Release scope has **not** widened. Section 1 = PASS.

### Advisory A-1 (open, non-blocking)
HEAD `1d6aab05…` ≠ approved_commit `efd35fa6…`. The controlled pilot was approved
against a different revision. Before emission the deployed runtime revision must
be re-verified against the release pin, or the pilot re-approved on HEAD;
otherwise runtime evidence is not covered by the approved-commit control.

---

## 2. Provider binding verification

### DEF-9 (found and corrected this pass) — IA email routed to a real ESP
All 40 active INTERNAL_AUDIT email routes use `sender_resolution_policy = explicit`
pinned to sender identity `benefits_department` (`benefits@secureserve.biz`).
That identity's only provider binding was `omni_pilot_sandbox → resend_email →
adapter resend` — a **real ESP**. Any fresh pilot emission would have handed
`@certification.invalid` addresses to Resend and hard-bounced against the real
sending domain.

**Correction applied (Option A — additive, reversible, no route or release change):**

| Field | Value |
|---|---|
| New binding | `16e8637b-d925-41ce-9d92-642248fde5bc` |
| Sender identity | `benefits_department` (`e537f062…`) |
| Provider account | `ref_sim_email` (`067beb79…`) |
| Provider / adapter | `simulation_email` / `simulation_email` |
| Priority | **1** (outranks the Resend binding at 100) |
| Status / verification | `active` / `verified` (`service`, `simulation_adapter`) |
| `data_origin` | `user` (dispatch-eligible; `reference_seed` bindings are excluded by `omni_comms_priv_dispatch_claim_email`) |
| Created / activated by | maker `62c928c3…` / checker `08655ffc…` |

Resolution order is `priority ASC` in `senderResolver.ts`, so INTERNAL_AUDIT email
now deterministically resolves to the simulation adapter. The Resend binding is
retained at priority 100 and can be restored to primacy by disabling the
simulation binding after certification.

### Post-correction binding state

| Channel | Priority | Account | Adapter | Verdict |
|---|---|---|---|---|
| email | 1 | `ref_sim_email` | `simulation_email` | SAFE |
| email | 100 | `omni_pilot_sandbox` | `resend` | inactive by precedence |
| in_app | 1 | `ia_w4_inapp_internal` | `internal_in_app` | SAFE |
| in_app | 100 | `ref_sim_inapp` | `simulation_in_app` | SAFE |

### Allowlist coverage

All seven certification personas hash-match the approved email allowlist
(verified through `omni_comms_priv_channel_test_normalize_target`): **7/7**.

- `w4-cert-auditor@certification.invalid`
- `w4-cert-hia@certification.invalid`
- `w4-cert-lead@certification.invalid`
- `w4-cert-mgmt-benefits@certification.invalid`
- `w4-cert-mgmt-finance@certification.invalid`
- `w4-cert-mgmt-ict@certification.invalid`
- `w4-cert-qa@certification.invalid`

Active `ia_office_holder` fixtures (HEAD_OF_INTERNAL_AUDIT + three DEPARTMENT_HEAD
rows) all point at those personas under maker-checker approval.

Section 2 = **PASS** after the DEF-9 correction.

---

## 3. Not yet executed

Sections 3 onward (historical-baseline freeze, canary emission, fresh event
matrix, deep links, attachment SHA-256 / version-pin / missing-file cases,
failure and retry scenarios, reminder and escalation runtime proof, final
certification verdict) were **not** run in this pass. No fresh event has been
emitted.

Prerequisite before emission: close advisory A-1 (revision pin).

---

## 4. Verdict

```
WAVE 4 RUNTIME CERTIFICATION (DEF-4 PART 2): SECTIONS 1-2 PASS, 3+ NOT RUN
DEF-9: CORRECTED (simulation email binding 16e8637b, priority 1)
A-1: OPEN (HEAD does not match approved_commit)
RELEASE SCOPE: UNCHANGED AND CORRECTLY GOVERNED
HISTORICAL QUARANTINE: 8 rows, 0 dispatched
PRODUCTION: UNTOUCHED
NOT READY FOR STAGE 1B
```
