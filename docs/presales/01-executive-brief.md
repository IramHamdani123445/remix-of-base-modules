# Executive Brief

## In one sentence

A single, configuration-driven administration platform that runs the full
lifecycle of a national social security scheme — from registering a person or
employer, through contributions, compliance and enforcement, to benefit claims,
awards, payments and legal recovery — with every action audited and every
citizen communication issued through one governed channel.

## The problem it solves

Most social security boards and comparable public agencies run on some mix of:

- **Legacy desktop systems** (PowerBuilder, Oracle Forms, VB) that only a
  shrinking pool of people can maintain.
- **Paper and spreadsheets** for inspections, arrangements, legal cases and
  correspondence.
- **Disconnected point solutions** for email, SMS and printed letters, so no one
  can answer "what did we send this citizen, when, and who approved it?"
- **Hardcoded policy** — a rate change, a new benefit product or a penalty rule
  means a code release and a vendor invoice.

The result is slow service to citizens, weak audit trails, revenue leakage on
the contributions side, and total dependency on a single supplier.

## What this platform does differently

**One platform, not an integration project.** Registration, contributions,
benefits, compliance, legal, finance, documents, workflow and communications are
one system with one identity model and one audit trail — not seven products
stitched together.

**Configuration instead of customisation.** Benefit products, eligibility rules,
calculation formulas, rate tables, penalty rules, numbering sequences, workflow
approvals, document templates and correspondence are all administered from
screens by authorised staff, under governance. Policy change is an operational
task, not a development project.

**Governed by design.** Roles are held in the database, not in code. Sensitive
actions require maker-checker separation. Configuration versions must pass
readiness checks before they can be approved, and be approved before they can be
published. Ledgers are immutable.

**Omnichannel citizen communication, centrally controlled.** Email, SMS,
WhatsApp, printed letters, in-app notifications, push, webhooks and voice/IVR
are all issued through a single communication service. Business modules never
send anything directly — they raise a business event and the hub decides
template, branding, channel, approval, dispatch and retry. Every send is logged.

**A real migration path off legacy.** The platform carries an explicit
legacy-mapping framework that records how old tables and columns map to the new
model, so migration is documented and auditable rather than a one-off script.

## Value pillars

| Pillar | What it means to the buyer |
|---|---|
| **Single governed platform** | One vendor surface, one audit trail, one security model across all operations. |
| **Configuration over code** | Policy, rates, products, letters and workflows change without a release. |
| **Auditability end to end** | Who did what, when, on which record, under which approval — including every outbound message. |
| **Revenue protection** | Contribution assessment, compliance monitoring, enforcement, payment arrangements and legal recovery are one connected chain, not silos. |
| **Citizen service** | Self-service portals plus multi-channel notifications and an IVR that answers balance, contribution and claim-status questions without a human. |
| **Modern delivery** | Browser-based, responsive, no desktop install, cloud or self-hosted. |

## Who it is for

### Social security and social insurance boards
Direct domain fit. The platform already implements contribution collection,
coverage, benefit products and eligibility, claims and awards, payments, medical
review, life certificates, suspensions, overpayment recovery, mortality
handling, means tests, uprating and appeals. A new board is a configuration and
data-migration exercise, not a rebuild.

### Government agencies more broadly
The same spine — parties, obligations, assessments, collections, cases,
enforcement, payments, correspondence and audit — maps onto:

- **Revenue and tax authorities** — registration, filing, assessment, arrears,
  enforcement, payment arrangements.
- **Pension and provident funds** — membership, contributions, entitlement,
  payment runs, life certification.
- **Labour and employment agencies** — employer registry, inspections,
  violations, penalties, case management.
- **Licensing and regulatory bodies** — registration, obligations, compliance
  monitoring, notices, legal escalation.

For these buyers the pitch is the *platform* — governed configuration, workflow,
correspondence, audit, portals — with domain rules configured to their statute.

## Proof points to complete before external use

- `[CONFIRM: reference client naming]` — production reference implementation.
- `[CONFIRM: go-live dates]` — which modules are live and since when.
- `[CONFIRM: scale figures]` — registered persons, employers, staff users,
  annual transaction volumes.
- `[CONFIRM: commercial model]` — licence, implementation and support pricing.
