# Internal Audit — Phase C Screen-by-Screen Functional / Unit-Style Certification

**Date:** 2026-09-02
**Scope:** Functional and unit-style certification of the 33 canonical screens / 75 certifiable surfaces frozen in Phase A and remediated in Phase B.
**Explicitly out of scope:** Full multi-persona business E2E (deferred to a later phase, per instruction).
**Environment:** preview (`localhost:8080`), Lovable Cloud backend, authenticated admin session.
**Fixture namespace:** `IA-UT-20260902-` (all rows created by this phase carry this prefix and are traceable/removable by it).

---

## 1. Certification Method

Three independent layers, each producing machine-checkable evidence:

| Layer | What it certifies | Evidence |
|---|---|---|
| **L1 — Deterministic unit tests** | Pure business logic: tab vocabularies, risk scoring bands, capacity arithmetic, compensating rollback | `bunx vitest run src/lib/audit/__tests__` — 39 tests, 4 files, all passing |
| **L2 — Authenticated surface pass** | Every canonical screen, alias route and workspace tab renders with real fixture data, returns no HTTP ≥400, no console error, no Access Denied / Under Activation | `/tmp/browser/ia-phase-c/result.json` — 75 surfaces |
| **L3 — Database governance probes** | Capability gating, grant surface, RLS posture across all 118 `ia_*` tables | Live catalogue queries + `supabase/verify/ia_business_convergence_security_closure.sql` |

---

## 2. Fixture Estate Created

A complete, self-consistent audit estate was seeded so that screens are certified against **populated** state, not empty states:

| Entity | Count | Notes |
|---|---|---|
| Departments | 2 | `DEPT-A` (High), `DEPT-B` (Medium) |
| Business functions | 3 | High / Medium / Low, spread across both departments |
| Auditors | 2 | One Lead (Senior), one Team Member (Junior) |
| Risk register entries | 3 | 5×5 (Critical), 3×3 (Medium), 1×1 (Low) — deliberately spanning three bands |
| Risk assessment | 1 | Linked to `FN-A1` |
| Annual plan | 1 | FY2027, Draft, fully populated narrative fields |
| Audit engagements | 5 | One per quarter plus one `In Progress`, risk ratings Critical→Low |
| Activity | 1 | Under the in-progress engagement |
| Finding | 1 | High severity, Draft lifecycle, traced to activity + engagement + plan |
| Time log | 1 | 6h fieldwork |
| Leave request | 1 | Approved, overlapping a Q1 engagement (capacity-conflict fixture) |

The plan renders as **"Engagements (5)"** and the engagement workspace renders **Activities 1 / Findings 1 / Responses 1**, confirming the fixtures are reaching the UI through the real read models rather than being masked by empty states.

---

## 3. L1 — Unit-Style Certification Results

New suites added in this phase:

### `src/lib/audit/__tests__/workspaceTabs.test.ts` (8 tests)
- Freezes the Plan (10) and Engagement (14) tab vocabularies and their order — the counts certified in Phase A can no longer drift silently.
- No duplicate keys in either vocabulary.
- Management-respondent surface is restricted: `evidence`, `working-papers`, `quality-review`, `closure`, `programme` are provably *not* reachable by an audited department.
- Normalization contract: unknown, empty, `null`, `undefined` and case-variant tab values all fall back to `overview`; explicit fallbacks are honoured; **vocabularies do not leak across workspaces** (`portfolio` never resolves in the engagement workspace, `evidence` never resolves in the plan workspace).

### `src/lib/audit/__tests__/riskEngine.test.ts` (17 tests)
- Label→score mapping for all five canonical labels; unknown labels degrade to Medium rather than throwing.
- All three formulas (`likelihood_x_impact`, `likelihood_plus_impact`, `weighted_average`) plus unknown-formula fallback.
- **Every band boundary asserted explicitly**: 1/5 Low, 6/10 Medium, 11/15 High, 16/25 Critical.
- Out-of-scale scores (0, 26) return `Unknown` instead of a guessed band.
- The default band set is proven gap-free and overlap-free.
- Custom (configuration-driven) bands override defaults correctly.

### `src/lib/audit/__tests__/capacityPlanner.test.ts` (9 tests)
- Capacity arithmetic verified against hand-computed values (5 auditors → 9,600 gross / 8,160 effective / 816 buffer / 7,344 net / 1,836 per quarter).
- Zero-auditor division-by-zero guard: no `NaN` escapes.
- `getEngagementHours` precedence (hours over days×8) and zero-fallback.
- Quarter extraction always returns four quarters, excludes inactive engagements, and counts High+Critical as high-risk.
- Overload detection produces a finite utilization percentage and raises warnings.
- Quarter suggestion avoids the already-loaded quarter.

**L1 result: 39/39 passing.**

---

## 4. L2 — Surface Certification Results

75 surfaces exercised with the fixture estate loaded:

| Group | Surfaces | Result |
|---|---|---|
| Canonical screens | 31 | PASS |
| Alias routes | 8 | PASS |
| Plan workspace tabs (`?tab=`) | 10 | PASS — each tab distinct |
| Engagement workspace tabs (`?tab=`) | 14 | PASS — each tab distinct |
| Action Centre tabs (`?tab=`) | 9 | PASS — each tab distinct |
| Invalid-tab fallback (plan + engagement) | 2 | PASS — both fall back to Overview |
| Alias deep link (`/audit/engagements/:id?tab=findings`) | 1 | PASS — search params preserved |

Aggregate assertions:
- **0** crashes, **0** blank renders, **0** "Access Denied", **0** "Under Activation".
- **0** HTTP responses ≥400 across the entire pass.
- **0** console errors (after the DEF-C-02 fix below).
- Tab uniqueness: 10 distinct plan renders from 10 tab values, 14 distinct engagement renders from 14 tab values, 9 distinct Action Centre renders — confirming the Phase-B DEF-A-01 remediation holds under real data and did not regress.
- Live counts observed on tab labels (`Engagements (5)`, `Activities 1`, `Findings 1`, Action Register 19, Findings Register 23, Closure Readiness 59) prove the tabs bind to live queries, not placeholders.

---

## 5. L3 — Governance / Security Probes

| Probe | Result |
|---|---|
| `ia_business_convergence_security_closure.sql` (portfolio capability gating, private core helpers, OVER-BROAD reconciliation) | **PASSED** |
| RLS enabled across `ia_*` tables | 117/118 enabled; the single exception (`ia_prior_action_reference`) carries **no** client grants at all and is reachable only through governed RPCs — the intended design |
| Tables with RLS enabled but zero policies (silent lockout risk) | **0** |
| Surplus `anon` table grants | **14 found → 0 remaining** (see DEF-C-01) |

---

## 6. Defects Found and Closed in Phase C

| ID | Severity | Area | Finding | Disposition |
|---|---|---|---|---|
| **DEF-C-01** | Medium (security hygiene) | Database grants | 14 `ia_*` tables carried full `arwdDxtm` grants to the `anon` (signed-out) role. RLS was enabled on all 14 and **no policy targeted `anon`**, so the estate was fail-closed in practice — but the grant surface was unnecessary and would have become live exposure the moment any permissive policy was added. | **Fixed.** `REVOKE ALL … FROM anon` on all 14 tables. Verified: 0 `ia_*` tables now grant `anon`. Surface pass re-run afterwards — 75/75 still passing, confirming zero functional impact. |
| **DEF-C-02** | Low | `RiskMatrix`, `AuditReportWorkflowBar` | Two residual `React.Fragment` / `data-lov-id` console-warning sites survived the Phase-B DEF-A-04 fix. | **Fixed.** Replaced with `<div className="contents">` wrappers, which satisfy the dev tagger without altering the CSS grid / flex layout (a plain `div` would have broken the 6-column risk matrix). Console-error count is now **0** across all 75 surfaces. |

No High or Critical functional defects were found in Phase C.

---

## 7. Phase C Verdict

| Dimension | Result |
|---|---|
| Unit-style logic certification | **PASS** — 39/39 |
| Surface functional certification (with data) | **PASS** — 75/75 |
| Tab deep-link / fallback contract | **PASS** |
| Governance & grant posture | **PASS** after DEF-C-01 remediation |
| Defects raised | 2 (1 Medium, 1 Low) — **both closed and re-verified** |

**Phase C status: CERTIFIED.**

Full E2E business certification (multi-persona, cross-lifecycle) remains deliberately un-started, per scope.

---

## 8. Coverage Honesty Statement

This phase certifies: render integrity, data binding, tab/route contracts, calculation correctness, and grant/RLS posture. It does **not** certify: multi-persona authorization behaviour under non-admin sessions, maker-checker workflow traversal, communication dispatch, or document generation — all of which belong to the E2E phase and are explicitly excluded here rather than assumed passing.
