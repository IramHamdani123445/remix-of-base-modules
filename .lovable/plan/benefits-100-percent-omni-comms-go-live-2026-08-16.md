# Benefits 100% Omni-Comms Go-Live Plan

Date: 2026-08-16
Status: AUTHORITATIVE BENEFITS GO-LIVE PLAN
Repository: `miplnoida/remix-of-base-modules`
Parent architecture: `omni-comms-master-provider-neutral-non-breaking-2026-08-16.md`

This plan takes the Benefits module from its current partial Omni-Comms cutover to 100% canonical communication coverage while preserving currently working Benefits Email until each replacement path is independently certified.

## 1. Definition of 100% Benefits communication go-live

Benefits is 100% live on Omni-Comms only when:

1. Every executable Benefits transition classified `COMMUNICATION_REQUIRED` or `COMMUNICATION_OPTIONAL` has one canonical producer at the authoritative business transaction boundary.
2. No active Benefits production path writes a new current communication to `notification_queue`, `notification_logs`, `in_app_notifications`, `bn_communication_log`, `bn_letter`, or another module-local current-communication store.
3. Legacy Benefits communication records remain visible as read-only archive until retirement/retention approval.
4. Every new Benefits communication is represented by one canonical Communication Request, even when one event creates several recipients and several channel deliveries.
5. Channel selection is resolved centrally from communication policy + recipient eligibility/preference + destination readiness. Benefits does not hard-code Email, SMS, WhatsApp, Print, provider names, templates, sender accounts, retries or delivery gates.
6. Email, SMS, WhatsApp and Print/Letter can be child delivery obligations/messages of the same Benefits communication where policy requires/allows them.
7. Employer/Insured Person/claim/award/payment/case references are searchable in central Communication 360.
8. Current Benefits Email remains working throughout the migration; no legacy/current producer is removed before its canonical replacement has provider-free certification, controlled live proof and rollback evidence.
9. A communication cannot be actively delivered by both legacy and Omni paths for the same business fact.
10. 100% means 100% of executable catalogued communication transitions are wired and certified. A business operation that does not exist in the Benefits module is explicitly reported as not executable, not falsely marked complete.

## 2. Confirmed current state

### What already exists

- `emitBenefitsCommunication()` is the typed Benefits -> Omni-Comms entry point.
- `emitBusinessCommunication()` delegates to the single `sendCommunication()` façade.
- Claim manual actions in `CommunicationTab.tsx` already call the Omni path.
- Claim Omni activity is already shown separately from legacy archive data.
- `workflowCommunicationBridge.ts` already raises selected claim workflow communications through Omni-Comms.
- The Benefits communication catalogue already classifies transitions across Claim, Evidence, Eligibility, Calculation, Determination, Entitlement, Award, Suspension/Reinstatement, Payment, Life Certificate, Medical Review, Appeal, Overpayment, Means Test, Mortality, Risk and Uprating.
- A large Email template registry already exists for Benefits communication events.
- Architecture guards already prevent selected active producer files from directly using the legacy dispatcher/queues.

### What is still incomplete

1. `benefitsCommunicationProducer.ts` is Email-only: `requestedChannels: ['email']` and the typed input only carries `recipientEmail`.
2. `BusinessProducerRecipient` supports email/phone but no postal destination; the public façade also has no postal-address destination.
3. The Benefits communication catalogue is Email-shaped (`emailApplicable`, `emailPolicy`, one Email template family) rather than channel-obligation shaped.
4. Only a small subset of catalogue transitions have a producer populated; most catalogue rows still have `producer: null`.
5. `workflowCommunicationBridge.ts` maps only selected claim actions; several actions are deliberately empty and most other Benefits domains have their own command/RPC/scheduler boundaries that are not yet connected.
6. `useBnClaimCommunication.ts` still exposes legacy history and legacy mutation hooks alongside the new Omni hooks.
7. The Claim Communications screen has moved manual sending toward Omni, but legacy archive/letter readers still exist and the Omni list is not yet a full multi-recipient/multi-channel grouped communication journey.
8. Current central recipient/business-subject linkage is not yet sufficient for first-class Employer/IP/postal communication search in every Benefits path.
9. Print/Letter physical production and dispatch evidence is not yet implemented as a governed Omni channel.
10. WhatsApp is not yet a live delivery adapter; SMS is further along than WhatsApp but still needs full Benefits business certification.

## 3. Target Benefits communication model

One business transition creates one canonical communication identity.

```text
Benefits business transition
        |
        v
Canonical Benefits event
        |
        v
Communication Request
        |
        +-- Business subjects
        |     claim / insured person / employer / award / payment / case
        |
        +-- Recipient A: claimant / beneficiary / payee / debtor / etc.
        |      |
        |      +-- Delivery obligation: Email
        |      +-- Delivery obligation: SMS
        |      +-- Delivery obligation: WhatsApp
        |      +-- Delivery obligation: Print/Letter
        |
        +-- Recipient B: employer/contact/medical provider/etc.
               |
               +-- its own resolved delivery obligations
```

A communication is shown once in Benefits and Communication 360. Child channel deliveries show their individual status underneath it.

Provider failover is below the channel message and never creates another business communication.

## 4. Introduce channel obligations, not hard-coded requested channels

Replace the Benefits Email-only policy concept with a generic channel-policy model.

Each Benefits communication event must define, per semantic recipient role, channel rules such as:

- `required` — this channel obligation must be satisfied;
- `optional` — use only when recipient preference/eligibility permits;
- `alternative` — one of an allowed set satisfies the digital obligation;
- `prohibited` — must not be used for this event/role;
- `fallback` — eligible only when the preferred permitted channel cannot be resolved.

Example — formal claim decision:

```text
BENEFITS.CLAIM.DISALLOWED
claimant:
  Print/Letter: required
  Email: optional or required-by-policy
  WhatsApp: optional courtesy
  SMS: optional courtesy
```

Example — evidence reminder:

```text
BENEFITS.CLAIM.EVIDENCE.REQUESTED
claimant:
  digital obligation: Email OR WhatsApp according to preference/eligibility
  SMS: optional reminder
  Print/Letter: policy-configurable for formal escalation
```

Legal/business policy always overrides preference. Recipient preference chooses only among channels the event policy permits.

## 5. Preserve the resolution snapshot

For every communication persist the decision evidence used at creation time:

- event policy version;
- recipient role;
- recipient preference snapshot/version;
- destination eligibility at resolution time;
- selected obligations/channels;
- why a channel was selected/excluded;
- communication/business subjects;
- organization/department/product policy scope.

Historical communications are never reinterpreted using today's preferences.

## 6. Recipient model changes

Extend the common recipient/destination model rather than adding Benefits-only destination fields.

Minimum destination support:

- Email address;
- SMS phone number;
- WhatsApp-capable phone/business destination;
- Push destination where applicable later;
- Postal destination/address snapshot for Print/Letter.

Benefits typed producer inputs should provide business recipient references and available business facts; central recipient resolution should obtain authoritative destinations/preferences where possible.

A recipient may have multiple destinations. Destination values shown in general activity are masked according to permission.

For Print/Letter, persist the exact postal-address snapshot used for that letter; later master-data changes must not alter historical evidence.

## 7. Business-subject linkage

A communication may relate to several subjects simultaneously.

Benefits must be able to attach at least:

- insured person/person reference;
- employer reference where relevant;
- claim;
- award/entitlement;
- payment/payable;
- appeal;
- overpayment;
- medical-review case;
- means-test case;
- life-certificate obligation;
- mortality/risk/uprating case where relevant.

The primary caller entity remains useful, but a first-class subject-link collection is required so Communication 360 can answer "show every communication concerning this insured person/employer" without text searching.

## 8. Template model

Keep one business communication/template family concept with channel variants.

Example family:

```text
BENEFITS_CLAIM_DISALLOWED
  Email variant
  SMS variant
  WhatsApp approved-template reference/variant
  Print/Letter formal PDF variant
```

The variants express the same business communication appropriately for the channel; they are not independent business events.

Published contract/payload tokens remain event-based. Channel variants may consume a validated subset/representation but must not invent unrelated business facts.

## 9. Print/Letter implementation for Benefits

Print is a first-class physical channel.

Lifecycle:

```text
communication obligation
-> render immutable PDF
-> freeze postal address snapshot
-> ready/approval state
-> production job
-> print batch
-> printed / spoiled / reprinted attempts
-> packed/enveloped
-> dispatch manifest
-> dispatched
-> delivered when tracking exists
-> returned/undeliverable when applicable
```

Each letter gets a unique Letter ID linked to the Omni message/request. A safe QR/barcode may carry only that internal reference.

`printed` is never equal to `sent`/`dispatched`.

Internal print room, external print-and-mail vendor, postal API, courier or controlled manual mailroom are providers/adapters behind the same Print channel.

Legacy `bn_letter` becomes read-only archive for pre-cutover letters. New formal Benefits letters use Omni generated-document/artifact evidence and the governed Print workflow.

## 10. Email implementation and continuity

Email remains the first live reference channel.

Non-breaking sequence:

1. Lock regression evidence for current working Benefits Email.
2. Keep current Resend behavior and delivery gate unchanged.
3. Generalize the Benefits producer/channel policy without changing the currently resolved Email outcome for already-live events.
4. Route Email through the common provider adapter/router while Resend remains primary.
5. Add second Email provider in test/shadow mode only.
6. Enable production failover only after no-duplicate/unknown-outcome reconciliation proof.

Benefits never names Resend or another provider.

## 11. SMS implementation for Benefits

SMS is a child delivery of the same communication.

Requirements:

- E.164 normalization;
- channel-policy/recipient-preference resolution;
- SMS template variants;
- sender identity/binding resolution;
- delivery callbacks normalized into common attempts/evidence;
- inbound STOP/HELP handling where applicable;
- own channel release gate;
- Twilio as initial adapter, not architecture;
- ability to add local/secondary gateway without Benefits code change.

Go live in Benefits first for low-risk courtesy/transactional events, then legal/formal events only where approved policy permits SMS.

## 12. WhatsApp implementation for Benefits

WhatsApp is another child delivery obligation.

Requirements:

- WhatsApp eligibility/consent/preference resolution;
- approved-template reference/version evidence;
- business phone/account identity;
- delivery/read callback normalization;
- inbound reply evidence where required;
- own release gate/test centre/diagnostics;
- Meta may be first adapter but additional BSP adapters must require no Benefits code change.

Do not block Benefits 100% canonical event coverage on WhatsApp adapter completion: an event can be 100% canonically wired while a channel remains policy-disabled until its adapter is certified. Channel readiness and producer coverage are separate dimensions.

## 13. Overall communication status

Overall status must derive from delivery obligations, not from "did every channel succeed?".

Example:

```text
Email      required   delivered
Letter     required   dispatched
SMS        optional   failed
Overall               completed
```

Example:

```text
Email      required   delivered
Letter     required   print failed
SMS        optional   delivered
Overall               action_required
```

Each obligation defines the evidence state that satisfies it. For ordinary post, `dispatched` may satisfy policy; for registered post a policy may require `delivered`.

## 14. Benefits UI changes

### Claim Communications

Replace the current split operational view with one grouped Omni timeline:

```text
Benefit Award Notice
COM-...
Overall: Completed

Claimant
  Email      Delivered
  SMS        Delivered
  Letter     Dispatched

[View communication]
```

Legacy archive remains behind a clearly labelled historical/archive section only.

Remove/retire active legacy retry, generate-letter and mark-dispatched mutations once the equivalent governed Omni operations are live.

### Other Benefits entities

Add the same Communication 360 projection where useful for:

- Claim;
- Insured Person/beneficiary;
- Award;
- Payment;
- Appeal;
- Overpayment;
- Medical Review;
- Life Certificate;
- Means Test.

These are projections of central Omni data, not separate logs.

## 15. Catalogue refactor

Refactor `benefitsCommunicationCatalogue.ts` from Email-specific fields toward generic communication policy metadata.

Current fields such as:

- `emailApplicable`;
- `emailPolicy`;
- one `templateFamily` assumption;

should be superseded by metadata conceptually like:

```text
communicationPolicy
recipientRoles
channelPolicies / obligation profiles
templateFamily
productSpecific
producer binding/source owner
```

Retain temporary compatibility readers during migration if needed, but new tests should assert the generic policy model.

The catalogue remains the machine-testable source of truth for what 100% means.

## 16. Producer refactor

Refactor `BenefitsCommunicationInput` so it no longer means "send this Email".

It should carry:

- event code;
- organization/department/product context;
- primary business entity + version;
- additional business-subject references;
- recipient business roles/references or facts needed for central resolution;
- available destination facts when authoritative at source;
- payload/business values;
- correlation/idempotency context;
- optional explicit channel request only for controlled operator/test use, not normal business policy.

Normal Benefits production must omit hard-coded `requestedChannels: ['email']`; the server resolves channels from the event/role policy and recipient preferences/readiness.

## 17. Source wiring — authoritative transaction boundaries

Do not depend on browser buttons for production completeness.

Wire communications at the command/RPC/scheduler boundary that owns successful state change.

Implementation batches:

### Batch A — Claim/Evidence/Determination/Award

- Claim submit;
- claim withdraw/correction where executable;
- evidence requested/received/resubmission;
- claim approve/disallow;
- award create/adjust/terminate/uprate.

### Batch B — Suspension/Reinstatement

- external notification only on executed state changes unless catalogue says otherwise;
- internal proposal/approval/rejection events remain internal/audit according to catalogue.

### Batch C — Payment

- schedule notification where enabled;
- issued/cancelled/reissued/correction-completed;
- internal batch/finance workflow remains internal unless catalogue changes.

### Batch D — Life Certificate + Medical Review

Wire all executable external events from their real scheduler/command/service owner, not merely from screens.

### Batch E — Appeal + Overpayment + Means Test

Wire each executable external event; preserve internal-only events as audit/internal workflow.

### Batch F — Mortality + Risk + remaining Uprating effects

Wire only actual executable operations and classify any missing implementation explicitly.

For database-owned transitions, the communication outbox emission must be transactionally coupled to successful business-state change. For application-command/scheduler transitions, emit immediately after authoritative success with deterministic idempotency.

## 18. Legacy shutdown strategy

Create a machine-generated legacy-writer inventory.

For each legacy producer classify:

- active and must migrate;
- historical reader only;
- dead/unreferenced;
- temporarily waived with owner and retirement condition.

After a canonical event is cut over:

- disable/remove its legacy writer;
- keep old records readable;
- do not delete old queue/log/letter evidence;
- architecture tests fail if that Benefits event reintroduces a legacy write.

The current architecture guard must be expanded from a few producer files to the whole active Benefits source surface, with explicit narrow waivers only where still under migration.

## 19. Certification matrix

For every executable `COMMUNICATION_REQUIRED` and `COMMUNICATION_OPTIONAL` catalogue entry record independently:

- source command/service exists;
- canonical event registered;
- published contract;
- template family;
- required channel variants/policy;
- recipient roles resolvable;
- business-subject linkage;
- producer wired at authoritative boundary;
- provider-free end-to-end test passes;
- Communication 360 visibility passes;
- no legacy current write after cutover;
- live sample evidence where required;
- rollback procedure proven;
- final production status.

This matrix is the release dashboard for 100% closure.

## 20. Provider-free test requirement for every event

Before any live-provider test, prove:

1. authoritative source transition succeeds;
2. exactly one canonical business event/request identity is created;
3. recipient roles resolve;
4. communication policy resolves obligations/channels;
5. recipient preference/destination decision is snapshotted;
6. contract validates;
7. every required channel variant renders or produces a bounded blocker;
8. jobs/held obligations persist;
9. business subjects are searchable;
10. Benefits and central Communication 360 show the same request;
11. no provider is contacted;
12. no legacy current queue/log/letter write occurs.

## 21. Controlled live certification

Do not send every event/template to real addresses.

Use representative approved test cases by policy class:

- normal transactional Email;
- legal/mandatory Email;
- SMS courtesy + callback;
- WhatsApp template + delivered/read callback when adapter is ready;
- Print formal letter through print batch + dispatch manifest;
- multi-channel event where one communication produces at least Email + SMS + Letter;
- multi-recipient event where applicable;
- safe provider fallback case with exactly one final delivery;
- blocked recipient/destination case;
- returned-letter case.

Trace each sample source transition -> request -> obligations -> messages/artifact -> provider/production attempts -> evidence -> Communication 360.

## 22. Go-live waves

### Wave 0 — Baseline/protection

No behavior change.

- freeze current Benefits Email behavior;
- generate catalogue/source/legacy inventory;
- create current production regression suite;
- create go-live dashboard.

Exit: current behavior is reproducible and protected.

### Wave 1 — Common model refactor in shadow/held mode

- generic channel policy/obligation model;
- recipient preference/destination model;
- business-subject linkage;
- producer no longer Email-hard-coded;
- Email outcome remains identical for current live events.

Exit: existing Email still works; same events can resolve multi-channel obligations in dry-run/shadow without additional delivery.

### Wave 2 — Claim + Evidence + Determination + Award complete

Wire all executable external events in these domains.

Exit: every executable external event in these domains is canonical; no new legacy current writes.

### Wave 3 — Benefits Communication 360

- grouped communication card;
- recipient -> obligation/channel hierarchy;
- legacy archive separated;
- central deep links;
- governed retry/reconciliation operations.

Exit: operators use Omni as current truth.

### Wave 4 — SMS Benefits live

Enable approved Benefits SMS policy classes behind SMS gate.

Exit: at least one real multi-channel Benefits event is production-certified.

### Wave 5 — Print/Letter Benefits live

Enable formal letter production, print batches, dispatch manifests and return handling.

Exit: mandatory physical correspondence is fully auditable.

### Wave 6 — Remaining Benefits domains

Suspension/Reinstatement, Payment, Life Certificate, Medical Review, Appeal, Overpayment, Means Test, Mortality/Risk/Uprating.

Exit: producer coverage reaches 100% of executable catalogued communication transitions.

### Wave 7 — WhatsApp Benefits live

Enable approved WhatsApp event policies after adapter/consent/template certification.

Exit: WhatsApp becomes another governed obligation option without changing Benefits business producers.

### Wave 8 — Closure

- all active legacy Benefits writers retired/frozen;
- legacy history read-only;
- 100% certification dashboard green except explicitly non-executable business operations;
- operational runbook and rollback evidence approved.

## 23. Release controls

Keep independent channel gates:

- Email;
- SMS;
- WhatsApp;
- Print/Letter.

A Benefits event may be fully canonical even if one optional channel gate is OFF. Required obligations must be policy-aware: if a required channel is unavailable, the communication becomes held/action-required rather than silently pretending completion.

Channel gate changes remain centrally governed and audited.

## 24. Rollback

Every cutover unit has its own rollback entry.

Preferred sequence:

1. pause affected Omni event/channel if needed;
2. stop/reconcile in-flight accepted/unknown provider attempts;
3. preserve canonical evidence;
4. restore the previously proven legacy producer only if duplicate analysis proves it is safe;
5. never delete new communication history;
6. record rollback decision and correlation IDs.

A rollback must never cause a communication already accepted by a provider to be resent through the legacy path.

## 25. PR implementation order

Do not implement this as one giant PR.

Recommended bounded PRs:

1. Go-live inventory + current Email regression protection.
2. Generic Benefits channel-policy/obligation types with compatibility adapter; no delivery change.
3. Recipient/destination/preference + business-subject contracts; no new live channel.
4. Refactor `emitBenefitsCommunication()` away from Email hard-coding while preserving current Email result.
5. Generic grouped Benefits Communication 360 read model/UI.
6. Claim/Evidence source-boundary wiring closure.
7. Determination/Award wiring closure.
8. SMS Benefits variants + policy + controlled activation.
9. Print/Letter artifact/batch/manifest workflow + Benefits formal notices.
10. Payment/Life Certificate/Medical Review wiring.
11. Appeal/Overpayment/Means Test wiring.
12. Mortality/Risk/Uprating wiring.
13. WhatsApp Benefits variants + controlled activation.
14. Legacy-writer final retirement + closure report.

Each PR must state unchanged behavior, new behavior, provider calls possible/impossible, migration/data impact, tests, rollback and acceptance evidence.

## 26. Master acceptance criteria

Benefits communication go-live is complete only when:

- 100% of executable catalogue communication transitions are source-wired;
- required/optional channels are centrally policy-resolved;
- recipient preferences cannot override legal/business mandatory channels;
- a single communication may contain several recipients and several channel obligations;
- Benefits no longer hard-codes Email as the production architecture;
- current Email remains regression-safe;
- SMS, WhatsApp and Print plug into the same canonical request model;
- Print preserves immutable PDF + postal snapshot + print/dispatch evidence;
- all current communications are visible from the Benefits entity and central Communication 360;
- legacy Benefits records are archive-only;
- no active Benefits path directly writes current communication queues/logs/letters;
- provider selection/failover is outside Benefits;
- every migrated event has provider-free certification and rollback evidence;
- required representative live proofs pass;
- unknown provider outcomes cannot trigger blind duplicate resend;
- release dashboard reports zero unexplained executable coverage gaps.

## 27. Immediate next step

Start with PR 1 only: generate the authoritative Benefits go-live matrix from `BENEFITS_COMMUNICATION_CATALOGUE`, current source owners, template registry and legacy-writer scan, plus regression tests for the currently working Benefits Email path. Do not alter live delivery behavior in that first implementation slice.

After that baseline is green, PR 2 can generalize the communication-policy model without changing which Email is currently sent.