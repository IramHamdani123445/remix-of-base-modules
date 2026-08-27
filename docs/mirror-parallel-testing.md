# Testing the app against the mirrored target project (before cutover)

Goal: exercise the full application against the **target** Supabase project while the
live Lovable Cloud project keeps serving the current preview/production app, so you can
walk away from the mirror at any time with zero rollback work.

## How it works

`vite.config.ts` aliases `@/integrations/supabase/client` to
`src/integrations/supabase/mirrorClient.ts` **only** when Vite runs with `--mode mirror`.
Every screen, hook and service therefore points at the target project without a single
call site being changed. The auto-generated client and `.env` are untouched, so:

- normal `npm run dev`, the Lovable preview and the published app → live project (unchanged)
- `npm run dev:mirror` / `npm run build:mirror` → target project

The mirror session is stored under its own auth key (`sb-mirror-auth-token`), so signing in
to the mirror does not disturb your live session. A dark-orange banner is pinned to the
bottom of every mirror screen showing the target host.

## Setup (one time)

```bash
cp .env.mirror.example .env.mirror
# fill in the target project's URL + publishable (anon) key
```

`.env.mirror` is git-ignored. Only publishable keys go here.

## Run

```bash
npm run dev:mirror            # local dev server against the target
npm run build:mirror && npm run preview   # production-style build against the target
```

## What to test

1. Sign-in with a migrated user (auth users were streamed to the target).
2. Role/permission resolution and sidebar navigation.
3. One read-heavy screen per module (Benefits, Compliance, Employer, Legal, Finance).
4. One write path per module, on non-critical records only — remember the target holds a
   point-in-time copy; anything written there is discarded if you re-stream before cutover.
5. Edge functions (141 deployed on the target) — confirm they resolve secrets correctly.
6. Storage: open a document and generate a signed URL.
7. Omni-Comms: keep delivery channels suspended on the target so no real messages go out.

## Going back

Nothing to undo. Stop the mirror dev server and use the normal commands. The live project
was never written to by mirror mode.

## Cutover (only after you are satisfied)

Follow `docs/mirror-step11-cutover.md`: freeze writes, stream the delta, then repoint the
real `VITE_SUPABASE_*` values. Mirror mode stays in the repo as a safety harness.
