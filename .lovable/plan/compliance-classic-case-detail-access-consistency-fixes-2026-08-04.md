# Compliance Classic — Case Detail Access & Consistency Fixes

Scope: `src/pages/compliance/cases/CaseDetailView.tsx` and `src/components/compliance/CaseRequestActions.tsx`. No database or workflow-logic changes.

## Confirmed current state

- The case header action bar uses plain `Button` for Create Notice, Recommend Legal, Refer to Legal (Wizard), Quick Forward, Cascade Resolve, Create Payment Arrangement and Request Waiver. Visibility depends only on case status, outstanding balance and Legal linkage.
- `CaseRequestActions` (Closure / Reopen / Merge) already uses `PermissionButton` with module `manage_compliance` plus `isComplianceFeatureEnabled(...)` — this is the house pattern the header actions are missing.
- Assign / Reassign renders only when `useComplianceRole() === 'head'` (line 91/452), a raw role comparison rather than the capability model in `src/lib/compliance/capabilities.ts` (`useHasCapability`).
- Create Notice appears in the header only for non-closed cases, but the Notices tab renders its own Create Notice button with no status condition — the inconsistency reported.
- All five tabs (Violations, Notices, Arrangements, History, Timeline) render unconditionally; no `isComplianceFeatureEnabled` check.
- Merge request captures the target case as a free-text `Input` expecting a UUID.
- There is no Documents or Inspections summary on the case.

## Changes

### 1. Permission-wrap the header actions
Wrap each operational button in `PermissionButton` (module `manage_compliance`), keeping the existing status/data conditions as an additional gate:

| Action | actionName |
|---|---|
| Create Notice (header + Notices tab) | `create` |
| Recommend Legal | `edit` |
| Refer to Legal (Wizard) | `edit` |
| Quick Forward | `edit` |
| Cascade Resolve | `edit` |
| Create Payment Arrangement | `create` |
| Request Waiver | `create` |
| Add to / Remove from Inspection Planning | `edit` |

Read-only navigation (Back to Cases, Employer 360, View Legal Intake / Case, View breakdown) stays ungated.

### 2. Capability-based Assign / Reassign
Replace `complianceRole === 'head'` with `useHasCapability(COMPLIANCE_CAPABILITIES.CASES_MANAGE)` for the Assign/Reassign control, and use the same value for the inspection-nomination `canNominate` fallback (assigned officer OR capability holder). This keeps `useComplianceRole` only where an actual role label is displayed.

### 3. Consistent Create Notice rule
Apply the same closed-case condition (`RESOLVED`/`CLOSED`/`COMPLETED` hide it) to the Notices-tab button so header and tab agree.

### 4. Feature-flag the tabs
Gate tab triggers and their content with the existing compliance feature keys:
- Notices → `notices.generate`
- Arrangements → `arrangements.new`
- Violations / History / Timeline remain always visible (no matching keys; they are core case context).

Also gate the corresponding case-level actions with the same keys so a disabled feature hides both the tab and the action, matching the route guards.

### 5. Merge target: picker instead of UUID
Replace the free-text UUID input in `CaseRequestActions` with a searchable case selector: type a case number or employer name, query open compliance cases (excluding the current case), and submit the selected case's id. The user never sees or types a UUID; the selected case number is displayed for confirmation.

### 6. Clarify Quick Forward vs Legal Referral Wizard
Add short helper text under the two buttons (and tooltips) — Wizard: full 6-step referral with item selection, history and documents; Quick Forward: fast hand-off to Legal intake without item selection — so the choice is self-explanatory.

### 7. Documents and Inspections summary
Add two read-only tabs to the case:
- Documents — case-linked documents with name, type, uploaded date and a view action.
- Inspections — inspections/nominations for the case's employer with status, date and a link to the inspection record.

Both are read-only summaries reusing existing compliance services; no new mutations.

## Technical notes

- `PermissionButton` already passes admins through and disables with an explanatory tooltip, so behaviour degrades gracefully rather than hiding controls silently.
- No changes to `caseRequestsService`, workflow mapping resolution, or any RPC signature; only the merge dialog's input mechanism changes, still submitting `targetCaseId`.
- Tests: extend the compliance test suite with cases asserting that each header action is permission-wrapped, that Assign uses the capability hook, and that disabled feature keys hide their tab and action.
