# Benefits Claim Queue — workbasket visibility and routing proof

Executed 31 Aug 2026 against the running preview and the live database.
Screenshots: `docs/bn/screenshots/`.

## 1. Role scoping — an officer sees only their own baskets

Visibility is served by the `bn_workbaskets_for_user` RPC (direct, bundled and delegated
roles), which `/bn/queue` consumes through `useMyWorkbaskets`.

| User | Effective BN roles | Baskets returned |
| --- | --- | --- |
| benefits.officer@… (`7c63b96a…`) | BN_INTAKE_OFFICER, BN_ELIGIBILITY_OFFICER, BN_DOCUMENT_OFFICER, BN_CALCULATION_OFFICER, BN_CLAIMS_OFFICER | 7 of 27 — Intake Review, Eligibility Review, REVIEW_MEDICAL_CERTIFICATE, Document Review, Review Document, Calculation Review, Claim Recommendation |
| benefits.manager@… (`ae093689…`) | BN_AWARD_OFFICER, BN_MANAGER, BN_PRODUCT_MANAGER | 3 of 27 — Award Setup, Manager Approval, Product Governance |

Neither user is offered any other role's basket, so the scoping is per role, not global.

Note: a UI sign-in as these two officers could not be captured — minting a preview session
for a specific auth user requires workspace admin/owner rights, which the agent does not
hold. The scoping above is proved at the same RPC the screen calls.

## 2. Admin oversight — all baskets, work on behalf of every role

Screenshot: `queue-admin-all-baskets.png` (signed in as System Admin).

- The **All baskets** toggle is active by default for the oversight role.
- All 27 active workbaskets are listed with live counts: Intake Review 37 (4 overdue),
  Award Setup 16, Payment Issue 6, Supervisor Approval 3, Eligibility Review 1, rest 0.
- Award Setup (a `BN_AWARD_OFFICER` basket the admin does not personally own) opens with
  its 16 claims and a `Pick` action on every row — i.e. the admin can act for that role.
- "My Assigned Claims" separately shows the one claim picked by the admin.

## 3. Routing the three unrouted claims

The `Route` action calls the same `routeClaimToWorkbasket` service intake and status
transitions use: claim status → workflow step → product version + channel → workflow
template → step role → workbasket. It never guesses; a configuration gap is reported.

| Claim | Status | Before | Route result | After |
| --- | --- | --- | --- | --- |
| BN-2026-000001 | SUBMITTED | no assignment | UNROUTED — claim has no product version | no assignment |
| BN-2026-000002 | SUBMITTED | no assignment | UNROUTED — claim has no product version | no assignment |
| BN-20260827-05906 | INTAKE | no assignment | UNROUTED — "no workflow template is mapped to this product version and channel, so the product does not say which queue this claim belongs in" | no assignment |

Screenshot: `queue-route-unrouted-result.png` (the on-screen message for the third claim).

### Why they cannot be routed (configuration, not code)

Verified in the database:

- `BN-2026-000001` and `BN-2026-000002` (Sickness Benefit, `SKN-SICK`) have
  `bn_claim.product_version_id = NULL`. Routing is a property of the product version, so
  there is nothing to resolve from.
- `BN-20260827-05906` (Sickness 2027, `SICK_11`) points at product version 4
  (`f85ef311…`, ACTIVE). That version has no `bn_product_version_workflow` rows, no
  `workflow_template_id` on the version row, and both channel configs
  (`OFFLINE`, `ONLINE`) carry a NULL workflow template.

The routing engine behaved correctly — it reported the gap instead of dropping the claims
into an approximate basket. To clear them, either map a workflow template to Sickness 2027
version 4 (Product editor → Application Channels / workflow mapping) and re-run `Route`,
or attach a product version to the two legacy Sickness claims.

## Verdict

- Role-scoped visibility: **working** (per-role basket sets, live counts).
- Admin oversight across all roles: **working** (All baskets default, pick on any basket).
- Product-workflow-driven routing: **working**; the three remaining claims are blocked by
  missing product-version workflow configuration, not by the routing logic.
