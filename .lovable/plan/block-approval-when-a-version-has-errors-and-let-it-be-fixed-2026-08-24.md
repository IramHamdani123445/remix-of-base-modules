# Block approval when a version has errors, and let it be fixed

## The problem, as it stands today

Two things are broken together on TESTGOV01:

1. Both versions (V1 and V2) are already sitting in **Approved** with no screen template and no workflow template. They were approved before the readiness gate existed at that step.
2. A version in **Approved** is **read-only** in the Product Editor, and there is no way to send it back to Draft. Reject only works from *Pending Approval*. So the version cannot be published (errors block it) and cannot be corrected (it is locked).

The result is a dead end: the operator sees "Publish failed", opens the editor, and everything is greyed out.

## What will change

### 1. Errors block approval (already in place, kept)
Submit, Approve and Publish all run the same readiness gate. A version with a missing screen template, no calculation binding or no workflow can no longer reach Approved.

### 2. A version with errors can always be returned to Draft
A new **Return to Draft** action becomes available in Rule Version Governance for versions in *Pending Approval* or *Approved*. It:
- Sets the version back to `DRAFT` so every editor tab unlocks
- Records the reason and who returned it in the audit trail
- Is the standard exit for the dead end above

For an *Approved* version this is only offered while it has not been published; a live (Active) version is never edited in place — it is cloned to a new draft, exactly as today.

### 3. The dead end is called out where it happens
- Governance rows already show "Ready to publish" or "N blocking issues". When there are blocking issues on a Pending/Approved version, the row offers **Return to Draft & Fix** next to the disabled action.
- The read-only banner in the Product Editor stops saying only "awaiting approval". When the version has blocking issues it names them and offers the same Return to Draft action inline, so the fix can start from the screen the user is already on.

### 4. Existing stuck versions
The two TESTGOV01 Approved versions are left as data — no silent status rewrite. Once the Return to Draft action exists, they can be unlocked from the UI in one click, the screen template and workflow assigned, then resubmitted through the normal path.

## Technical notes

- `src/services/bn/rulesAdminService.ts`: add `returnVersionToDraft(versionId, userCode, reason)`. Accepts `PENDING_APPROVAL` and `APPROVED` only; refuses `ACTIVE` and `ARCHIVED`. Writes `status='DRAFT'`, appends the reason to `description` (same convention `rejectVersion` uses), clears `approved_by`/`approved_at`, and logs `RULE_VERSION_RETURNED_TO_DRAFT` via `logRuleAudit`.
- `src/hooks/bn/useBnRulesAdmin.ts`: add `useBnReturnToDraft`, invalidating `['bn','rule-versions']`, `['bn','product-versions']` and `['bn','version-readiness']`.
- `src/pages/bn/config/RulesAdministration.tsx`: render the Return to Draft button for Pending/Approved rows (always available, highlighted when readiness fails), reusing the existing action sheet for the reason.
- `src/components/bn/smart/ReadOnlyVersionBanner.tsx`: accept optional `blockingIssues: string[]` and `onReturnToDraft`; when issues are present, list them and show the unlock CTA.
- `src/pages/bn/config/ProductEditor.tsx`: fetch the readiness report for the selected version and pass issues plus the return-to-draft handler into the banner. Editing itself stays DRAFT-only — no widening of write permissions.
- No database migration; the status column and audit table already support this.
