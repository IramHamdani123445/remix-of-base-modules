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
  capturedAt: '2026-08-26T10:20:00Z',
  sourceLabel: 'Lovable Cloud (source, read-only)',
  targetLabel: 'External Supabase project (target)',
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
        'The 348 migrations created after the baseline cutoff, applied in order and recorded in the target migration ledger. Running now; failures are logged and skipped rather than aborting the run.',
      state: 'in_progress',
      progress: 51,
      metrics: [
        { label: 'Applied', value: '179 / 348' },
        { label: 'Ledger', value: 'created' },
        { label: 'Failures', value: '8 (logged, skipped)' },
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
        'Export the data bundle from Lovable Cloud (Advanced settings -> Export data), then load it with the CSV loader: constraints deferred, identity sequences reset afterwards.',
      state: 'pending',
      progress: 0,
      metrics: [{ label: 'Export bundle', value: 'awaiting download' }],
    },
    {
      id: 'auth-users',
      title: '8. Auth users',
      detail:
        'Auth accounts are part of the export bundle and load after table data. Passwords are hashed; existing sessions do not carry over.',
      state: 'pending',
      progress: 0,
    },
    {
      id: 'functions',
      title: '9. Edge functions',
      detail:
        'Functions live in this repository and must be deployed once against the target project with its own CLI login.',
      state: 'manual',
      progress: 0,
    },
    {
      id: 'secrets-app',
      title: '10. Application secrets',
      detail:
        '29 secret names must be re-entered in the target project. Values are encrypted at rest and cannot be exported — re-issue them from the original providers (Resend, Twilio, Turnstile, DMS) or regenerate the internal tokens.',
      state: 'manual',
      progress: 0,
      metrics: [{ label: 'Secret names', value: '29' }],
    },
    {
      id: 'cutover',
      title: '11. Parity verification & cutover decision',
      detail:
        'Compare structure and row counts, spot-check a signed storage URL and a login, then decide whether to point the app at the target.',
      state: 'pending',
      progress: 0,
    },
  ],
  verification: [
    { id: 'v1', check: 'Base tables in public', expected: '~1,566', observed: '1,567', state: 'done' },
    { id: 'v2', check: 'Views in public', expected: '~85', observed: '85', state: 'done' },
    { id: 'v3', check: 'Functions in public', expected: '~1,368', observed: '1,369', state: 'done' },
    { id: 'v4', check: 'Indexes in public', expected: '≥ source', observed: '3,681 (baseline complete)', state: 'done' },
    { id: 'v5', check: 'Migration ledger versions', expected: '348 post-cutoff', observed: '179 applied, 8 failed', state: 'in_progress' },
    { id: 'v6', check: 'Storage objects copied', expected: '179', observed: '179 (byte-parity verified)', state: 'done' },
    { id: 'v7', check: 'Storage policies', expected: '46', observed: '46', state: 'done' },
    { id: 'v8', check: 'Row counts per table', expected: 'match source export', observed: 'not started', state: 'pending' },
    { id: 'v9', check: 'Auth users loadable', expected: 'match source', observed: 'not started', state: 'pending' },
    { id: 'v10', check: 'Edge functions deployed', expected: 'all', observed: 'not started', state: 'manual' },
    { id: 'v11', check: 'Secrets present in target', expected: '29 names', observed: 'not started', state: 'manual' },
    { id: 'v12', check: 'Source database untouched', expected: 'read-only throughout', observed: 'confirmed — scripts refuse the source URL', state: 'done' },
  ],
};
