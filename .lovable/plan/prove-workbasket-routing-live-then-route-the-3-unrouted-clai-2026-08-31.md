# Prove workbasket routing live, then route the 3 unrouted claims

## Goal

Demonstrate, with real sign-ins and screenshots, that:
1. An officer sees only the claims their role is responsible for.
2. An admin sees every workbasket and can act on behalf of all roles.
3. The `Route` action places a claim into the workbasket defined by its product's workflow.

## Steps

### 1. Officer proof (read-only)
Sign the preview in as an officer account (e.g. the `BN_INTAKE_OFFICER` user), open `/bn/queue`, and capture:
- the basket list (only their role's baskets, with live counts),
- the auto-selected basket and its claim list.
Repeat for a second role (Eligibility or Award Setup) to show the scoping differs per role.

### 2. Admin proof (read-only)
Sign in as the admin account, open `/bn/queue`, and capture:
- the "My / All baskets" toggle defaulting to All baskets,
- every active basket listed with counts,
- a claim opened from a basket the admin does not personally own.

### 3. Route the 3 unrouted claims (data change)
For BN-2026-000001, BN-2026-000002 and BN-20260827-05906, use the `Route` action in the
Unrouted Claims panel — the same path a user takes, so the product workflow decides the
target basket. For each claim, record before/after: claim status, resolved workflow step,
target basket, and the created `bn_claim_queue_assignment` row. Screenshot the claim
appearing in its new basket.

### 4. Evidence
Write the screenshots and the before/after routing table to
`docs/bn/workbasket-routing-proof.md`.

## Not in scope

- No code changes unless the run exposes a defect. If one appears, I stop and report it
  with the evidence rather than fixing it silently.
- No workbasket, workflow or product configuration changes.
- No changes to role assignments.

## Technical detail

Verification is driven through the running preview with Playwright using minted preview
sessions; database reads use read-only queries against `bn_claim`,
`bn_claim_queue_assignment`, `bn_workbasket` and `v_bn_user_effective_roles`. The only
writes are the three routing actions performed through the UI.
