/**
 * Governed re-approval of the controlled-pilot channel releases.
 *
 * Calls the canonical approval RPC with optimistic concurrency (expected
 * updated_at + fingerprint) so an approval can never be applied to a release
 * row that changed underneath it. Contacts no provider.
 *
 * Usage:
 *   OMNI_APPROVE_REVISION=<40-char sha> \
 *   bun --preload ./scripts/omni-comms/pilot/preload-browser-session.ts \
 *       ./scripts/omni-comms/pilot/reapprove-controlled-release.ts
 */
import { supabase } from '@/integrations/supabase/client';

async function main() {
  const revision = process.env.OMNI_APPROVE_REVISION;
  if (!revision || !/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error('OMNI_APPROVE_REVISION must be a 40-character commit sha');
  }

  const { data: auth } = await supabase.auth.getUser();
  const actorId = auth?.user?.id;
  if (!actorId) throw new Error('No authenticated actor');

  // Release rows are governed and not directly readable by an operator; the
  // caller supplies the optimistic-concurrency facts explicitly.
  const releases = JSON.parse(process.env.OMNI_APPROVE_RELEASES ?? '[]') as Array<{
    id: string;
    channel: string;
    updated_at: string;
    release_fingerprint: string;
  }>;
  if (releases.length === 0) throw new Error('OMNI_APPROVE_RELEASES is required');

  for (const r of releases) {
    const { data, error: rpcError } = await supabase.rpc(
      'omni_comms_priv_channel_release_approve_activate',
      {
        p_actor_id: actorId,
        p_release_control_id: r.id,
        p_expected_updated_at: r.updated_at,
        p_expected_fingerprint: r.release_fingerprint,
        p_deployed_revision: revision,
        p_approval_note:
          'Re-approval after the governed adapter-registry change that lets the controlled pilot use the existing operational email provider.',
        p_correlation_id: `reapprove:${revision.slice(0, 8)}:${r.channel}`,
      },
    );
    console.log(r.channel, rpcError ? `ERROR ${rpcError.message}` : JSON.stringify(data));
  }
}

main().catch((e) => {
  console.error('REAPPROVE_FAILED', e?.message ?? e);
  process.exit(1);
});
