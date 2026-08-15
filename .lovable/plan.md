# Benefits-wide Omni-Comms cutover and certification

## Confirmed diagnosis

The concern is valid. The rows labelled `EMAIL / QUEUED` in the screenshot are legacy `bn_communication_log` rows, not Omni-Comms jobs. Database evidence for the displayed claim shows recent `bn.eligibility.failed` Email/SMS rows only in the Benefits-local history, while the Omni-Comms outbox contains only three processed `BENEFITS.CLAIM.SUBMITTED` events from earlier claims.

The source still has three parallel Benefits communication paths:

- claim workflow actions call the legacy `bnCommunicationAdapter`, which selects `notification_templates` and writes legacy logs/letters;
- the older Benefits notification service writes `notification_logs` / `in_app_notifications` and can call the old send function directly;
- the Benefits notification adapter writes `notification_queue` directly.

The catalogue currently marks only `BENEFITS.CLAIM.SUBMITTED` as source-wired. Templates and event registrations alone do not make the source business operations emit Omni-Comms events.

## Implementation plan

### 1. Establish a machine-enforced cutover inventory

- Generate one authoritative matrix from the Benefits communication catalogue and source-parity registry: business command, executable owner, canonical event, recipient role, template family, producer state, and certification state.
- Fail tests when an executable communication-required/optional transition has no canonical producer binding or when Benefits production code imports a legacy sender/queue writer.
- Keep `NO_COMMUNICATION_REQUIRED` and not-yet-executable transitions explicitly classified; do not fabricate sends for operations that do not exist.

### 2. Replace all active Benefits legacy producers

- Change claim workflow automation and the eligibility failure dialog to emit canonical `BENEFITS.*` events through `emitBenefitsCommunication()` only.
- Replace active callers of `dispatchBnNotification`, `bnNotificationAdapter.sendClaimNotification`, and direct claim communication triggers with domain-specific typed producer calls that delegate to the single façade.
- Preserve legacy readers as read-only history, but remove production write/send/retry entry points from Benefits screens and workflow bridges.
- Make retries and status actions operate on governed Omni-Comms requests/jobs rather than legacy rows.

### 3. Wire executable domains at their authoritative transaction boundary

Implement in bounded batches so each batch is independently testable:

1. Claim, evidence, eligibility, calculation, determination and award.
2. Suspension and reinstatement.
3. Life certificate and medical review.
4. Overpayment and means test.
5. Appeals, mortality, risk and uprating.
6. Payment transitions that are genuinely executable.

For database-owned operations, publish to the existing Omni-Comms business-event outbox in the same transaction as the successful state change. For command-pipeline and scheduler-owned operations, publish immediately after authoritative success using deterministic idempotency. No provider calls or queue writes will occur inside Benefits business code.

### 4. Use one canonical payload and recipient-resolution layer

- Extend the typed Benefits producer input to support each catalogue recipient role and the channels allowed by central policy; Benefits will supply facts, not choose templates, branding, sender accounts or delivery state.
- Build event-specific payload adapters against the published contracts and template token registry.
- Resolve organization, department, product and semantic recipient context through the existing shared scope/configuration resolvers so organization/department/product/event overrides continue to work centrally.
- Return bounded blockers for missing recipient facts or contract values and show those blockers in Activity.

### 5. Make the Claim Communications screen truthful

- Show Omni-Comms Activity as the only current operational timeline.
- Move Email/SMS/Failed/Letters views onto Omni-Comms request, message, job and attempt data.
- Put legacy rows under one clearly labelled read-only archive; never show a legacy `QUEUED` badge as a current delivery job.
- Deep-link each current row to its Omni-Comms Activity detail so the same request is visible in both Benefits and the central Hub.

### 6. Event-by-event provider-free certification

For every catalogued communication event, automatically verify:

- unique canonical event and active producer binding;
- published server contract and template family/version;
- valid semantic recipient role and central Email policy;
- representative payload generation and strict contract validation;
- deterministic template rendering with no unresolved tokens;
- organization/department/product/event resolution precedence;
- deterministic idempotency and replay behavior;
- request, recipient, message and governed job persistence;
- visibility through the central Activity query and the Benefits entity filter;
- no write to legacy notification queues/logs and no provider contact.

For every executable source transition, add an integration test proving that the real command/RPC/scheduler success creates exactly one matching outbox/request identity. Database-backed tests will use rollback fixtures or dedicated synthetic entities so benefit records are not polluted.

### 7. Controlled live delivery proof

- Do not send every template to real addresses; that would create avoidable production mail and weaken operational safety.
- After all events pass provider-free certification, perform controlled real delivery for representative events from each recipient/policy class, using approved test recipients and the existing delivery gate.
- Trace each sample from source transition → outbox → request → rendered message → dispatch job → delivery attempt/provider result → Activity.

### 8. Closure report

Deliver a generated report with independent counts for:

- events designed;
- communication events with published templates/contracts;
- executable source transitions;
- executable transitions wired to Omni-Comms;
- events passing provider-free end-to-end certification;
- controlled live samples delivered;
- remaining items blocked because their source business operation is not implemented.

## Technical constraints

- No new parallel communication subsystem, provider integration, template table or queue.
- Reuse `emitBenefitsCommunication` → `emitBusinessCommunication` → `sendCommunication`, the existing outbox/ingest worker, central resolver, generated-document archive and Activity read model.
- Legacy Benefits communication tables remain read-only evidence until compatibility and retention requirements permit retirement.
- Business state changes remain authoritative even if communication is blocked; the failure is recorded and retryable through Omni-Comms.
- Database-owned emissions must be transactional and idempotent; browser-only “fire and forget” is not sufficient for production closure.
