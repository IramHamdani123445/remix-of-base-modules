# CR-002 — Interest Retroactivity and Accrual Cap

**Status: OPEN business decision — `CR-002-RETROACTIVITY`**
Registered in `public.ce_open_business_decision`.

## 1. Confirmed vs unconfirmed

| Confirmed by approved client material | Not confirmed |
|---|---|
| 5% per annum | maximum accrual months |
| compounded monthly | maximum interest amount / cap policy |
| accrues after the applicable grace period | historical interest effective (start) date |
| EC$10 minimum balance | retrospective application to liabilities pre-dating implementation |

Nothing in the confirmed column has been altered. No cap and no effective
date have been invented, seeded or defaulted anywhere in code, configuration
or migrations.

## 2. Configuration (governed, audited, no code change needed)

`ce_calculation_rules.parameters` for CR-002 now supports, all optional and
all unset today:

| Parameter | Type | Current value |
|---|---|---|
| `interest_effective_from` | date | *unset* |
| `max_accrual_months` | integer, nullable | *unset* |
| `max_interest_amount` | amount, nullable | *unset* (cap disabled) |
| `apply_to_pre_existing_liabilities` | policy mode | *unset* → `not_approved` |

Modes: `not_approved` (default), `exclude_pre_effective` (accrue only from the
effective date forward), `apply_retrospectively` (accrue from the original
statutory anchor). All four values are written through the governed
compliance-configuration path and captured on every calculation trace
(`ce_calculation_audit.inputs`), so any change is attributable.

## 3. Production-readiness guard

`computeInterest` (CR-002) now classifies each balance:

| Classification | Meaning | Posted? |
|---|---|---|
| `ACCRUED` | Approved basis — normal accrual | yes |
| `SUPPRESSED` | Below EC$10, or anchor not yet passed | no |
| `INTEREST_POLICY_REVIEW_REQUIRED` | Production run, balance predates the approved effective date (or no effective date is approved) and retroactivity is `not_approved` | **no** |
| `SIMULATED` | Impact analysis only, clearly labelled | **no** |

The accrual worker (`ce-ledger-penalty-accrual`) reads the environment marker.
In production, review-required balances are recorded in
`ce_interest_accruals` with `classification = 'INTEREST_POLICY_REVIEW_REQUIRED'`,
zero interest, and the reason — no ledger entry is created. TEST and
simulation runs (`{"simulate": true}`) may compute the amounts for impact
analysis; they are stored with `is_simulation = true` and `posted_interest = 0`.

## 4. Historical impact analysis (TEST data, as of 2026-08-29)

Basis: 5% p.a., monthly compounding, grace-period anchor, EC$10 minimum —
the confirmed policy, uncapped.

| Age Band | Liabilities | Principal (EC$) | Interest if Uncapped (EC$) | Oldest Period | Largest Individual Interest (EC$) |
|---|---:|---:|---:|---|---:|
| ≤ 12 months | 117 | 60,450.00 | 956.92 | 2025-12 | 27.79 |
| 13–36 months | 0 | 0.00 | 0.00 | — | 0.00 |
| 37–60 months | 0 | 0.00 | 0.00 | — | 0.00 |
| 61–120 months | 0 | 0.00 | 0.00 | — | 0.00 |
| > 120 months | 15 | 13,700.46 | 83,417.06 | 1987-01 | 15,560.76 |
| **Total** | **132** | **74,150.46** | **84,373.98** | 1987-01 | 15,560.76 |

Observation: 11% of the liabilities (all older than 10 years) carry 99% of the
uncapped interest. The oldest balance compounds for 474 months.

## 5. Cap scenarios — **NOT CLIENT APPROVED, ILLUSTRATION ONLY**

Shown purely to support the decision. Neither value is configured, seeded or
recommended.

| Scenario (illustrative) | Total Interest (EC$) | vs Uncapped |
|---|---:|---:|
| Uncapped (current confirmed policy, retrospective) | 84,373.98 | — |
| 60-month cap *(NOT CLIENT APPROVED)* | 4,838.90 | −79,535.08 |
| 120-month cap *(NOT CLIENT APPROVED)* | 9,821.08 | −74,552.90 |

By band (> 120-month band only; other bands are unaffected by either cap):

| Age Band | Uncapped | 60-month *(NOT APPROVED)* | 120-month *(NOT APPROVED)* |
|---|---:|---:|---:|
| ≤ 12 months | 956.92 | 956.76 | 956.76 |
| > 120 months | 83,417.06 | 3,882.14 | 8,864.33 |

A third option exists and needs no cap at all: setting
`interest_effective_from` with `apply_to_pre_existing_liabilities =
exclude_pre_effective`, which charges interest only from the policy's start
date forward.

## 6. Decision required from the client

1. Is there an interest effective date? If so, which date?
2. Does the 5% policy apply retrospectively to pre-implementation liabilities?
3. If yes, is there a statutory maximum accrual period or maximum interest amount?

Until answered, production accrual on pre-effective balances stays blocked and
classified `INTEREST_POLICY_REVIEW_REQUIRED`.

## 7. Checkpoint C

**COMPLETE — CR-002 retroactivity/cap decision OPEN for client confirmation.**
