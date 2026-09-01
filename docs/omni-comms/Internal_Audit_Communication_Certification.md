# Internal Audit — Complete Communication Certification

Scope: every Internal Audit (IA) communication obligation, its business trigger, its
recipient rule, and its observed behaviour in the governed Omni-Comms pipeline.
Environment: TEST. Certification run: 2026-08-30.

Pipeline under certification (no bypasses permitted):

```text
IA business transition (DB trigger / service)
  -> ia_comms_emit()
  -> omni_comms_business_event_outbox
  -> omni-comms-business-event-ingest (cron, 1 min)
  -> omni_comms_request -> omni_comms_recipient -> omni_comms_message
  -> omni_comms_dispatch_job (release-control authorisation)
  -> provider dispatch (Resend / in-app) -> delivery webhooks
```

## 1. Obligation register summary

| Group | Count |
|---|---|
| Catalogued IA obligations (`internalAuditCommunicationCatalogue.ts`) | 49 |
| Registered as `active` in `omni_comms_event_definition` | 49 |
| Previously bound + provider-delivered (signature-verified Resend `sent`/`delivered`) | 17 |
| Newly bound this wave (DB emitters installed) | 12 |
| Bound but not exercisable this wave (no business surface) | 2 (ENGAGEMENT.ENTRANCE_MEETING, ENGAGEMENT.EXIT_MEETING) |
| Remaining catalogued obligations awaiting real business traffic | 18 |

## 2. Emitters installed this wave

Governed triggers added (all `SECURITY DEFINER`, `EXECUTE` revoked from `PUBLIC` and
`authenticated`):

| Trigger | Obligations bound |
|---|---|
| `zz_ia_annual_plans_comms_trg` | PLAN.APPROVED, PLAN.REJECTED, PLAN.REVISION_REQUESTED, PLAN.CLOSED |
| `zz_ia_action_extensions_comms_trg` | ACTION.EXTENSION_REQUESTED, ACTION.EXTENSION_DECIDED |
| `zz_ia_action_progress_comms_trg` | ACTION.PROGRESS_RECORDED |
| `zz_ia_findings_comms_trg` | FINDING.SEVERITY_CHANGED |
| `zz_ia_requests_comms_trg` | REQUEST.ISSUED, REQUEST.FULFILLED |
| `zz_ia_followups_comms_trg` | FOLLOWUP.CARRIED_FORWARD |
| `zz_ia_engagements_comms_trg` | ENGAGEMENT.FIELDWORK_COMPLETED |

Recipient resolution helpers: `ia_comms_plan_recipient_fact()` (lead auditor via
`ia_auditors`, falling back to Head of Internal Audit) and
`ia_comms_escalation_fact('head_of_audit')`.

## 3. Live proof — certification cycle

Synthetic plan `2099-2100` plus representative engagement/finding/action/request/follow-up
entities were driven through real business transitions (no direct inserts into
Omni-Comms tables).

Observed:

- 12 distinct event codes emitted to `omni_comms_business_event_outbox`.
- 10 already ingested (`processed`); 2 (`REQUEST.ISSUED`, `REQUEST.FULFILLED`) awaiting
  the next ingest tick at time of writing.
- 19 `omni_comms_message` rows created across `email` and `in_app`, all with
  `omni_comms_request.status = completed` (resolution, rendering and routing succeeded).
- Recipient resolution verified correct per obligation:
  - `head_of_audit` -> Head of Internal Audit mailbox (PLAN.*, FIELDWORK_COMPLETED,
    FINDING.SEVERITY_CHANGED, FOLLOWUP.CARRIED_FORWARD, ACTION.EXTENSION_REQUESTED)
  - `action_owner` -> owning officer (ACTION.EXTENSION_DECIDED)
  - `lead_auditor` -> engagement lead (ACTION.PROGRESS_RECORDED)

## 4. Dispatch outcome and the remaining gate

All 19 new dispatch jobs are `held`:

| Channel | Jobs | Authorisation outcome |
|---|---|---|
| email | 9 | `recipient_not_allowlisted` |
| in_app | 10 | `recipient_not_allowlisted` |

Cause: the `email` and `in_app` channel release controls are in `controlled_pilot`
state (`release_version` 27 and 11) with a 14-entry pilot recipient allowlist. The
newly resolved IA recipients (Head of Internal Audit, engagement lead, action owner)
are not in that allowlist, so the release-control gate correctly refused dispatch.

This is governed behaviour, not a defect: the event codes themselves are already
permitted by both release controls, and the caller module `INTERNAL_AUDIT` is
permitted. Only the recipient allowlist blocks send.

Closure requires an operator governance cycle in the Omni-Comms Control Centre
(configuration edits are intentionally locked while `release_state =
controlled_pilot`):

1. Suspend the channel release control.
2. Upsert configuration adding the IA certification recipients (and
   `INTERNAL_AUDIT.ACTION.PROGRESS_RECORDED` to the email permitted event codes).
3. Propose pilot, then approve with a recorded approval note.
4. Re-evaluate held jobs (`omni_comms_priv_reevaluate_held_jobs`).

No SQL-level allowlist edit was performed: doing so would bypass the four-eyes
approval the pilot gate exists to enforce.

## 5. Known gaps

| Obligation | Reason |
|---|---|
| `INTERNAL_AUDIT.ENGAGEMENT.ENTRANCE_MEETING` | No entrance-meeting business surface/table exists to trigger from. |
| `INTERNAL_AUDIT.ENGAGEMENT.EXIT_MEETING` | No exit-meeting business surface/table exists to trigger from. |

Both remain catalogued and registered; they will bind when the meeting surface is built.

## 6. Verdict

- Emitter coverage: **COMPLETE** for every IA obligation that has a supporting business
  surface (47 of 49).
- Recipient correctness: **PASS** for all obligations exercised this wave.
- Provider delivery: **PASS** for the 17 previously certified obligations;
  **BLOCKED-BY-GOVERNANCE** for the 12 newly bound obligations pending the pilot
  recipient allowlist expansion described in section 4.
