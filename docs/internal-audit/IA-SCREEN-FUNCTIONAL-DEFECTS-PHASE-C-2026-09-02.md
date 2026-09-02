# Internal Audit — Phase C Defect Register

Date: 2026-09-02 · Phase: C (functional / unit-style certification) · Both defects **closed and re-verified** in-phase.

---

## DEF-C-01 — Surplus `anon` grants on 14 Internal Audit tables

| Field | Detail |
|---|---|
| **Severity** | Medium (security hygiene / latent exposure) |
| **Layer** | Database grants |
| **Detected by** | L3 governance probe over `pg_class.relacl` for all 118 `ia_*` tables |

### Observation
Fourteen tables granted the full `arwdDxtm` privilege set to the `anon` (signed-out) role:

`ia_action_extensions`, `ia_action_progress_log`, `ia_comms_obligation_policy`, `ia_comms_payload_alias`, `ia_comms_pre_release_quarantine`, `ia_comms_recovery_probe`, `ia_comms_reminder_policy`, `ia_comms_reminder_run_log`, `ia_comms_role_designation`, `ia_engagement_schedule_history`, `ia_escalation_cert_log`, `ia_finding_severity_history`, `ia_office_holder`, `ia_report_versions`.

### Risk assessment
Not a live exposure: RLS is enabled on all fourteen and **every policy targets `authenticated` only** — no policy grants `anon` any row, so signed-out reads and writes were already denied. The defect is that the grant surface was unnecessary and asymmetric with the rest of the estate: the moment any future policy was written permissively (`USING (true)` without a role clause), all fourteen would have become anonymously readable — including audit report versions, finding severity history and communication policy tables.

### Remediation
`REVOKE ALL` on all fourteen tables from `anon`. `authenticated` and `service_role` grants untouched.

### Verification
- Post-fix catalogue query: `anon`-granted `ia_*` tables = **0** (was 14).
- Full 75-surface authenticated pass re-executed after the revoke: **75/75 passing, 0 HTTP ≥400** — proving zero functional impact on legitimate users.

**Status: CLOSED.**

---

## DEF-C-02 — Residual `React.Fragment` / `data-lov-id` console warnings

| Field | Detail |
|---|---|
| **Severity** | Low (developer-experience / console noise) |
| **Layer** | Frontend presentation |
| **Detected by** | L2 console capture during the surface pass |
| **Relationship** | Recurrence of the Phase-A DEF-A-04 class at two sites missed by the Phase-B fix |

### Observation
Two surfaces emitted `Invalid prop 'data-lov-id' supplied to React.Fragment`:
- `src/pages/audit/RiskMatrix.tsx:100` — `React.Fragment` used as the per-row wrapper inside the 6-column risk matrix grid.
- `src/components/audit/reports/AuditReportWorkflowBar.tsx:49` — `React.Fragment` used as the per-step wrapper inside the flex stepper.

### Why the Phase-B remedy could not be copied
Phase B fixed `AuditLifecycleStepper` by swapping the Fragment for a plain `div`. That approach is **wrong here**: both sites rely on their children being direct participants of the parent grid/flex container. A plain `div` would collapse the 5×5 risk matrix into five nested rows and break the stepper's wrap behaviour.

### Remediation
Replaced both Fragments with `<div className="contents">`. The `display: contents` box is removed from the layout tree, so the children remain direct grid/flex participants while the element is a real DOM node that can carry the `data-lov-id` attribute.

### Verification
Full 75-surface pass re-executed: **console-error surfaces = 0** (was 2). Risk Matrix and Report Builder both render with unchanged layout.

**Status: CLOSED.**

---

## Defects raised, not fixed

None. No High or Critical functional defect was observed in Phase C.

## Carry-forward note

Phase A `OBS-A-06` (surfaces that previously had no business data) is now partially retired: Risk Register, Time Tracking and Auditor Leave are populated by the `IA-UT-20260902-` fixture estate and were certified with data. Communication Compliance and Carry-Forward Aging remain data-thin and were certified on render + query-health only.
