# Implementation & Migration Approach

How a new institution goes from signature to live. Use this in proposals, in
technical due diligence, and whenever a buyer asks "how long and how risky?"

All durations are indicative and must be confirmed against scope:
`[CONFIRM: delivery timeline for this prospect]`.

---

## Delivery principles

1. **Configure first, customise last.** The default answer to a requirement is a
   configuration change. Code change is an exception that must be justified.
2. **Go live in slices, not in a big bang.** Each module has its own readiness
   gate; nothing goes live half-configured.
3. **The client's own team must be able to run it.** Administration screens, not
   vendor tickets, are the intended operating model.
4. **Migration is an auditable artefact.** Mapping is reviewed and approved by
   the client, not run silently by the vendor.
5. **Nothing is switched on that cannot be switched off.** Every channel and
   every automated workload has an explicit gate.

## Phase plan

### Phase 0 — Mobilisation
- Governance structure, steering committee, decision log.
- Environment provisioning (development, test, production).
- Access, identity and role mapping to the institution's actual job titles.
- Legacy system access for discovery and extraction.

**Exit:** signed scope, environments live, project team named on both sides.

### Phase 1 — Discovery and configuration design
- Statute and policy walkthrough: contribution rules, rates, ceilings, penalty
  rules, benefit products, eligibility conditions, calculation formulas.
- Organisation structure, departments, offices, numbering sequences.
- Correspondence inventory: every letter, notice and message the institution
  sends today, mapped to a business event and channel.
- Data quality assessment on the legacy extract.

**Exit:** configuration design document approved; legacy mapping drafted.

### Phase 2 — Core configuration build
- Organisation, departments, roles, permissions, approval chains.
- Reference data, numbering sequences, document profiles.
- Branding: letterhead, signature blocks, footers, disclaimers.
- Benefit products with versions, formulas, rate tables, eligibility rules —
  each taken through readiness and approval.
- Templates per business event per channel.

**Exit:** configuration versions pass readiness and are approved in test.

### Phase 3 — Data migration
- Extract from legacy, transform per the approved mapping, load into staging.
- Reconciliation: record counts, control totals, financial balances, sample
  case comparison signed off by the institution's own officers.
- Repeat the full run at least twice before the live run.

**Exit:** reconciliation report accepted; rehearsed cutover timings known.

### Phase 4 — Integration and communications
- Provider accounts for email, SMS, WhatsApp, voice, print `[CONFIRM: who
  procures]`.
- Banking and payment file formats.
- Channel test centre runs per channel; controlled dry run with no external
  dispatch, then a controlled pilot to a small internal recipient list.

**Exit:** each channel green in the test centre and approved for go-live.

### Phase 5 — UAT and training
- Scenario-based UAT owned by the institution, scripted per module.
- Role-based training: front office, contributions, benefits, compliance,
  legal, finance, administrators.
- Administrator training specifically on configuration governance — this is what
  removes long-term vendor dependency.

**Exit:** UAT sign-off, trained user register, defects triaged and closed.

### Phase 6 — Go-live and hypercare
- Final data run, cutover window, verification checklist.
- Channels enabled progressively — in-app and print before external SMS/email.
- Hypercare period with daily triage `[CONFIRM: duration]`.

**Exit:** steady-state support handover.

## Migration approach in detail

**What we migrate.** Persons and their identifiers, employers, employment and
wage history, contribution ledgers and balances, active and historical claims
and awards, payment history, open compliance and legal cases, documents.

**How we prove it.**

| Check | Evidence produced |
|---|---|
| Completeness | Source vs target record counts per entity |
| Financial integrity | Control totals: contributions, arrears, benefit payments |
| Referential integrity | Orphan report — zero tolerance on money-bearing records |
| Business correctness | Sampled cases recalculated and compared to legacy output |
| Traceability | Every migrated row carries its legacy key |

**What we do not do.** We do not silently fix bad legacy data. Data quality
exceptions are reported back to the institution to decide: correct, migrate as
is, or exclude. That decision is recorded.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Legacy data quality worse than expected | Early data assessment in Phase 1, exception register, client decisions logged |
| Policy ambiguity discovered late | Statute walkthrough in Phase 1 with the legal/policy owner in the room |
| Client staff availability | Named client resources with committed time in the contract |
| Scope creep via "small" requests | Change control against the configuration design document |
| Provider procurement delays | Channel dependencies identified in Phase 0, not Phase 4 |
| Parallel-run fatigue | Time-boxed parallel run with defined exit criteria, not open-ended |

## What we need from the client

- A policy owner who can decide rules, not just describe them.
- Access to the legacy database and to whoever understands it.
- Named business owners per module for UAT sign-off.
- Procurement of communication providers and payment rails.
- A decision on hosting and data residency.
