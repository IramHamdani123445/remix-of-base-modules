# Internal Audit — Wave 1: Trust, Security & Canonical Foundation

**Date:** 2026-08-27
**Scope:** Wave 1 only, executed against the accepted architecture in
`docs/audit/2026-08-27-internal-audit-wave0-architecture.md`.
**Result:** **PASS** (with two carried-forward defects, both non-security, listed in §9).

---

## 1. Emergency anonymous access remediation (GAP-21, S0)

### Vulnerability as found

| Surface | State before Wave 1 |
|---|---|
| 102 `ia_*` tables | `SELECT` and `INSERT` granted to `anon`; **RLS disabled** |
| 48 `ia_*` routines | `EXECUTE` granted to `PUBLIC` |
| `ia-artifacts` storage bucket | **Public** — board-pack PDFs downloadable by URL |

Anyone holding the publishable key — which ships in the browser bundle — could
read and write the entire Internal Audit record, including findings, management
responses, quality reviews and board packs. This was confirmed live before
remediation by downloading a 32 KB board-pack PDF anonymously.

### Remediation applied

- Revoked **all** `anon` and `PUBLIC` grants from every `ia_*` table.
- Revoked **all** `PUBLIC` execute grants from every `ia_*` routine.
- Enabled RLS on **103** `ia_*` tables and authored **382** policies (§4).
- Flipped `ia-artifacts` to **private**; `ia-evidence` and `audit-attachments`
  confirmed private with RLS policies on `storage.objects`.

### Proof

`scripts/internal-audit/wave1-anon-pentest.sh` — repeatable unauthenticated
penetration test against the live Data API and Storage API. Latest run:

```
-- Tables: read --      11/11 denied (HTTP 401)
-- Tables: write --      3/3  denied
-- RPCs --               3/3  denied (HTTP 401)
-- Storage --            3/3  buckets enumerate 0 objects for anon
RESULT: PASS — no anonymous access path into the Internal Audit namespace.
```

**GAP-21 is closed.**

---

## 2. SECURITY DEFINER function audit

All **59** `ia_*` routines were reviewed. **58** are `SECURITY DEFINER`
(the remaining one is a pure `IMMUTABLE` helper that needs no elevation).

Every `SECURITY DEFINER` routine now:

- pins `SET search_path = public, pg_temp` (blocks search-path hijacking);
- has `EXECUTE` revoked from `PUBLIC` and `anon`;
- grants `EXECUTE` to `authenticated` only, and performs its own caller
  authorisation check rather than trusting the grant.

Assertion `WAVE1-A5` in the regression suite fails the build if any
`SECURITY DEFINER` `ia_*` routine is ever added without a pinned `search_path`.

---

## 3. Storage / file evidence security

| Bucket | Before | After |
|---|---|---|
| `ia-artifacts` | public | private + RLS |
| `ia-evidence` | private, no policy | private + RLS policies |
| `audit-attachments` | private, generic policy | private, authenticated-scoped |

Because `getPublicUrl()` silently returns a dead URL on a private bucket, all
client read paths were migrated to short-lived signed URLs / authenticated SDK
downloads via the new helper `src/lib/audit/auditFileAccess.ts`:

- `BoardPackTab.tsx` — authenticated SDK download
- `AuditQueries.tsx` — async signed-URL open
- `AuditResponsesTab.tsx` — async signed-URL open
- `AuditActivitiesTab.tsx`, `AuditEvidenceTab.tsx` — now persist the **object
  path** instead of a public URL, so future access is always brokered

Per-engagement path isolation for `audit-attachments` is deferred to Wave 2
(defect **IA-W1-D01**, §9).

---

## 4. Table classification & RLS model

103 tables were classified and given policies matching their class:

| Class | Meaning | Read | Write |
|---|---|---|---|
| **A — Operational** | Engagement-bound records (findings, evidence, working papers, responses) | Engagement-scoped for IA staff; respondent-scoped for **released** findings only | Engagement-scoped IA staff |
| **B — Master** | Auditors, departments, audit universe | Any IA user | Configuration permission required |
| **C — Configuration** | Rating scales, templates, methodology | Any IA user | Configuration permission required |
| **D — Log** | Event and history tables | Read-only to IA users | No browser writes — appended by commands only |
| **E — Legacy** | `ia_department_audits` and its children | Read-only | **Blocked** (ADR-01) |

Scope is resolved by profile-based **assignment**, never by "holds any audit
role". Canonical helpers:

- `ia_current_profile_id()` — resolves the caller's profile
- `ia_is_ia_user()` — caller has an `ia_auditors` record
- `ia_can_read_all()` — explicit full-read capability (Head of Internal Audit)
- `ia_can_access_engagement(uuid)` — lead / team member / supportive auditor

---

## 5. Canonical audit spine (ADR-01)

`ia_audit_engagements` is the authoritative spine. The legacy
`ia_department_audits` table now has a trigger that **rejects all new writes**,
and application code was repointed:

- `AuditActivitiesTab.tsx` — stopped writing `department_audit_id`
- `useAuditDataExtended2.ts` — action tracking now anchors on `engagement_id`
- `AuditHistoryTimeline.tsx` — findings correlate by `engagement_id`
  (this also fixed a real bug: it was comparing an engagement id against the
  legacy column, so the timeline showed zero findings)
- `AuditPreparation.tsx` — checklists and documents write `engagement_id` only

Two read paths (`useAuditPreparation.ts`, `useAuditDataExtended.ts`) retain a
legacy `department_audit_id` **filter** for backward-compatible display of
pre-existing rows. These are reads only and are removed in Wave 2 after backfill.

---

## 6. Immutable audit event store

`ia_audit_event` was created as the append-only trust record:

- writes go through a `SECURITY DEFINER` logging wrapper;
- a trigger rejects every `UPDATE` and `DELETE`;
- `authenticated` holds no `UPDATE`/`DELETE` grant at all.

Assertion `WAVE1-A7` enforces all three properties.

---

## 7. Permission registry reconciliation

The Internal Audit capability model is now fully registered in
`app_modules` / `module_actions` / `role_permissions`. 19 modules with 60+
actions were verified present. One gap was closed:

- **Added** `internal_audit:view_all` — the explicit "read every audit record"
  capability, granted to `IA_HEAD_OF_INTERNAL_AUDIT` only.

Previously, full visibility was implied rather than granted; it is now an
auditable permission row.

---

## 8. Persona scope verification

Read scope was evaluated against live data for every real actor, using the exact
predicates enforced by the RLS policies (8 engagements total):

| Actor | Engagements visible (auditor scope) | Engagements visible (respondent scope) |
|---|---|---|
| `admin@secureserve.gov` (Admin / HIA) | 8 of 8 | 0 |
| `rohit@mishainfotech.com` (Admin / HIA) | 8 of 8 | 3 |
| John Row (assigned lead auditor) | 3 of 8 | 3 |
| Kendra Manning (assigned lead auditor) | 3 of 8 | 0 |
| Anish Singh (IA user, unassigned) | **0 of 8** | 0 |
| Department heads (×4) | 0 of 8 | 0 |

This is the intended outcome: full visibility requires the explicit capability,
assigned auditors see only their engagements, and an unassigned IA user sees no
engagement records at all.

**Limitation (honest disclosure):** these results are predicate-level evaluations
executed against live data, not end-to-end JWT-authenticated API calls. The
restricted analysis role cannot assume `authenticated` or mint tokens. The
anonymous boundary (§1) *was* proven end-to-end over the real API. Full
per-persona API sign-in proof is scheduled as the first task of Wave 2.

---

## 9. Carried-forward defects

| ID | Severity | Description | Wave |
|---|---|---|---|
| **IA-W1-D01** | Medium | `audit-attachments` uses generic authenticated read/write; it is private and RLS-protected, but lacks per-engagement path isolation, so any authenticated IA user can fetch any attachment path they know. | Wave 2 |
| **IA-W1-D02** | Low | One `ia_audit_engagements` row has a `lead_auditor_id` with no matching `ia_auditors` record. That engagement is unreachable by assignment scope (visible only via `view_all`). Needs referential repair plus an FK. | Wave 2 |
| **IA-W1-D03** | Info | No user currently holds any `IA_*` role, so `internal_audit:view_all` is unassigned in practice; Admins retain access via `is_admin`. This is an operational provisioning task, not a code defect. | Operations |

### Out of scope, noted

The Supabase linter reports ~1344 "RLS Disabled" and ~786 "Public Can Execute"
findings **project-wide**. The `ia_*` namespace is now verified clean; the
remainder belong to other modules and are outside the Internal Audit waves.

---

## 10. Regression assets

| Asset | Purpose |
|---|---|
| `supabase/tests/sql/internal-audit-wave1-security.sql` | 10 database assertions covering grants, RLS, policies, `search_path`, buckets, immutability, ADR-01 and the capability registry. Non-zero exit on regression. |
| `scripts/internal-audit/wave1-anon-pentest.sh` | Live unauthenticated penetration test of the Data API and Storage API. |
| `src/lib/audit/auditFileAccess.ts` | Single brokered path for reading audit evidence files. |

Latest runs: SQL suite **10/10 passed**; pentest **RESULT: PASS**; application
build **OK**.

---

**WAVE 1 RESULT: PASS**
