/**
 * Omni-Comms Channels C2 CLOSURE proof.
 *
 *   1. reference_seed provider accounts are read-only and non-operational;
 *   2. the legacy `omni_comms_provider_account.secret_ref` column is a
 *      Resend-only compatibility mirror;
 *   3. a disabled account can be reactivated behind the same safety gates;
 *   4. reference rows require `omni_comms.configure`.
 *
 * Static + unit proof only. No provider is contacted, no request, message,
 * dispatch job or delivery attempt is created anywhere in this file.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  isReferenceAccountRow,
  REFERENCE_ACCOUNT_READ_ONLY_HELP,
} from '@/platform/omni-comms/admin/views/channels/ChannelAccountsTab';
import { partitionEmailConfig, readinessCounts } from '@/platform/omni-comms/admin/views/channels/channelReferenceData';
import type { ChannelProviderAccountRow } from '@/platform/omni-comms/application/channelProviderAccountTypes';

const MIGRATION =
  'supabase/migrations/20260802085539_be60c792-8386-4fc5-80fe-798799a7d6e3.sql';
const UI = 'src/platform/omni-comms/admin/views/channels/ChannelAccountsTab.tsx';
const SERVICE = 'src/platform/omni-comms/application/channelProviderAccountService.ts';

const sql = readFileSync(MIGRATION, 'utf8');
const ui = readFileSync(UI, 'utf8');
const service = readFileSync(SERVICE, 'utf8');

const upsertWorker = sql.slice(
  sql.indexOf('FUNCTION public.omni_comms_priv_channel_account_upsert('),
  sql.indexOf('FUNCTION public.omni_comms_priv_channel_account_lifecycle('),
);
const lifecycleWorker = sql.slice(
  sql.indexOf('FUNCTION public.omni_comms_priv_channel_account_lifecycle('),
  sql.indexOf('FUNCTION public.omni_comms_channel_provider_account_summary('),
);
const summaryRpc = sql.slice(
  sql.indexOf('FUNCTION public.omni_comms_channel_provider_account_summary('),
);

const account = (o: Partial<ChannelProviderAccountRow> = {}): ChannelProviderAccountRow => ({
  id: 'a1',
  code: 'primary_email',
  display_name: 'Primary email',
  provider_id: 'p1',
  provider_adapter_key: 'resend',
  channel: 'email',
  environment: 'sandbox',
  region: null,
  provider_account_reference: null,
  status: 'draft',
  data_origin: 'user',
  health_state: 'unknown',
  health_checked_at: null,
  verification_status: 'unverified',
  verification_result_code: null,
  verification_detail: null,
  verification_checked_at: null,
  updated_at: '2026-01-01T00:00:00Z',
  secret_ref_purposes: [{ purpose: 'api_key', secret_ref: 'OMNI_COMMS_RESEND_PRIMARY' }],
  required_credential_count: 1,
  configured_credential_count: 1,
  ...o,
});

describe('C2 closure — reference account immutability', () => {
  it('1. rejects update of a reference account with a bounded detail', () => {
    expect(upsertWorker).toMatch(
      /v_before\.data_origin\s*=\s*'reference_seed'[\s\S]{0,220}reference_account_read_only/,
    );
  });

  it('2-4. rejects activate, disable and retire for a reference account', () => {
    // one guard placed before the action branch covers all three actions
    expect(lifecycleWorker).toMatch(
      /v_before\.data_origin\s*=\s*'reference_seed'[\s\S]{0,220}reference_account_non_operational/,
    );
    const guardIdx = lifecycleWorker.indexOf('reference_account_non_operational');
    for (const action of ["v_action='activate'", "v_action='disable'", 'ELSE']) {
      expect(lifecycleWorker.indexOf(action)).toBeGreaterThan(guardIdx);
    }
  });

  it('does not accept an allow_reference_account override on public RPCs', () => {
    expect(sql).not.toMatch(/allow_reference_account/);
    expect(service).not.toMatch(/allow_reference/i);
  });

  it('5-6. hides verification and manual evidence controls for reference rows', () => {
    expect(ui).toMatch(/if \(isReference\) return;/);
    expect(ui).toMatch(/accounts\.filter\(\(a\) => !isReferenceAccountRow\(a\)\)/);
    expect(ui).toMatch(/const operational = accounts\.filter\(\(a\) => !isReferenceAccountRow\(a\)\)/);
    expect(ui).toMatch(/\{operational\.map\(/);
  });

  it('7. keeps reference rows visible read-only with helper text', () => {
    expect(REFERENCE_ACCOUNT_READ_ONLY_HELP).toBe(
      'Reference account — read-only and excluded from operational configuration.',
    );
    expect(ui).toMatch(/isReference \? \([\s\S]{0,400}REFERENCE_ACCOUNT_READ_ONLY_HELP/);
    expect(isReferenceAccountRow(account({ data_origin: 'reference_seed' }))).toBe(true);
    expect(isReferenceAccountRow(account())).toBe(false);
  });

  it('8. reference accounts never contribute to readiness', () => {
    const part = partitionEmailConfig({
      accounts: [
        { id: 'g', code: 'primary', secret_ref: 'OMNI_COMMS_RESEND_PRIMARY', data_origin: 'user' },
        { id: 'r', code: 'simulation_a', secret_ref: 'OMNI_COMMS_SIMULATION_A', data_origin: 'reference_seed' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any,
    });
    expect(part.accounts).toHaveLength(1);
    expect(readinessCounts(part).accounts).toBe(1);
  });
});

describe('C2 closure — legacy secret_ref compatibility', () => {
  it('9. legacy column is nullable with a NULL-tolerant bounded constraint', () => {
    expect(sql).toMatch(/ALTER COLUMN secret_ref DROP NOT NULL/);
    expect(sql).toMatch(
      /CHECK \(secret_ref IS NULL[\s\S]{0,200}\^OMNI_COMMS_\[A-Z0-9\]\+/,
    );
    expect(sql).not.toMatch(/DROP COLUMN secret_ref/);
  });

  it('10-11. generic insert never copies a supplied credential into the legacy column', () => {
    const insert = upsertWorker.slice(
      upsertWorker.indexOf('INSERT INTO public.omni_comms_provider_account('),
      upsertWorker.indexOf('RETURNING * INTO v_after'),
    );
    expect(insert).not.toMatch(/jsonb_array_elements\(p_secret_refs\)/);
    expect(insert).toMatch(/NULL,\s*\n\s*v_region/);
    expect(upsertWorker).toMatch(
      /omni_comms_priv_apply_account_secret_refs[\s\S]{0,200}omni_comms_priv_sync_legacy_secret_ref/,
    );
  });

  it('12-14. the synchroniser mirrors Resend only and clears every other provider', () => {
    const sync = sql.slice(
      sql.indexOf('FUNCTION public.omni_comms_priv_sync_legacy_secret_ref('),
      sql.indexOf('-- ─── 3. safe backfill'),
    );
    expect(sync).toMatch(/adapter_key = 'resend' AND p\.channel = 'email'/);
    expect(sync).toMatch(/NOT COALESCE\(v_is_resend, false\)[\s\S]{0,200}SET secret_ref = NULL/);
    expect(sync).toMatch(/purpose = 'api_key'/);
    // update path recalculates after a provider change
    expect(upsertWorker).toMatch(
      /Resend mirrors api_key, others NULL[\s\S]{0,200}omni_comms_priv_sync_legacy_secret_ref\(p_id\)/,
    );
  });

  it('backfill preserves child references and account identity', () => {
    expect(sql).not.toMatch(/DELETE FROM public\.omni_comms_provider_account_secret_ref/);
    expect(sql).not.toMatch(/DELETE FROM public\.omni_comms_provider_account\b/);
  });
});

describe('C2 closure — lifecycle and reference-read authorization', () => {
  it('15. activate is allowed from draft and disabled behind all gates', () => {
    expect(lifecycleWorker).toMatch(/status NOT IN \('draft','disabled'\)/);
    expect(lifecycleWorker).toMatch(/must_be_draft_or_disabled/);
    expect(lifecycleWorker).toMatch(/provider_not_active/);
    expect(lifecycleWorker).toMatch(/missing_required_credential/);
    expect(lifecycleWorker).toMatch(/updated_at_mismatch/);
    expect(lifecycleWorker).toMatch(/verification state is preserved on reactivation/);
  });

  it('16. an unverified Resend account cannot activate or reactivate', () => {
    expect(lifecycleWorker).toMatch(
      /adapter_key='resend' AND v_before\.verification_status IS DISTINCT FROM 'verified'[\s\S]{0,160}provider_verification_required/,
    );
  });

  it('UI labels reactivation contextually', () => {
    expect(ui).toMatch(/account\.status === 'disabled' \? 'Reactivate' : 'Activate'/);
    expect(ui).toMatch(/canActivate = account\.status === 'draft' \|\| account\.status === 'disabled'/);
  });

  it('17-18. reference rows require the configure capability', () => {
    expect(summaryRpc).toMatch(
      /v_include := COALESCE\(p_include_reference,false\)\s*\n?\s*AND public\.has_permission\(v_uid,'omni_comms','configure'\)/,
    );
    expect(summaryRpc).toMatch(/CASE WHEN v_include THEN v_ref_accounts ELSE '\[\]'::jsonb END/);
    expect(summaryRpc).toMatch(/CASE WHEN v_include THEN jsonb_array_length\(v_ref_accounts\) ELSE 0 END/);
  });

  it('19. no send, request, message, dispatch job or attempt is introduced', () => {
    for (const source of [sql, ui, service]) {
      expect(source).not.toMatch(/omni_comms_request\b/);
      expect(source).not.toMatch(/omni_comms_message\b/);
      expect(source).not.toMatch(/omni_comms_dispatch_job\b/);
      expect(source).not.toMatch(/omni_comms_delivery_attempt\b/);
      expect(source).not.toMatch(/sendCommunication/);
      expect(source).not.toMatch(/api\.resend\.com/);
    }
  });
});
