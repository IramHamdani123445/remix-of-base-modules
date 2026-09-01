# Internal Audit — Screen-by-Screen Functional Certification

**Phase A — Test & Inventory Only (no remediation performed)**
Date: 2026-09-01 · Persona: System Admin (`admin@secureserve.gov`) · Environment: preview (localhost:8080)

---

## 1. Canonical Screen Count

| Category | Count |
|---|---|
| Canonical screens (unique pages) | **33** |
| Alias routes redirecting/duplicating a canonical screen | 9 |
| Workspace tabs inside tabbed hosts | 33 |
| **Total certifiable surfaces (screens + tabs)** | **66** |

Breakdown of the 33 canonical screens:

| # | Screen | Canonical route | Alias route(s) |
|---|---|---|---|
| 1 | Audit Dashboard | `/audit/dashboard` | — |
| 2 | Department Master | `/audit/departments` | `/audit/universe` |
| 3 | Risk Register | `/audit/risk-register` | — |
| 4 | Business Function Master | `/audit/functions` | — |
| 5 | Risk Assessment | `/audit/risk-assessment` | — |
| 6 | Entity Risk Summary | `/audit/entity-summary` | — |
| 7 | Risk Matrix | `/audit/risk-matrix` | — |
| 8 | Annual Plans Register | `/audit/audit-plans` | `/audit/plans` |
| 9 | Audits (Engagements) Register | `/audit/audits` | `/audit/engagements` |
| 10 | Action Centre (tabbed host, 9 tabs) | `/audit/action-centre` | `/audit/action-center`, `/audit/actions` |
| 11 | Escalation Roles | `/audit/escalation-roles` | — |
| 12 | Follow-Up Tracker | `/audit/follow-up-tracker` | — |
| 13 | Report Centre | `/audit/audit-reports` | `/audit/reports` |
| 14 | Report Builder | `/audit/report-builder` | — |
| 15 | Plan Approval | `/audit/plan-approval` | — |
| 16 | Audit Configuration | `/audit/config` | — |
| 17 | Access Matrix | `/audit/access-matrix` | — |
| 18 | Risk Configuration | `/audit/risk-settings` | — |
| 19 | Document & Output Settings | `/audit/document-templates` | — |
| 20 | Audit Queries | `/audit/queries` | — |
| 21 | Auditor Profiles | `/audit/auditors` | `/audit/auditor-profiles` |
| 22 | Workload & Capacity | `/audit/workload` | — |
| 23 | Time Tracking | `/audit/time-tracking` | — |
| 24 | Auditor Leave | `/audit/leave` | — |
| 25 | User Manuals | `/audit/user-manuals` | `/audit/manuals` |
| 26 | Communication Templates (Audit view) | `/audit/templates` | — |
| 27 | Report — Engagement Summary | `/audit/reports/engagement-summary` | — |
| 28 | Report — Communication Compliance | `/audit/reports/communication-compliance` | — |
| 29 | Report — Plan Slippage | `/audit/reports/plan-slippage` | — |
| 30 | Report — Overdue Actions | `/audit/reports/overdue-actions` | — |
| 31 | Report — Carry-Forward Aging | `/audit/reports/carry-forward-aging` | — |
| 32 | Annual Plan Workspace (tabbed host, 10 tabs) | `/audit/audit-plans/:id` | — |
| 33 | Audit/Engagement Workspace (tabbed host, 14 tabs) | `/audit/audits/:id` | `/audit/engagements/:id` |

Tab inventory:
- **Plan Workspace (10):** overview, portfolio, engagements, coverage, capacity, autoplan, approval, boardpack, distribution, closure.
- **Engagement Workspace (14):** overview, preparation, programme, activities, control-tests, evidence, working-papers, findings, responses, actions, follow-ups, quality-review, timeline, closure.
- **Action Centre (9):** my-work, management, attention, register, findings, verification, followup, qa, closure.

---

## 2. Test Method

Automated authenticated browser pass (Playwright, admin session) over all 66 surfaces. For each surface: page render, visible content, empty-state vs error-state, console errors, and failing network responses were captured. Evidence: `/tmp/browser/ia-cert/result.json`.

**Result:** 66/66 surfaces rendered. 0 crashes, 0 blank screens, 0 "Access Denied", 0 "Under Activation" placeholders for the admin persona.

---

## 3. Gap Register

| ID | Severity | Screen(s) | Observation | Evidence |
|---|---|---|---|---|
| DEF-A-01 | **High** | Plan Workspace (`/audit/audit-plans/:id`), Engagement Workspace (`/audit/audits/:id`) | `?tab=` deep links are ignored — every tab value renders Overview. `AuditPlanDetail.tsx:210` uses `<Tabs defaultValue="overview">` and `EngagementDetail.tsx:176` uses `useState('overview')`, neither reads `useSearchParams`. Action Centre navigates to `/audit/audits/{id}?tab=findings`, so cross-screen drill-down lands on the wrong tab. | All 24 tab URLs returned byte-identical Overview content (1849 / 2834 chars). |
| DEF-A-02 | **High** | Report — Communication Compliance | Two HTTP 400s: `ia_communication_stages?select=*,engagement:engagement_id(title,status)` → `42703 column ia_audit_engagements_1.title does not exist`. The correct column is `engagement_name`. Screen silently shows 0 records / 0% compliance instead of surfacing the failure. | Network capture. |
| DEF-A-03 | **Medium** | Communication Templates (`/audit/templates`) | Two HTTP 400s: `core_template_channel.channel_code does not exist` and `core_template_channel_variant.template_id does not exist` — the Audit template view queries columns that are not in the current Core Template schema. | Network capture. |
| DEF-A-04 | **Low** | Engagement Workspace (all tabs) | React warning repeated ~90×: `Invalid prop 'data-lov-id' supplied to React.Fragment` originating in `AuditLifecycleStepper`. Cosmetic but noisy; indicates a Fragment used where a wrapper element is required. | Console capture. |
| DEF-A-05 | **Low** | Route surface | 9 alias routes duplicate canonical screens without redirecting (`/audit/plans`, `/audit/reports`, `/audit/engagements`, `/audit/actions`, `/audit/action-center`, `/audit/universe`, `/audit/auditor-profiles`, `/audit/manuals`, `/audit/engagements/:id`). They render the same component rather than issuing a canonical redirect, so breadcrumbs and analytics fragment. | Identical body content per alias pair. |
| OBS-A-06 | Info | Risk Register, Time Tracking, Plan Approval (pending queue), Communication Compliance, Carry-Forward Aging | Legitimate empty states with correct guidance copy — not defects, but these surfaces carry no business data in the current estate and therefore cannot be functionally certified beyond render. | Page text capture. |

---

## 4. Phase A Verdict

- Inventory reconciled and frozen: **33 canonical screens / 66 certifiable surfaces**.
- Render certification: **PASS** (66/66).
- Functional gaps recorded: **5 defects (2 High, 1 Medium, 2 Low)** + 1 informational coverage note.
- No remediation performed in Phase A, per scope.

Recommended Phase B order: DEF-A-01 → DEF-A-02 → DEF-A-03 → DEF-A-05 → DEF-A-04.
