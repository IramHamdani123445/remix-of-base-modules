# Product Versions must respect Rule Version Governance decisions

## What is happening

Two screens act on the same record (`bn_product_version.status`):

- **Rule Version Governance** (`/bn/config/rules-administration`) — Submit → Approve → Publish. Approve sets the version to `APPROVED`, Publish sets it to `ACTIVE` and archives the previous active version.
- **Product Catalog → Product → Versions tab** — its own Submit / Approve / Reject / Retire buttons, where "Approve" publishes straight to `ACTIVE`.

Two defects follow from this:

1. The Versions tab only knows `DRAFT, PENDING_APPROVAL, ACTIVE, SUSPENDED, ARCHIVED`. `APPROVED` is unknown to it, so a version approved in Governance renders with a raw `APPROVED` badge and **no** action — the operator cannot see it is waiting to be published, and there is no route forward from that screen.
2. The versions list is a cached query (1 minute freshness). Governance's Approve action does not invalidate the product-versions cache, so after approving and returning to the product screen the row can still be painted as *Pending Approval* with **Approve / Reject** buttons — exactly what the screenshot shows. (Checked live: the version in the screenshot is already `ACTIVE` in the database; the screen is showing stale state.)

## What will change

**Governance is the single approval authority.** The Versions tab becomes status-aware and stops duplicating the approve/publish decision.

1. Add `APPROVED` to the product version status vocabulary (type + label + icon), so every screen renders it correctly.
2. In the Versions tab:
   - `DRAFT` — keep **Submit for approval** and **Copy rules**.
   - `PENDING_APPROVAL` — remove the local **Approve / Reject** buttons; show a **Review in Rule Version Governance** link to the governance screen filtered to this product.
   - `APPROVED` — show the "Approved — awaiting publish" badge and the same governance link. No local publish.
   - `ACTIVE` — keep **Retire** with its existing block reasons.
   - `ARCHIVED` / `SUSPENDED` — no actions (unchanged).
   - Update the explanatory note at the top of the tab to describe the DRAFT → PENDING_APPROVAL → APPROVED → ACTIVE flow and where approval happens.
3. Make Governance's Approve and Reject invalidate the `['bn','product-versions']` cache (Publish already does), so the product screen never shows a decision that has already been taken.
4. **Publishing from Governance must make the product usable for claim registration.** Claim Registration only lists products whose `bn_product.status = ACTIVE`, then resolves the version by claim date. The Product Editor publish path already promotes the product from DRAFT/PENDING_APPROVAL to ACTIVE and runs the pre-publish safety gates; the Governance publish path does neither — so a product published only from Governance stays invisible to claim intake. Governance publish will reuse the same publish routine as the Product Editor so both paths behave identically: validation + governance gates, archive the previous active version, activate the new one, and promote the product.

## Technical notes

- `src/types/bn.ts` — extend `BnProductStatus` and `BN_PRODUCT_STATUS_LABELS` with `APPROVED`.
- `src/components/bn/config/VersionHistoryTab.tsx` — status icon map, action column per state, governance deep link, updated helper text. The `APPROVE` / `REJECT` branches of `handleStatusAction` and their dialog entries are removed; `SUBMIT` and `RETIRE` stay.
- `src/hooks/bn/useBnRulesAdmin.ts` — add `qc.invalidateQueries({ queryKey: ['bn','product-versions'] })` to the approve and reject mutations.
- `src/services/bn/rulesAdminService.ts` — `publishVersion` delegates to `productService.publishProductVersion(versionId, effectiveDate)` (keeping the APPROVED-status precondition and its audit entries), instead of its own partial update. That brings the configuration-validation gate, catalogue-rule governance gate, previous-version archival and `bn_product` promotion to the Governance screen.
- No database changes.


## Verification

- Product with a `PENDING_APPROVAL` version: Versions tab shows no Approve/Reject, only the governance link.
- Approve in Governance, return to the product: row reads **Approved**, no approve action, publish only available in Governance.
- Publish in Governance: row reads **Active** with Retire; previous version reads **Archived** with a closed Effective To; the product shows **Active** in Product Catalog.
- Open Claim Registration: the just-published benefit is selectable, and step 5 resolves to the new version for a claim date on or after its effective-from date.
