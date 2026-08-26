# FAQ and Glossary

## Frequently asked questions

**Is this a product or a bespoke build?**
A product. It is configured per institution — products, rates, formulas,
letters, workflow, roles and branding — but the code base is shared. Statute
differences are handled by configuration, not by forking.

**Can our own staff change rules, rates and letters?**
Yes, and that is the intended operating model. Configuration changes go through
draft, readiness validation, approval by a second person, and publication with
effective dating. Administrator training on this is part of delivery.

**Who can approve what?**
Roles live in the database with a permission registry. Critical permissions are
flagged. A submitter cannot approve their own work on benefit versions,
compliance progression, legal referrals, waivers or communication go-live.

**Can two versions of a benefit product be active at once?**
Only for non-overlapping effective periods. For any given transaction date
exactly one version applies.

**What happens if a configuration is incomplete?**
It cannot be approved. Readiness checks list the specific blockers — missing
formula, rate table, template or binding — and the version can be returned to
draft, corrected and resubmitted.

**How do you stop duplicate or rogue messages to citizens?**
Business modules cannot send. They raise a business event and the hub decides
template, branding, channel, approval, dispatch and retry. Idempotency keys
prevent duplicates, and CI tests fail the build if a module tries to bypass the
hub. There is a master kill switch plus a per-channel switch.

**Can we prove what was sent to a citizen?**
Yes — channel, template version, branding used, sender, approval, dispatch
attempts, outcome and, for print, the document checksum, page count and
dispatch address.

**Can it work offline, for field inspectors?**
Not today. Field inspection is browser-based and requires connectivity.
`Roadmap` if required.

**Does it support multiple languages?**
Template localisation is supported. Full user-interface localisation is
`Roadmap`.

**Can it integrate with our banking, payroll or national ID systems?**
Integration surfaces exist — REST/RPC, signed outbound webhooks, file ingestion.
Each specific integration is a scoped piece of work against the counterparty's
interface.

**Where is our data hosted?**
`[CONFIRM: hosting/residency options]`.

**What about backups and disaster recovery?**
`[CONFIRM: RPO/RTO and DR arrangements offered]`.

**Do you hold SOC 2 or ISO 27001?**
No. We describe controls we actually implement — RLS, role separation,
maker-checker, audit logging, secret handling, SSRF protection — but we make no
certification claim.

**How long does implementation take?**
Scope-dependent. See `08-implementation-and-migration.md` for the phase plan.
`[CONFIRM: indicative timeline]`.

**What does it cost?**
`[CONFIRM: commercial model]` — licence, implementation and support.

**What happens to our legacy data?**
It is migrated under an approved table-by-table mapping, reconciled on counts,
control totals and sampled recalculation, and every migrated record keeps its
legacy key. Bad data is reported, not silently corrected.

**Can we exit if we want to?**
Data is in standard PostgreSQL and can be exported in full. Document archives
are standard files. `[CONFIRM: contractual exit assistance terms]`.

---

## Glossary

| Term | Meaning in this platform |
|---|---|
| **Insured person** | A registered individual covered by the scheme |
| **Employer** | A registered entity liable to contribute for employees |
| **Contribution schedule (C3)** | The periodic filing of wages and contributions by an employer |
| **Assessment** | The system's determination of what is owed for a period |
| **Arrears** | Assessed liability not yet settled |
| **Penalty / surcharge** | Rule-driven charge for late or short payment |
| **Employer ledger** | Append-only financial record of an employer's postings |
| **Payment arrangement** | An agreed instalment plan covering identified liability |
| **Breach** | Failure to meet an arrangement instalment, detected by the system |
| **Violation** | A recorded instance of non-compliance |
| **Finding** | An observation from an inspection, which may convert to a violation |
| **Case** | A managed unit of compliance or legal work with assignment and lifecycle |
| **Referral** | Escalation of a case from compliance to legal |
| **Benefit product** | A configured benefit type with versions, rules and formulas |
| **Product version** | A dated, governed rule set: draft, submitted, approved, active |
| **Readiness** | Computed check that a version has everything it needs to operate |
| **Claim** | An application for a benefit |
| **Award** | An approved entitlement arising from a claim |
| **Payment instruction** | The instruction to disburse an award payment |
| **Life certificate** | Periodic proof-of-life requirement for a beneficiary |
| **Medical review** | Scheduled reassessment of a medical condition affecting an award |
| **Suspension** | Temporary stop on an award, with reason and audit |
| **Overpayment** | Benefit paid in excess of entitlement, subject to recovery |
| **Uprating** | Periodic indexation of benefit amounts |
| **Means test** | Assessment of income/assets against a threshold |
| **Maker-checker** | Enforced separation between the person who submits and the person who approves |
| **Business event** | A named thing that happened in a module, which may trigger communication |
| **Communication hub** | The single service that resolves and dispatches all outbound messages |
| **Channel** | A delivery route: email, SMS, WhatsApp, print, in-app, push, webhook, voice |
| **Template version** | A governed, approved content version for a business event and channel |
| **Branding inheritance** | Letterhead, signature, footer and disclaimer resolved from organisation and department defaults |
| **Print item** | A physical letter with its own production and dispatch state |
| **Configuration registry** | The catalogue of governed configurable assets and their dependencies |
| **Consumption registry** | The record of which module owns a table and who may read it |
| **Legacy mapping** | Approved table/column mapping from the old system to the new model |
