# Two screens, two different answers: make readiness one truth

## What is actually happening on TESTGOV01 v2

Confirmed in the data: version 2 is `DRAFT`, has a screen template, a workflow template and 2 active eligibility rules — but **zero active formula bindings**.

That single fact explains both symptoms:

- **Rule Version Governance** shows "1 blocking issue". Its badge comes from the full publish gate, which requires at least one active formula binding ("no benefit amount can be calculated").
- **The Product Editor panel shows "0 error"**. That panel only runs cross-tab conflict detection, and conflict detection has no rule at all for a missing calculation binding. It is not wrong, it is answering a narrower question — but the heading reads like a clean bill of health.
- **Submit is disabled** in Governance because the same gate now guards Submit/Approve/Publish. Nothing was "already submitted": the version is still `DRAFT`, so the disabled Submit is the gate refusing, not a stale state.

So the product cannot be submitted until an ACTIVE formula version is bound on the Calculation tab, and today nothing on the Product Editor says so.

## What will change

### 1. The Product Editor shows the same readiness verdict as Governance
Above the conflict panel, the editor gains a **Version Readiness** summary driven by the same publish gate used by Submit / Approve / Publish. It lists every blocking item verbatim (missing formula binding, missing screen or workflow template, legal/coverage failures, baseline FAILs) with a link into the tab that fixes it. Cross-tab conflict detection stays where it is, retitled so it no longer reads as the overall verdict.

### 2. A missing calculation binding becomes a real conflict
Conflict detection gains `NO_CALCULATION_BINDING` at ERROR severity for non-SERVICE products, so the "0 error" panel can never again claim clean while the gate blocks. The gate keeps its own independent check.

### 3. The Governance badge says what the issue is
The "1 blocking issue" chip is clickable/hoverable to the itemised list (the list already exists in the detail sheet); the row's disabled Submit gets a tooltip naming the first blocking item instead of only being greyed out.

### 4. Nothing is auto-fixed
No data change for TESTGOV01. To make v2 submittable: Product Catalog → Governance Test Benefit → v2 → Calculation → bind an ACTIVE formula version. Both screens then read "Ready to publish" and Submit enables.

## Technical notes

- `src/hooks/bn/useVersionReadiness.ts` (new): shared `useQuery` wrapper over `assertVersionReadiness(versionId)`, key `['bn','version-readiness',versionId]` — same key Governance already uses, so both screens share one cache entry.
- `src/pages/bn/config/ProductEditor.tsx`: render the new readiness summary for the selected version, above `ConflictDetectionPanel`, reusing the existing `onJumpToTab` handler for deep links.
- `src/components/bn/config/VersionReadinessPanel.tsx` (new): presentational; ok/blocked state, issue list, per-issue tab link.
- `src/components/bn/config/ConflictDetectionPanel.tsx`: title becomes "Cross-Tab Consistency Checks" and the empty state says "no cross-tab conflicts — see Version Readiness for publish eligibility".
- `src/services/bn/config/conflictDetectionService.ts`: add `detectCalculationConflicts` raising `NO_CALCULATION_BINDING` (ERROR, tab `Calculation`) when no active `bn_product_formula_binding` exists for a non-SERVICE product.
- `src/pages/bn/config/RulesAdministration.tsx`: tooltip on the readiness chip and on the disabled Submit button.
- No database migration.
