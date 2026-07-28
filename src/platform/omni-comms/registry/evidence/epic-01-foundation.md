# Epic 1 — Foundation: Verified

**Epic name:** Omnichannel Communications Foundation
**Status:** VERIFIED
**Approval:** Awaiting sign-off on Story 5 completion report.
**Version reference:** Repository HEAD at Story 5 close.

## Stories completed

| Story | Title | Status |
| --- | --- | --- |
| 1 | Shell, capability registration, permanent navigation | Complete |
| 2 | Health / Readiness page (source-controlled) | Complete |
| 3 | Object, route, edge-function, and queue registries | Complete |
| 4 | Architecture boundary and CI enforcement | Complete |
| 5 | Final foundation verification and evidence | Complete |

## Files created (Stories 1–5)

- `src/platform/omni-comms/README.md`
- `src/platform/omni-comms/{application,domain,repositories,adapters,rendering,workers,api,admin,architecture,registry}/**` (skeleton)
- `src/platform/omni-comms/admin/OmniCommsAdminRoute.tsx`
- `src/platform/omni-comms/admin/views/OmniComms{Landing,Operations,Events,Templates,Channels,Preferences,Health}Page.tsx`
- `src/platform/omni-comms/admin/views/readiness/{ReadinessTab.tsx,ReadinessSection.tsx,ReadinessStatusBadge.tsx}`
- `src/platform/omni-comms/registry/{registry.types.ts,objectRegistry.ts,deferredObjects.ts,routeRegistry.ts,integrationRegistry.ts,queueRegistry.ts,validateRegistries.ts,readinessManifest.ts}`
- `src/platform/omni-comms/registry/evidence/epic-01-foundation.md` (this file)
- `src/platform/omni-comms/architecture/{architectureCheck.types.ts,architecturePolicy.ts,architectureBaseline.ts,runArchitectureChecks.ts,index.ts}`
- `src/platform/omni-comms/architecture/checks/check{LegacyImports,LegacyTableReferences,ProviderImports,ReactRuntimeWrites,MigrationRegistry,RouteRegistry,IntegrationRegistry,QueueRegistry,FacadeBoundary,PermanentNames}.ts`
- `src/platform/rbac/omniComms.permissions.ts`
- `src/pages/admin/omnichannel-communications/{Landing,Operations,Events,Templates,Channels,Preferences,Health}Page.tsx`
- `scripts/omni-comms/check-architecture.ts`
- `src/__tests__/omni-comms/{epic1-shell,health-readiness,story3-registries,architecture-boundaries,epic1-final-verification}.test.*`
- `supabase/migrations/20260728095023_52a20396-c392-4a26-bb7d-f6cd20ffccd9.sql` (Omni-Comms nav seed)

## Files modified

- `src/components/routing/AppRoutes.tsx` — seven lazy imports and seven route registrations under `/admin/omnichannel-communications`.
- `src/platform/rbac/permissionRegistry.ts` — registered six `omni_comms.*` capability keys.
- `package.json` — added `check:omni-comms-architecture` script.
- `.github/workflows/comm-hub-clean-db-ci.yml` — added `omni-comms-architecture` job.

## Routes verified (exactly seven)

| # | URL | Guard | Page wrapper | Module view | State |
| - | --- | --- | --- | --- | --- |
| 1 | `/admin/omnichannel-communications` | `OmniCommsAdminRoute` → `omni_comms.view` | `LandingPage.tsx` | `OmniCommsLandingPage.tsx` | Placeholder (with Readiness card) |
| 2 | `/admin/omnichannel-communications/operations` | same | `OperationsPage.tsx` | `OmniCommsOperationsPage.tsx` | Placeholder |
| 3 | `/admin/omnichannel-communications/events` | same | `EventsPage.tsx` | `OmniCommsEventsPage.tsx` | Placeholder |
| 4 | `/admin/omnichannel-communications/templates` | same | `TemplatesPage.tsx` | `OmniCommsTemplatesPage.tsx` | Placeholder |
| 5 | `/admin/omnichannel-communications/channels` | same | `ChannelsPage.tsx` | `OmniCommsChannelsPage.tsx` | Placeholder |
| 6 | `/admin/omnichannel-communications/preferences` | same | `PreferencesPage.tsx` | `OmniCommsPreferencesPage.tsx` | Placeholder |
| 7 | `/admin/omnichannel-communications/health` | same | `HealthPage.tsx` | `OmniCommsHealthPage.tsx` | Available (Readiness) |

No eighth permanent route exists. No tab is registered as a separate top-level route.

## Permissions verified

| Capability | Registered | Mapping |
| --- | --- | --- |
| `omni_comms.view` | Yes | Mapped to System Administrator (Story 1 seed) |
| `omni_comms.operate` | Yes | Unmapped |
| `omni_comms.configure` | Yes | Unmapped |
| `omni_comms.author_templates` | Yes | Unmapped |
| `omni_comms.approve_templates` | Yes | Unmapped |
| `omni_comms.view_sensitive_content` | Yes | Unmapped |

No new role created. No Legacy permission reused for Omni-Comms access. No client-side-only bypass.

## Registry counts (source-controlled, all `PLANNED`)

- Active logical objects: **19**
- Deferred objects: **2** (`omni_comms_attachment`, `omni_comms_message_attachment`)
- Permanent routes: **7** (all `available`)
- Reserved integrations: **7**
- Reserved queues: **5**

## Architecture rules verified (all enforced in CI)

`OMNI_LEGACY_IMPORT`, `OMNI_LEGACY_TABLE_REFERENCE`, `OMNI_PROVIDER_IMPORT_BOUNDARY`, `OMNI_REACT_RUNTIME_WRITE`, `OMNI_MIGRATION_OBJECT_REGISTRY`, `OMNI_ROUTE_REGISTRY`, `OMNI_INTEGRATION_REGISTRY`, `OMNI_QUEUE_REGISTRY`, `OMNI_SEND_FACADE_BOUNDARY`, `OMNI_PERMANENT_NAME_POLICY`.

Baseline: 0 entries inside new-system roots, 0 wildcard entries, 0 invalid entries, 0 stale entries.

## Tests executed

- `bunx vitest run src/__tests__/omni-comms/` — see completion report for actual counts.
- `bun run check:omni-comms-architecture` — 0 violations, 0 baseline, 0 stale.

## CI check result

`.github/workflows/comm-hub-clean-db-ci.yml` runs the `omni-comms-architecture` job on pull requests touching `src/platform/omni-comms/**`, `src/components/routing/AppRoutes.tsx`, `supabase/migrations/**`, and `scripts/omni-comms/**`.

## Legacy impact

None. Legacy Communication Hub routes, permissions, tables, providers, and jobs are unchanged. Architecture checks statically prohibit Legacy imports and Legacy table references from `src/platform/omni-comms/**`.

## Known limitations

- All 19 approved logical objects are `PLANNED`. No business tables exist.
- No `sendCommunication()` implementation or export exists.
- No provider adapter, worker, edge function, queue implementation, or webhook exists.
- Five capabilities remain unmapped and cannot yet be granted through the UI.

## Remaining blockers

- `first-event-legacy-trigger` — verified Legacy trigger and named owner required (Epic 11).
- `ninety-day-frequency-evidence` — 90-day volume data required before selecting the first shadow event (Epic 11).
- `independent-legacy-disable` — independent Legacy-disable capability must be verified before production cutover (Epic 12).

## Rollback procedure (rehearsal — DO NOT EXECUTE without authorisation)

Rollback is strictly limited to Story 1–5 artifacts. It must not modify Legacy Communication Hub code, routes, tables, permissions, provider configuration, jobs, or runtime behavior. Where reverting the exact Story 1–5 commits is feasible, prefer that over directory deletion.

**Step 1 — Source shell.** Revert only the files created/modified by Stories 1–5 under `src/platform/omni-comms/**`, `src/pages/admin/omnichannel-communications/**`, `src/__tests__/omni-comms/**`, `scripts/omni-comms/**`, and this evidence file. Do not delete unrelated files.

**Step 2 — Routes.** Remove exactly the seven Omni-Comms lines from `src/components/routing/AppRoutes.tsx` (seven `lazy(...)` imports and seven `<Route path="/admin/omnichannel-communications...">` registrations). Do not modify any Legacy route registration.

**Step 3 — Permission definitions.** Revert `src/platform/rbac/omniComms.permissions.ts` and the corresponding registrations in `src/platform/rbac/permissionRegistry.ts`. Run the repository's standard permission-registry synchronisation so removed definitions are not recreated or left stale.

**Step 4 — Navigation and role grant (targeted DB rollback).** The Story 1 seed at `supabase/migrations/20260728095023_...sql` has already been applied. Reverting the migration source alone is insufficient. Execute an approved targeted rollback migration in this exact foreign-key-safe order, using the exact stable identifiers below:

```sql
-- 4a. Revoke the exact omni_comms.view grant to System Administrator
DELETE FROM public.role_permissions
 WHERE role_id  = 'bdec06a6-cfbd-4c4e-a2be-11d6b638b948'
   AND module_id = (SELECT id FROM public.app_modules WHERE name = 'omni_comms')
   AND action_id = (
     SELECT id FROM public.module_actions
      WHERE action_name = 'view'
        AND module_id = (SELECT id FROM public.app_modules WHERE name = 'omni_comms')
   );

-- 4b. Delete the six module_actions rows for the omni_comms module
DELETE FROM public.module_actions
 WHERE module_id = (SELECT id FROM public.app_modules WHERE name = 'omni_comms')
   AND action_name IN ('view','operate','configure','author_templates','approve_templates','view_sensitive_content');

-- 4c. Delete the seven child app_modules rows by exact name
DELETE FROM public.app_modules
 WHERE name IN (
   'omni_comms_overview','omni_comms_operations','omni_comms_events','omni_comms_templates',
   'omni_comms_channels','omni_comms_preferences','omni_comms_health'
 );

-- 4d. Delete the parent omni_comms app_modules row by exact name
DELETE FROM public.app_modules WHERE name = 'omni_comms';
```

Prohibited rollback patterns:
- `DELETE FROM core_permission_registry WHERE permission_key LIKE 'omni_comms.%'`
- Any `LIKE '%omni%'` predicate
- Any deletion that removes rows for other communication modules

**Step 5 — CI.** Remove only the `omni-comms-architecture` job added to `.github/workflows/comm-hub-clean-db-ci.yml` by Story 4. Do not remove or replace the existing workflow. Remove the `check:omni-comms-architecture` script from `package.json` (Story 4 introduced it; no other tooling depends on it).

**Step 6 — Registries and Readiness.** Reverted with the source shell in Step 1.

**Step 7 — Verify post-rollback.** Run: permission-registry synchronisation, `tsgo`, lint, route tests, permission tests, and standard CI. Confirm: Omnichannel Communications navigation absent, all seven routes absent, six `omni_comms.*` capability definitions and the `view` grant absent, no Omni-Comms CI step remains, no Omni-Comms source shell remains, Legacy Communication Hub navigation and routes still work, Legacy permissions unchanged, no Legacy database object altered, no broad deletion affected another module.

**Authorisation note.** This procedure is a documented rehearsal. It must not be executed against the active development branch or any shared environment without explicit approval.

## Next approved epic

**Epic 2 — Story 1: Event Definition and Contract Database Design.**
