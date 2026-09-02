# Internal Audit — Phase C Certification Matrix (75 surfaces)

Date: 2026-09-02 · Persona: System Admin · Fixture namespace: `IA-UT-20260902-`

Legend — every surface was checked for: **R** render, **N** no HTTP ≥400, **C** no console error, **A** no Access Denied / Under Activation, **D** binds live data or shows a correct empty state.

## A. Canonical screens (31)

| # | Screen | Route | R | N | C | A | D |
|---|---|---|---|---|---|---|---|
| 1 | Audit Dashboard | `/audit/dashboard` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2 | Department Master | `/audit/departments` | ✅ | ✅ | ✅ | ✅ | ✅ fixtures visible |
| 3 | Risk Register | `/audit/risk-register` | ✅ | ✅ | ✅ | ✅ | ✅ 3 fixture risks |
| 4 | Business Function Master | `/audit/functions` | ✅ | ✅ | ✅ | ✅ | ✅ 3 fixture functions |
| 5 | Risk Assessment | `/audit/risk-assessment` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 6 | Entity Risk Summary | `/audit/entity-summary` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 7 | Risk Matrix | `/audit/risk-matrix` | ✅ | ✅ | ✅ (after DEF-C-02) | ✅ | ✅ |
| 8 | Annual Plans Register | `/audit/audit-plans` | ✅ | ✅ | ✅ | ✅ | ✅ fixture plan listed |
| 9 | Audits Register | `/audit/audits` | ✅ | ✅ | ✅ | ✅ | ✅ 5 fixture audits |
| 10 | Action Centre | `/audit/action-centre` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 11 | Escalation Roles | `/audit/escalation-roles` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 12 | Follow-Up Tracker | `/audit/follow-up-tracker` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 13 | Report Centre | `/audit/audit-reports` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 14 | Report Builder | `/audit/report-builder` | ✅ | ✅ | ✅ (after DEF-C-02) | ✅ | ✅ |
| 15 | Plan Approval | `/audit/plan-approval` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 16 | Audit Configuration | `/audit/config` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 17 | Access Matrix | `/audit/access-matrix` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 18 | Risk Configuration | `/audit/risk-settings` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 19 | Document & Output Settings | `/audit/document-templates` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 20 | Audit Queries | `/audit/queries` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 21 | Auditor Profiles | `/audit/auditors` | ✅ | ✅ | ✅ | ✅ | ✅ 2 fixture auditors |
| 22 | Workload & Capacity | `/audit/workload` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 23 | Time Tracking | `/audit/time-tracking` | ✅ | ✅ | ✅ | ✅ | ✅ fixture time log |
| 24 | Auditor Leave | `/audit/leave` | ✅ | ✅ | ✅ | ✅ | ✅ fixture leave |
| 25 | User Manuals | `/audit/user-manuals` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 26 | Communication Templates | `/audit/templates` | ✅ | ✅ | ✅ | ✅ | ✅ (DEF-A-03 fix holds) |
| 27 | Report — Engagement Summary | `/audit/reports/engagement-summary` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 28 | Report — Communication Compliance | `/audit/reports/communication-compliance` | ✅ | ✅ | ✅ | ✅ | ✅ (DEF-A-02 fix holds) |
| 29 | Report — Plan Slippage | `/audit/reports/plan-slippage` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 30 | Report — Overdue Actions | `/audit/reports/overdue-actions` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 31 | Report — Carry-Forward Aging | `/audit/reports/carry-forward-aging` | ✅ | ✅ | ✅ | ✅ | ✅ |

## B. Alias routes (8)

`/audit/plans`, `/audit/reports`, `/audit/engagements`, `/audit/actions`, `/audit/action-center`, `/audit/universe`, `/audit/auditor-profiles`, `/audit/manuals` — all ✅ R/N/C/A/D.

## C. Annual Plan Workspace tabs (10) — plan `IA-UT-20260902-PLAN-1`

| Tab | `?tab=` honoured | Rendered tab label | Distinct content |
|---|---|---|---|
| overview | ✅ | Overview | ✅ |
| portfolio | ✅ | Portfolio | ✅ |
| engagements | ✅ | Engagements (5) | ✅ live count |
| coverage | ✅ | Coverage & Risk | ✅ |
| capacity | ✅ | Capacity & Schedule | ✅ |
| autoplan | ✅ | Auto Plan | ✅ |
| approval | ✅ | Approval & Amendments | ✅ |
| boardpack | ✅ | Board Pack | ✅ |
| distribution | ✅ | Distribution | ✅ |
| closure | ✅ | Closure | ✅ |
| *(invalid)* `?tab=zzz-invalid` | ✅ | Overview | ✅ safe fallback |

## D. Engagement Workspace tabs (14) — audit `IA-UT-20260902-ENG-5`

| Tab | `?tab=` honoured | Rendered tab label | Distinct content |
|---|---|---|---|
| overview | ✅ | Overview | ✅ |
| preparation | ✅ | Preparation | ✅ |
| programme | ✅ | Programme / RCM | ✅ |
| activities | ✅ | Activities (1) | ✅ live count |
| control-tests | ✅ | Control Tests | ✅ |
| evidence | ✅ | Evidence | ✅ |
| working-papers | ✅ | Working Papers | ✅ |
| findings | ✅ | Findings (1) | ✅ live count |
| responses | ✅ | Responses (1) | ✅ live count |
| actions | ✅ | Actions | ✅ |
| follow-ups | ✅ | Follow-ups | ✅ |
| quality-review | ✅ | Quality Review | ✅ |
| timeline | ✅ | Timeline | ✅ |
| closure | ✅ | Closure | ✅ |
| *(invalid)* `?tab=zzz-invalid` | ✅ | Overview | ✅ safe fallback |
| *alias* `/audit/engagements/:id?tab=findings` | ✅ | Findings | ✅ search params preserved |

## E. Action Centre tabs (9)

| Tab | Rendered tab label | Live count observed |
|---|---|---|
| my-work | My Audit Work | 59 |
| management | Management Actions | 0 |
| attention | Head of Audit | 51 |
| register | Action Register | 19 |
| findings | Findings Register | 23 |
| verification | Verification | 1 |
| followup | Follow-Up | 6 |
| qa | Quality Review | 7 |
| closure | Closure Readiness | 59 |

All ✅ R/N/C/A/D, all nine renders distinct.

## F. Logic certification (39 unit assertions)

| Suite | Tests | Result |
|---|---|---|
| `workspaceTabs.test.ts` | 8 | ✅ |
| `riskEngine.test.ts` | 17 | ✅ |
| `capacityPlanner.test.ts` | 9 | ✅ |
| `auditCompensatingRollback.test.ts` (pre-existing) | 5 | ✅ |

## G. Governance probes

| Probe | Result |
|---|---|
| Security closure verifier | ✅ PASSED |
| RLS enabled on `ia_*` tables | 117/118 (1 intentional, no client grants) |
| RLS-on-but-no-policy tables | 0 |
| `anon` grants on `ia_*` tables | 0 (14 revoked in DEF-C-01) |

**Totals: 75/75 surfaces certified · 39/39 logic assertions passing · 2 defects raised, 2 closed.**
