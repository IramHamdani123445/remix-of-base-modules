# Why TESTGOV01 will not publish — and making the reason visible

## What is actually wrong

Publish is being refused correctly. TESTGOV01 (`Governance Test Benefit`) has two APPROVED versions (v1 and v2, both effective 2026-08-22) and neither is publishable:

1. **No screen template assigned.** Both versions have `screen_template_id` empty. Conflict detection raises an ERROR-level `NO_SCREEN_TEMPLATE` ("intake form cannot render"). That single ERROR is what triggers the message you saw.
2. **No formula binding.** Neither version has an active formula binding, so no benefit amount can be calculated. The publish gate blocks on this too (visible in the registry row as `0C`).
3. **No workflow template** (warning only, does not block).

So the product is genuinely not ready. The real defect is the *message*: Governance says only "Cross-tab conflicts contain ERROR-level issues. Resolve them on the Product Editor before publishing." It never says which issues, on which tab, or for which version — so there is no way to act on it from that screen.

## What will change

Governance keeps refusing an unsafe publish, but it will now tell the operator exactly what to fix.

1. **Report the real blocking list.** Replace Governance's own generic conflict pre-check with the full publish gate result: the toast/dialog lists every blocking item verbatim (missing screen template, missing formula binding, legal/coverage issues, channel readiness, baseline FAILs), with the Product Editor tab named for each.
2. **Pre-flight before the click.** On each APPROVED row in the Version Registry, run the same gate and show a **Ready to publish** / **N blocking issue(s)** indicator. Clicking the indicator opens a panel listing the issues, each with a deep link into the relevant Product Editor tab for that version.
3. **Disable Publish when not ready**, with the reason in the tooltip, instead of letting the operator click and receive an opaque failure.
4. No change to the gate itself, no relaxing of any rule, no database change.

## To publish TESTGOV01 (manual steps, no code involved)

- Product Catalog → Governance Test Benefit → version v2 → **Screens**: assign a screen template.
- **Calculation**: bind an ACTIVE formula version.
- Return to Rule Version Governance → Publish. The product will then be promoted to ACTIVE and become selectable in Claim Registration.
- Note v1 and v2 both carry effective-from 2026-08-22; publishing the second one will archive the first, which is the intended behaviour.

## Technical notes

- `src/services/bn/rulesAdminService.ts` — `publishVersion` drops its standalone `hasBlockingConflicts` pre-check and returns the joined `gate.errors` produced by `publishProductVersion` / `assertSafeToPublish` instead of the fixed string.
- `src/pages/bn/config/RulesAdministration.tsx` (Version Registry tab) — per-row readiness query calling `assertSafeToPublish(versionId)`, cached, rendered as a badge; Publish disabled when `ok === false`.
- New small component for the blocking-issues panel with deep links to `/bn/config/products/:productId?versionId=...&tab=screens|calculation|documents`.
- `src/services/bn/config/publishGateService.ts` — unchanged; already returns structured `errors` / `details`.
