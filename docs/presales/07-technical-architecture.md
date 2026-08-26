# Technical Architecture & Security Posture

For CIOs, enterprise architects and technical evaluation panels. Everything
below describes the system as built. Anything not built is marked `Roadmap`.
Anything requiring a commercial or hosting decision is marked `[CONFIRM]`.

---

## 1. Solution shape

```text
                    Browser (staff, portals, admin)
                                 |
                        React + TypeScript SPA
                       (role-driven navigation)
                                 |
                    ---------------------------------
                    |     Managed backend platform    |
                    |  PostgreSQL + Row Level Security|
                    |  Auth / JWT / role claims       |
                    |  Auto REST + RPC (SECURITY      |
                    |    DEFINER governed functions)  |
                    |  Serverless edge functions      |
                    |  Object storage (documents)     |
                    |  Scheduled jobs / workers       |
                    ---------------------------------
                                 |
        Providers: email, SMS, WhatsApp, voice/IVR, push, webhooks, print
```

- **Front end** — React 18, TypeScript, Vite, Tailwind, shadcn/ui component
  system. Responsive; no desktop client, no browser plug-ins.
- **Data tier** — PostgreSQL. Business logic that must not be bypassed lives in
  the database as governed functions and triggers, not only in the UI.
- **Application services** — serverless functions for outbound dispatch,
  inbound voice/IVR, document production, scheduled workloads and integrations.
- **Storage** — object storage for generated letters, uploaded evidence,
  branding assets, with access mediated by policy.

## 2. Security model

| Control | How it is implemented |
|---|---|
| Authentication | Managed identity provider, JWT sessions, password policy, SSO/SAML capable `[CONFIRM: which IdP the client uses]` |
| Authorisation | Roles held in a dedicated role table — never on the user or profile record. Permission registry marks critical permissions. |
| Row-level access | Row Level Security on data tables; policies evaluate the caller's roles server-side |
| Privilege escalation defence | Role checks use `SECURITY DEFINER` helper functions with fixed `search_path`; the client can never assert its own role |
| Separation of duties | Maker-checker enforced in the database for benefit version approval, compliance progression, legal referral, waivers, communication go-live |
| Sensitive-action logging | Canonical audit log records actor, action, entity, before/after and timestamp |
| PII handling | Masking context in the UI for sensitive identifiers; admin consoles are read-only where the data is personal |
| Outbound safety | One communication façade; architecture tests in CI fail the build if a module tries to send directly |
| Secrets | Provider credentials held server-side only; never present in front-end code or in the browser bundle |
| Outbound request safety | Webhook adapter validates targets against SSRF (no private ranges, no loopback, no metadata endpoints) |

**Not claimed.** No certification statements (SOC 2, ISO 27001, GDPR
attestation) are made anywhere in this pack. If a prospect requires one, that is
a programme commitment, not an existing fact.

## 3. Governance and configuration architecture

- **Configuration registry** — every configurable asset is registered with an
  owner, a lifecycle and dependency links.
- **Versioning** — configuration and product rule sets are versioned with
  `DRAFT → SUBMITTED → APPROVED → ACTIVE` transitions and effective dating.
- **Readiness gates** — a version cannot be approved while blocking issues
  exist (missing formula, rate table, template or binding). Failures are listed
  specifically and the version can be returned to draft for correction.
- **Consumption registry** — records which module owns which table and which
  modules may read it. Prevents duplicate implementations of the same concept.
- **Legacy mapping framework** — table/column level mapping from the legacy
  system to the new model, with an approval status per mapping.

## 4. Communications architecture

Business modules never dispatch. They raise a business event; the hub resolves
everything else.

```text
Business module
    -> sendCommunication({ moduleCode, departmentCode, eventCode,
                           channels, recipient, data, reference,
                           idempotencyKey })
        -> template + active version resolution
        -> branding: letterhead, signature, footer, disclaimer
        -> sender account / sender ID resolution
        -> approval requirement check
        -> communication_request
            -> per-channel delivery record
                -> delivery attempts (retry policy)
                    -> event log + audit log
```

Channels implemented: email, SMS, WhatsApp, print, in-app, push, webhook,
voice/IVR. Each channel has its own release state, provider binding, test
centre and kill switch, plus a master delivery switch over all of them.

Operational safety: idempotency keys prevent duplicate sends, single-flight
worker leasing prevents double-running jobs, and a control centre exposes every
gate as an explicit toggle with audit.

## 5. Integration surface

- **Inbound** — REST/RPC endpoints, secured webhooks, file/CSV ingestion for
  bulk contribution and payroll submissions, inbound voice via telephony
  provider.
- **Outbound** — signed outbound webhooks with retry, email/SMS/WhatsApp/voice
  via provider adapters, generated PDF documents to storage.
- **Provider independence** — channel providers are adapters registered in a
  provider registry. Swapping a provider is configuration plus one adapter, not
  a rewrite.
- **Banking / payments** — payment instruction generation, cheque and EFT
  records, reconciliation `[CONFIRM: which national payment rails apply]`.

## 6. Operations

- Central scheduler console listing every scheduled workload and its last run.
- Worker health panel with lease state, so a stuck job is visible.
- Delivery control centre, print audit, notification logs, system logs.
- Environment marker so a non-production environment cannot be mistaken for
  production by operators or by outbound dispatch.

## 7. Deployment and data residency

`[CONFIRM: hosting/residency options]` — the platform runs on managed cloud
today. Options to present to a buyer, once confirmed commercially:

1. Vendor-managed cloud, regional hosting.
2. Client's own cloud tenancy.
3. On-premise / national data centre `[CONFIRM: supported or not]`.

Backup, retention and RPO/RTO targets: `[CONFIRM]`.

## 8. Quality engineering

- Automated test suite covering domain calculations, permission behaviour,
  readiness logic and architecture boundaries.
- Architecture tests that fail CI when a module bypasses the communication
  façade or the governed configuration resolvers.
- Database-level verification scripts for benefit, compliance and communication
  workloads.
- End-to-end browser tests for critical flows.

## 9. Known constraints to state honestly

- Some legacy tables remain the system of record and are surfaced through
  adapter views; they are not rewritten. This is deliberate and documented.
- Provider trial accounts (SMS/voice) restrict destinations; production numbers
  and accounts are a client-side procurement step.
- Certification and formal accreditation are not in place; they can be a
  programme workstream.
