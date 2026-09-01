# Internal Audit — Certification Environment Governance Unblock

Date: 2026-08-28
HEAD: `37193989b`
Working tree: clean (0 modified files)
Repository migrations: 1696

Continues: `docs/audit/2026-08-28-internal-audit-wave4-closure-certification.md`

No channel was proposed, approved, activated, suspended or mutated in this pass.
No environment classification value was changed in this pass.

## HEADLINE FINDING

The instance all Wave-1 → Wave-4 work has been performed on is **NOT** the production
backend. It is the Lovable Cloud **Test/development** backend. The
`omni_comms_runtime_environment.environment = production` value is a **misclassification**:
a manual administrator assertion recorded with **no deployment evidence**.

A genuinely separate production backend exists and is a different database project.

## 1. Instance identity

| Attribute | Current runtime instance | Live/production instance |
| --- | --- | --- |
| Lovable Cloud role | **Test / development** | **Live / production** |
| Database project ref | `xynceskeiiisiefqlgxo` | `pruvbfejdpodpalqafcu` |
| Organization | `wpczgwxsriezaubncuom` | `wpczgwxsriezaubncuom` (same org) |
| Instance size | Medium | Mini |
| Managed by Lovable | true | true |
| Paused | false | false |
| App binding (`.env` `VITE_SUPABASE_PROJECT_ID`) | `xynceskeiiisiefqlgxo` | — |
| App binding (`VITE_SUPABASE_URL`) | `https://xynceskeiiisiefqlgxo.supabase.co` | — |
| `supabase/config.toml` `project_id` | `xynceskeiiisiefqlgxo` | — |

The repository, the preview runtime, the sandbox toolchain and every migration applied during
Waves 1–4 are all bound to `xynceskeiiisiefqlgxo`, which the platform reports as the
**development** environment. No secrets were read or exposed.

## 2. Evidence matrix

| Signal | Observed value | Authority | Production indicator? | Non-production indicator? | Confidence |
| --- | --- | --- | --- | --- | --- |
| Lovable Cloud environment role of `xynceskeiiisiefqlgxo` | `development` | **Platform / infrastructure** | No | **Yes** | Very high |
| Existence of a distinct Live project `pruvbfejdpodpalqafcu` | present, unpaused | **Platform / infrastructure** | No (for this instance) | **Yes** | Very high |
| App runtime binding (`.env`, `config.toml`) | dev ref | Deployment config | No | **Yes** | Very high |
| Migrations applied on this instance | 1712 | Database | Neutral | Neutral | High |
| Migrations applied on Live | **504** | Database | — | — | High |
| Omni-Comms tables on this instance | 65 | Database | Neutral | Neutral | High |
| Omni-Comms tables on Live | **0** | Database | — | — | Very high |
| `omni_comms_runtime_environment` / `_event` tables on Live | **absent** | Database | — | — | Very high |
| `platform_environment_marker` table on Live | **absent** | Database | — | — | Very high |
| `ia_office_holder` (DEF-1) on Live | **absent** | Database | — | — | Very high |
| `omni_comms_attachment` (DEF-3) on Live | **absent** | Database | — | — | Very high |
| `ia_audit_engagements` rows on Live | **0** | Database | — | — | High |
| `omni_comms_runtime_environment.environment` | `production` | **Application self-assertion** | **Yes** | No | **Low** (see §3) |
| `omni_comms_runtime_environment_event` provenance | 1 row, `unknown → production`, 2026-08-12 14:41 UTC, reason "Administrator confirmed this deployment is the production runtime", `evidence.deployment_hint = **absent**`, `source = release_control_edge` | Application self-assertion | Weak yes | No | **Low** |
| `platform_environment_marker` | **0 rows** | Governed marker | Neutral (fails closed) | No | High |
| `allows_controlled_test_activation` | unavailable (no row) | Governed marker | — | — | High |
| Release-control rows permitting `INTERNAL_AUDIT` | 0 | Governance | — | — | High |
| Explicit production activation approval | none | Governance | — | — | High |

**Weighting.** Per the pass rule that identity must derive from platform/infrastructure
governance, the infrastructure signals (rows 1–3) are authoritative and unanimous. The single
contrary signal is an application row whose own audit trail records `deployment_hint: absent`
— it is an unverified human claim, not a platform fact.

## 3. Provenance of the "production" classification

```
from_environment : unknown
to_environment   : production
occurred_at      : 2026-08-12 14:41:08 UTC
actor            : 62c928c3-cd5e-421f-a010-50f9123fff70
reason           : "Administrator confirmed this deployment is the production runtime."
evidence         : { source: release_control_edge,
                     deployment_hint: ABSENT,
                     runtime_revision: efd35fa61a545f26fcf7200c887ba4e67b3255f3 }
```

The governed setter `omni_comms_priv_confirm_runtime_environment` accepted the value on the
administrator's word alone; it performed no deployment-identity corroboration, and the
evidence payload explicitly records that no deployment hint was available. The classification
therefore has no infrastructure backing.

No environment reclassification is being inferred from data content. Row contents, synthetic
personas and user counts were deliberately **not** used as classification evidence.

## 4. Backend topology

```
Lovable Cloud project (org wpczgwxsriezaubncuom)
|
+-- Test / development backend      xynceskeiiisiefqlgxo   <-- CURRENT RUNTIME
|      1712 migrations, 65 omni_comms tables, 112 ia_* tables,
|      13 engagements, 56 auth users, 15 sender identities
|      ALL Wave 1-4 work lives here
|
+-- Live / production backend       pruvbfejdpodpalqafcu
       504 migrations, 0 omni_comms tables, 167 ia_* tables (older generation),
       0 engagements
       ~1200 migrations behind; has never received Omni-Comms or Wave-4 work
```

Only two backends exist. There is no separate staging, preview or certification project.

## 5. Suitability as the certification environment

The Test/development backend is structurally the correct and already-provisioned home for
DEF-4 and Stage 1B. Parity, recalculated live this pass (not carried forward):

| Requirement | Observed | Verdict |
| --- | --- | --- |
| Latest repository migrations applied | 1712 applied vs 1696 files (superset; no drift blocking) | PASS |
| Internal Audit active events | **41** (recalculated) | PASS |
| Active IA routes | **81** — `email: 40`, `in_app: 41` | PASS |
| Active producer bindings | **41** | PASS |
| DEF-1 governance (`ia_office_holder`) | present, **5** designations | PASS |
| DEF-2 cutover (direct send paths) | 0 | PASS |
| DEF-3 attachments (`omni_comms_attachment`) | table present, 0 rows (expected pre-activation) | PASS |
| Wave-3 Action Centre | present | PASS |
| Omni-Comms surface | 65 tables | PASS |
| RBAC/RLS | Wave-1 classified policies in force | PASS |
| Auth identities available for personas | 56 | PASS (see §7) |
| Sender identities configured | 15 | PASS (see §6) |

The only thing disqualifying it today is its **untruthful self-classification**, not its
capability.

## 6. Test email provider strategy (documented, not activated)

For certification the environment must use a sandbox/allowlisted posture:

- **Provider account** — a dedicated non-production sending account, distinct from any
  account used for the Benefits production pilot.
- **Sandbox/test status** — required; provider account must be in sandbox or restricted mode.
- **Recipient allowlist** — certification-only mailboxes. Production stakeholder lists,
  real auditee addresses and real office-holder mailboxes are **excluded**.
- **Sender identity** — a certification sender on a non-production sending domain, never the
  live corporate sender.
- **Callback support** — delivery and bounce webhooks must terminate in this environment.
- **Bounce simulation** — provider-supported simulation addresses required for the DEF-4
  permanent-failure and retry-exhaustion scenarios.

None of this was configured or activated in this pass.

## 7. In-app / persona strategy (documented, not created)

Controlled certification profiles to be provisioned before DEF-4:
`W4-CERT-HIA`, `W4-CERT-LEAD`, `W4-CERT-AUDITOR`, `W4-CERT-QA`,
`W4-CERT-MGMT-BENEFITS`, `W4-CERT-MGMT-FINANCE`, `W4-CERT-MGMT-ICT`.

These support DEF-4 in-app delivery, escalation routing through the DEF-1 office-holder
register, and Stage 1B persona/RLS assertions. They must be synthetic, allowlisted, and must
not reuse real staff identities.

## 8. Marker governance path

`platform_environment_marker` (migration `20260805204800_...`) is a governed single-row table:

- columns: `environment_kind`, `environment_label`, `project_ref`,
  `allows_controlled_test_activation`, `notes`, `created_at`, `updated_at`
- `environment_kind` enum: **`PRODUCTION` | `TEST` | `LOCAL` | `CI`** — there is no
  `CERTIFICATION` value, so a certification instance is expressed as `TEST`
- a CHECK constraint already forbids `allows_controlled_test_activation = true` when
  `environment_kind = 'PRODUCTION'` — the schema itself refuses the bypass
- read-only to `authenticated`; writes are `service_role` only
- an `updated_at` touch trigger exists

There is **no** governed write command for this table yet (no propose/approve RPC, no
migration that seeds it). A minimal auditable configuration path must be added before the
marker is populated, capturing `environment_kind`, `environment_label`, `project_ref`,
`allows_controlled_test_activation`, reason/notes, actor and timestamp.

The marker was deliberately **not** populated in this pass: doing so while
`omni_comms_runtime_environment` still reads `production` would create exactly the
contradictory identity (`runtime = production`, `marker = TEST`) that the consistency rule
forbids, and would amount to bypassing the safety gate rather than correcting it.

## 9. Environment consistency check

| Layer | Current value | Required for activation |
| --- | --- | --- |
| Deployment / project identity | `xynceskeiiisiefqlgxo` (**development**) | certification backend |
| `omni_comms_runtime_environment` | `production` | `non_production` |
| `platform_environment_marker.environment_kind` | absent | `TEST` |
| `allows_controlled_test_activation` | unavailable | `true` |

**Result: INCONSISTENT.** The deployment identity says development while the runtime row says
production. The two disagree, so the consistency precondition fails and the gate must stay shut.

## 10. Production preservation

Verified after the pass, on both instances:

| Assertion | Result |
| --- | --- |
| Live backend `pruvbfejdpodpalqafcu` written to this pass | **No** — read-only queries only |
| Live release controls changed | No (Live has no Omni-Comms tables at all) |
| Live provider configuration changed | No |
| Live office-holder data changed | No (table absent on Live) |
| Live business records changed | No — `ia_audit_engagements` = 0, unchanged |
| Current-instance release controls changed | **No** — still 2 rows, `email` and `print`, both `suspended`, permitting `[BENEFITS]` only |
| Current-instance release events appended | **No** — 23 events, unchanged |
| `INTERNAL_AUDIT` added to any permitted module list | **No** — 0 release rows permit it |
| Environment classification mutated | **No** — 1 event row, unchanged since 2026-08-12 |

## 11. Stage 1B location

Stage 1B will generate substantial synthetic business activity: 20+ audits across multiple
departments and functions, findings, management responses, corrective actions, extensions,
follow-ups, QA cycles, issued reports, email and in-app communications, cross-year obligations
and plan closure. This volume of synthetic audit evidence must **not** be created in a
production system of record. The certification (non-production) backend is the required
execution location. Provisioning cost is not an acceptable reason to run Stage 1B in production.

## 12. Production activation route (documented, not exercised)

If the organisation ever chooses to activate Internal Audit channels in genuine production,
that requires an explicit recorded business/release approval specifying at minimum: module
`INTERNAL_AUDIT`; channels `EMAIL` and `IN_APP`; environment `production`; event scope;
effective time; approver identity; second-person approval; canary/initial recipient controls;
and the rollback/suspension procedure.

This Lovable prompt is **not** such an approval. A request to analyse or certify the system is
not equivalent to formal production channel-release authorisation, and no approval was
manufactured from it.

## 13. Certification environment readiness matrix

```
CERTIFICATION ENVIRONMENT READINESS

Dedicated non-production backend:          YES (xynceskeiiisiefqlgxo, Lovable Cloud Test)
Environment identity unambiguous:          FAIL (infra=development vs runtime row=production)
Runtime environment:                       production   <-- CONTRADICTED BY INFRASTRUCTURE
Platform environment marker:               ABSENT (0 rows)
Controlled test activation permitted:      NO
Migration parity:                          PASS (1712 applied / 1696 files)
Internal Audit catalogue parity:           PASS (41 events, 81 routes, 41 bindings)
Omni-Comms parity:                         PASS (65 tables)
DEF-1 parity:                              PASS (ia_office_holder, 5 designations)
DEF-2 parity:                              PASS (0 direct send paths)
DEF-3 parity:                              PASS (omni_comms_attachment present)
RBAC/RLS parity:                           PASS (Wave-1 classified policies in force)
Test personas available:                   FAIL (W4-CERT-* profiles not yet provisioned)
Test email provider strategy:              FAIL (sandbox account/allowlist not configured)
Production untouched:                      PASS
```

## 14. Decision

```
ROUTE D — CONFLICT

ENVIRONMENT DECISION:
ENVIRONMENT_CLASSIFICATION_CONFLICT

NO CHANNEL ACTIVATION PERFORMED
```

The conflict is asymmetric and diagnosable, not a stalemate: every infrastructure signal says
this instance is the Lovable Cloud **Test/development** backend, while one application row —
set by hand on 2026-08-12 with `deployment_hint: absent` — claims production. The application
row is almost certainly wrong.

Because correcting it would immediately open the DEF-4 activation gate, the correction is a
governance act and is **not** performed unilaterally in this pass.

## 15. Recommended remediation (requires explicit authorisation)

1. **Correct the misclassification through the governed setter.** Call
   `omni_comms_priv_confirm_runtime_environment` with `non_production`, reason citing this
   document, and an evidence payload carrying the real deployment identity
   (`project_ref = xynceskeiiisiefqlgxo`, Lovable Cloud role `development`, distinct Live ref
   `pruvbfejdpodpalqafcu`). This appends a second event row; the original assertion stays in
   the immutable trail.
2. **Add a governed marker configuration path** (migration + service-role command) and seed
   `platform_environment_marker` truthfully:
   `environment_kind = 'TEST'`, `environment_label = 'Certification'`,
   `project_ref = 'xynceskeiiisiefqlgxo'`, `allows_controlled_test_activation = true`,
   notes referencing this document.
3. **Re-run the consistency check** — deployment identity, runtime environment and marker must
   agree semantically before the gate is consulted.
4. **Provision the certification posture** — `W4-CERT-*` personas and the sandbox email
   provider account with recipient allowlist.
5. **Only then** run DEF-4 governed EMAIL + IN_APP release, followed by Stage 1B.

Steps 1–2 change environment governance state and are held pending explicit instruction.

Stage 1B was **not** started. DEF-4 was **not** executed.
