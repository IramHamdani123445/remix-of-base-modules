# Benefits Uprating & Indexation — Completion Record

Module: `bn_uprating`
Status: **FUNCTIONALLY COMPLETE AND TECHNICALLY CERTIFIED**
Canonical commands: **17 / 17 implemented**

---

## 1. Scope delivered

| Epic | Scope | Status |
| --- | --- | --- |
| Epic 0 | Module foundation, policy catalogue, version governance | COMPLETE — CERTIFIED |
| Epic 1 | Run creation, population snapshot, exceptions, simulation | COMPLETE — CERTIFIED |
| Epic 2 | Run approval and execution scheduling | COMPLETE — CERTIFIED |
| Epic 3 | Batch execution and failed-item retry | COMPLETE — CERTIFIED |
| Epic 4 | Reconciliation, rollback and operational completion | COMPLETE — CERTIFIED |
| Epic 5 | Run closure and end-to-end technical certification | COMPLETE — CERTIFIED |

Detail per epic, including the delivered boundary and surfaces, is in
`UPRATING_IMPLEMENTATION_MATRIX.md`.

---

## 2. Canonical command catalogue

All 17 canonical commands are implemented behind the single governed boundary
`bn_uprating_run_command_v1` (policy commands behind the policy boundary):

Epic 0 (5), Epic 1 (4), Epic 2 (3), Epic 3 (2), Epic 4 (2), Epic 5 (1).

The terminal command is `BN_UPRATING_CLOSE_RUN`. Nothing in the catalogue remains
NOT_STARTED.

---

## 3. Lifecycle

```text
DRAFT → PARAMETERISED → ELIGIBILITY_SNAPSHOT → EXCLUSIONS_APPLIED → DRY_RUN
      → AWAITING_APPROVAL → APPROVED → EXECUTING
      → COMPLETED | PARTIAL | FAILED
      → SCHEDULES_REBUILT → COMMUNICATIONS_ISSUED → RECONCILED → CLOSED
        FAILED → ROLLED_BACK → CLOSED
```

`CLOSED` is terminal. There is no reopen command.

---

## 4. Governance guarantees

- One command boundary, one readiness source per decision; the frontend never decides
  availability locally.
- Execution applies exactly what was approved. No amount is recalculated at execution or
  at closure.
- Maker-checker separation on policy approval, run approval, batch execution and rollback
  authorisation.
- Closure changes no award, entitlement, payment schedule or communication, and deletes no
  evidence.
- Every governed operation writes a lifecycle event and a command-audit row.
- Every readiness surface fails closed when its source cannot be read.
- Claimant notices are requested through the Communication Hub façade only; a request is
  never treated as a delivery.

---

## 5. Technical certification evidence

- Epic suites: `upratingEpic0Foundation`, `upratingEpic1Run`, `upratingEpic2Approval`,
  `upratingEpic3Execution`, `upratingEpic4Reconciliation`, `upratingEpic5Closure`
  (`src/__tests__/bn/uprating/`).
- Full Uprating regression: green.
- Typecheck: CLEAN (`tsgo -p tsconfig.app.json`).
- Governed boundary SQL is certified as source of truth by the suites above, which assert
  against the delivered migrations.

---

## 6. Known limitation — controlled existing-data UAT

CONTROLLED EXISTING-DATA UAT: **DEFERRED**

Technical certification above is complete and automated. What is **not** yet evidenced is
an operational walkthrough (policy lifecycle → run preparation → simulation → approval →
scheduling → execution → schedule rebuild → claimant notices → reconciliation → closure)
performed against **real existing Benefits data by real maker / checker / executor sign-ins**.

Reason: no authorised isolated non-production environment is available to this workspace.
The only reachable backend is the live project, which is explicitly denylisted for
controlled validation, and `public.platform_environment_marker` carries no
non-production marker. Per the fail-closed environment safety rule, no existing award was
mutated and no marker was manufactured.

To lift this limitation, provision an isolated non-production project with governed
existing Benefits data and run `scripts/bn/provision-uprating-validation-db.sh`, as
described in `UPRATING_CONTROLLED_VALIDATION_ENVIRONMENT.md`. No source change is required.

---

## 7. Statement

UPRATING EPIC 5 COMPLETE — 17/17 CANONICAL COMMANDS IMPLEMENTED — FUNCTIONALLY COMPLETE AND
TECHNICALLY CERTIFIED — CONTROLLED EXISTING-DATA UAT DEFERRED PENDING AUTHORISED
NON-PRODUCTION ENVIRONMENT
