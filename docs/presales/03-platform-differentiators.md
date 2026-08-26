# Platform Differentiators — Talk Track

Use these when the buyer asks "why you, and not the big vendor or a custom
build?" Each point below is architecture that is actually in the product, with
the business consequence spelled out. Lead with the consequence, not the
mechanism.

---

## 1. Configuration governance, not a settings page

**Mechanism.** Configuration is a first-class governed asset. There is a
configuration registry, dependency tracking, configuration packages, validation,
snapshots and impact analysis. Business modules are forbidden from reading
policy tables directly — they call approved resolvers.

**Why the buyer cares.** You can change a rate, a benefit product, a penalty
rule or a letter and know in advance what it affects, who approved it, and how
to roll it back. Configuration change stops being the riskiest thing you do.

**Say this.** "Most systems let you change a setting. This one makes you prove
the change is safe, records who approved it, and can undo it."

---

## 2. Readiness gates before anything goes live

**Mechanism.** A benefit product version, a template, a channel or a
configuration package cannot be approved while blocking issues exist. Readiness
is computed from the actual bindings — missing formula, missing rate table,
missing template — and shown as a specific list. A version that fails can be
returned to draft, corrected and resubmitted.

**Why the buyer cares.** No half-configured product ever pays a claim. The
system refuses, and tells the officer exactly what is missing.

**Say this.** "The system will not let you approve something that is not ready,
and it tells you precisely why."

---

## 3. Maker-checker as a platform primitive

**Mechanism.** Separation of duties is enforced server-side, not in the UI. The
role catalogue lives in the database with a permission registry that flags
critical permissions. Submitters cannot approve their own work — in benefit
version governance, compliance case progression, legal referral, waivers, and
communication go-live.

**Why the buyer cares.** Audit and internal-control requirements are met by the
platform rather than by procedure and trust.

**Say this.** "Four-eyes is not a policy document here. The database enforces
it."

---

## 4. One communication spine — no shadow senders

**Mechanism.** Business modules never send email, SMS, WhatsApp, print, push,
webhooks or voice directly. They raise a business event. The hub resolves
template, active version, branding, letterhead, signature, footer, disclaimer,
sender account, approval requirement, queueing, dispatch, retry and logging.
Architecture tests in CI block any module that tries to bypass it.

**Why the buyer cares.** You can answer, for any citizen, "what did we send,
through which channel, from which template version, approved by whom, and did it
arrive?" — across every channel, in one place. And you can turn all outbound
traffic off with one switch.

**Say this.** "Every letter, text and call the institution makes goes through
one governed door, and that door is logged."

---

## 5. Immutable financial ledgers

**Mechanism.** The employer financial ledger is append-only and protected by
database triggers. Corrections are new postings, never edits. Payment
arrangements record covered liability and every instalment allocation, so any
balance can be traced to its constituent postings.

**Why the buyer cares.** The balance a citizen or employer disputes can always
be reconstructed. Nobody can quietly change history.

---

## 6. A documented path off legacy

**Mechanism.** A legacy mapping framework records, table by table and column by
column, how the old system maps to the new model, with an approval status per
mapping. Migration control and lifecycle tracking sit alongside it.

**Why the buyer cares.** Migration is the part that kills these projects.
Here it is an auditable artefact the client's own team can review, not a black
box script the vendor runs at 2am.

**Say this.** "We do not ask you to trust the migration. We show you the map."

---

## 7. Module ownership is contractual, not conventional

**Mechanism.** An Enterprise Consumption Registry records which module owns
which table and which modules may consume it. Applications provide a capability
or consume it — never both. Duplicate implementations are rejected in review.

**Why the buyer cares.** The system does not rot into seven versions of "the
employer record". Ten years in, it is still one platform.

---

## 8. Self-service IVR built on live data

**Mechanism.** Inbound voice identifies the caller, verifies identity against
SSN and date of birth, and reads back current balance, last contribution, latest
claim status and payment information queried live from the operational database.

**Why the buyer cares.** Contact-centre call volume for "what is my balance"
and "where is my claim" is the single biggest driver of front-office cost, and
it is answerable without a human.

---

## 9. Operations you can actually watch

**Mechanism.** Central scheduler console, worker health panel, single-flight
worker leasing so jobs cannot double-run, delivery control centre, print audit,
notification logs, system logs.

**Why the buyer cares.** The institution's own operations team can run the
platform day to day without calling the vendor.

---

## Honest positioning against the alternatives

| Alternative | Their strength | Where we win |
|---|---|---|
| **Large global COTS vendor** | Brand, scale, references | Cost, speed, configurability without change-request fees, and no multi-year rewrite of your statute to fit their model |
| **Keep the legacy system** | It works today; zero project risk | Shrinking skills pool, no citizen self-service, no audit trail, no multi-channel communication, rising cost per change |
| **Custom build from scratch** | Exact fit | Three to five years and full risk; this platform is the same domain already built and governed |
| **Best-of-breed point solutions** | Each tool is strong | Integration cost, split audit trail, no single view of the citizen, seven vendors to manage |

Do not claim we are cheaper, faster and better than everything. Pick the two
that matter to the buyer in front of you.
