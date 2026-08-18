# Omni-Comms — Business-First Template Administration

Make the Business Catalogue the real administration model (Module → Business Object → Event → Communication Action → Channel → Locale → Versions), authored entirely from the UI, on top of a corrected communication-identity data model.

Current production data (checked): 81 template families (79 event-scoped, 2 organisation-scoped, 0 department-scoped), 294 versions, 80 events, 19 business objects. Nothing is dropped or rewritten.

## Phase 1 — Data-model correction (non-destructive)

New table `omni_comms_communication_action` (id, organization_id, event_definition_id nullable, code, name, description, status, audit columns) with GRANTs, RLS-off convention already used by Omni-Comms, plus audit triggers.

`omni_comms_template_family` gains `communication_action_id` (nullable during migration, then enforced by trigger for new rows). `scope_type` stays as the *scope* of a family; identity moves to the action.

Backfill:
- one action per distinct event-scoped family (keeps its code/name, links `event_definition_id`)
- the 2 organisation-scoped families become genuinely Shared/General actions (`event_definition_id = null`)
- every existing family points at its action; versions untouched

Resolution: `omni_comms_template_resolve_published` resolves *action + organization (+ optional department) + channel + locale*, then applies scope precedence (event override → department × module → organisation) **within the same action**. Cross-action resolution becomes impossible; a regression test proves it.

## Phase 2 — Governed RPCs (SECURITY DEFINER, permission-checked, audited)

- Business object: `omni_comms_business_object_create / update / list` (+ `status` and `updated_by/created_by` columns added). Requires `omni_comms.configure`.
- Event: extend create/update RPCs to persist `business_object_code` and `display_order`, and validate the code shape `MODULE.BUSINESS_OBJECT.ACTION`.
- Communication action: `omni_comms_communication_action_create / update / list`, creating the action plus its scoped template family in one transaction, with optional multi-channel draft version creation. Requires `omni_comms.author_templates`.
- `omni_comms_template_business_catalogue` rewritten to build the tree from `business_object` + `event_definition` + `communication_action` + families/versions only — no code parsing — and to return scope/override info, all six channel states and latest version metadata. Shared/General contains only actions with `event_definition_id is null`.

## Phase 3 — UI

Templates page (`OmniCommsTemplatesPage.tsx`) keeps exactly two tabs; Business Catalogue is the default:
- all six channel cells always rendered with Not configured / Draft / Approved / Published / Retired + version number
- configured cell → existing `TemplateChannelWorkspace` (version history, preview, layout, approve, publish with replacement reason, retire — unchanged)
- missing cell → channel creation for that exact action + channel, using the existing version services and channel schemas (email subject/preheader/html/text, sms/whatsapp body, in_app/push title+body, print subject/html/text), locale selectable, layout selection where required, never auto-approved

New `CommunicationActionWizard` replaces the generic family editor when launched from an Event row: business context (module, business object, event) pre-filled and locked, then name/code/description/scope, then channel multi-select, then draft creation.

Events page (`OmniCommsEventsPage.tsx` + `EventDefinitionEditorDialog.tsx`): module selector, business object selector, action segment, name, description, communication class, priority, display order, plus "Add business object" for users with configure permission, and an "Open communications" action deep-linking to the event in the catalogue (`?tab=catalogue&event=<code>`).

Legacy `NotificationTemplateManager` is left as a read-only compatibility view — no new authoring there.

## Phase 4 — Tests

Vitest coverage for: business-object CRUD service, event classification + code validation, event→action linkage, catalogue grouping/ordering from governed metadata, missing-channel creation, multi-channel creation, per-channel version history, scope resolution precedence, cross-action isolation, replacement publishing, permission gating, audit emission. Plus a SQL verify script asserting resolution never crosses communication actions.

## Notes

- No new template/version tables, no second template system, no direct browser table writes — everything goes through the bound Omni-Comms RPC client.
- Existing seed migrations stay for bootstrap only; after this, business objects, events, actions, channels and versions are all created from the UI.
