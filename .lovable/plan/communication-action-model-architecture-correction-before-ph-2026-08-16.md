# Communication Action Model — architecture correction before physical Print

## 1. What Phase 3A already did

- `omni_comms_print_item` — one physical item per Print message (artefact pointer, postal destination snapshot, production profile, physical status, version).
- `omni_comms_print_attempt` — physical attempts.
- Server-side physical state machine + governed RPCs (`..._print_item_ensure`, `..._print_item_action`, `..._print_queue_list`, `..._print_item_detail`).
- `printArtefactAdapter.ts` — deterministic PDF production into the documents bucket.
- `printProductionService.ts` / `printProductionTypes.ts`, `PrintProductionQueue.tsx` mounted inside the existing Operations route.
- Registry counts and tests updated.

## 2. Does any of it assume "print the Email"?

Partly, in one place only. `omni_comms_print_item` is created from an existing `omni_comms_message`, and the test-delivery path renders the Print artefact from whatever rendered content the message carries. Because the message already carries its own `channel` and `template_version_id`, the data model does not force Email reuse — but the current test-delivery flow will happily produce a PDF from an Email-shaped render when no Print variant exists. That fallback is what must be removed.

Nothing else assumes Email→Print conversion. Print items are keyed to message + template family/version, not to Email.

## 3. What can safely remain

All of it, unchanged, except:
- remove the implicit "render Print from Email content" fallback in the test-delivery/artefact path; require a Print channel template variant (fail closed with a clear blocker when absent).
- Print item creation stays message-driven, but the message must be a Print-channel message.

## 4. Current event/template architecture (as built)

```text
omni_comms_event_definition (code, module, communication_class)
  └─ omni_comms_event_route (org, dept, event, CHANNEL,
        is_required, is_enabled, priority, template_family_id,
        sender_identity_id, preference_policy, lifecycle_state)
        └─ omni_comms_template_family (code, scope, event)
              └─ omni_comms_template_version (CHANNEL, locale, content, status)

omni_comms_request → omni_comms_recipient (recipient_role) → omni_comms_message (channel, template_version_id, render, provider) → delivery attempts → print_item/print_attempt
```

Key finding: channel-specific template variants **already exist** — `omni_comms_template_version.channel`. No duplicate template repository is needed. What is missing is the obligation layer between event and channel.

## 5. Proposed Communication Action model (smallest backward-compatible extension)

Two new tables plus a nullable pointer on the existing route table.

```text
omni_comms_communication_action        -- catalogue of obligations
  id, code (FORMAL_DECISION_NOTICE | COURTESY_ALERT | …),
  event_definition_id, recipient_role, name, description,
  obligation ('required' | 'optional'),
  satisfaction_rule ('one_of' | 'all_of'),
  legal_basis, status, scope (org/dept), lifecycle columns

omni_comms_action_channel_option       -- allowed fulfilment per action
  id, action_id, channel, rank,
  template_family_id (nullable — else inherit from route),
  is_fallback boolean, condition jsonb   -- e.g. digital_unavailable

omni_comms_event_route
  + action_id uuid NULL                 -- NEW, nullable = legacy direct route
```

Resolution becomes: event → actions for the recipient's role → for each action, ordered allowed channels → apply policy → pick the satisfying set → resolve template family → resolve **channel-specific** template version → create one message per selected channel.

Legacy behaviour: when an event has no actions defined, the resolver falls back to today's per-channel `omni_comms_event_route` rows exactly as now. Existing Benefits callers that pass `requestedChannels: ['email']` keep working untouched.

## 6. Channel-variant model

No schema change. `template_family` = the family (`BENEFITS_CLAIM_APPROVED_FORMAL`), `template_version.channel` = the variant (email / print / sms / whatsapp). Rules to add:
- a channel is only selectable for an action if a **published version for that channel** exists;
- the renderer never cross-renders channels (fail closed, blocker `channel_variant_missing`);
- an official-document concept: a family may be flagged `produces_official_document`, so the Print variant produces the PDF artefact and the Email/SMS variants **reference or attach** it instead of being the document.

## 7. Configurable paper/digital policy

```text
omni_comms_delivery_policy            -- versioned, org/dept scoped
  id, organization_id, department_id, action_id NULL (NULL = default),
  mode ('digital_first' | 'paper_first' | 'both'),
  print_when jsonb  -- {legally_required, recipient_requested,
                    --  digital_unavailable, policy_exception}
  version_number, status, effective_from/to, lifecycle columns

omni_comms_recipient_channel_preference
  organization_id, recipient_role, recipient_reference,
  channel, preference ('preferred'|'opt_out'|'paper_required'), source, evidence
```

Statutory override wins over recipient preference; recipient preference wins over org default; channel readiness (adapter deployed + release control live) can only *remove* a channel, never add one — if removal breaks a required action's satisfaction rule, the fallback channel is used, and if none is available the request is blocked with an explicit reason.

Moving from paper-heavy to digital-first then becomes: edit one policy row version. No Benefits code change.

## 8. Evidence and snapshots

- `omni_comms_request.business_context_snapshot` gains a `resolution` block: actions considered, channels allowed, chosen, rejected + reason code (`policy_digital_first`, `recipient_opt_out`, `channel_not_ready`, `statutory_print_required`, `variant_missing`).
- New `omni_comms_message.action_id` + `policy_version_id` (nullable) so every message states which obligation and which policy version produced it.
- Print items inherit that provenance — the physical record can always answer "why was this printed?".

## 9. Migration / backward compatibility

1. Additive-only migration: new tables, nullable columns, GRANTs + RLS mirroring existing Omni-Comms tables.
2. Resolver runs in **dual mode**: action-driven when actions exist for the event, legacy route-driven otherwise.
3. Seed actions for one Benefits event first (`BENEFITS.CLAIM.APPROVED`) behind the existing governance gates; verify parity against the legacy path before seeding the rest.
4. No caller signature change. `requestedChannels` continues to act as a caller-side narrowing filter, never as an override of a required statutory action.

## 10. Sequence after this slice

1. Communication Action model (this slice)
2. Channel resolution policy
3. Channel-specific template variants enforcement (remove Email→Print fallback)
4. Recipient preferences + paperless policy
5. Print physical production (resume Phase 3A)
6. Print batches
7. Dispatch / returns
8. Benefits event migration

Print Batch, Dispatch Manifest and Returns are explicitly **not** started until steps 1–4 are implemented and tested.
