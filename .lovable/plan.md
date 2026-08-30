# BUG-51 — Benefit-specific facts missing at intake and on the workbench

Goal: make benefit-field resolution general so any product code resolves on its own merit, and make the fields that are captured actually visible and correctly owned on the workbench. TypeScript only — no migration, no schema change, no product code named in application code.

## Confirmed current state

- `normalizeBenefitKey` (`src/services/bn/forms/sectionCatalogue.ts:194`) is a whole-string lookup: exact `BENEFIT_FIELDS` key, else a fixed `alias` table of the original `SKN-XXX` names, else `null`.
- Intake (`src/pages/bn/intake/ClaimRegistration.tsx:199,444`) derives its step 8 field list solely from `normalizeBenefitKey(selectedProduct.benefit_code)` → unresolved product means no fields to enter.
- `BenefitDetailSection.tsx:143` renders `CATEGORY_FIELDS[category]` only — it has no product awareness, so captured benefit facts outside the category list are never shown.
- `ClaimWorkbench.tsx:541` passes only `category`, `detailJson`, `claimStatus`, `roles`, `onDetailChange` — no product code.
- `getFieldOwnership` (`src/lib/bn/fieldOwnership.ts:142`) defaults unknown keys to `STAFF_REVIEW`, so any field the maps don't list is treated as staff-editable.

## Changes

### 1. `src/services/bn/forms/sectionCatalogue.ts` — token-based resolution

Rewrite `normalizeBenefitKey` in strict order:
1. Upper-case, replace `[-\s.]` with `_`.
2. Exact `BENEFIT_FIELDS[key]` hit → return it.
3. Existing whole-key `alias` table hit → return it (kept ahead of tokens so multi-token codes like `SKN_EI_DTH` keep today's answer exactly).
4. New: split on `_`, map tokens → benefit key (MAT/MATERNITY; SICK/SICKNESS/STB; EI/INJ/INJURY; DIS/DISABLEMENT; MED/MEDICAL; DTH/DEATH; FUN/FUNERAL; AGE/AGEG; INV/INVALIDITY; SUR/SURV/SURVIVOR; NCP). Ignore non-benefit tokens (SKN, TEST, GRANT, BENEFIT, BE, S1, numerics). On competing tokens prefer the more specific.
5. No match → `null` (junk codes stay unmapped).

### 2. `src/components/bn/workbench/BenefitDetailSection.tsx` — product-aware overlay

- New optional prop `productCode?: string | null`.
- Resolve via `normalizeBenefitKey`, read `BENEFIT_FIELDS[key]` (not `getDefaultFieldsForBenefit` — shared fields don't belong here).
- Map `field_type` DATE/TEXT/CHECKBOX/NUMBER → `date/text/checkbox/number`; unsupported types (SELECT/TEXTAREA) fall back to `text`.
- Merge into `CATEGORY_FIELDS[category]`, de-duplicated by field key, every merged field `required: false`.
- Unresolved product → today's behaviour unchanged. No product code appears in this file.

### 3. `src/lib/bn/fieldOwnership.ts` — ownership coverage and aliases

- Add maternity fields to both `SHORT_TERM` and `GRANT`: `expected_confinement_date` CITIZEN_SUBMITTED, `actual_confinement_date` STAFF_REVIEW, `maternity_leave_start` CITIZEN_SUBMITTED, `maternity_leave_end` CITIZEN_SUBMITTED.
- Alias fixes: `SHORT_TERM.work_related` → `['is_work_related','work_related_confirmed']`; `SHORT_TERM.is_work_related` → `['work_related','work_related_confirmed']`; add `work_related`/`is_work_related` (STAFF_REVIEW, same aliases) to `INJURY`.
- Sweep every `BENEFIT_FIELDS` entry (sickness, injury, disablement, medical expense, injury death, funeral, age, invalidity, survivors, NCP) against the ownership map for the category its products use; add missing entries — claimant-stated facts CITIZEN_SUBMITTED, evidence-confirmed facts STAFF_REVIEW — and report every one added.
- `STAFF_REVIEW_STATUSES` untouched.

### 4. `src/pages/bn/claims/ClaimWorkbench.tsx`

- Pass `productCode={product?.benefit_code}` to `BenefitDetailSection`.
- Extend the `factsAliased` merge with `work_related: facts.work_related ?? facts.is_work_related ?? facts.work_related_confirmed`.

### 5. Audit script

`scripts/bn/audit-benefit-field-mapping.ts`, registered as `"audit:bn-benefit-fields"` alongside the existing `audit:bn-eligibility-rules` tsx entry. Reads every `bn_product` row and prints per product: `benefit_code | category | normalizeBenefitKey result | field count | fields with no ownership entry`, plus a summary (resolved vs unresolved counts, missing ownership field codes). Always exits 0 — report, not a gate.

## Verification

1. `tsc --noEmit` clean.
2. New unit test for `normalizeBenefitKey` asserting all 36 live product codes: the 12 that resolve today asserted unchanged, each newly resolving code asserted explicitly, and `ABCZ`, `TEST`, `TESTGOV01`, `EIB_TEST_001`, `EXCEPTURI NISI QUI D` still `null`. `SKN-SVC-*`, `SKN-REFUND`, `SKN-SRF`, `SIP` remain `null`.
3. Run `npm run audit:bn-benefit-fields` and paste the output.
4. Browser check on claim `ee7dc625` (SKN-MAT, SHORT_TERM): four maternity dates render (01/07/2026, 31/07/2026, 01/08/2026, 31/01/2027); expected confinement and both leave dates show the Citizen badge + lock, actual confinement shows Staff.
5. `SKN-SICK` and `SICK_11` show no maternity fields.
6. Intake step 8 offers benefit-specific fields for `SICK_11`, `MATERNITY_GRANT_TEST`, `SKN-STB-SICK`, `SKN-AGEG`, `SKN-SUR-GRANT`.
7. Register a claim with Work-Related Confirmed ticked and confirm the workbench Work Related checkbox is ticked.
8. Report the full before/after resolution table for all 36 products.
