# Fix Approval Console — Workbaskets (empty results and empty category filter)

## What is actually wrong

Both symptoms come from one broken data query, confirmed by reproducing it against the live database:

- The console asks for a claim field called `total_amount`, but the claim table has no such column. The backend rejects the whole request with an error ("column bn_claim_1.total_amount does not exist").
- Because the request fails, the console receives **zero** pending assignments. So:
  - Every workbasket shows "0 pending" and selecting one in the filter shows "No pending items".
  - The **Product category** dropdown is built from the loaded assignments, so it only shows "All categories".
- The failure is silent — the page has no error state, so it looks like there is simply no work.

There really are 61 open assignments right now (Intake Review 35, Award Setup 16, Payment Issue 6, Supervisor Approval 3, Eligibility Review 1). "Calculation Review" in the screenshot genuinely has none, but the other baskets should have shown items.

## Fix

1. **Repair the query** in the Approval Workbaskets Console: remove the non-existent `total_amount` field.
2. **Restore the amount column properly.** Claim monetary values live in the claim calculation record, not on the claim. Embed the latest calculation per claim and display an amount (monthly rate, falling back to weekly rate or lump sum). The "Min amount" filter uses this same value. Claims without a calculation show "—" and are only excluded when a minimum amount is actually entered.
3. **Product category filter** then populates automatically from the loaded data (INJURY, SHORT_TERM, GRANT, PENSION, ASSISTANCE, SURVIVOR, LONG_TERM).
4. **Add a visible error state** so a failed load shows a red inline message with the backend reason instead of a silently empty console.
5. **Assigned to**: currently prints a raw user id. Resolve it to the staff display name where available, otherwise "Unassigned".

## Technical notes

- File: `src/pages/bn/approval/ApprovalWorkbasketsConsole.tsx` (frontend only, no schema changes).
- Amount source: `bn_claim_calculation` (`monthly_rate` → `weekly_rate` → `lump_sum`), embedded from the claim and reduced to the most recent `calc_date` per claim.
- Surface `error` from both React Query hooks and render an alert card.
- No migrations required; grants and access on the involved tables are already in place.

## Verification

- Load `/bn/approval/workbaskets` in a signed-in browser session; confirm no 400 responses in the network log.
- Confirm the totals match the database: 61 pending across the 5 baskets that have work.
- Select "Intake Review" in the workbasket filter and confirm its 35 items render.
- Open the Product category dropdown and confirm the categories are listed and filtering narrows the rows.
