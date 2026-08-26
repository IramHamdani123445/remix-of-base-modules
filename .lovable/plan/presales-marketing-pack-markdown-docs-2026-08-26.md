# Presales & Marketing Pack (Markdown Docs)

Create a self-contained documentation pack under `docs/presales/` that sales and
partnership teams can use to pitch the platform to other social security boards
and to government agencies generally. Docs only — no application code, schema,
route, or UI changes.

## What gets written

`docs/presales/README.md` — index and "how to use this pack" (which document for
which meeting: first call, RFP response, technical due diligence, demo).

`docs/presales/01-executive-brief.md`
- One-page positioning: what the platform is, who it is for, the problem it
  solves (legacy PowerBuilder / paper-driven social insurance administration).
- Value pillars: single governed platform, configuration over customisation,
  full auditability, omnichannel citizen communication, modern web delivery.
- Two audience lenses in one document: social security boards (domain fit) and
  broader government agencies (revenue, pensions, labour, licensing).

`docs/presales/02-feature-catalogue.md`
- The main asset: module-by-module feature list drawn from what is actually
  built in the repository. Each module gets a short business description plus a
  bulleted capability list.
- Modules covered: Insured Person / Registration, Employer Registration &
  Employer 360, Contributions (C3) incl. self-employed and voluntary
  contributors, Benefits (products, eligibility, claims, awards, payments,
  medical reviews, life certificates, suspensions, overpayment recovery,
  mortality, means tests, uprating, appeals), Compliance & Enforcement
  (inspections, violations, cases, payment arrangements, ledger), Legal
  (referral to judgment, cost recovery), Finance (ledger, receipts,
  reconciliation, disbursement), Omnichannel Communications (email, SMS,
  WhatsApp, print, in-app, push, webhook, voice/IVR), Document Management,
  Workflow & Maker-Checker, Organisation Management & Branding, Identity &
  Roles, Reporting & Analytics, Audit & Traceability, Portals (claimant,
  employer, doctor, agent).

`docs/presales/03-platform-differentiators.md`
- Talk-track pointers: configuration governance and registries, database-driven
  role model with maker-checker separation of duties, single communication
  façade (no shadow senders), immutable ledgers, legacy mapping framework for
  PowerBuilder migration, readiness gates before anything goes live.

`docs/presales/04-discovery-and-objections.md`
- Discovery questions to ask a prospect, common objections with honest answers,
  and a short list of questions we should ask before promising anything.

`docs/presales/05-demo-script.md`
- A 30-minute demo path with the screens to show in order and the story for
  each, plus a 10-minute short version.

`docs/presales/06-proposal-boilerplate.md`
- Reusable paragraphs for proposals/RFPs: solution overview, delivery approach,
  configurability, security & audit posture, migration approach, and a
  placeholder section for commercial terms.

## Evidence rules

- Every capability claim is grounded in code that exists in this repository
  (pages, services, migrations). Anything planned but not built is either
  omitted or explicitly marked `Roadmap`.
- No invented metrics, customer names, testimonials, certifications,
  performance numbers, or compliance claims. Where a number would help
  (user counts, uptime, go-live dates), a `[CONFIRM]` placeholder is left for
  you to fill in.
- St. Kitts & Nevis is referenced as the reference implementation only if you
  confirm it can be named publicly; otherwise it appears as
  `[CONFIRM: reference client naming]`.

## Not in scope

- No changes to app routes, components, database, or edge functions.
- No public marketing page and no in-app page (docs only, as chosen).
