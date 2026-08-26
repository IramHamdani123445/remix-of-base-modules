# Demo Script

Two versions: a 30-minute standard demo and a 10-minute short form. Both are
built around one narrative thread — **follow one employer and one citizen all
the way through** — rather than a tour of menus. A menu tour is the fastest way
to lose the room.

## Before you start

- [ ] Use demo data only. Never demo against live citizen records.
- [ ] Log in as a role that shows the right menu for the audience (an operations
      audience should not see the platform administration tree).
- [ ] Pick your employer and your citizen in advance and know their history.
- [ ] Have the print/PDF preview and the IVR simulator ready — they land well.
- [ ] Disable any real outbound delivery before demoing communications.

---

## Standard demo — 30 minutes

### 0. Frame (2 min)
"I am going to follow one employer who has fallen into arrears, and one citizen
who claims a benefit. You will see the same audit trail and the same
communication spine behind both."

Do not open with architecture.

### 1. Employer 360 (4 min)
Open the employer. Show registration details, employees, contribution filings,
and then the **financial ledger** — every charge, payment, penalty and
adjustment with a running balance.

Point to make: "This ledger is append-only. Corrections are new entries. Any
balance you dispute can be reconstructed line by line."

### 2. Contribution filing (3 min)
Open the contribution filing wizard. Show wage entry, automatic calculation of
contribution, levy and penalty, and the configuration screen behind it.

Point to make: "That rate came from configuration your staff administer, not
from our code. A rate change is an afternoon, not a release."

### 3. Compliance case and payment arrangement (5 min)
Show the arrears position, the violation, the case, then create or open a
**payment arrangement** — covered liability, instalment schedule, breach
detection. Show an instalment allocating back to the ledger.

Point to make: "Arrears, enforcement, arrangement and accounting are one chain,
not four spreadsheets."

### 4. Legal escalation (2 min)
Show the referral to Legal, the stage lifecycle and the maker-checker on
progression.

Point to make: "The officer who refers cannot approve the referral. That is
enforced in the database, not by policy."

### 5. Switch to the citizen — claim to award (6 min)
Open the claim workbench. Show a claim, the eligibility determination, the
calculation with its traceability back to a specific product version, formula
and rate table, then the decision and the award.

Then open **benefit product configuration** briefly: show a version, its
readiness panel with blocking issues, and the fact that approval is blocked
until they are resolved.

Point to make: "The system will not let you approve a product that is not
ready — and it tells you exactly what is missing."

### 6. Communications (5 min)
This is the differentiator. Show:
- the outbound letter generated for the award, with real letterhead, signature
  and footer resolved automatically;
- the print preview / save-as-PDF;
- the print audit entry with outcome, pages and checksum;
- the delivery control centre with per-channel switches;
- the same event delivered as SMS or WhatsApp;
- the **IVR simulator** answering a balance or claim-status query.

Point to make: "Eight channels, one governed door, every send logged. And we can
stop all outbound traffic with one switch."

### 7. Audit and governance (2 min)
Open the audit log against one of the records you just touched. Show who did
what, when, under which approval.

### 8. Close (1 min)
"Everything you saw is configuration, not custom code for this demo. The
question for us to work through is how your statute maps onto that
configuration, and what shape your existing data is in."

Then go to discovery questions (`04-discovery-and-objections.md`).

---

## Short demo — 10 minutes

For a first call or a busy principal. Three beats only:

1. **Employer 360 + financial ledger** (3 min) — one view of the employer, an
   immutable money trail.
2. **Claim → determination → award with traceability** (4 min) — the decision
   can always be explained.
3. **Communications: letter with real branding + delivery control centre + IVR**
   (3 min) — the capability nobody expects.

Close with one sentence and one question: "That is the platform. What is the
thing that is hurting you most right now?"

---

## Demo hygiene

- **Never** invent a number on screen. If they ask "how many can it handle?",
  say you will answer with a measured figure, not a guess.
- If something breaks, say so plainly and move on. Do not narrate around it.
- If asked for a feature that does not exist, say it does not exist and note it.
  Write it down visibly — buyers trust that more than a yes.
- Do not show the platform administration and governance trees to a
  non-technical audience; it reads as complexity, not as control.
- Leave the executive brief (`01-executive-brief.md`) and the feature catalogue
  (`02-feature-catalogue.md`) behind.
