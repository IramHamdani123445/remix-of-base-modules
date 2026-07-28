
# Epic 1 · Story 3 — Registries (metadata only)

Create source-controlled TypeScript registries as the single source of truth for the 19 approved logical database objects, 7 permanent admin routes, 7 reserved server integrations, 5 reserved queues, and 2 deferred attachment objects. Wire the existing Readiness page to consume the registries. **No** DB migration, edge function, queue, worker, façade, provider adapter or new route is created.

## Files to create

Under `src/platform/omni-comms/registry/`:

1. `registry.types.ts` — shared types
2. `objectRegistry.ts` — 19 active + 2 deferred entries
3. `routeRegistry.ts` — 7 permanent routes + approved tab names
4. `integrationRegistry.ts` — 7 reserved server integrations
5. `queueRegistry.ts` — 5 reserved queues
6. `validateRegistries.ts` — pure validator returning structured errors
7. `index.ts` — barrel export

Tests:

8. `src/__tests__/omni-comms/registry.test.ts` — registry contents, epic ownership, validator positive path, and three fixture failure cases (duplicate, invalid prefix, banned-name)
9. `src/__tests__/omni-comms/readiness-registry-integration.test.tsx` — Readiness page renders registry-sourced 19 objects / 7 routes / integrations / queues / deferred attachments; no edit control present

## Files to modify

10. `src/platform/omni-comms/registry/readinessManifest.ts` — drop the hardcoded `plannedObjects`, `reservedEdgeFunctions`, `reservedQueues`, and `permanentRoutes` arrays; re-export derived views sourced from the new registries. Bump `currentStory` to `Story 3` and set the `Object registry` foundation row to `Verified`. Update `nextStep` to Story 4.
11. `src/platform/omni-comms/admin/views/readiness/ReadinessTab.tsx` — add a **Catalogues** area rendering: Object catalogue (grouped by category, showing status + owning epic + write authority), Route catalogue (7 rows with approved tabs), Reserved integrations, Reserved queues, Deferred attachments. Every row displays "Registered in architecture catalogue — Not yet created". Existing sections that are already registry-derived (routes/queues/edge functions/objects) switch to the new registry imports.
12. `src/platform/omni-comms/README.md` — append the six registry-governance bullets required by the spec.

No changes to `AppRoutes.tsx`, `OmniCommsAdminRoute.tsx`, permission files, DB, or any Legacy file.

## Registry TypeScript interfaces (exact)

```ts
// registry.types.ts
export type RegistryStatus =
  | 'planned' | 'reserved' | 'available'
  | 'verified' | 'deferred' | 'blocked' | 'retired';

export type ObjectCategory =
  | 'events_content' | 'channels_senders_preferences' | 'runtime' | 'bulk';

export interface OmniCommsObjectEntry {
  name: string;
  objectType: 'table';
  category: ObjectCategory;
  purpose: string;
  owningEpic: number;
  introductionStory?: string;
  currentStatus: RegistryStatus;      // active = 'planned'
  writeAuthority: string;
  readAuthority: string;
  containsSensitiveData: boolean;
  legacyDependency: 'none';
  requiredForFirstProductionSlice: boolean;
  notes?: string;
}

export interface OmniCommsDeferredObjectEntry {
  name: string;
  currentStatus: 'deferred';
  intendedEpic: number;
  reasonDeferred: string;
}

export interface OmniCommsRouteEntry {
  routeId: string;
  path: string;
  label: string;
  requiredPermission: 'omni_comms.view';
  owningEpic: number;
  currentStatus: RegistryStatus;      // 'available' for shell routes
  purpose: string;
  approvedTabs: string[];
  pageWrapperPath: string;
  moduleViewPath: string;
}

export type IntegrationType = 'edge_function' | 'webhook_handler' | 'worker_entrypoint';

export interface OmniCommsIntegrationEntry {
  name: string;
  integrationType: IntegrationType;
  owningEpic: number;
  currentStatus: 'reserved';
  purpose: string;
  provider?: string;
  publicExposure: 'internal' | 'public_webhook';
  authenticationModel: string;
  notes?: string;
}

export interface OmniCommsQueueEntry {
  name: string;
  purpose: string;
  owningEpic: number;
  currentStatus: 'reserved';
  priorityClass: 'transactional' | 'bulk' | 'webhook' | 'retry' | 'dead-letter';
  producer: string;
  consumer: string;
  retryAllowed: boolean;
  notes?: string;
}

export interface RegistryValidationError {
  registry: 'object' | 'route' | 'integration' | 'queue';
  code: string;
  entryName?: string;
  message: string;
}
```

## Object entries (name → epic → category)

Events & content — Epic 2/3/5:
- `omni_comms_event_definition` — Epic 2 · events_content
- `omni_comms_event_contract` — Epic 2 · events_content
- `omni_comms_template_family` — Epic 3 · events_content
- `omni_comms_template_version` — Epic 3 · events_content
- `omni_comms_event_route` — Epic 5 · events_content

Channels, senders, preferences — Epic 4/5:
- `omni_comms_provider` — Epic 4 · channels_senders_preferences
- `omni_comms_provider_account` — Epic 4 · channels_senders_preferences
- `omni_comms_sender_identity` — Epic 4 · channels_senders_preferences
- `omni_comms_sender_provider_binding` — Epic 4 · channels_senders_preferences
- `omni_comms_channel_setting` — Epic 4 · channels_senders_preferences
- `omni_comms_preference` — Epic 5 · channels_senders_preferences

Runtime — Epic 6:
- `omni_comms_request`, `omni_comms_recipient`, `omni_comms_message`, `omni_comms_dispatch_job`, `omni_comms_delivery_attempt`, `omni_comms_message_event`, `omni_comms_webhook_event` — all `runtime`

Bulk — Epic 13:
- `omni_comms_batch` — `bulk`

Deferred (not counted in 19): `omni_comms_attachment`, `omni_comms_message_attachment` — intendedEpic per attachment epic, reason per spec.

All 19 active entries: `currentStatus: 'planned'`, `legacyDependency: 'none'`, `writeAuthority`/`readAuthority` populated per the Write/Read Authority sections in the story.

## Route entries (all `requiredPermission: 'omni_comms.view'`, `owningEpic: 1`, `currentStatus: 'available'`)

| routeId | path | approvedTabs |
|---|---|---|
| root | /admin/omnichannel-communications | [overview] |
| operations | .../operations | [requests, messages, batches] |
| events | .../events | [definitions, contracts, routes, simulator] |
| templates | .../templates | [library, versions, preview] |
| channels | .../channels | [settings, senders, providers, bindings] |
| preferences | .../preferences | [preferences] |
| health | .../health | [readiness, data-model, queues, webhooks, audit, migration] |

`pageWrapperPath` / `moduleViewPath` reference the existing Story 1 files.

## Integration entries (all `currentStatus: 'reserved'`)

| name | type | epic | exposure |
|---|---|---|---|
| omni-comms-send | edge_function | 7 | internal |
| omni-comms-dispatch | worker_entrypoint | 8 | internal |
| omni-comms-webhook-resend | webhook_handler | 9 | public_webhook (Resend) |
| omni-comms-webhook-twilio | webhook_handler | SMS | public_webhook (Twilio) |
| omni-comms-webhook-meta | webhook_handler | WhatsApp | public_webhook (Meta) |
| omni-comms-webhook-fcm | webhook_handler | Push | public_webhook (FCM) |
| omni-comms-print-materialise | worker_entrypoint | Print | internal |

## Queue entries (all `currentStatus: 'reserved'`)

| name | priorityClass | epic |
|---|---|---|
| omni-comms.transactional | transactional | 8 |
| omni-comms.retry | retry | 8 |
| omni-comms.dead-letter | dead-letter | 8 |
| omni-comms.webhook | webhook | 9 |
| omni-comms.bulk | bulk | 13 |

Priority intent notes recorded per spec.

## Validator rules (pure function, returns `RegistryValidationError[]`)

Enforces every bullet in **PART 6 — REGISTRY VALIDATION**: count = 19 active objects, unique names, `omni_comms_` prefix, banned fragments (`advanced|new|next|v2|pilot|controlled|rehearsal|standby|phase`), owning epic present, write authority present, `legacyDependency === 'none'`, exactly 7 routes with correct prefix and permission, no approved tab is a top-level route path, integrations start with `omni-comms-`, no `omni-comms-render`, queues start with `omni-comms.` and unique, deferred attachments excluded from the 19 count, statuses within the shared union, no entry status of `live`/`production-ready`.

## Readiness page integration

- `readinessManifest.ts` re-exports arrays derived from the registries (`plannedObjects` grouping, `permanentRoutes`, `reservedEdgeFunctions`, `reservedQueues`) so no data is duplicated.
- `ReadinessTab.tsx` adds a `Catalogues` block with four subsections (Objects · Routes · Integrations · Queues) plus a Deferred attachments note. Each row shows `Registered in architecture catalogue · Not yet created`. No edit controls.

## Tests to add / modify

- New `registry.test.ts`: counts, name presence, epic mapping, `legacyDependency: 'none'`, deferred exclusion, integration/queue exact sets, absence of `omni-comms-render`, all queues reserved, validator returns `[]` for canonical registry, validator returns errors for three inline fixture variants (duplicate object, `foo_bar` invalid prefix, `omni_comms_pilot_thing` banned fragment).
- New `readiness-registry-integration.test.tsx`: render Readiness page under memory router, assert all 19 object names, all 7 routes, all 7 integrations, all 5 queues and both deferred attachment names appear; assert no button/textbox editing controls exist inside the catalogue sections; assert Legacy sidebar route file untouched (import remains resolvable).
- Extend existing `health-readiness.test.tsx` only if manifest field renames break current assertions.

## Conflicts with Story 1 / Story 2

None. No route, guard, permission or module seed is changed. Story 2 hardcoded arrays inside `readinessManifest.ts` are safely replaced by re-exports from the new registries — the manifest keeps the same public shape consumed by `ReadinessTab.tsx`.

## Confirmation

- No database migration is required.
- No new top-level route.
- No `sendCommunication` file, edge function, queue, worker or provider adapter.
- No Legacy import.

## Rollback

Revert the eight new files and the three modified files (`readinessManifest.ts`, `ReadinessTab.tsx`, `README.md`). No DB or route state to unwind.
