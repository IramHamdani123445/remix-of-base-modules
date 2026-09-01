# Proposal & RFP Boilerplate

Reusable text for proposals, tender responses and MoUs. Every block is written
to be safe to send once the `[CONFIRM]` placeholders are replaced. Delete any
paragraph you cannot stand behind for the specific client.

---

## 1. Solution overview

> We propose the implementation of an integrated social security and public
> administration platform covering the full operational lifecycle of the
> institution: registration of persons and employers; contribution filing,
> assessment and collection; compliance monitoring, inspection and enforcement;
> payment arrangements and legal recovery; benefit product administration,
> claims, determination, awards and payments; finance and general-ledger
> integration; document management; and multi-channel correspondence with
> citizens and employers.
>
> The platform is a single browser-based system with one identity model, one
> workflow engine, one document repository, one communication service and one
> audit trail. It is not an assembly of separate products.
>
> Institutional policy — benefit products, eligibility conditions, calculation
> formulas, rate tables, contribution and penalty rules, numbering, approval
> workflows and correspondence templates — is held as governed configuration
> administered by authorised staff, rather than embedded in program code.

## 2. Functional scope

> The functional scope proposed for this engagement is set out in the Feature
> Catalogue attached as Annex `[CONFIRM: annex letter]`. Modules included in
> Phase 1 are `[CONFIRM: phase 1 modules]`. Modules identified for later phases
> are `[CONFIRM: later phases]`.
>
> Any capability not expressly listed in the Feature Catalogue is outside scope
> unless separately agreed in writing.

## 3. Delivery approach

> Delivery follows five workstreams executed in overlapping phases.
>
> **1. Assessment and mapping.** Review of the institution's governing
> legislation, operating procedures, existing systems and data. Output: a
> statute-to-configuration mapping, a data-quality assessment and a confirmed
> implementation schedule.
>
> **2. Configuration.** Establishment of organisation structure, offices,
> departments, designations and approval hierarchy; reference and master data;
> contribution rules; benefit products and rules; workflows; branding and
> correspondence templates. Configuration follows a defined sequence so that
> dependencies are satisfied in order.
>
> **3. Data migration.** Legacy structures are mapped to the target model
> through the platform's legacy mapping framework, with each mapping recorded
> and approved. Migration runs are repeatable and reconciled, with exception
> reports signed off by the institution before cut-over.
>
> **4. Verification and acceptance.** Configuration verification, functional
> testing, user acceptance testing against agreed scenarios, and a documented
> readiness review per module prior to go-live.
>
> **5. Training, go-live and stabilisation.** Role-based training for
> operational staff and administrators, a phased go-live, and a defined
> stabilisation period `[CONFIRM: stabilisation duration]` before transition to
> steady-state support.
>
> Phasing is recommended over a single cut-over. Each module carries independent
> readiness controls, permitting one area to go live without destabilising
> others.

## 4. Configurability and change control

> Policy change is designed to be an operational activity, not a software
> release. Rates, thresholds, benefit products, eligibility rules, calculation
> formulas, penalty rules, approval workflows and correspondence content are
> configured through administration screens by authorised staff.
>
> Configuration is itself governed. Changes are recorded in a configuration
> registry with dependency tracking, validated before activation, versioned with
> effective dates, and subject to approval by a person other than the person who
> proposed them. Configuration versions cannot be approved while unresolved
> blocking issues exist, and can be reverted.

## 5. Security, access control and audit

> Access is controlled through a database-governed role catalogue and permission
> registry; roles and permissions are configuration, not code. Permissions
> carrying elevated risk are classified and separately controlled.
> Authorisation is enforced on the server for every privileged operation, in
> addition to row-level access controls on the underlying data.
>
> Separation of duties is enforced by the platform. For designated actions —
> including benefit product approval, compliance case progression, legal
> referral, waiver approval and activation of outbound communication — the
> approving user must be different from the initiating user.
>
> Privileged actions are recorded in a canonical audit log capturing the actor,
> the action, the affected record, the timestamp and the approval under which it
> was taken. Financial ledgers are append-only: corrections are recorded as new
> postings and history is never overwritten. Every outbound communication is
> logged with its template version, channel, recipient, dispatch attempts and
> outcome.
>
> No certification is claimed. Where the institution requires certification
> against a specific standard, this can be scoped as a separate exercise
> `[CONFIRM: current certification position]`.

## 6. Communication with citizens and employers

> All outbound correspondence is issued through a single governed communication
> service supporting electronic mail, SMS, WhatsApp, printed letters, in-app
> notification, push notification, outbound webhooks and voice/IVR.
>
> Operational modules do not send correspondence directly. They raise a business
> event; the communication service determines the applicable template and
> version, applies institutional branding, letterhead, signature and disclaimer,
> selects the sending account, applies any required approval, and manages
> queueing, dispatch, retry and logging. This ensures a complete and consistent
> record of every communication issued by the institution.
>
> Printed correspondence is produced with the institution's own letterhead and
> tracked through a physical production lifecycle including batch, printer,
> dispatch, postal address and an audit record with page count and document
> checksum.

## 7. Self-service

> Self-service portals are provided for claimants, employers, medical
> practitioners and authorised agents, permitting online submission, document
> upload and status tracking. An interactive voice response service allows
> callers to obtain account balance, contribution and claim-status information
> after identity verification, reducing demand on the contact centre.

## 8. Technology and hosting

> The platform is a browser-based application requiring no desktop installation,
> built on standard, widely supported technologies with a PostgreSQL relational
> database. Deployment options are `[CONFIRM: hosting/residency options]`.
> Background processing is executed by scheduled workers with monitoring and
> single-execution guarantees, observable by the institution's own operations
> staff.

## 9. Knowledge transfer and sustainability

> Delivery includes role-based training for operational users, administrator
> training covering configuration and platform operations, written and in-application
> documentation, and a knowledge-transfer programme for the institution's
> technical staff. `[CONFIRM: source code / escrow position]`.

## 10. Support

> `[CONFIRM: support tiers, hours of cover, response and resolution targets,
> escalation path, maintenance and upgrade policy]`.

## 11. Assumptions and dependencies

> This proposal assumes:
> - the institution will nominate a project sponsor and empowered business
>   owners for each functional area;
> - the institution will provide timely access to governing legislation,
>   operating procedures, existing system documentation and data extracts;
> - policy decisions required for configuration will be made within agreed
>   timeframes;
> - the institution is responsible for the accuracy and completeness of legacy
>   data supplied for migration;
> - named third-party integrations are limited to those listed at
>   `[CONFIRM: named integrations]`, and the respective system owners will make
>   interfaces and test environments available;
> - user acceptance testing will be resourced by the institution.
>
> Changes to governing legislation during implementation are handled through
> change control.

## 12. Commercial

> `[CONFIRM: licence or subscription model, implementation fee and payment
> milestones, support and maintenance fee, currency, validity period of the
> offer, applicable taxes]`.

---

## Drafting warnings

Do not add to a proposal, under any circumstance, without evidence:

- Certification or compliance claims (SOC 2, ISO, GDPR, HIPAA, PCI).
- Uptime or availability guarantees not backed by a contracted SLA.
- Performance or throughput figures that have not been measured.
- Named client references without written consent.
- Fixed prices or fixed dates issued before the assessment is complete.
- Statements that a module is delivered when it is roadmap.
