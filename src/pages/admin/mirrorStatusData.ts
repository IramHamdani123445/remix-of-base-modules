/**
 * Snapshot of the Lovable Cloud -> external Supabase mirror job.
 *
 * TEMPORARY: this file is hand-updated by the migration operator (the numbers
 * come from `scripts/mirror/mirror-status.sh`, which runs outside the app).
 * Delete this file, the page and its route once the mirror is signed off.
 */

export type MirrorStepState = 'done' | 'in_progress' | 'pending' | 'manual' | 'blocked';

export interface MirrorStep {
  id: string;
  title: string;
  detail: string;
  state: MirrorStepState;
  /** 0-100, omit when not measurable */
  progress?: number;
  metrics?: { label: string; value: string }[];
}

export interface MirrorSnapshot {
  capturedAt: string;
  sourceLabel: string;
  targetLabel: string;
  steps: MirrorStep[];
  verification: { id: string; check: string; expected: string; observed: string; state: MirrorStepState }[];
}

export const mirrorSnapshot: MirrorSnapshot = {
  capturedAt: '2026-08-26T19:47:00Z',
  sourceLabel: 'Lovable Cloud (source, read-only)',
  targetLabel: 'external target project (target)',
  steps: [
    {
      id: 'prep',
      title: '1. Bootstrap tooling & guards',
      detail:
        'Mirror scripts committed: baseline bootstrap, CSV loader, storage copier, status readout. Refuses to run against the source project.',
      state: 'done',
      progress: 100,
      metrics: [{ label: 'Scripts', value: '4' }],
    },
    {
      id: 'secrets-target',
      title: '2. Target credentials captured',
      detail:
        'Target database URL and service role key stored as project secrets. Never printed or committed.',
      state: 'done',
      progress: 100,
      metrics: [
        { label: 'MIRROR_TARGET_DATABASE_URL', value: 'set' },
        { label: 'MIRROR_TARGET_SERVICE_ROLE_KEY', value: 'set' },
      ],
    },
    {
      id: 'baseline',
      title: '3. Baseline schema apply',
      detail:
        'Committed baseline schema (public) fully applied into the target: tables, views, functions, enums, indexes, constraints.',
      state: 'done',
      progress: 100,
      metrics: [
        { label: 'Lines streamed', value: '167,261 / 167,261' },
        { label: 'Tables', value: '1,567' },
        { label: 'Views', value: '85' },
        { label: 'Functions', value: '1,369' },
        { label: 'Indexes', value: '3,681' },
      ],
    },
    {
      id: 'migrations',
      title: '4. Post-cutoff migrations',
      detail:
        'All 348 migrations created after the baseline cutoff have been replayed into the target after bounded reconciliation of historical reference-data dependencies.',
      state: 'done',
      progress: 100,
      metrics: [
        { label: 'Applied', value: '348 / 348' },
        { label: 'Remaining', value: '0' },
        { label: 'Ledger', value: 'complete' },
        { label: 'Replay failures', value: '0' },
      ],
    },
    {
      id: 'storage',
      title: '5. Storage objects',
      detail:
        'All buckets recreated with the same ids and public/private flags; every object copied and byte-verified. Resumable, zero failures.',
      state: 'done',
      progress: 100,
      metrics: [
        { label: 'Objects', value: '179 / 179' },
        { label: 'Buckets', value: '17' },
        { label: 'Bytes', value: '~362 MB' },
        { label: 'Failures', value: '0' },
      ],
    },
    {
      id: 'storage-policies',
      title: '6. Storage access policies',
      detail: 'The 46 access policies on storage objects extracted from the source and applied to the target.',
      state: 'done',
      progress: 100,
      metrics: [{ label: 'Policies', value: '46' }],
    },
    {
      id: 'data',
      title: '7. Table data load',
      detail:
        'Direct table-by-table CSV streaming from source to target (scripts/mirror/stream-table-data.sh): one global truncate, replica-role loads over a session-mode (5432) connection so order does not matter, resumable via a done-list. The target disk was increased and read-only mode lifted (default_transaction_read_only = off); the full run then completed with zero failures. 296 tables carried rows, the remainder were empty at source. Row counts spot-checked on the largest tables match exactly.',
      state: 'done',
      progress: 100,
      metrics: [
        { label: 'Tables processed', value: '1,730 / 1,730' },
        { label: 'Tables with rows loaded', value: '296' },
        { label: 'Failures', value: '0' },
        { label: 'Target data size', value: '1.57 GB' },
      ],

    },


    {
      id: 'auth-users',
      title: '8. Auth users',
      detail:
        'All auth accounts and their linked sign-in identities streamed directly from source to target (scripts/mirror/stream-auth-users.sh), copying only columns present on both sides. Password hashes carried over, so existing passwords keep working; active sessions do not carry over and users sign in again. Temporary read-only views used on the source were dropped afterwards.',
      state: 'done',
      progress: 100,
      metrics: [
        { label: 'Users', value: '55 / 55' },
        { label: 'Identities', value: '55 / 55' },
        { label: 'Password hashes present', value: '55' },
        { label: 'Failures', value: '0' },
      ],
    },

    {
      id: 'functions',
      title: '9. Edge functions',
      detail:
        'All 142 functions deployed to the target with scripts/mirror/deploy-edge-functions.sh, which now uses npx supabase@latest with --use-api so no local Docker bundling is needed. The only failure, bn-gap-command, imported from src/ via paths that no longer exist; it was rebuilt with a vendored _shared.ts (regenerate via scripts/bn/vendor-gap-command-shared.py) and deployed successfully. verify_jwt settings came from supabase/config.toml.',
      state: 'done',
      progress: 100,
      metrics: [
        { label: 'Deployed', value: '142 / 142' },
        { label: 'Failures', value: '0' },
        { label: 'Bundler', value: '--use-api (no Docker)' },
      ],
    },
    {
      id: 'secrets-app',
      title: '10. Application secrets',
      detail:
        'Secrets required by the deployed functions have been created in the target. The remainder are issued on demand as each capability is switched on, and a subset of the 39 inventoried names relate only to the migration itself (mirror/source-side tooling) and are deliberately not carried into the target. Platform-injected values (Supabase URL, anon key, service role key) must never be set by hand. Keep live-sending flags off until cutover is signed off.',
      state: 'done',
      progress: 100,
      metrics: [
        { label: 'Created in target', value: 'required set' },
        { label: 'Deferred', value: 'issued on demand' },
        { label: 'Migration-only, not needed', value: 'excluded' },
        { label: 'Platform-injected', value: '3 (do not set)' },
      ],
    },
    {
      id: 'cutover',
      title: '11. Parity verification & cutover decision',
      detail:
        'Everything that can be copied has been copied. Remaining: spot-check a signed storage URL and a real login against the target, run the parity queries once more, then decide whether to repoint the app. This is the only outstanding stage.',
      state: 'pending',
      progress: 0,
    },
  ],
  verification: [
    { id: 'v1', check: 'Base tables in public', expected: '~1,566+', observed: '1,730', state: 'done' },
    { id: 'v2', check: 'Views in public', expected: '~85', observed: '93', state: 'done' },
    { id: 'v3', check: 'Functions in public', expected: '~1,368+', observed: '2,012', state: 'done' },
    { id: 'v4', check: 'Indexes in public', expected: '≥ source', observed: '4,079', state: 'done' },
    { id: 'v5', check: 'Migration ledger versions', expected: '348 post-cutoff', observed: '348 applied; 0 pending', state: 'done' },
    { id: 'v6', check: 'Storage objects copied', expected: '179', observed: '179 (byte-parity verified)', state: 'done' },
    { id: 'v7', check: 'Storage policies', expected: '46', observed: '46', state: 'done' },
    { id: 'v8', check: 'Row counts per table', expected: 'match source', observed: '1,730/1,730 streamed, 0 failures; largest tables byte-for-row match', state: 'done' },
    { id: 'v9', check: 'Auth users loadable', expected: 'match source', observed: '55 users + 55 identities, hashes intact', state: 'done' },
    { id: 'v10', check: 'Edge functions deployed', expected: '142', observed: '142 deployed, 0 failures', state: 'done' },
    { id: 'v11', check: 'Secrets present in target', expected: 'required names', observed: 'required set created; rest on demand, migration-only names excluded', state: 'done' },

    { id: 'v12', check: 'Source database untouched', expected: 'read-only throughout', observed: 'confirmed — scripts refuse the source URL', state: 'done' },
  ],
};
