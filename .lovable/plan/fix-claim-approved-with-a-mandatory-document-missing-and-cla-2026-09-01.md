# Fix: claim approved with a mandatory document missing, and Claim Queue hidden for Benefits Manager

Not yet implemented — this plan is awaiting approval.

## Issue 1 — BN-20260901-19059 approved with DOC-002 outstanding (verified)

The checklist row for DOC-002 on that claim reads:

```text
status = OUTSTANDING, is_blocking = false
requirement: DOC-002, requirement_level = MANDATORY,
             blocks_decision = true, blocks_submission = false
```

Every approval control (`approvalPreconditions.ts`, `isEvidenceComplete`,
the workflow runtime) filters on `is_blocking = true`, so the row was invisible
and approval passed while the badge showed "Evidence Complete".

Root cause: the database function `bn_submit_claim_application` creates the
checklist with

```sql
is_blocking = COALESCE(dr.blocks_submission, true)
```

It ignores `requirement_level = MANDATORY` and `blocks_decision`. DOC-002 only
blocks the decision, not submission, so it was written as non-blocking. This is
not a one-off: 653 checklist rows carry `is_blocking = false` today.

A second, smaller defect: when a document is verified, the service writes
checklist status `FULFILLED`, but `approvalPreconditions` treats only
`VERIFIED`/`WAIVED` as satisfying — a genuinely verified document can still read
as unmet.

## Issue 2 — Claim Queue menu missing for benefits.manager@ (verified)

The user holds `BN_MANAGER`, `BN_PRODUCT_MANAGER`, `BN_AWARD_OFFICER`.

- The sidebar entry "Claim Queue" still requires the legacy module
  `benefits_management`, while the page itself was already migrated to guard on
  `bn_claim_queue`.
- Neither `benefits_management` nor `bn_claim_queue` is granted to `BN_MANAGER`,
  so even with the menu fixed the page would deny. Roles currently granted
  `bn_claim_queue`: Admin, BN_INTAKE_OFFICER, BN_CLAIMS_OFFICER,
  BN_ELIGIBILITY_OFFICER, BN_CALCULATION_OFFICER, BN_SENIOR_ELIGIBILITY_OFFICER,
  BN_SUPERVISOR, BN_DOCUMENT_OFFICER, BN_AUDITOR.

## Changes

### Database (migration)
1. `BEFORE INSERT` trigger on `bn_evidence_checklist` that forces
   `is_blocking = true` whenever the requirement is `MANDATORY`, or sets
   `blocks_decision`/`blocks_submission`. This fixes every insert path at once
   (the submit RPC and the three service-side generators) without rewriting the
   216-line submission function.
2. Data repair: set `is_blocking = true` on existing rows that are still
   outstanding/pending/rejected and whose requirement is mandatory or
   decision-blocking. Rows already FULFILLED/VERIFIED/WAIVED are untouched.

### Database (data change)
3. Grant `bn_claim_queue` and `bn_claim_worklist` view/edit permissions to
   `BN_MANAGER` so managers can open the queue and approve from their basket.

### Frontend
4. `src/services/bn/claims/approvalPreconditions.ts` — stop trusting
   `is_blocking` alone: join `bn_doc_requirement` and treat any mandatory or
   decision-blocking requirement as a gate; accept `FULFILLED` alongside
   `VERIFIED`/`WAIVED` as satisfying.
5. `src/services/bn/evidenceService.ts` — `isEvidenceComplete` applies the same
   rule, so the "Evidence Complete" badge and the transition engine agree with
   the approval gate.
6. `src/components/sidebar/menuItems/bnMenuItems.ts` — point "Claim Queue" at
   `bn_claim_queue` and "Claim Worklist" / "My Workbench" at
   `bn_claim_worklist`, matching the page guards.

## Verification

- Re-open BN-20260901-19059: the Documents panel shows DOC-002 as blocking and
  the "Evidence Complete" badge is gone.
- Attempt APPROVE on a claim with an outstanding mandatory document: refused
  with "Birth certificate is not verified".
- Register a new claim through submission: its mandatory checklist rows are
  created blocking.
- Sign in as benefits.manager@mishainfotech.com: Claim Queue appears in the
  sidebar and opens without Access Denied.

## Not in scope

- No change to how documents are uploaded, verified or waived.
- No change to already-approved claims' statuses; BN-20260901-19059 stays as it
  is unless you want it sent back for rework (say so and I will add that).
