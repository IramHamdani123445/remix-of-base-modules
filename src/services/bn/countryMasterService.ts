/**
 * countryMasterService — CRUD for bn_country plus pack-status counts and
 * "seed default Country Pack" helper. This is the source-of-truth service
 * for the Country Master screen.
 */
import { supabase } from '@/integrations/supabase/client';

const db = supabase as any;

export interface BnCountryRow {
  country_code: string;
  country_name: string;
  currency_code: string;
  currency_symbol?: string | null;
  locale?: string;
  timezone?: string;
  default_language?: string | null;
  is_active: boolean;
  default_retirement_age?: number;
  fiscal_year_start_month?: number;
  modified_at?: string;
}

export interface BnCountryInput {
  country_code: string;
  country_name: string;
  currency_code: string;
  currency_symbol?: string | null;
  locale?: string;
  timezone?: string;
  default_language?: string | null;
  is_active?: boolean;
  default_retirement_age?: number;
  fiscal_year_start_month?: number;
}

export interface CountryPackStatus {
  country_code: string;
  idRules: number;
  addressModel: number;
  participantTypes: number;
  paymentConfig: number;
  legalRefs: number;
  products: number;
  isComplete: boolean;
}

export async function listCountries(): Promise<BnCountryRow[]> {
  const { data, error } = await db
    .from('bn_country')
    .select('country_code,country_name,currency_code,currency_symbol,locale,timezone,default_language,is_active,default_retirement_age,fiscal_year_start_month,modified_at')
    .order('country_name');
  if (error) throw error;
  return (data ?? []) as BnCountryRow[];
}

export async function createCountry(input: BnCountryInput, userCode?: string): Promise<BnCountryRow> {
  const payload: any = {
    ...input,
    country_code: input.country_code.toUpperCase().trim(),
    is_active: input.is_active ?? true,
    entered_by: userCode ?? null,
    modified_by: userCode ?? null,
  };
  const { data, error } = await db.from('bn_country').insert(payload).select().single();
  if (error) throw error;
  return data as BnCountryRow;
}

export async function updateCountry(code: string, patch: Partial<BnCountryInput>, userCode?: string): Promise<void> {
  const payload: any = { ...patch, modified_by: userCode ?? null };
  delete payload.country_code;
  const { error } = await db.from('bn_country').update(payload).eq('country_code', code);
  if (error) throw error;
}

export async function setCountryActive(code: string, isActive: boolean, userCode?: string): Promise<void> {
  return updateCountry(code, { is_active: isActive }, userCode);
}

/**
 * Returns reference counts across every table that holds a country_code FK.
 * Used by the Country Master delete guard.
 */
export interface CountryUsage {
  total: number;
  byTable: { table: string; count: number }[];
}
const COUNTRY_REF_TABLES = [
  'bn_product',
  'bn_country_id_rule',
  'bn_country_address_model',
  'bn_country_participant_type',
  'bn_country_payment_config',
  'bn_country_legal_ref',
  'bn_scheme',
  'bn_service_doc_type',
  'bn_reason_code',
];
export async function getCountryUsage(code: string): Promise<CountryUsage> {
  const results = await Promise.all(COUNTRY_REF_TABLES.map(async (t) => {
    const { count } = await db.from(t).select('*', { count: 'exact', head: true }).eq('country_code', code);
    return { table: t, count: count ?? 0 };
  }));
  const byTable = results.filter(r => r.count > 0);
  return { total: byTable.reduce((s, r) => s + r.count, 0), byTable };
}

export async function deleteCountry(code: string): Promise<void> {
  const usage = await getCountryUsage(code);
  if (usage.total > 0) {
    const detail = usage.byTable.map(r => `${r.table} (${r.count})`).join(', ');
    throw new Error(`Cannot delete ${code} — still referenced in: ${detail}. Remove dependent records first.`);
  }
  const { error } = await db.from('bn_country').delete().eq('country_code', code);
  if (error) throw error;
}

/** Returns the number of active products bound to a country (for deactivation guard). */
export async function countActiveProductsForCountry(code: string): Promise<number> {
  // BUG-54: bn_product has no active flag at all; ACTIVE is a value of
  // `status`. The filter failed with 42703 and the error was swallowed into a
  // count of 0, so this guard, which exists to stop a country being deactivated
  // while products still use it, always reported none.
  const { count, error } = await db
    .from('bn_product')
    .select('*', { count: 'exact', head: true })
    .eq('country_code', code)
    .eq('status', 'ACTIVE');
  if (error) {
    throw new Error(
      `The products bound to ${code} could not be counted (${error.message}). ` +
      'Refusing to report zero, which would allow the country to be deactivated.',
    );
  }
  return count ?? 0;
}

export async function getCountryPackStatus(code: string): Promise<CountryPackStatus> {
  const countOf = async (table: string) => {
    const { count, error } = await db.from(table).select('*', { count: 'exact', head: true }).eq('country_code', code);
    if (error) throw error;
    return count ?? 0;
  };
  const [idRules, addressModel, participantTypes, paymentConfig, legalRefs, products] = await Promise.all([
    countOf('bn_country_id_rule'),
    countOf('bn_country_address_model'),
    countOf('bn_country_participant_type'),
    countOf('bn_country_payment_config'),
    countOf('bn_country_legal_ref'),
    countOf('bn_product'),
  ]);
  const isComplete = !!(idRules && addressModel && participantTypes && paymentConfig && legalRefs);
  return { country_code: code, idRules, addressModel, participantTypes, paymentConfig, legalRefs, products, isComplete };
}

export async function getAllCountryPackStatus(codes: string[]): Promise<Record<string, CountryPackStatus>> {
  const out: Record<string, CountryPackStatus> = {};
  await Promise.all(codes.map(async (c) => { out[c] = await getCountryPackStatus(c); }));
  return out;
}

/**
 * Seeds a minimal Country Pack for a country if any child config is empty.
 * Idempotent: only inserts rows for the categories that are still empty.
 */
export async function seedDefaultCountryPack(code: string, userCode?: string): Promise<{ seeded: string[] }> {
  const status = await getCountryPackStatus(code);
  const seeded: string[] = [];
  const tag = (userCode ?? 'SEED');

  if (status.idRules === 0) {
    await db.from('bn_country_id_rule').insert({
      country_code: code,
      id_type: 'SSN',
      id_label: 'Social Security Number',
      digit_length: 9,
      format_pattern: '^[0-9]{9}$',
      format_mask: '###-##-####',
      example_value: '123-45-6789',
      is_primary: true,
      is_active: true,
      entered_by: tag,
    });
    seeded.push('idRules');
  }

  if (status.addressModel === 0) {
    const rows = [
      { country_code: code, field_code: 'LINE1', field_label: 'Address Line 1', field_type: 'TEXT', is_required: true, sort_order: 10 },
      { country_code: code, field_code: 'LINE2', field_label: 'Address Line 2', field_type: 'TEXT', is_required: false, sort_order: 20 },
      { country_code: code, field_code: 'CITY', field_label: 'City / Town', field_type: 'TEXT', is_required: true, sort_order: 30 },
      { country_code: code, field_code: 'POSTAL', field_label: 'Postal Code', field_type: 'TEXT', is_required: false, sort_order: 40 },
      { country_code: code, field_code: 'COUNTRY', field_label: 'Country', field_type: 'TEXT', is_required: true, sort_order: 50 },
    ].map(r => ({ ...r, is_active: true, entered_by: tag }));
    await db.from('bn_country_address_model').insert(rows);
    seeded.push('addressModel');
  }

  if (status.participantTypes === 0) {
    const rows = [
      { country_code: code, type_code: 'CLAIMANT', type_label: 'Claimant', is_required: true, sort_order: 10 },
      { country_code: code, type_code: 'EMPLOYER', type_label: 'Employer', is_required: false, sort_order: 20 },
      { country_code: code, type_code: 'BENEFICIARY', type_label: 'Beneficiary', is_required: false, sort_order: 30 },
    ].map(r => ({ ...r, is_active: true, entered_by: tag }));
    await db.from('bn_country_participant_type').insert(rows);
    seeded.push('participantTypes');
  }

  if (status.paymentConfig === 0) {
    const rows = [
      { country_code: code, method_code: 'CASH', method_label: 'Cash', is_default: true, is_active: true, sort_order: 10 },
      { country_code: code, method_code: 'CHEQUE', method_label: 'Cheque', is_default: false, is_active: true, sort_order: 20 },
      { country_code: code, method_code: 'EFT', method_label: 'Direct Deposit / EFT', is_default: false, is_active: true, sort_order: 30 },
    ].map(r => ({ ...r, entered_by: tag }));
    await db.from('bn_country_payment_config').insert(rows);
    seeded.push('paymentConfig');
  }

  if (status.legalRefs === 0) {
    await db.from('core_legal_reference').insert({
      country_code: code,
      ref_code: 'PRIMARY_ACT',
      short_title: 'Social Security Act',
      ref_type: 'ACT',
      effective_from: new Date().toISOString().slice(0, 10),
      status: 'ACTIVE',
      is_active: true,
      created_by: tag,
    });
    seeded.push('legalRefs');
  }


  return { seeded };
}

/**
 * Returns countries referenced by products/rates/legal/payment whose
 * country_code is NOT present in bn_country — used by validation panel.
 */
export async function findOrphanCountryRefs(): Promise<{ table: string; country_code: string; count: number }[]> {
  const tables = ['bn_product', 'core_legal_reference', 'bn_country_payment_config', 'bn_country_id_rule', 'bn_country_address_model', 'bn_country_participant_type'];
  const { data: countries } = await db.from('bn_country').select('country_code');
  const known = new Set<string>((countries ?? []).map((r: any) => r.country_code));
  const orphans: { table: string; country_code: string; count: number }[] = [];
  for (const t of tables) {
    const { data } = await db.from(t).select('country_code');
    const tally: Record<string, number> = {};
    (data ?? []).forEach((r: any) => { if (r.country_code && !known.has(r.country_code)) tally[r.country_code] = (tally[r.country_code] ?? 0) + 1; });
    Object.entries(tally).forEach(([cc, count]) => orphans.push({ table: t, country_code: cc, count }));
  }
  return orphans;
}
