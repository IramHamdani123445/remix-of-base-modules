# RFP / Tender Compliance Matrix

A reusable requirement-by-requirement response grid. Copy the rows that match
the tender, paste the buyer's own wording into the requirement column, and keep
the compliance code and evidence note.

## Compliance codes

| Code | Meaning | When to use it |
|---|---|---|
| **C** | Compliant — built and in use today | Demonstrable in the product now |
| **CC** | Compliant by configuration | Exists, needs configuring to the client's rules |
| **PC** | Partially compliant | Core exists, a stated gap remains |
| **R** | Roadmap | Committed development, with a date `[CONFIRM]` |
| **NC** | Not compliant | Say so. Do not stretch a C into an NC's place. |

Never mark **C** for something a demo cannot show.

---

## Functional requirements

| # | Requirement | Code | Evidence / note |
|---|---|---|---|
| F1 | Register and maintain insured persons with unique identifiers | C | Insured person registry, identifiers, dependants, verification |
| F2 | Register and maintain employers, locations, owners | C | Employer registry and Employer 360 |
| F3 | Capture employment and wage history | C | Wage records tied to person and employer |
| F4 | Contribution filing and assessment, including self-employed and voluntary | C | C3 filing, missing/reported schedules, assessment |
| F5 | Penalty and interest calculation on late or short payment | CC | Rule-driven penalty configuration |
| F6 | Contribution receipting, batching and cashiering | C | Cashier and receipt/batch handling |
| F7 | Employer financial ledger with immutable posting | C | Append-only ledger protected by database triggers |
| F8 | Payment arrangements with instalments and breach tracking | C | Covered liability, allocation traceability, breach detection |
| F9 | Benefit product definition with versions and effective dating | C | Product catalogue with version governance |
| F10 | Configurable eligibility rules and calculation formulas | CC | Formula, rate table and matrix configuration under approval |
| F11 | Claim intake, assessment, award and payment | C | Full claim-to-award-to-payment chain |
| F12 | Medical review lifecycle | C | Medical review scheduling, outcome, effect on award |
| F13 | Life certificate lifecycle | C | Issue, certify, chase, suspend on failure |
| F14 | Award suspension and reinstatement | C | Suspension lifecycle with reasons and audit |
| F15 | Overpayment detection and recovery | C | Overpayment records, recovery plans, offsetting |
| F16 | Mortality handling | C | Death notification effects on awards and payments |
| F17 | Means testing | CC | Means test configuration and assessment |
| F18 | Benefit uprating / indexation runs | C | Uprating engine with snapshots and execution runs |
| F19 | Appeals | C | Appeal registration and progression |
| F20 | Compliance inspections and findings | C | Field inspection workflow, finding capture |
| F21 | Conversion of findings into violations | C | Policy-driven conversion controlled by violation types |
| F22 | Violation and case management with assignment | C | Case lifecycle, assignment, workload routing |
| F23 | Legal referral, judgment and cost recovery | C | Multi-stage legal lifecycle with maker-checker |
| F24 | Document generation and archive | C | Generated documents stored with checksum |
| F25 | Correspondence by email | C | Email channel live via provider adapter |
| F26 | Correspondence by SMS | C | SMS channel live via provider adapter |
| F27 | Correspondence by WhatsApp | C | WhatsApp channel with template and session handling |
| F28 | Printed letters with letterhead, batching, dispatch and audit | C | Print production, batch console, postal dispatch, print audit |
| F29 | In-app notifications | C | In-app delivery and notification bell |
| F30 | Push notifications | C | Push channel with device registration |
| F31 | Outbound webhooks to third-party systems | C | Signed webhooks with retry and SSRF protection |
| F32 | Voice / IVR self-service | C | Inbound IVR with identity verification and live data read-back |
| F33 | Template management with versioning and approval | C | Template master, versions, channel variants, approvals |
| F34 | Branding inheritance (organisation → department) | C | Branding defaults with resolution precedence |
| F35 | Workflow with maker-checker approvals | C | Server-enforced separation of duties |
| F36 | Role-based access control | C | Database-held role catalogue and permission registry |
| F37 | Full audit trail of user and system actions | C | Canonical audit logging |
| F38 | Self-service portals for claimants and employers | C | Claimant, employer, doctor and agent portals |
| F39 | Operational and management reporting | C | Reporting surfaces and exports |
| F40 | Bulk data import from legacy or payroll | CC | File ingestion, mapped per client format |

## Non-functional requirements

| # | Requirement | Code | Evidence / note |
|---|---|---|---|
| N1 | Browser-based, no desktop install | C | React SPA, responsive |
| N2 | Role-based navigation driven by permissions | C | Menu resolved from role model |
| N3 | Row-level data security | C | RLS policies on data tables |
| N4 | Encryption in transit | C | TLS throughout |
| N5 | Encryption at rest | C | Managed platform storage encryption |
| N6 | Secrets never exposed to the client | C | Provider credentials server-side only |
| N7 | Audit retention | CC | `[CONFIRM: retention period required]` |
| N8 | Backup and recovery targets | — | `[CONFIRM: RPO/RTO offered]` |
| N9 | Data residency | — | `[CONFIRM: hosting options offered]` |
| N10 | Availability target | — | `[CONFIRM: SLA offered]` |
| N11 | Performance under load | — | `[CONFIRM: benchmark figures]` — do not invent |
| N12 | Accessibility (WCAG) | PC | Semantic components and keyboard support; no formal audit `[CONFIRM]` |
| N13 | Multi-language / localisation | PC | Template localisation supported; full UI localisation is `Roadmap` |
| N14 | Single sign-on | CC | `[CONFIRM: client IdP]` |
| N15 | Formal security certification | NC | No SOC 2 / ISO 27001 attestation today |
| N16 | Disaster recovery site | — | `[CONFIRM]` |
| N17 | Automated regression testing | C | Test suite plus architecture-boundary tests in CI |
| N18 | Documented API for integration | CC | REST/RPC surface; published API doc pack `[CONFIRM]` |

## How to use this in a tender

1. Read the buyer's evaluation method first. Many tenders score **C** and **CC**
   identically; some penalise **CC**. Word accordingly, never falsely.
2. Every **C** must have a demo screen behind it. Build the demo list from the
   compliance matrix, not from the feature catalogue.
3. Every **R** needs an owner, a date and a contractual commitment, or drop it.
4. Leave the **NC** rows in. Tender panels trust a submission with honest gaps
   far more than one that claims everything.
