# Internal Audit — Stage 1B / E2E-2

## High-Risk Audit Journey with Findings, Management Responses and Corrective Actions

**Engagement:** ENG-2027-002 — Benefits Payment Processing (Benefits Department)
**Engagement ID:** `66579005-1b9c-4155-a464-f86deb4d45b4`
**Risk band:** Critical · **Plan:** 2027 Risk-Based Audit Plan, version 2 (approved)
**Outcome:** Report IAR-2027-002 issued; engagement **Closed** with **0 open actions**
**Certified:** 2026-08-28 (TEST environment, `platform_environment_marker = TEST`)

---

## 1. Personas and segregation of duties

| Role | Persona | Auditor ID |
|---|---|---|
| Lead auditor | `w4-cert-auditor@certification.invalid` | `66a54aff-f263-4dac-b3dd-f1fe06d4ba4c` |
| Independent reviewer / QA | `w4-cert-lead@certification.invalid` | `d4e4f228-db0e-4d66-985c-f675708b1fbc` |
| Auditee management | `w4-cert-mgmt-benefits@certification.invalid` | profile `72866da8-06c3-4e3a-b7aa-773eb411f792` |

## 2. Journey executed (all through governed `ia_*` commands)

1. **Launch and preparation** — engagement notification and entrance meeting recorded; 5 preparation checklist items completed; preparation closed (`ia_complete_preparation`).
2. **Risk and control matrix** — 3 processes, 6 risks (1 Critical, 3 High, 2 Medium), 6 controls.
3. **Fieldwork** — 6 activities assigned, evidence and working papers filed, completed and independently reviewed. 6 control tests concluded: **3 Effective, 2 Ineffective, 1 Partially Effective**.
4. **Findings** — 3 raised, each Draft → Under Review → Confirmed (by the independent reviewer) → Released:
   - `F-2027-002-01` **High** — payments released without a current life certificate (9 of 30).
   - `F-2027-002-02` **Critical** — bank detail changes without signed mandate or supervisor approval (6 of 25).
   - `F-2027-002-03` **Medium** — quarterly bank detail change log review not evidenced for Q3 2026.
5. **Management responses** — Accepted / Partially Accepted (with rationale) / Rejected (with rationale). Audit review outcomes: Accepted, Accepted, **Escalated to the Audit Committee** for the rejected finding.
6. **Corrective actions** — 3 raised from recommendations and assigned to Benefits management; one **extension request** (30 Jun → 31 Aug 2027) approved by the independent reviewer; all three completed by management, **verified by Internal Audit**, and closed with evidence.
7. **Reporting and QA** — report IAR-2027-002 drafted; QA cycle 1 returned **Rework Required**; report revised to v3; QA cycle 2 **Cleared** (Satisfactory); issuance gate passed (9 evidence items, 6 working papers, 3 findings, all responses on file, required communication stages recorded); report **Issued**.
8. **Closure** — engagement closed with disposition `Closed`, 0 open actions, 0 open follow-ups. **75 immutable audit events** recorded.

## 3. Negative tests — all correctly refused

| Test | Result |
|---|---|
| Finding author confirms own finding | `IA_SOD_VIOLATION` |
| Response author reviews own management response | `IA_FORBIDDEN` |
| Management approves its own extension request | `IA_FORBIDDEN` |
| Management verifies its own corrective action | `IA_FORBIDDEN` |
| Lead auditor named as quality reviewer of own engagement | `IA_SOD_VIOLATION` |
| Lead auditor clears quality assurance on own engagement | `IA_SOD_VIOLATION` |
| Re-review requested before the report was revised | `IA_REWORK_OUTSTANDING` |
| Control test with exceptions concluded without a finding | `IA_RATIONALE_REQUIRED` |
| Partial/rejected management response without rationale | `IA_RATIONALE_REQUIRED` |
| Activity completed with no evidence or working paper | `IA_NO_ARTEFACT` |

## 4. Defects found and remediated

| ID | Defect | Remediation |
|---|---|---|
| **DEF-S1B-18** | `ia_record_communication_stage` silently accepted unrecognised stage codes (stamped `stage_order = 99`), so preparation and issuance gates were never satisfied and no error was shown. | Command now normalises casing/spacing and rejects unknown codes with `IA_INVALID_STAGE`, returning the allowed catalogue. Two mislabelled rows corrected. |
| **DEF-S1B-19** | `ia_create_action_from_recommendation` and `ia_link_action_evidence` guarded on a non-existent permission namespace (`InternalAudit` / `create_audit_actions`). **No auditor — not even the engagement lead — could ever raise a corrective action.** | Both now use the canonical engagement guard (`ia_cmd_guard_elevated` / `ia_cmd_guard` on `action_tracking`), consistent with every other action command. |
| **DEF-S1B-20** | A `Rework Required` quality review still counted as "in progress", so no re-review could be started. **Any rework permanently blocked report issuance and engagement closure.** | Re-review is now permitted after rework, but only once a revised report version exists (`IA_REWORK_OUTSTANDING` otherwise); the superseded review is marked `Superseded`. |
| **DEF-S1B-21** | `ia_close_action` left `lifecycle_status = 'Verified'`; closure counted the action as open, so engagements could never close cleanly (forced to `Closed – Actions Pending`). | Closure now sets `lifecycle_status = 'Closed'`, requires prior verification, and existing affected rows were backfilled. |

## 5. Final state (verified)

```
engagement       status = Closed, execution_status = Closed
control tests    3 Effective, 2 Ineffective, 1 Partially Effective
findings         F-2027-002-01 High, -02 Critical, -03 Medium — all Responded
responses        Accepted / Partially Accepted / Rejected → Accepted, Accepted, Escalated
actions          3 × Closed (one with an approved extension to 2027-08-31)
quality reviews  1 × Superseded (Needs Improvement), 1 × Cleared (Satisfactory)
report           IAR-2027-002, Issued, version 3
audit events     75 immutable records
```

No Omni-Comms configuration, dispatch activation or certified revision was changed during E2E-2.
