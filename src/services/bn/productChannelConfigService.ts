import { supabase } from '@/integrations/supabase/client';
import type { BnProductChannelConfig, BnChannelCode } from '@/types/bn';

const db = supabase as any;

export async function fetchChannelConfigs(productVersionId: string): Promise<BnProductChannelConfig[]> {
  const { data, error } = await db
    .from('bn_product_channel_config')
    .select('*')
    .eq('product_version_id', productVersionId)
    .order('channel_code', { ascending: true });
  if (error) throw error;
  return (data ?? []) as BnProductChannelConfig[];
}

export async function getChannelConfig(
  productVersionId: string,
  channel: BnChannelCode
): Promise<BnProductChannelConfig | null> {
  const { data, error } = await db
    .from('bn_product_channel_config')
    .select('*')
    .eq('product_version_id', productVersionId)
    .eq('channel_code', channel)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as BnProductChannelConfig | null;
}

/**
 * The currency for a product's amounts, taken from the country the product is
 * registered in. A product whose country has no currency on file is a data
 * fault worth reporting, not something to paper over with a guessed default —
 * a wrong currency on a benefit payment is worse than a refused save.
 */
async function resolveProductCurrency(productId: string): Promise<string> {
  // Two lookups rather than an embedded join: there is no foreign key between
  // bn_product.country_code and bn_country.country_code, so PostgREST cannot
  // relate the two tables.
  const { data: product, error: productError } = await db
    .from('bn_product')
    .select('country_code')
    .eq('id', productId)
    .maybeSingle();
  if (productError) {
    throw new Error(`Cannot determine the channel currency: ${productError.message}`);
  }

  const countryCode = (product as any)?.country_code;
  if (countryCode) {
    const { data: country } = await db
      .from('bn_country')
      .select('currency_code')
      .eq('country_code', countryCode)
      .maybeSingle();
    const currency = (country as any)?.currency_code;
    if (currency) return currency;
  }

  throw new Error(
    `Cannot determine the channel currency: this product is registered in country ` +
    `"${countryCode ?? 'unknown'}", which has no currency set. ` +
    `Set the currency for that country under Reference Data → Country Packs first.`,
  );
}

export async function upsertChannelConfig(
  cfg: Partial<BnProductChannelConfig>,
  actor?: { userCode: string } | null,
): Promise<BnProductChannelConfig> {
  // Capture before state for audit (best-effort; null on first insert)
  let before: BnProductChannelConfig | null = null;
  if (cfg.product_version_id && cfg.channel_code) {
    try {
      before = await getChannelConfig(cfg.product_version_id, cfg.channel_code as BnChannelCode);
    } catch { /* ignore — audit will record null before */ }
  }

  const payload: Record<string, any> = { ...cfg, modified_at: new Date().toISOString() };

  // bn_product_channel_config.currency_code is NOT NULL with no default, so
  // creating the first channel row for a version failed outright:
  //   null value in column "currency_code" ... violates not-null constraint
  // Nothing in the application set it, because the column exists only in the
  // live database — it is not declared in any migration in this repository.
  // The currency is not a free choice: it belongs to the country the product
  // is registered in, so it is derived rather than asked for.
  if (!payload.currency_code && payload.product_id) {
    payload.currency_code = await resolveProductCurrency(payload.product_id);
  }

  const { data, error } = await db
    .from('bn_product_channel_config')
    .upsert(payload, { onConflict: 'product_version_id,channel_code' })
    .select()
    .single();
  if (error) throw error;

  if (actor?.userCode) {
    const { writeBnAudit } = await import('@/services/bn/audit/bnAuditService');
    await writeBnAudit({
      action: 'CHANNEL_CONFIG_CHANGED',
      entityType: 'bn_product_channel_config',
      entityId: data.id,
      beforeValue: before as any,
      afterValue: data,
      performedBy: actor.userCode,
      module: 'BN_CONFIG',
      critical: true,
    });
  }

  return data as BnProductChannelConfig;
}

export async function deleteChannelConfig(id: string): Promise<void> {
  const { error } = await db.from('bn_product_channel_config').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Ensure both ONLINE and OFFLINE rows exist for a product version with sensible defaults.
 * Returns the configs (existing or newly created).
 */
export async function ensureChannelConfigs(
  productId: string,
  productVersionId: string
): Promise<BnProductChannelConfig[]> {
  const existing = await fetchChannelConfigs(productVersionId);
  const have = new Set(existing.map(c => c.channel_code));
  const toCreate: Array<Partial<BnProductChannelConfig>> = [];

  if (!have.has('OFFLINE')) {
    toCreate.push({
      product_id: productId,
      product_version_id: productVersionId,
      channel_code: 'OFFLINE',
      is_enabled: true,
      default_source: 'STAFF_ASSISTED',
      allow_save_draft: true,
      allow_upload_later: true,
      requires_identity_verification: false,
      requires_email_or_phone_otp: false,
      requires_staff_review_before_acceptance: false,
      blocks_submission_if_documents_missing: false,
      blocks_submission_if_precheck_fails: true,
      correction_allowed: true,
    });
  }
  if (!have.has('ONLINE')) {
    toCreate.push({
      product_id: productId,
      product_version_id: productVersionId,
      channel_code: 'ONLINE',
      is_enabled: false,
      default_source: 'ONLINE',
      allow_save_draft: true,
      allow_upload_later: false,
      requires_identity_verification: true,
      requires_email_or_phone_otp: true,
      requires_staff_review_before_acceptance: true,
      blocks_submission_if_documents_missing: true,
      blocks_submission_if_precheck_fails: true,
      correction_allowed: true,
    });
  }
  for (const row of toCreate) {
    await upsertChannelConfig(row);
  }
  return fetchChannelConfigs(productVersionId);
}
