# Internal Audit — Gate E1/E2/E3 Communication Pre-Flight Canary

Date: 2026-09-02 · Environment: TEST · Release identity:
`1ac766266983a142bd8cfa6f82b4d911686b4de9`

## 1. Templates (Gate E2)

Professional Internal Audit templates are published for every catalogued
obligation:

- 48 published **email** template versions (table-based HTML composer: masthead,
  purpose, action required, next steps, priority chip, deep link into the
  Internal Audit workspace).
- 49 published **in-app** template versions.
- Editorial content is sourced from `internalAuditEmailContent.ts`; no address,
  name or reference is hard-coded — all business facts arrive as contract fields.
- The producer refuses to emit when a required business fact is missing, so
  "Not stated" placeholders can no longer reach a recipient.

## 2. Automatic process communications (Gate E3)

All 49 obligations are registered as active event definitions with active
`INTERNAL_AUDIT` producer bindings permitting queued mode. Emission is driven by
governed database triggers (`zz_ia_*_comms_trg`) into
`omni_comms_business_event_outbox`; no business module writes to the sending
spine directly.

## 3. Held-job re-evaluation

`omni_comms_priv_reevaluate_held_jobs` was run against the 50 outstanding held
jobs after the pilot expansion.

| Result | Count | Reason |
|---|---|---|
| still held | 50 | `certification_revision_mismatch` |
| authorised | 0 | — |

Significance: **`recipient_not_allowlisted` no longer appears**. The recipient
gate that previously blocked every Internal Audit job now admits the resolved
Internal Audit mailboxes. The remaining hold reason is the release-identity pin:
those jobs were created under the earlier certified commit
(`03fcd61c…`) and are refused under the newly certified revision. They are
pre-cutover artefacts and are intentionally left held rather than force-released.

Jobs emitted from this point forward carry the current release identity and are
therefore no longer blocked by either the recipient gate or the revision pin.

## 4. Position

Gates E1, E2 and E3 are satisfied. The final 20-engagement E2E plan has **not**
been started.

---

## 5. Gate E4.0 — closed

The fresh post-cutover canary was executed and **passed**. It also exposed and
corrected DEF-E2E-002 (deployment certification did not advance the privileged
dispatch activation, so no newly rendered job could ever dispatch after a
redeploy).

Full trace, provider acceptance evidence and the correction detail:
`docs/internal-audit/IA-FULL-E2E-COMMUNICATION-EVIDENCE-2026-09-02.md`.

Summary: Annual Plan `2029-CANARY-C` approved through governed commands only →
`INTERNAL_AUDIT.PLAN.APPROVED` emitted → ingested and rendered automatically →
both email and in-app jobs authorised with a valid release snapshot → dispatched
unattended within one scheduler cycle → email accepted by the provider (HTTP
200) and in-app delivered. Recipient was an approved Internal Audit test mailbox;
live delivery remains disabled.
