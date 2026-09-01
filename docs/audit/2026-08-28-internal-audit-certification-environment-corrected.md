# Internal Audit — Certification Environment Governance Correction (COMPLETE)

Continues from `docs/audit/2026-08-28-internal-audit-certification-environment-governance.md`.

Scope of this pass: environment identity correction, marker governance, consistency
certification, W4 certification personas, sandbox provider posture assessment.

**No communication channel was activated. No message was sent. The Live backend was not touched.**

---

## 1. Environment identity — CORRECTED

| Signal | Before | After |
| --- | --- | --- |
| `omni_comms_runtime_environment.environment` | `production` (manual assertion, 2026-08-12, no deployment evidence) | `non_production` |
| `platform_environment_marker` | 0 rows (no governed write path existed) | 1 row — `TEST` |
| `allows_controlled_test_activation` | n/a | `true` |
| Bound project ref | n/a | `xynceskeiiisiefqlgxo` (this Test/development backend) |

The historical `production` assertion was preserved, not overwritten, in
`omni_comms_runtime_environment_event`. The correction is recorded as a new governed
event with reason and deployment evidence.

Live backend `pruvbfejdpodpalqafcu` was read-only throughout this pass and remains
approximately 1200 migrations behind with no Omni-Comms/Wave-4 infrastructure.

## 2. Marker governance — IMPLEMENTED

New governed configuration path (previously missing):

- `public.platform_environment_marker_configure(...)` — `service_role` only, fail-closed,
  rejects granting `allows_controlled_test_activation` to `PRODUCTION` marker kinds
  (enforced both in command logic and by a table check constraint).
- `public.platform_environment_marker_event` — append-only history; not writable from the browser.
- `public.platform_environment_consistency(p_expected_project_ref)` — returns the
  runtime/marker/project-ref matrix with `status` and machine-readable `reasons`.

Negative tests confirmed: `anon` and `authenticated` cannot execute the configure command;
`PRODUCTION` + controlled-test-activation is rejected; the event log is immutable client-side.

## 3. Environment consistency certification — PASS

```
status                             PASS
runtime_environment                non_production
marker_environment_kind            TEST
marker_environment_label           Internal Audit Certification / Lovable Cloud Test
marker_project_ref                 xynceskeiiisiefqlgxo
allows_controlled_test_activation  true
reasons                            []
```

## 4. W4 certification personas — PROVISIONED

Provisioned by the fail-closed edge function `w4-cert-persona-provision`, which refuses to
run unless `platform_environment_consistency()` returns `PASS` with a `TEST` marker.

All personas use the RFC-reserved, permanently undeliverable domain `certification.invalid`.
No real stakeholder mailbox is used. Passwords are random and unrecorded (sign-in for these
fixtures is via admin password reset if ever required). Each persona holds exactly one
Internal Audit role — no persona holds `Admin`.

| Tag | Email | Role | Department |
| --- | --- | --- | --- |
| W4-CERT-HIA | w4-cert-hia@certification.invalid | IA_HEAD_OF_INTERNAL_AUDIT | organisation |
| W4-CERT-LEAD | w4-cert-lead@certification.invalid | IA_LEAD_AUDITOR | — |
| W4-CERT-AUDITOR | w4-cert-auditor@certification.invalid | IA_TEAM_MEMBER | — |
| W4-CERT-QA | w4-cert-qa@certification.invalid | IA_QUALITY_REVIEWER | — |
| W4-CERT-MGMT-BENEFITS | w4-cert-mgmt-benefits@certification.invalid | IA_MANAGEMENT_RESPONDENT | Benefits |
| W4-CERT-MGMT-FINANCE | w4-cert-mgmt-finance@certification.invalid | IA_MANAGEMENT_RESPONDENT | Finance |
| W4-CERT-MGMT-ICT | w4-cert-mgmt-ict@certification.invalid | IA_MANAGEMENT_RESPONDENT | Information Technology |

### Office-holder designations (DEF-1 escalation identity)

Designated through the governed maker-checker commands `ia_office_holder_propose` /
`ia_office_holder_approve` with two distinct actors — no direct table writes.

| Function | Holder | Effective from | Status |
| --- | --- | --- | --- |
| HEAD_OF_INTERNAL_AUDIT | W4-CERT-HIA | 2026-08-29 | active |
| DEPARTMENT_HEAD (Benefits) | W4-CERT-MGMT-BENEFITS | 2026-08-27 | active |
| DEPARTMENT_HEAD (Finance) | W4-CERT-MGMT-FINANCE | 2026-08-27 | active |
| DEPARTMENT_HEAD (ICT) | W4-CERT-MGMT-ICT | 2026-08-27 | active |

The prior organisation-level `HEAD_OF_INTERNAL_AUDIT` fixture (a real staff profile) was
effective-dated to `2026-08-28` and superseded rather than deleted, giving continuous
coverage with no unresolved-role gap. Escalation identity for W4 now resolves to a sandbox
persona rather than a production staff member.

## 5. Sandbox provider posture — ASSESSED, NOT ACTIVATED

| Channel | Sandbox account available | Notes |
| --- | --- | --- |
| email | `resend_email / omni_pilot_sandbox` (sandbox_mode, healthy) and `simulation_email / ref_sim_email` | Simulation account is the safe DEF-4 path: `certification.invalid` recipients are undeliverable by design at a real ESP |
| in_app | `simulation_inapp / ref_sim_inapp` | In-app delivery is internal; no external provider involved |

**Provider prerequisite for DEF-4:** real-provider Email delivery evidence requires either
(a) an allowlisted deliverable sandbox mailbox, or (b) an accepted decision that Email
delivery/retry evidence is produced against the simulation adapter. This is a decision for
the DEF-4 pass, not this one.

## 6. Release-control state — UNCHANGED

| Channel | `release_state` |
| --- | --- |
| email | `suspended` |
| print | `suspended` |
| in_app | no release-control row |

No proposal, approval, activation or release-version change was made in this pass.

## 7. Regression

- Omni-Comms / platform communications suite: **83/83 passed**
- Typecheck and build clean.

---

## Result

`ENVIRONMENT GOVERNANCE: CORRECTED AND CERTIFIED`
`W4 CERTIFICATION PERSONAS: PROVISIONED`
`CHANNELS: NOT ACTIVATED (as instructed)`

DEF-4 is now unblocked from an environment-governance standpoint. The next pass requires
explicit authorisation to propose and activate EMAIL and IN_APP under controlled-test
release limits, plus the provider decision noted in section 5.
