# Feature Catalogue

Module-by-module capability list. Everything below is implemented in the
product today unless explicitly marked `Roadmap`. Use this document as the
functional annex to an RFP response.

---

## 1. Person Registration & Insured Person Management

Registers and maintains the citizen/member record that every other module
depends on.

- Insured person registration with identity capture, demographics, contact and
  address details.
- Social security number issue and lookup; duplicate detection on registration.
- Person 360 view consolidating employment history, contributions, claims,
  awards, payments, documents and correspondence in one place.
- Self-employed registration and management as a distinct contributor category.
- Voluntary contributor registration with rules-driven eligibility (residency,
  age band, no active employment, grace period after termination) and automatic
  cessation when residency changes.
- Employment history maintenance — employer links, start and termination dates.
- Identity document management with document type masters and expiry tracking.
- Member card / IP card configuration and issue.
- Online applications intake for registrations submitted through the portals.

## 2. Employer Registration & Employer 360

- Employer registration and registry with statutory identifiers, trading names,
  legal form, addresses and contacts.
- Employer 360 view: registration details, employees, contribution filings,
  arrears, compliance history, cases, arrangements and correspondence.
- Employer financial ledger — an immutable, append-only record of every charge,
  payment, penalty, interest posting, adjustment and write-off, with running
  balance and recalculation controls.
- Multi-branch / multi-location employer support.
- Employer self-service portal access with approval controls.
- Bulk employer data import with validation and error reporting.

## 3. Contributions (C3)

Collection of contributions from employers, self-employed and voluntary
contributors.

- Contribution filing wizard for employers, including field-level change
  tracking on amendments.
- Self-employed and voluntary contributor filing paths with their own rate and
  calculation configuration.
- Wage and earnings recording, wage history and average-weekly-wage derivation.
- Contribution assessment: contribution, levy and surcharge calculation driven
  by configurable rates, income categories, income codes and levy slabs.
- Penalty and interest calculation with configurable rules per contributor type.
- Contribution period configuration — filing periods, due dates, grace periods.
- Payment allocation rules controlling how a receipt is applied across
  principal, penalty, interest and levy.
- Contribution statements and passbook-style views per employer and per person.
- Configurable calculation engine administered from
  `Administration → C3 Calculation Configuration` — no code change to move a
  rate, threshold, age band or slab.

## 4. Benefits

The largest functional area. Covers product definition through to payment and
post-payment review.

### 4.1 Benefit product configuration
- Benefit product master with versioning: draft → submitted → approved →
  published/active, each version carrying its own effective dates.
- Eligibility rule builder — contribution conditions, age, coverage, dependency
  and residency tests expressed as configurable rules, not code.
- Calculation formula library, rate tables and matrix tables, all versioned.
- Rule Version Governance: a version cannot be approved while blocking
  readiness issues exist, and a failed version can be returned to draft for
  correction.
- Conflict detection and readiness panel showing exactly which bindings,
  formulas or templates are missing before a version can go live.
- Maker-checker: the person who submits a version cannot be the person who
  approves it.

### 4.2 Claims and determination
- Claim intake and claim workbench with queue management.
- Eligibility determination against the active product version for the claim
  date.
- Benefit calculation with full traceability of which formula, rate table and
  version produced the figure.
- Decision management, approval console and batch operations.
- Appeals lodgement and tracking.

### 4.3 Awards, payments and servicing
- Award creation, entitlement management and award servicing.
- Payment schedules, payables queue, payment issue and batch payment runs.
- Post-issue review and reconciliation back to finance.
- Historical inquiry across legacy and current benefit data.

### 4.4 Ongoing benefit administration
- **Medical reviews** — scheduling, review outcomes, effect on entitlement.
- **Life certificates** — issue, return, certification and non-return handling.
- **Award suspensions** — suspension and reinstatement with reasons and audit.
- **Overpayment recovery** — overpayment raising, recovery plans, offsets.
- **Mortality handling** — death notification, award cessation, survivor paths.
- **Means tests** — assessment capture and effect on entitlement.
- **Uprating** — scheme-wide benefit uprating with snapshots, dry-run execution
  and closure, so an uprating can be modelled before it is committed.
- **Risk and fraud** — risk scoring and referral into compliance/legal.

## 5. Compliance & Enforcement

- Compliance dashboards and staff work queues.
- Risk-based case selection, sampling and audit planning.
- Field inspection management — scheduling, inspector assignment, mobile-capable
  field workflow, findings capture.
- Policy-driven conversion of inspection findings into violations, controlled by
  configurable violation types.
- Violation management with automatic assignment and routing rules.
- Compliance case lifecycle with stage gates and server-side workflow
  enforcement (a stage cannot be skipped from the UI).
- Notices and warning letters issued through the communication hub.
- **Payment arrangements** — instalment plans against specific covered
  liabilities, with breach detection, concurrent-arrangement protection and
  full allocation traceability back to the employer ledger.
- Waivers with approval control.
- Enforcement actions and penalties.
- Escalation to Legal through a defined multi-stage referral lifecycle with
  maker-checker protection.
- Compliance reporting and geography/staff-based work distribution.

## 6. Legal

- Legal referral intake from compliance, with a nine-stage referral lifecycle.
- Case intake wizard, case list, case detail and case tracking.
- Court order management and hearing calendar.
- Evidence and legal document management.
- Enforcement actions and penalties on the legal track.
- Delinquent case register.
- Legal cost recovery posting back to the employer ledger.
- Appeal submission handling.
- Bulk case import from Excel for migration of existing legal files.
- Legal reference data administration (courts, case types, statutes, outcomes).

## 7. Finance

- Cashier and payment entry with receipting.
- Receipt search, reversals and penalty adjustments.
- Invoice management.
- Payment arrangement detail from the finance side.
- Batch management for disbursement runs.
- General ledger integration and GL export.
- Accounts payable.
- Daily reports, finance dashboards and financial reporting.
- Fee configuration and finance administration screens.

## 8. Omnichannel Communications Hub

A single governed sending spine. Business modules raise a business event; the
hub decides everything else.

- **Channels supported:** Email, SMS, WhatsApp, Printed letter, In-app
  notification, Web/mobile Push, Outbound webhook, Voice/IVR.
- Single façade — no module sends directly; there are no shadow senders.
- Business event registry mapping module + department + event to templates and
  channels.
- Template workspace: template master, versions, channel variants, tokens,
  layouts, localisation, draft authoring with responsive preview and approval.
- Branding and stationery inheritance — organisation letterhead, logo,
  signature, header, footer and disclaimer resolved automatically per
  department and document type.
- Provider administration in-screen: sender accounts, sender addresses, SMS
  sender IDs, WhatsApp senders, voice numbers and webhook endpoints.
- Delivery control centre with per-channel on/off gates, release control and a
  master delivery switch — an operator can stop all outbound traffic instantly.
- Asynchronous queue, dispatch scheduler, retry policies, idempotency keys and
  delivery-attempt logging.
- Test centre with preflight checks and controlled test delivery per channel.
- **Physical print production**: print items with a server-side physical state
  machine, print batches, printer register, PDF generation with real letterhead,
  dispatch and postal address capture, and a print audit trail recording letter,
  outcome, device, page count and PDF checksum.
- **Inbound voice / IVR**: caller identification, SSN and date-of-birth
  verification, and spoken self-service answers for current balance, last
  contribution, latest claim status and payment information, sourced live from
  the database.
- Full event log and audit for every request, delivery and attempt.
- Recipient preference handling and PII masking in operator consoles.

## 9. Document Management

- Core DMS with document type masters and metadata.
- Generated document archive — every official PDF or letter produced by the
  platform is stored and retrievable against the case, claim, employer or
  person.
- Document configuration, categories and retention settings.
- Document upload, versioning and secure retrieval.
- Bulk document handling for migration.

## 10. Workflow, Approvals & Task Management

- Configurable workflow templates with stages, approvers and approver types.
- Maker-checker enforcement as a platform primitive, not a per-module feature.
- Task and workbasket management per role and per office.
- SLA and escalation configuration.
- Approval consoles in benefits, compliance, legal and configuration governance.
- Central scheduler for recurring platform jobs, with worker health monitoring.

## 11. Organisation Management

- Organisation profile, locations and branches, departments.
- Designation and approval hierarchy.
- Module ownership and per-module defaults.
- Brand asset library: media, letterheads, signatures, headers/footers,
  disclaimers, portal branding, document assets.
- Communication library: document templates, notification templates, text
  blocks, tokens, categories, channels, languages and translations.
- Configuration Center with a defined ten-step golden path for standing up a new
  organisation.
- Health dashboard, usage validation, impact analysis and broken-reference
  detection across all configuration.
- In-app user manual for organisation administrators.

## 12. Identity, Roles & Security

- Staff profiles extending the base user record: employment status, staff type,
  hire and termination dates, supervisor.
- Staff assignments to office, department and designation over time, with a
  guaranteed single active primary assignment.
- Account security state — active, locked, suspended, disabled — with MFA
  fields.
- Delegation of authority: delegator to delegate, scoped by module or
  permission, with an effective window and approval.
- Database-governed role catalogue — roles are data, never hardcoded.
- Permission registry with criticality levels; sensitive permissions such as
  role management are flagged and separately controlled.
- Row-level security on data access, plus server-side authority checks on every
  privileged operation.
- API key management and external API administration.

## 13. Reference & Master Data Administration

- Geography — countries, states, districts, parishes, constituencies.
- Identity reference — document types, title, gender, marital status, relations.
- Financial reference — banks, branches, payment channels, currencies.
- Legal reference — courts, statutes, case types.
- Document type masters.
- Numbering rules and sequences per record type.
- Public holidays and working calendar.
- Formula and rule library.
- Legacy mapping administration — a dictionary of how legacy tables and columns
  map to the modern model, with approval status per mapping.
- Enterprise Consumption Registry — a formal record of which module owns which
  table and which modules may consume it, preventing duplicate implementations.

## 14. Portals (Citizen & Partner Self-Service)

- **Claimant portal** — apply, upload documents, track claim status, view
  payments and notifications.
- **Employer portal** — file contributions, view statements and arrears, manage
  employees, submit waivers, receive notices.
- **Doctor portal** — receive and submit medical assessments.
- **Agent portal** — act on behalf of registered parties.
- Shared external task framework: secure task links, external authentication,
  notification bell and approval controls for portal submissions.
- Portal branding driven from organisation management, not hardcoded.

## 15. Reporting, Analytics & Audit

- Operational dashboards per module and per role.
- Report library with export to Excel and PDF.
- Compliance, legal, finance and benefits reporting suites.
- Canonical audit logging across every privileged action, with an audit log
  administration screen.
- Field-level change tracking on sensitive records.
- System logs, notification logs, email logs and print audit.
- Audit calendar and audit planning.

## 16. Platform & Operations

- Browser-based; no desktop client to install or patch.
- Cloud-hosted or self-hosted deployment `[CONFIRM: hosting/residency options]`.
- Edge/serverless background workers with single-flight leasing, so scheduled
  jobs cannot double-run.
- Worker health monitoring panel and central scheduler console.
- Data migration control centre and migration lifecycle tracking.
- Configuration governance: registry, dependencies, packages, validation,
  snapshots and impact analysis, so a configuration change can be reviewed and
  rolled back.
- Environment markers and readiness gates preventing test configuration from
  reaching production behaviour.

---

## Explicitly not claimed

The following are **not** presented as delivered capability. Raise them only as
scoped work:

- Any statutory rule set for a jurisdiction other than the reference
  implementation — those are configuration and analysis work.
- Biometric identity capture or national ID card production.
- Actuarial valuation and scheme projection modelling.
- Payroll processing on behalf of employers.
- Mobile native applications (the platform is responsive web).
