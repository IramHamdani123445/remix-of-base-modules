# Print / Correspondence — make it real, in phases

## First: the starting state is not what the brief assumes

I checked the repository at HEAD against the database before planning. They disagree:

**Database already has Print groundwork** (from an earlier session):
- `print_spool` provider registered and active on channel `print`
- Test-delivery prepare, target/payload normalisation, release prerequisites and release-control summary all contain Print handling

**The application and edge code does NOT**:
- No print artefact adapter exists (`supabase/functions/_shared/omni-comms/` has resend, twilio, svix only)
- The server adapter registry lists Email and SMS only — Print is not deliverable
- `channelCatalogue.ts` still marks Print `implemented: false`, with Providers / Accounts / Endpoints / Bindings / Release Control all locked
- `providerAdapterCatalogue.ts` marks `print_spool` as `deliveryImplemented: false` ("ships in build C10")
- There is no `issuing_authority` identity type, no `render_service` endpoint type, and Print is not in the Control Center picker
- No physical-production tables at all (no print queue, batches, attempts, manifests, returns, postal snapshots)

So items 1-4 of the brief's "current known state" are not true in source today. Everything below is written against the real state.

## Why this is phased

The brief spans configuration correctness, a production-grade PDF artefact, and an entire physical operations domain (queue, batches, attempts, mailroom dispatch, returns). That is three distinct deliverables with different risk. Shipping them as one change would make the Email/SMS regression surface unmanageable. Each phase below is independently green and independently useful.

---

## Phase 1 — Print configuration honestly operational

Goal: an administrator can configure Provider → Account → Identity → Endpoint → Binding → Policy → Release Control for Print and see truthful readiness.

- Unlock Print capabilities in `channelCatalogue.ts` (`implemented: true`; providers/accounts/identities/endpoints/bindings/release-control enabled), keeping Email/SMS matrices untouched.
- Add `print_spool` to the server adapter registry as a **credential-free internal adapter**: new descriptor flag `credentialModel: 'none' | 'required' | 'verifiable'`, replacing the implicit "no credentials means unconfigured" reading.
- Credential-free semantics, applied consistently in the UI and in the server readiness predicate: a zero-requirement adapter reports **not applicable**, is credential-complete, and may be activated. Resend and Twilio keep their existing required/verifiable rules unchanged.
- Print identity type `issuing_authority` (authority name, address block, signatory, letterhead profile); Print endpoint type `render_service` with `internal` or `https` mode; Print binding requires an endpoint.
- Release prerequisites for Print report credentials, sending domains and callbacks as **not applicable**, not failed.
- Add Print to the Control Center channel picker with channel-correct wording, recipient hints and test payload shape.
- Tests: credential-free account create + activate, Print readiness not-applicable rows, Email/SMS rules unchanged.

## Phase 2 — Production-grade artefact

Goal: what the catalogue claims is what is stored.

- Replace the plain-text artefact with a genuine **PDF** rendered through the existing generated-document/template infrastructure — no duplicate template store.
- Artefact record carries: immutable stored object, template family + version, checksum, generated timestamp, issuing authority, recipient, **postal destination snapshot**, page count, letter reference, communication/request id.
- Deterministic and idempotent: same request + same version yields the same artefact and the same idempotency outcome.
- Postal snapshot is frozen at send time, so a later address change on the Employer/IP does not alter historical correspondence. Address masked in list views by permission.
- Catalogue, adapter, UI and tests all say PDF, together.

## Phase 3 — Physical production domain

Goal: `artefact produced` stops meaning `posted`.

New narrow tables, extending the existing communication model rather than duplicating it (each Print message keeps its canonical `communication_request` / channel message / attempt / audit records):

| Table | Why it is needed |
| --- | --- |
| `omni_comms_print_item` | Physical state machine per letter (requested → rendering → artefact_produced → awaiting_approval → approved → queued_for_print → printing → printed → quality_checked → packed → ready_for_dispatch → dispatched → delivered / returned), plus production profile and blockers. The channel message has no physical lifecycle. |
| `omni_comms_print_attempt` | Each physical print attempt with operator, time, provider/account, outcome and spoil reason. A reprint is a new attempt, never an overwrite. |
| `omni_comms_print_batch` + items link | Controlled batch production with reconciliation counts (expected / produced / failed / spoiled / held / reprinted / completed) and an authorised override with reason when counts do not reconcile. |
| `omni_comms_dispatch_manifest` + items link | Physical handover evidence: ordinary post, registered post, courier, hand delivery, internal collection; handover provider, dispatched at, operator, receipt reference. |
| `omni_comms_print_return` | Returned / address unknown / moved / refused / deceased / undeliverable / other, with evidence reference, linked to the original communication. |

Production profiles (paper size, simplex/duplex, colour, letterhead, envelope, inserts, copies, registered/ordinary, special handling) and provider capabilities (PDF input, internal or HTTPS rendering, physical printing, duplex, colour, envelopes, inserts, batching, dispatch, tracking, delivery evidence, return handling) are stored as provider-neutral capability/requirement JSON on the existing provider-account and message rows — no Print-specific provider registry. Routing selects an account whose capabilities satisfy the message requirements, so switching production account needs no business-module change.

## Phase 4 — Operator surfaces and closure

- Governed **Print Queue** driven by live Print messages (communication id, letter id, recipient, employer/IP reference, issuing authority, artefact, page count, provider/account, production profile, physical state, blockers, age/SLA). The stale read-only placeholder and its "Print worker not enabled" wording are removed.
- Batch console, dispatch manifest console, returns capture.
- Full acceptance suite from section 16, including: release OFF blocks production, release ON permits it, printed ≠ dispatched, spoil + reprint keep separate attempts, manifest links individual letters, returns stay linked, historical postal snapshot immutable.
- Closure report: architecture found, gaps fixed, files/RPCs/tables changed, structures reused, why each new table was necessary, supported provider/account types, readiness workflow, lifecycle, configuration UI paths, test counts, and remaining gaps before Benefits formal correspondence.

Benefits producers are not touched in any phase.

## Technical notes

- Provider/account types supported by the model without new tables: built-in internal spool, internal central print room, department/local print room, network spool service, external print-and-mail company, controlled manual mailroom, future postal/courier provider — distinguished by account capabilities and endpoint mode, never by provider-name checks. Any type without a deployed adapter is shown honestly as configuration-only.
- No new communication history, no duplicate template store, no duplicate provider registry, no second hub.

## Suggested start

Phase 1 in this turn, then continue phase by phase.
