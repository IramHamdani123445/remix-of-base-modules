# BUG-51 — Product-specific maternity facts + work-related alias

## What I found (current behaviour)

**How products map to categories.** `bn_product.category` is a coarse bucket (`SHORT_TERM`, `GRANT`, `INJURY`, …). Maternity products are spread across two buckets: `SKN-MAT`, `MAT`, `MATERNITY_GRANT_TEST` are `SHORT_TERM`; `SKN-MAT-GRANT`, `TEST-MAT-GRANT` are `GRANT`. Sickness products (`SKN-SICK`, `SKN-STB-SICK`, `SICK_11`, …) sit in the same `SHORT_TERM` bucket. There is no `MATERNITY` category, confirmed in the live database.

**How Benefit Details fields are selected.** `BenefitDetailSection.tsx` picks a hard-coded field list from `CATEGORY_FIELDS[category]`, where `category` comes from `claim.bn_product.category` in `ClaimWorkbench.tsx`. Because the list is purely category-driven, `SHORT_TERM` shows sickness fields only — the four maternity keys are never rendered, even though the values exist in `raw_application_json.benefit_facts` for claim `ee7dc625` (product `SKN-MAT`, category `SHORT_TERM`).

**How product-specific applicability is already handled.** The intake side already has a product-aware mechanism: `normalizeBenefitKey(product.benefit_code)` in `sectionCatalogue.ts` resolves a product code to a benefit key (`SICKNESS`, `MATERNITY`, `EMPLOYMENT_INJURY`, …), and `BENEFIT_FIELDS.MATERNITY` already defines the exact four field codes required. The claim query (`claimService.ts`) already selects `bn_product(benefit_code, …)`, so the workbench has the product code available.

**Safest place to change.** Keep the category list as the base, and add a product-aware overlay in `BenefitDetailSection` driven by the benefit key resolved from the product code. No category changes, no new category, no migration.

## Changes

### 1. `src/lib/bn/fieldOwnership.ts`
- Add the four maternity fields with explicit ownership to both `SHORT_TERM` and `GRANT` maps (ownership lookup is category-keyed, and maternity products exist in both):
  - `expected_confinement_date` → `CITIZEN_SUBMITTED`
  - `actual_confinement_date` → `STAFF_REVIEW`
  - `maternity_leave_start` → `CITIZEN_SUBMITTED`
  - `maternity_leave_end` → `CITIZEN_SUBMITTED`
- Add the `work_related_confirmed` alias:
  - `SHORT_TERM.work_related` aliases → `['is_work_related', 'work_related_confirmed']`
  - `SHORT_TERM.is_work_related` aliases → `['work_related', 'work_related_confirmed']`
  - `INJURY`: add `work_related` / `is_work_related` entries (ownership `STAFF_REVIEW`) carrying the same `work_related_confirmed` alias, since the field lives in the `employment_injury_details` intake section.
- `STAFF_REVIEW_STATUSES` untouched.

### 2. `src/components/bn/workbench/BenefitDetailSection.tsx`
- Accept a new optional `productCode` prop.
- Add a `MATERNITY_FIELDS` list using the four exact keys, all `required: false`, type `date`.
- Resolve applicability with the existing `normalizeBenefitKey` from `sectionCatalogue.ts`; a small explicit maternity product-code set covers the codes the normalizer does not yet resolve (`MAT`, `MATERNITY_GRANT_TEST`, `SKN-MAT-GRANT`, `TEST-MAT-GRANT`). Only when the product resolves to maternity are the four fields appended to the category list.
- Sickness and every other `SHORT_TERM`/`GRANT`/`INJURY` product keeps exactly its current field list — nothing is removed and nothing maternity-specific is added.

### 3. `src/pages/bn/claims/ClaimWorkbench.tsx` (minimal wiring)
- Pass `productCode={product?.benefit_code}` into `BenefitDetailSection`.
- Extend the existing `factsAliased` merge so `work_related` falls back to `work_related_confirmed` / `is_work_related`, so an intake selection shows on the workbench checkbox for both short-term and injury claims.

## Verification
- `npx tsc --noEmit` exits 0.
- Claim `ee7dc625` (SKN-MAT) Benefit Details shows the four maternity dates: 01/07/2026, 31/07/2026, 01/08/2026, 31/01/2027.
- Expected Confinement Date, Maternity Leave Start, Maternity Leave End render with the Citizen badge and lock icon; Actual Confinement Date renders as Staff.
- `SKN-SICK` shows no maternity fields and no maternity required-field errors.
- A claim registered with Work-Related Confirmed shows the Work Related checkbox ticked in the workbench, for short-term and injury products.

No migration, no schema change, no category change, no other files touched.
