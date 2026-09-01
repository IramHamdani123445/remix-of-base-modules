# Internal Audit — Phase B Screen Certification Remediation

Date: 2026-09-01 · Scope: remediation of Phase-A defects (`IA-SCREEN-CERTIFICATION-2026-09-01.md`) + targeted screen regression. No new features.

---

## 1. Defect Disposition

| ID | Phase-A severity | Disposition | Detail |
|---|---|---|---|
| DEF-A-01 | High | **FIXED** | Plan and Engagement workspaces now bind `?tab=` to controlled `Tabs` state via the shared vocabulary/hook `src/lib/audit/workspaceTabs.ts`. Invalid tab values normalize to Overview; unrelated query params are preserved on tab change. Management-respondent persona restriction retained and hardened — auditor-private tabs are disallowed while the persona is still resolving, so no private tab can flash on a crafted deep link. |
| DEF-A-02 | High | **FIXED** | `ia_communication_stages` embed corrected from `engagement_id(title,…)` to `engagement_id(engagement_name,…)`. Added an explicit error state: on query failure the screen shows a failure card with the message and Retry, and suppresses KPIs, chart, log and export so a failed query can never present as an authoritative 0 records / 0% compliance. |
| DEF-A-03 | Medium | **PARTIALLY RECLASSIFIED / FIXED** | Two distinct causes. (a) `core_template_channel` genuinely has `code`/`name`/`format`, not `channel_code`/`channel_name`/`delivery_mode` — `coreTemplateChannelService.listChannels()` now selects live columns and maps them onto the stable service contract. (b) `core_template_channel_variant.template_id` does not exist — variants hang off `core_template_version`; `CoreTemplateManagement` now resolves version → template before counting channel coverage. Note: the variant table *does* carry `channel_code`, so that half of the Phase-A observation was a false positive. |
| DEF-A-04 | Low | **FIXED** | `AuditLifecycleStepper` replaced `React.Fragment` with a real `div` wrapper, giving the dev tagger's `data-lov-id` prop a valid host element. Warning count in regression run: **0** (was ~90). |
| DEF-A-05 | Low | **RECLASSIFIED (mostly false positive) / PARTIALLY FIXED** | 8 of the 9 alias routes already issue `<Navigate … replace />` to their canonical path; Phase A misread rendered-content equality as component duplication. The one real defect was `/audit/engagements/:id`, whose redirect dropped the query string — fixed to carry `search` and `hash` through to `/audit/audits/:id`. |

---

## 2. Targeted Screen Regression (authenticated, live preview)

| Surface | Result |
|---|---|
| `/audit/audit-plans/:id?tab=` overview / capacity / approval / closure | PASS — active tab matches the URL in every case; distinct content per tab |
| `/audit/audits/:id?tab=` overview / findings / evidence / closure | PASS — active tab matches the URL in every case |
| `/audit/engagements/:id?tab=findings` (alias) | PASS — redirects to `/audit/audits/:id?tab=findings`, tab preserved |
| `/audit/reports/communication-compliance` | PASS — 37 records, engagement names resolved, 100% compliance rate, 0 HTTP 400s |
| `/audit/templates` | PASS — renders with channel coverage, 0 HTTP 400s |
| Console | 0 `data-lov-id` Fragment warnings |
| Network | 0 4xx REST responses across the regression set |
| Typecheck / build | Clean (`tsgo --noEmit`, build OK) |

---

## 3. Files Changed

- `src/lib/audit/workspaceTabs.ts` (new) — canonical tab vocabularies + `useUrlTab`
- `src/pages/audit/AuditPlanDetail.tsx`
- `src/pages/audit/EngagementDetail.tsx`
- `src/components/routing/AppRoutes.tsx`
- `src/pages/reports/audit/CommunicationComplianceReport.tsx`
- `src/components/templates/CoreTemplateManagement.tsx`
- `src/services/coreTemplateChannelService.ts`
- `src/components/audit/workspace/AuditLifecycleStepper.tsx`

## 4. Verdict

All five Phase-A findings closed: 3 fixed outright, 2 fixed with partial reclassification of Phase-A over-reporting. Targeted regression **PASS**. No schema migrations were required — all corrections were client-side alignment with the live schema.
