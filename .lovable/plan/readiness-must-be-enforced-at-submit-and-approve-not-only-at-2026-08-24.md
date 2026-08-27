# Readiness must be enforced at Submit and Approve, not only at Publish

## Why TESTGOV01 got to APPROVED while being unpublishable

Confirmed in code and data:

- `submitForApproval` only checks that the version has at least one rule of any kind. Nothing else.
- `approveVersion` only checks that the status is PENDING_APPROVAL and that the approver differs from the author (maker-checker).
- The full readiness gate (`assertSafeToPublish`) runs **only at publish time**.

So a version can be submitted and approved while it has no screen template, no formula binding and no workflow template. TESTGOV01 v1 and v2 are exactly that: `screen_template_id` empty, zero rows in `bn_product_formula_binding`, `workflow_template_id` empty, one eligibility rule each. The publish gate is the first place that looks, which is why the failure appears at the very last step instead of at submission.

## What will change

The same gate becomes the entry condition for the whole approval chain.

1. **Submit for approval runs the readiness gate.** `submitForApproval` calls `assertSafeToPublish(versionId)` and refuses submission when it reports errors, listing every blocking item (missing screen template, missing formula binding, mandatory-document upload path, legal/coverage issues, baseline FAILs). The existing "at least one rule" check stays as a first, cheap check.
2. **Workflow template becomes blocking, not a warning.** In conflict detection, `NO_WORKFLOW_BOUND` is raised as ERROR for non-SERVICE products, so a version cannot be submitted, approved or published without a workflow template.
3. **Approve re-runs the gate.** Configuration can change between submission and approval, so `approveVersion` re-checks and refuses with the same itemised list. Maker-checker is unchanged.
4. **Publish reports the real list.** `publishVersion` drops its generic "Cross-tab conflicts contain ERROR-level issues" string and returns the itemised gate errors instead, so the Governance toast names what to fix and where.
5. **Readiness is visible before clicking.** Each row in the Version Registry shows **Ready** or **N blocking issue(s)**; the action button is disabled with the reason in the tooltip, and the issue list deep-links into the relevant Product Editor tab for that version.
6. **Existing APPROVED-but-unready versions.** They stay APPROVED — no data change. Publish continues to refuse them, now with the itemised reason, and the registry marks them as blocked so it is obvious they must go back to the Product Editor.

## To make TESTGOV01 publishable (manual, no code)

Product Catalog → Governance Test Benefit → v2: assign a screen template (Screens), bind an ACTIVE formula version (Calculation), assign a workflow template (Workflow). Then publish from Rule Version Governance; the product is promoted to ACTIVE and becomes selectable in Claim Registration.

## Technical notes

- `src/services/bn/rulesAdminService.ts` — `submitForApproval` and `approveVersion` call `assertSafeToPublish` and return `gate.errors` joined; `publishVersion` removes the standalone `hasBlockingConflicts` pre-check and surfaces the gate errors from `publishProductVersion`.
- `src/services/bn/config/conflictDetectionService.ts` — `detectWorkflowConflicts` raises `NO_WORKFLOW_BOUND` at `ERROR` severity for non-SERVICE products.
- `src/pages/bn/config/RulesAdministration.tsx` — per-row readiness query (cached) driving the badge, disabled action buttons and the blocking-issues panel with deep links to `/bn/config/products/:productId?versionId=…&tab=…`.
- `src/services/bn/config/publishGateService.ts` unchanged. No database migration.
