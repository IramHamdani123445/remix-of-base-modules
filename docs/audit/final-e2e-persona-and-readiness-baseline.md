# Internal Audit — Final Acceptance Readiness Baseline (Pre-Final-E2E)

Scope: persona certification and UI entitlement closure. No lifecycle development.

## Fixtures restored
- `ACT-2026-00008` target date restored to `2026-05-29` (`IA.FIXTURE.RESTORED` event recorded).
- `audit.qa` assigned as quality reviewer on `ENG-2028-001` / `ENG-2028-002`.

## Smoke evidence (INTERNAL_AUDIT.ACTION.DUE_SOON)
- Request `fb788196-7027-4084-b573-2a6f89318a42`
- Email job `a7a9c8db…` — Resend message `b1a19861…`, provider status 200
- In-App job `3d0a7e6a…` — delivered `d78e0c10…`
- Recipient: `audit.mgmt.benefits@mishainfotech.com`

## Defect verdicts

| Defect | Area | Verdict | Evidence |
| --- | --- | --- | --- |
| DEF-S1B-32 | Quality Reviewer access | CLOSED | `audit.qa@mishainfotech.com` opens assigned engagement workspace and Quality Review tab |
| DEF-S1B-33 | Management navigation | CLOSED | Management persona sidebar shows Internal Audit → Action Centre only; no auditor tree |
| DEF-S1B-34 | Management scoping | CLOSED | Benefits respondent sees only Benefits engagements; Action Centre restricted to Management Actions / Findings Register / Action Register / Follow-Up |
| DEF-S1B-35 | Entitlement UI | CLOSED | Launch Engagement / Launch Audit controls hidden unless `audit_engagements:launch`; close recommendation gated on `audit_engagements:close` |
| DEF-S1B-36 | Default filters | CLOSED (regression re-verified) | Closed / carried-forward engagements visible in list |
| DEF-S1B-38 | In-App presentation | CLOSED | Titles and bodies rendered from dispatch payload |
| DEF-S1B-43 | Recipient vocabulary | CLOSED | `ia_comms_profile_fact` emits `recipient_type: 'user'` |

## Code changes
- `src/hooks/audit/useInternalAuditPersona.ts` — audit-team vs management-only persona classification from `ia_auditors`.
- `src/components/audit/LaunchReadinessPanel.tsx` — launch CTA gated on `launch_department_audit`.
- `src/components/audit/workspace/AuditNextActionsPanel.tsx` + `AuditOverviewTab.tsx` — recommended lifecycle actions gated on launch/close entitlements.
- `src/pages/audit/AuditActionCentre.tsx` — management-only tab set and safe active-tab fallback.

## Freeze status
System is frozen for the final full E2E. No lifecycle RPCs changed in this pass.
