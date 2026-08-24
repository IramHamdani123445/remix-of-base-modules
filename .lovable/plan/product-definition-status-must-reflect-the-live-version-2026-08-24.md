# Product Definition status must reflect the live version

## What is happening

For EIB_TEST_001 the Product Definition tab shows **Draft**, while the header badge shows Active and the helper text says "already live on v5".

Checked in the database: version 5 is `ACTIVE` (v1–v4 archived), but the product row `bn_product.status` is still `DRAFT`. The header badge is computed from the versions (`effectiveProductStatus`), whereas the **Status** dropdown in Product Definition is bound to the raw stored `form.status`. So the two disagree on the same screen.

This is not unique to this product: 2 products with an ACTIVE version still read `DRAFT`, and 1 reads `PENDING_APPROVAL`. 24 are correct. These are products published before the publish routine promoted the product row, or published via a path that did not promote it.

## What will change

1. **Product Definition Status becomes derived, not hand-set.**
   - When the product has an `ACTIVE` version, the field shows **Active**.
   - Otherwise, when the most advanced version is `APPROVED`, it shows **Approved (awaiting publish)**.
   - Otherwise it shows the product's own stored status.
   - In the derived cases the control is read-only with the existing explanation ("A product becomes Active by publishing a version"), so nobody can set a status that contradicts the versions, and saving an unrelated field cannot write `DRAFT` back over a live product.
   - When no version is approved or active, the dropdown stays editable exactly as today.

2. **Backfill the three inconsistent rows** so stored data matches reality: products with an `ACTIVE` version get `bn_product.status = 'ACTIVE'`. No other rows touched.

3. **Keep publishing as the single promotion authority** — no change to the publish routine; it already promotes the product.

## Technical notes

- `src/pages/bn/config/ProductEditor.tsx`: extend the existing `liveVersionNumber` memo with an `approvedVersionNumber` equivalent; reuse `effectiveProductStatus` for the Status control; render a disabled Select (or a Badge + note) when derived; ensure the save payload sends the derived status rather than the stale `form.status` for these products.
- One idempotent data migration: `UPDATE bn_product SET status='ACTIVE' WHERE status <> 'ACTIVE' AND EXISTS (active version)`.
- No schema change, no change to governance, readiness or publish logic.

## Verification

- Open EIB_TEST_001: Product Definition Status reads **Active**, matching the header badge, and cannot be edited by hand.
- A product whose newest version is `APPROVED` (not yet published) reads **Approved (awaiting publish)**.
- A brand-new product with only a draft version keeps an editable Status defaulting to Draft.
- Editing and saving the description of a live product leaves its status Active.
