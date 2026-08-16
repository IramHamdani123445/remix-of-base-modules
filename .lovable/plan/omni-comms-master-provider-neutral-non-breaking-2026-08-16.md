# Omni-Comms Master Plan — Provider-Neutral, Multi-Channel, Non-Breaking

Date: 2026-08-16
Status: AUTHORITATIVE MASTER PLAN
Repository: `miplnoida/remix-of-base-modules`

This plan consolidates and amends the earlier Omni-Comms plans for channel generalisation, SMS parity, provider administration, Benefits migration, claim communications and operational control. If an older plan conflicts with this document, this document is authoritative.

## 1. Product definition

Omni-Comms is the single communications authority and evidence store for official communications with employers, insured persons and other business parties.

The platform must support Email, SMS, WhatsApp, Print/Letter and future channels without making any business module dependent on a specific provider.

Permanent rule:

**Channels are stable platform capabilities. Providers are replaceable adapters.**

Business modules supply business facts, recipient roles and business references. They do not choose providers, credentials, sender accounts, retry rules, templates, fallback behavior or live-delivery state.

## 2. Non-negotiable safety and continuity rules

1. Do not break an existing working Benefits Email path while building the new platform.
2. Do not remove a legacy Benefits send/write path until the corresponding canonical event has passed provider-free certification, controlled live proof and rollback validation.
3. One business event must not be actively delivered by both the old and new systems at the same time.
4. Legacy records remain readable as history during migration.
5. No mass Benefits cutover. Cut over event-by-event or bounded domain batch.
6. Provider changes are independent from business-event migration. A new provider must not be required in order to migrate a Benefits event to Omni-Comms.
7. No provider secret value is stored in the database or frontend; only secret-reference names are stored.
8. Every automatic live-delivery change remains governed and auditable.
9. A provider accepted/unknown outcome must never cause blind cross-provider replay that could duplicate a communication.
10. The canonical communication identity must remain the same when provider attempts or fallback occur.

## 3. Target architecture

```text
Business Modules
Benefits / Employer / Insured Person / Compliance / Finance / Legal / Admin
                         |
                         | business fact + recipient roles + entity references
                         v
                sendCommunication()
                         |
                         v
                  OMNI-COMMS CORE
  -----------------------------------------------------------------
  Event + Contract + Business Subjects + Recipients + Preferences
  Template + Layout + Assets + Channel Policy + Sender Resolution
  Communication Request + Message + Job + Audit + Timeline
  -----------------------------------------------------------------
                         |
              Channel Resolution / Policy
          -----------+----------+-----------+-----------
          |          |          |           |
        EMAIL       SMS      WHATSAPP     PRINT/LETTER
          |          |          |           |
          v          v          v           v
      Provider    Provider   Provider     Production
       Router      Router     Router        Router
       | | |       | | |      | | |         | | |
       v v v       v v v      v v v         v v v
      P1 P2 P3     P1 P2 P3   P1 P2 P3     P1 P2 P3
```

All channel messages and all provider attempts remain children of one canonical communication request.

## 4. Common platform objects — central, reusable, not duplicated per provider

The following concepts must be common across channels wherever semantically applicable:

- business event definition and contract;
- business subject/entity references;
- recipient and semantic recipient role;
- recipient destinations and preferences;
- template family and version;
- layout, branding, footer, disclaimer and shared assets;
- channel setting and channel release state;
- provider definition;
- provider account/environment;
- provider credential requirements and secret references;
- sender/production identity;
- sender-to-provider binding;
- provider priority and routing policy;
- endpoint/callback configuration;
- health and readiness state;
- retry/failover policy;
- communication request;
- rendered channel message/artifact;
- dispatch/production job;
- provider/production attempt;
- callback/status event;
- operator audit;
- unified activity timeline;
- test-delivery evidence;
- diagnostics.

Channel-specific behavior belongs in capabilities and adapters, not in duplicated administration modules.

## 5. Provider-neutral adapter contract

Every delivery provider must sit behind a server-side adapter contract. The core dispatcher must not contain vendor-specific business logic.

Conceptual adapter interface:

```text
send(message, account, binding)
verifyCredentials(account)
healthCheck(account)
normalizeTarget(recipient)
validateSender(binding)
getCapabilities()
mapProviderStatus(providerResponse)
processCallback(callback)
lookupDelivery(providerMessageId)      optional
cancel(providerMessageId)              optional/capability-gated
```

Adding a provider should require:

1. one provider-adapter implementation;
2. one governed provider-definition registration/seed;
3. credential-purpose metadata;
4. capability declaration;
5. verification/tests.

It must not require changes to Benefits, event routing, template resolution, common Operations screens or the central Control Center.

## 6. Provider registry — data-driven, capability-truth backed by code

The current provider-adapter catalogue becomes capability truth and seed metadata, not a closed list of providers the product can ever support.

The backend provider-definition registry must support:

- channel;
- adapter key;
- provider display name;
- status: draft / active / disabled / retired;
- implementation state: live-adapter / config-only;
- verification support;
- credential requirements;
- provider-specific settings schema;
- provider capabilities;
- audit metadata.

Operators may register, configure, enable, disable and retire provider definitions/accounts, but cannot claim an adapter implementation exists when code does not implement it.

## 7. Multiple providers per channel

A channel must support multiple simultaneously configured provider accounts.

Example Email routing pool:

```text
Resend Production        priority 10   active   healthy
Amazon SES Production    priority 20   active   healthy
Government SMTP          priority 30   active   healthy
```

Example SMS routing pool:

```text
Twilio                   priority 10   active   healthy
Local SKN Gateway        priority 20   active   healthy
Secondary Gateway        priority 30   active   degraded
```

Existing sender-provider binding priority becomes operational routing input after the safe routing engine is implemented; it is not sufficient by itself.

## 8. Central provider router

Provider selection happens at dispatch time, not inside Benefits or another business module.

Selection inputs include:

- channel;
- organization/department/product/event scope;
- resolved sender identity;
- verified active bindings;
- provider implementation availability;
- provider/account health;
- provider capabilities required by the rendered message;
- routing priority;
- policy constraints;
- rate-limit/circuit-breaker state;
- environment and release state.

Selection output must record:

- candidate providers considered;
- excluded provider + reason;
- selected provider account/binding;
- routing-policy version/evidence;
- timestamp and correlation/request identity.

## 9. Safe failover — no duplicate sends

Cross-provider fallback is allowed only when the attempt outcome proves another send is safe.

Canonical attempt outcome classes:

- `definitely_not_submitted` — safe to try next provider;
- `temporary_failure_before_acceptance` — safe to retry/fail over;
- `provider_accepted` — do not fail over;
- `delivered` — terminal success;
- `unknown_after_submission` — hold for reconciliation; do not blindly resend;
- `permanent_recipient_failure` — terminal recipient failure; do not switch provider;
- `policy_blocked` — no provider attempt;
- `channel_gate_blocked` — no provider attempt;
- `capability_mismatch` — provider excluded before submission.

The system must use idempotency where the provider supports it and internal duplicate-suppression evidence in all cases.

Fallback policy must be configurable per channel/scope and may be disabled.

## 10. Health, circuit breaking and capacity

A shared provider-account health model should include:

- Healthy;
- Degraded;
- Down;
- Disabled;
- Credential Error;
- Rate Limited;
- Unknown.

Track centrally:

- credential verification state/time;
- latest successful send;
- latest provider failure;
- callback/webhook health;
- recent latency;
- failure/rejection rate;
- consecutive failures;
- rate-limit state;
- manual suspension;
- automatic circuit-breaker state;
- last health check.

Routing must exclude or deprioritize unhealthy accounts according to policy.

## 11. Provider capability matrix

Provider adapters declare capabilities rather than relying on provider names.

Examples:

Email: HTML, text, attachments, CC/BCC, Reply-To, callback, bounce, custom headers, provider idempotency.

SMS: Unicode, concatenation, alphanumeric sender, long code, short code, delivery callback, inbound STOP/HELP, messaging service.

WhatsApp: approved templates, media, interactive messages, delivery/read callbacks, inbound replies, business account/phone identity.

Print: PDF input, duplex, color, envelope type, inserts, batch support, tracking/dispatch evidence, returned-mail status.

A message must fail closed before dispatch if the chosen provider lacks a required capability.

## 12. Channel model

### 12.1 Email

Email remains the first reference implementation.

Current working Resend-based Benefits behavior remains stable while provider abstraction is inserted underneath it.

Required end state:

- multiple Email provider accounts;
- generic adapter registry;
- provider routing;
- safe fallback;
- generic health/readiness;
- common Control Center;
- generic communication journey;
- Resend not special to Benefits or common UI.

Future adapters can include SMTP, SES, SendGrid, Mailgun, Postmark, Exchange relay or another approved service.

### 12.2 SMS

Twilio is an initial adapter, not the SMS architecture.

Required end state:

- Twilio certified through business dispatch;
- local/SKN gateway adapters possible without business-code changes;
- multiple SMS provider accounts and routing;
- E.164 recipient normalization;
- STOP/HELP/inbound handling where applicable;
- delivery callback normalization;
- per-channel gate;
- generic journey/activity evidence.

### 12.3 WhatsApp

WhatsApp is a first-class channel, not a special Meta screen.

Required end state:

- provider-neutral WhatsApp adapter contract;
- Meta Cloud API can be first adapter;
- additional BSP adapters can be installed later;
- provider account, business identity, webhook/endpoint and template capability mapping;
- template approval/reference evidence;
- delivery/read/inbound events normalized;
- own Release Control gate;
- test centre and diagnostics;
- unified Communication 360 visibility.

### 12.4 Print / Letter

Print is the physical-correspondence channel. A letter is a rendered physical communication artifact, not an unrelated document system.

Required lifecycle:

```text
business event
-> letter template/layout
-> immutable PDF/artifact
-> postal destination resolution
-> production provider selection
-> print/spool/batch
-> physical dispatch
-> dispatch evidence/tracking
-> returned/undeliverable evidence where available
```

Providers may include internal print room, network print server, external print-and-mail vendor, postal API, courier or controlled manual mailroom.

`printed` must not be treated as equivalent to `sent`.

The canonical recipient model must be extended to support postal destinations/address evidence without making Print a parallel communication subsystem.

## 13. Central Control Center

The Control Center is channel-central, not Email-central.

Top-level view should show every channel:

```text
Channel     Delivery   Primary/Selected   Backup Pool   Health   Queue   Failures
Email       ON         Resend             2 backups     Healthy  ...     ...
SMS         ON         Twilio             1 backup      Healthy  ...     ...
WhatsApp    OFF        Meta               none          Setup    ...     ...
Print       ON         Internal Print     external      Healthy  ...     ...
```

Each channel retains independent controls:

- release ON/OFF;
- approval state;
- provider pool;
- routing/fallback policy;
- account health;
- sender/identity bindings;
- test centre;
- diagnostics;
- recent failures/activity.

Pausing one channel must not pause other channels.

An optional organization-wide emergency stop may exist above channel gates, but it must be explicitly modeled and separately audited.

## 14. Unified Operations and Communication Journey

Remove Email as the conceptual center of Operations.

The common journey is:

```text
Business Event
-> Communication Request
-> Subjects/Entities
-> Recipients
-> Channel Messages / Letter Artifacts
-> Jobs
-> Provider/Production Attempts
-> Status Callbacks
-> Final Evidence
```

Generic filters must include at minimum:

- organization;
- department;
- date range;
- event;
- caller module;
- entity type;
- entity id;
- employer id/reference;
- insured-person id/reference;
- recipient reference;
- channel;
- provider;
- status;
- blocker/failure;
- correlation/request reference.

Any existing Email Journey UI should become a filtered projection of the generic journey rather than a separate data model.

## 15. Employer and Insured Person Communication 360

This is a core acceptance requirement.

From an Employer or Insured Person profile, an authorized operator must be able to open one Communications view and see all related:

- Email;
- SMS;
- WhatsApp;
- Letters/Print;
- future supported channels;
- old legacy history, clearly marked as read-only archive during migration.

Each current Omni-Comms item must show:

- event/reason;
- related business entity/case/claim;
- recipient;
- channel;
- sender identity;
- template/version;
- provider or production route;
- attempts;
- timestamps;
- current/final status;
- delivery/dispatch evidence;
- blockers/failures;
- audit/correlation identity.

No separate employer communication log or Benefits-local communication log should be created for new events.

## 16. Benefits — strict non-breaking migration plan

Benefits currently has working and legacy communication behavior. It must be migrated carefully.

### Stage B0 — Inventory and freeze

Create a machine-enforced inventory of every executable Benefits communication transition:

- business command/source owner;
- legacy behavior;
- canonical event;
- recipient roles;
- channels currently used;
- template family;
- producer state;
- certification state;
- current provider path.

Do not change current working sends in this stage.

### Stage B1 — Provider-free certification

For each event prove, without contacting a provider:

- canonical event exists;
- contract published;
- payload valid;
- recipient roles resolve;
- template/version resolves;
- rendering completes with no unresolved token;
- sender/routing resolution succeeds;
- communication request, recipients, message and held/governed job persist;
- Activity/Communication 360 can find it;
- no legacy queue/log is written by the new path;
- no provider contacted.

### Stage B2 — Shadow resolution

For an event still delivered through the current proven path, allow Omni-Comms to calculate the provider candidate/route in a non-sending mode and compare the expected result.

No second provider call.

### Stage B3 — Controlled live proof

For representative approved test recipients:

- source transition;
- outbox/ingest;
- request;
- template;
- selected provider;
- one provider attempt;
- callback/result;
- central Activity.

Prove exact idempotency and rollback behavior.

### Stage B4 — Event cutover

Only after B1-B3 are green for that event:

- enable the canonical Omni-Comms producer for that event;
- disable/freeze its legacy production writer;
- retain legacy read history;
- monitor reconciliation metrics.

Do not remove old history.

### Stage B5 — Expand event-by-event

Recommended order:

1. existing already-proven claim events;
2. claim acknowledgement/evidence/eligibility;
3. determination/award;
4. suspension/reinstatement;
5. life certificate/medical review;
6. overpayment/means test;
7. appeals/mortality/risk/uprating;
8. payment events with real executable owners.

No domain proceeds because another domain succeeded; each has its own certification evidence.

## 17. Preserve current Email while adding provider abstraction

Provider diversification for Email is a separate controlled rollout:

### E0
Keep current Resend production behavior unchanged.

### E1
Route current Resend calls through the generic adapter registry without changing outputs, sender, templates, recipient logic or gate behavior.

### E2
Register/configure a second Email provider in test/shadow state only.

### E3
Verify credentials, sender configuration, capabilities and approved technical test delivery for the second provider.

### E4
Run routing shadow mode: calculate primary/backup selection but send only via existing Resend path.

### E5
Perform controlled fallback test with approved test recipient and forced definitely-not-submitted primary failure.

### E6
Enable production fallback only after explicit approval and duplicate-prevention evidence.

Initially Resend remains primary. Adding fallback must not be bundled with Benefits event migration.

## 18. Provider administration UX

One shared provider-management experience across channels:

### Provider definitions

- search/filter/sort;
- create/edit/retire;
- implementation/config-only label;
- supported capabilities;
- credential requirements;
- audit trail.

### Accounts

- environment;
- secret references;
- provider-specific settings;
- status;
- verification;
- health;
- manual disable;
- diagnostics.

### Identities

- sender/production identity;
- organization/department/event scope;
- provider-specific external reference only where necessary.

### Bindings

- provider account;
- endpoint if applicable;
- priority;
- verification evidence;
- status.

### Routing

- provider pool;
- priority/weight;
- health eligibility;
- fallback allowed/disabled;
- rate/capacity rules;
- scope overrides;
- shadow mode;
- effective routing preview.

Provider-specific settings appear as small dynamic sections driven by adapter metadata, not as separate product modules.

## 19. Security and permissions

Maintain or extend capability separation:

- view communications;
- view sensitive communication content;
- operate/retry/reconcile where permitted;
- configure channels/providers/accounts/bindings;
- change routing/fallback policy;
- manage secrets by reference only;
- request/approve release changes;
- author templates;
- approve/publish templates;
- manage physical production where applicable.

Sensitive values must be masked by default.

Provider secrets must remain server-side.

All routing, gate and provider-selection decisions are server authoritative.

## 20. Audit requirements

Audit every meaningful configuration or operational decision:

- provider definition created/changed/retired;
- account enabled/disabled;
- credential verification result metadata, never secret value;
- identity/binding changes;
- routing/fallback policy change;
- channel gate request/approval/pause;
- provider selected/excluded and reason;
- fallback decision;
- manual retry/reconciliation action;
- print batch/dispatch action;
- sensitive-content reveal.

The communication timeline and admin configuration audit may be separate projections but share canonical correlation identities.

## 21. Observability and reconciliation

Create channel- and provider-neutral metrics:

- requests/messages/jobs by channel;
- success/failure/held counts;
- provider selection counts;
- failover count and reason;
- unknown-after-submission count;
- callback delay/missing callback;
- duplicate-prevention interventions;
- provider latency/error rate;
- print produced/dispatched/returned;
- legacy-vs-Omni reconciliation during migration.

Unknown provider outcomes require a reconciliation queue/workflow, not blind resend.

## 22. Testing strategy

### Architecture tests

- business modules cannot import provider adapters/SDKs;
- only approved adapter locations import provider SDKs;
- single send facade remains enforced;
- no new module-local communication queues/logs;
- no unregistered permanent objects/routes/integrations.

### Provider contract tests

Every adapter runs the same conformance suite:

- credential verification behavior;
- target normalization;
- capability reporting;
- status mapping;
- definitely-not-submitted failure;
- accepted result;
- unknown outcome;
- callback normalization;
- secret non-leakage.

### Routing tests

- one healthy provider;
- several healthy providers ordered by policy;
- primary unhealthy;
- capability mismatch;
- rate-limited account;
- fallback disabled;
- fallback allowed after safe failure;
- no fallback after accepted/unknown submission;
- deterministic replay/idempotency.

### Channel tests

Email, SMS, WhatsApp and Print each have channel-specific conformance tests in addition to common tests.

### Benefits tests

Each executable Benefits communication event must prove source transition -> exactly one canonical event/request identity and no unintended legacy write after cutover.

## 23. Rollback design

Rollback must be designed before cutover.

For every migration unit record:

- feature/release flag;
- legacy producer state;
- Omni producer state;
- provider routing state;
- database migration reversibility classification;
- data written by new path;
- rollback procedure;
- reconciliation procedure.

Operational rollback preference:

1. pause affected Omni channel/event routing;
2. stop new claims/jobs;
3. reconcile in-flight accepted/unknown attempts;
4. restore previously proven producer path only if doing so cannot duplicate already accepted communication;
5. preserve all evidence/audit;
6. never delete communication history to make rollback appear clean.

## 24. Implementation epics and order

### Epic 0 — Baseline and protection

- generate current-state inventory;
- lock Benefits non-breaking tests;
- document current Email production proof;
- identify all legacy writers;
- add architecture guards for new provider-neutral rules.

Exit: current working communication behavior is reproducibly tested before structural changes.

### Epic 1 — Provider registry and common adapter contract

- data-driven provider definitions;
- provider capability metadata;
- common server-side adapter registry;
- adapt Resend and Twilio to common contract without changing external behavior.

Exit: current Resend/Twilio paths pass the generic provider conformance suite.

### Epic 2 — Provider health and routing engine

- provider candidate resolution;
- health model;
- routing policy;
- shadow selection;
- audit evidence.

Exit: route can be calculated deterministically without changing production provider behavior.

### Epic 3 — Safe fallback and reconciliation

- normalized attempt outcomes;
- cross-provider fallback rules;
- circuit breaker;
- unknown-outcome reconciliation;
- duplicate-suppression tests.

Exit: controlled test proves exactly one final communication through forced failover.

### Epic 4 — Central Control Center redesign

- all-channel overview;
- per-channel gates;
- provider pool/health/routing view;
- common test/diagnostic entry points;
- independent controls.

Exit: operator can understand and control every implemented channel from one center.

### Epic 5 — Generic Operations + Communication 360

- remove Email-specific conceptual dependency;
- generic channel/provider filters;
- entity/recipient search;
- Employer Communications view;
- Insured Person Communications view;
- legacy archive projection.

Exit: one employer/person search returns every current channel communication in one timeline.

### Epic 6 — SMS production parity

- certify business dispatch through generic router;
- callbacks/inbound normalization;
- provider pool support;
- safe fallback-ready architecture.

Exit: SMS is operationally governed to the same platform standard as Email.

### Epic 7 — WhatsApp

- first real adapter, initially Meta if approved;
- provider-neutral template/capability layer;
- webhook/status/inbound handling;
- release gate/test/diagnostics;
- provider-pool-ready routing.

Exit: WhatsApp works through the same common platform and can accept a second provider later without business-code change.

### Epic 8 — Print / Letter

- postal recipient destination model;
- immutable letter artifact;
- production provider contract;
- internal/external provider support;
- batch/dispatch/tracking/returned evidence;
- gate/control/diagnostics.

Exit: physical correspondence is fully visible and auditable in the same Communication 360.

### Epic 9 — Benefits event-by-event migration

Run the B0-B5 process for each bounded Benefits event/domain.

Exit: active Benefits communications use the canonical facade with no unapproved parallel writer; current user-visible functionality remains intact.

### Epic 10 — Additional providers and channels

Add providers or future channels through the contracts proven above, not through new parallel systems.

## 25. Pull-request discipline

Do not deliver this master plan as one giant implementation PR.

Each PR must state:

- epic and bounded slice;
- behavior intentionally unchanged;
- behavior newly enabled;
- provider calls possible or impossible in the slice;
- data migration impact;
- security impact;
- tests added;
- rollback method;
- evidence/screens/queries required for acceptance.

A PR that combines provider abstraction, Benefits event cutover and live fallback should normally be split.

## 26. Acceptance criteria — master definition of done

The platform is considered complete for this scope only when all of the following are true:

1. Business modules do not depend on provider names or SDKs.
2. Email, SMS, WhatsApp and Print/Letter are represented as first-class channels.
3. At least two provider accounts can be configured for a channel without business-code changes.
4. Provider routing is server-side, auditable and health/capability aware.
5. Safe fallback is implemented with explicit no-duplicate rules and unknown-outcome reconciliation.
6. Provider adapters pass one common conformance contract.
7. Control Center shows all channels centrally while controls remain independent.
8. Employer Communication 360 shows all related channels from one place.
9. Insured Person Communication 360 shows all related channels from one place.
10. Generic Operations can filter by entity, recipient, channel and provider.
11. Print/Letter records production and physical dispatch separately.
12. Existing working Benefits Email behavior is protected through migration and is not removed prematurely.
13. Every migrated Benefits event has provider-free certification, controlled live proof and rollback evidence.
14. Legacy history remains readable until retention/retirement approval.
15. No new parallel communication subsystem, queue, template store or module-local current-activity log has been introduced.

## 27. Immediate next implementation slices

Recommended first five PR-sized slices:

1. **Protection baseline** — generate Benefits/current-Email inventory and regression tests; no runtime behavior change.
2. **Generic adapter contract** — put Resend and Twilio behind the same server adapter registry; no routing/fallback change.
3. **Provider routing shadow mode** — calculate candidate ordering and record evidence but continue selecting the currently proven provider.
4. **Control Center all-channel summary** — central view of channel status/provider health without changing gates or provider behavior.
5. **Operations entity/channel/provider filters** — begin Communication 360 search while delivery behavior remains unchanged.

Only after these foundations are proven should production fallback or major Benefits cutover expand.

## 28. Relationship to earlier plans

This document incorporates and supersedes conflicting portions of:

- `make-every-omni-comms-channel-genuinely-configurable-2026-08-16.md`;
- `sms-on-omni-comms-mirror-the-email-structure-2026-08-16.md`;
- `benefits-wide-omni-comms-cutover-and-certification-2026-08-15.md`;
- `claim-communications-screen-what-it-actually-uses-today-and-2026-08-15.md`.

Those files remain useful detailed evidence and implementation notes, but new work should reference this master plan for architecture, sequencing and safety decisions.

## 29. Decision summary

Lock these decisions before further implementation:

- one Omni-Comms platform;
- one canonical communication record;
- channels are stable, providers are pluggable;
- multiple providers per channel;
- provider-neutral common administration;
- centralized routing and health;
- safe controlled failover;
- independent channel controls in one Control Center;
- one Employer/IP Communication 360;
- Print/Letter as a real physical channel;
- Benefits migration is incremental and non-breaking;
- existing proven Email remains protected until each replacement path is independently certified.
