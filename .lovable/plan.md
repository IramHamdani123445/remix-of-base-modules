## Epic 1 — Story 1: Omni-Comms Shell + Capability Registration + Navigation

Pre-implementation report as required by the task brief. **Nothing has been implemented.** Awaiting approval (plus resolution of the navigation blocker in §7) before Build begins.

---

### 1. Exact files to create

**Source tree** (under `src/platform/omni-comms/`):

```
src/platform/omni-comms/
  README.md                        (architecture README, 10 required points)
  application/.gitkeep
  domain/.gitkeep
  repositories/.gitkeep
  rendering/.gitkeep
  adapters/channels/.gitkeep
  adapters/providers/.gitkeep
  workers/.gitkeep
  api/.gitkeep
  registry/.gitkeep
  __tests__/omniCommsShell.test.tsx           (route registration + guard-wiring test)
  admin/components/OmniCommsNotImplemented.tsx (shared "Not yet implemented" empty state)
  admin/views/OmniCommsLandingPage.tsx         (readiness placeholder — no metrics, no data)
  admin/views/OmniCommsOperationsPage.tsx      (NotImplemented)
  admin/views/OmniCommsEventsPage.tsx          (NotImplemented)
  admin/views/OmniCommsTemplatesPage.tsx       (NotImplemented)
  admin/views/OmniCommsChannelsPage.tsx        (NotImplemented)
  admin/views/OmniCommsPreferencesPage.tsx     (NotImplemented)
  admin/views/OmniCommsHealthPage.tsx          (NotImplemented)
```

No `sendCommunication.ts`, no adapters, no workers, no api clients, no repositories.

**Permissions source file:**

- `src/platform/rbac/omniComms.permissions.ts` — new capability file following the existing `bn.permissions.ts` / `er.permissions.ts` pattern, exporting a `PermissionSourceDefinition[]`.

### 2. Exact files to modify

- `src/platform/rbac/permissionRegistry.ts` — add `omniComms` entry to `PERMISSION_REGISTRY` and spread `OMNI_COMMS_PERMISSION_DEFINITIONS` into `ALL_PERMISSION_DEFINITIONS`.
- `src/components/routing/AppRoutes.tsx` — add lazy imports and 7 routes under `/admin/omnichannel-communications/*`, each wrapped in the existing `CommHubAdminRoute` guard (see §4). Legacy `/admin/communication-hub/*` routes left untouched.

No changes to any Legacy file, service, table, function, provider adapter, edge function, or comm module.

### 3. Exact permission-registry rows to add

New file `src/platform/rbac/omniComms.permissions.ts` publishes:


| permission_key                      | scope  | risk   | sensitive | admin | notes                                         |
| ----------------------------------- | ------ | ------ | --------- | ----- | --------------------------------------------- |
| `omni_comms.view`                   | PAGE   | LOW    | false     | true  | Route-guard capability for all 7 shell routes |
| `omni_comms.operate`                | ACTION | HIGH   | true      | true  | Placeholder — no writer yet                   |
| `omni_comms.configure`              | ADMIN  | HIGH   | true      | true  | Configuration authority (future)              |
| `omni_comms.author_templates`       | ACTION | MEDIUM | true      | true  | Template authoring (future)                   |
| `omni_comms.approve_templates`      | ACTION | HIGH   | true      | true  | Template approval (future)                    |
| `omni_comms.view_sensitive_content` | FIELD  | HIGH   | true      | true  | Unmask PII in payloads (future)               |


All rows: `module_code='OMNI_COMMS'`, `domain_code='COMMUNICATIONS'`, `lifecycle_status='PLANNED'` (except `view` which is `ACTIVE`), `source_file='src/platform/rbac/omniComms.permissions.ts'`.

Persistence into `core_permission_registry` happens through the existing **Sync Permissions from Registry** admin action (`syncPermissionsFromRegistry`) — no new sync path, no migration.

### 4. Existing route-guard component to reuse

- `src/components/auth/CommHubAdminRoute.tsx` — this is the sole reuse candidate today, but it hard-codes the `system_administration` / `communication_hub` capability checks. To honour the brief ("Every route must use the `omni_comms.view` capability through the existing route guard pattern"), I will introduce a small parallel gate `OmniCommsAdminRoute.tsx` in `src/components/auth/` that follows the identical pattern (same `useIsAdmin` + `useModulePermissions` hooks, same loading/denied UI) but checks `omni_comms.view`. This is a copy of the pattern, not a new framework — no changes to `CommHubAdminRoute`.

If the reviewer prefers strict single-guard reuse, alternative is to parameterise `CommHubAdminRoute` — flag this as a review decision.

### 5. Existing admin navigation component to modify

**None can be modified in code to achieve the required nav entry** — see §7 blocker. The static `src/components/sidebar/menuItems/communicationHubMenuItems.ts` is explicitly marked `@deprecated` and does not render; the live sidebar is DB-driven via `useNavigationMenu` → `app_modules` + `module_actions` + `role_permissions`.

### 6. Existing role mappings proposed for the new capabilities

Inspection of `core.permissions.ts` and `rbacService.ts` shows role→permission grants live in DB tables `core_role` / `role_permissions`, not in source. There is no code-side "default role mapping" convention in this repo. Therefore, per the brief ("If the correct existing role mappings cannot be determined safely, register the capability definitions only and report the unmapped capabilities. Do not invent new roles."):

- **Register capability definitions only.**
- **Unmapped capabilities reported:** all six (`omni_comms.view`, `.operate`, `.configure`, `.author_templates`, `.approve_templates`, `.view_sensitive_content`).
- Suggested (non-binding) future mapping for reviewer approval in a later story: `omni_comms.view` → existing System Administrator role; other five → deferred until Epic 2+.

### 7. Conflicts / Blockers

**BLOCKER — Navigation entry.**
The brief requires "Add: Omnichannel Communications as a distinct admin navigation entry" and also forbids any DB change other than permission registration. These are mutually exclusive in this codebase: the sidebar is rendered from `app_modules` rows (see `useNavigationMenu.ts`), and the static menu file is documented as having no rendering effect. Options for reviewer:

- **(a)** Authorise a single DB insert into `app_modules` (+ `module_actions` for `omni_comms.view`) to publish the "Omnichannel Communications" parent entry with 7 children. This is a one-row-per-route seed, no business tables. Recommended.
- **(b)** Defer nav entry to Story 2; ship shell + routes + capabilities only, reachable by URL.
- **(c)** Introduce a static-menu injection point (code-only) — rejected: would create a second navigation framework, explicitly forbidden.

Implementation will not proceed on the nav entry until one of the above is chosen.

**No other conflicts.** No route collisions with `/admin/communication-hub/*`. Legacy remains untouched.

---

### Post-implementation report (to be produced after Build)

Will include: every file changed, capabilities registered, capability→role mapping status (unmapped list), 7 route paths confirmed live, navigation entry status per §7 decision, Legacy routes/nav confirmed unchanged, tests executed with actual pass/fail counts, manual navigation verification steps, rollback (revert PR + `DELETE FROM core_permission_registry WHERE permission_key LIKE 'omni_comms.%'`), and explicit confirmation that no `sendCommunication` file, business table, provider adapter, edge function, or queue was created.

---

**Stop.** Awaiting: (i) approval of this plan and (ii) explicit decision on §7 navigation blocker before switching to Build mode.  
  
Epic 1 — Story 1 pre-implementation plan is approved with the following amendments.

1. NAVIGATION DECISION

Use option (a).

You are authorised to add only the shared database navigation configuration required to expose Omnichannel Communications through the existing DB-driven navigation system.

Use the repository’s existing migration/seed convention for:

- one Omnichannel Communications module entry
- seven approved child route/action entries
- required permission: omni_comms.view

Approved routes:

- /admin/omnichannel-communications
- /admin/omnichannel-communications/operations
- /admin/omnichannel-communications/events
- /admin/omnichannel-communications/templates
- /admin/omnichannel-communications/channels
- /admin/omnichannel-communications/preferences
- /admin/omnichannel-communications/health

Do not create another navigation mechanism.

Before implementation, confirm the exact app_modules and module_actions columns and show the exact rows or seed objects to be added.

2. PERMISSION MAPPING

Register all six approved permission definitions.

For this story, map only:

- omni_comms.view

to the existing System Administrator role, after verifying the exact existing role identifier.

Do not create a new role.

Leave the following capabilities unmapped:

- omni_comms.operate
- omni_comms.configure
- omni_[comms.author](http://comms.author)_templates
- omni_comms.approve_templates
- omni_comms.view_sensitive_content

3. ROUTE GUARD

Do not use or modify CommHubAdminRoute.

Create the new-system-specific guard at:

src/platform/omni-comms/admin/components/OmniCommsAdminRoute.tsx

It must reuse the existing shared authentication and permission hooks and shared loading/access-denied presentation, but it must check omni_comms.view.

Do not copy Legacy permission names or create a new authorization framework.

4. PAGE CONVENTION

Inspect the existing admin page-wrapper convention.

If AppRoutes normally imports wrappers from src/pages, create thin wrappers under:

src/pages/admin/omnichannel-communications/

The wrappers may only compose views from:

src/platform/omni-comms/admin/views/

They must contain no business logic.

Include any required page wrappers in the final file list before implementation.

5. LEGACY

Do not rename, redirect, import, modify or disable Legacy routes or behavior.

If the Legacy navigation item is already labelled Communication Hub — Legacy, retain it.

If it is not already labelled Legacy, defer that display-label change to a separately authorised story.

6. TESTS

Add tests proving:

- all seven routes exist
- unauthenticated access is rejected
- access without omni_comms.view is rejected
- access with omni_comms.view succeeds
- navigation appears only for authorised users
- all unfinished routes show the shared empty state
- Legacy routes remain unchanged
- no sendCommunication file or export exists
- no communication business table, provider adapter, edge function, worker or queue was created

7. ROLLBACK

The rollback must include:

- reverting source permission definitions
- running the standard permission-registry synchronisation
- removing the exact Omnichannel module/action navigation records
- removing the exact omni_comms.view System Administrator grant
- removing new route registrations and source files
- confirming Legacy routes and navigation remain operational

Do not use only a broad DELETE WHERE permission_key LIKE pattern.

Return the updated exact file list, navigation seed/ migration objects, verified System Administrator mapping and rollback plan before switching to Build mode.

If these amendments are reflected without conflicts, proceed with implementation.