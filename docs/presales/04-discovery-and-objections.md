# Discovery Questions & Objection Handling

## Part A — Discovery questions

Ask these before proposing anything. The answers determine whether this is a
three-month configuration exercise or a two-year programme.

### Institutional context
1. What schemes and benefit types do you administer today, and under which act
   or regulation?
2. How many registered persons, active contributors and registered employers?
3. How many staff will use the system, across how many offices?
4. Who is the executive sponsor, and what is driving the timing — a system
   end-of-life, an audit finding, a policy reform, a funding window?

### Current systems
5. What runs contributions today? What runs benefits? Are they the same system?
6. What is the underlying technology and who maintains it?
7. What is *not* in a system today — inspections, legal cases, arrangements,
   correspondence?
8. Where does the data live, in what shape, and can we get a schema and a sample
   extract?
9. What integrations must survive — banking, treasury, general ledger, national
   ID, tax authority?

### Process and pain
10. What is the current turnaround time from claim receipt to first payment?
11. How are arrears identified and pursued today, and what is the recovery rate?
12. How do you currently send letters, and how do you prove one was sent?
13. What does your internal audit or external auditor most often flag?
14. Do citizens or employers have any self-service today?

### Constraints
15. Cloud, on-premise, or does data have to stay in-country?
16. What is the procurement route — tender, sole source, framework, donor-funded?
17. What is the budget envelope and fiscal-year timing?
18. Who else are you talking to?

### Qualification red flags
- No named executive sponsor.
- No budget line and no procurement route.
- "We just want a quote to compare" with no discovery access.
- Expectation of a fixed price before any data assessment.
- A statutory rewrite in progress that will change the rules mid-project.

---

## Part B — Objection handling

Answer honestly. A lost deal is cheaper than an unwinnable delivery.

### "You are a small vendor. What if you disappear?"
Fair concern. The mitigations are contractual and technical: source-code escrow
or full source delivery `[CONFIRM: which we offer]`, standard open technologies
(PostgreSQL, standard web stack) with no proprietary runtime, and configuration
held as data in your own database. Knowledge transfer and administrator training
are part of delivery so your team can operate it without us. Offer a reference
call `[CONFIRM: reference client naming]`.

### "This was built for another country. Our law is different."
Expected — and it is why the platform is configuration-driven. Benefit products,
eligibility rules, formulas, rate tables, contribution rules, penalties,
numbering, workflows and correspondence are all configured, not coded. What
genuinely needs analysis is your statute-to-rule mapping, which is a defined
workstream in the proposal, not a surprise.

### "How long will it take?"
Do not answer with a number before discovery. The honest framing: the software
exists, so the timeline is driven by three things — statute-to-configuration
mapping, data migration quality, and your change-management capacity. We can
give a defensible schedule after a two-to-four-week assessment
`[CONFIRM: assessment duration and price]`.

### "Our data is a mess."
It always is, and it is the number one cause of failure. That is why the
platform has an explicit legacy mapping framework and a migration control
centre: mappings are recorded, approved and re-runnable, and quality issues
surface as reports your team signs off — rather than being discovered after
go-live.

### "Can we do it in phases?"
Yes, and we recommend it. The natural sequencing is: foundation and reference
data → registration (person and employer) → contributions → compliance →
benefits → legal and finance, with communications enabled progressively per
channel. Each module has its own readiness gates, so a phase can go live without
destabilising the rest.

### "What about the big vendor's product?"
They have brand and scale. The trade is cost, pace and control: with a large
COTS product, every deviation from their model is a change request, and you
adapt your process to their software. Here, policy is configuration your own
staff administer. If brand risk is the deciding factor for your board, say so
now and we will not waste your procurement cycle.

### "Is it secure?"
Row-level access control on data, server-side authority checks on every
privileged action, a database-held role catalogue with a permission registry
that flags critical permissions, enforced separation of duties, and canonical
audit logging across privileged actions. Provider credentials are never held in
front-end code. We do **not** claim any certification — if you require SOC 2,
ISO 27001 or a specific national standard, that is a scoped exercise we should
price separately `[CONFIRM: current certification position]`.

### "Can it handle our volume?"
Give the reference-implementation figures once confirmed
(`[CONFIRM: scale figures]`) and offer a load test against their stated volumes
as part of the assessment. Do not quote a transactions-per-second number we have
not measured.

### "Can our own IT team maintain it?"
Yes, that is the intent. Standard web and PostgreSQL skills, administration is
screen-driven, configuration is data, and there is an in-app administrator
manual. Discuss source access and training as part of the commercial terms.

### "We need it to integrate with X."
Ask what X is, who owns it, and whether it has an API. The platform has external
API management and API key administration, plus outbound webhooks. Named
integrations are scoped line items, not assumed inclusions.

### "Price?"
Never quote before discovery. Frame it as three components — licence or
subscription, implementation (configuration, migration, training), and ongoing
support — and commit to a written proposal after the assessment
`[CONFIRM: commercial model]`.

---

## Part C — Questions we must answer internally before promising anything

1. Which modules do we consider production-grade for a **new** client, and which
   need hardening?
2. What is our realistic implementation capacity — how many concurrent clients?
3. What is our support model and its hours, response times and escalation path?
4. Do we offer source escrow, source delivery, or neither?
5. What hosting options do we support, and who holds the data-protection
   obligation in each?
6. What is our position on certification, and are we willing to fund an audit?
7. What is the minimum deal size worth pursuing?
