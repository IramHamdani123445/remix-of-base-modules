/**
 * MEANS-TEST EPIC 4 — asset assessment contract tests.
 *
 * Proves the browser boundary for assets: ownership context is mandatory,
 * category metadata drives the form, disregards are only ever *flagged*,
 * derived values are never posted, and no browser code writes to
 * `bn_means_asset_*` tables directly.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  assetPayload,
  assetReasonLabel,
  draftFromAssetFact,
  emptyAssetDraft,
  findAssetCategory,
  previewAttributableAmount,
  resolveValuationBasis,
  validateAssetDraft,
  type BnMeansAssetCategoryOption,
  type BnMeansAssetFact,
  type BnMeansAssetMemberRef,
  type BnMeansAssetReference,
} from '@/types/bn/meansTests/meansAssets';
import { BN_MEANS_COMMANDS, getMeansCommandSpec } from '@/types/bn/meansTests/meansCommands';

const CASH: BnMeansAssetCategoryOption = {
  value: 'CASH_AND_BANK',
  label: 'Cash and bank balances',
  requires_institution: true,
  valuation_basis_choice: false,
  fixed_valuation_basis: 'ACCOUNT_BALANCE',
};
const PROPERTY: BnMeansAssetCategoryOption = {
  value: 'REAL_PROPERTY',
  label: 'Land or property',
  requires_property_address: true,
  valuation_basis_choice: true,
  disregard_candidate_default: true,
};
const VEHICLE: BnMeansAssetCategoryOption = {
  value: 'VEHICLE',
  label: 'Vehicle',
  requires_registration: true,
  valuation_basis_choice: true,
};
const BUSINESS: BnMeansAssetCategoryOption = {
  value: 'BUSINESS_INTEREST',
  label: 'Business interest',
  requires_business_name: true,
  valuation_basis_choice: true,
};

const REFERENCE: BnMeansAssetReference = {
  ASSET_CATEGORY: [CASH, PROPERTY, VEHICLE, BUSINESS] as never,
  ASSET_OWNERSHIP_TYPE: [{ value: 'SOLE', label: 'Sole' }, { value: 'JOINT', label: 'Joint' }],
  ASSET_VALUATION_BASIS: [
    { value: 'MARKET_VALUE', label: 'Market value' },
    { value: 'ACCOUNT_BALANCE', label: 'Account balance' },
  ],
  ASSET_FACT_SOURCE: [{ value: 'APPLICANT_DECLARATION', label: 'Applicant declaration' }],
  ASSET_DISREGARD_REASON: [{ value: 'PRIMARY_RESIDENCE', label: 'Primary residence' }],
  NO_ASSET_REASON: [{ value: 'HOLDS_NOTHING', label: 'Holds no assets' }],
};

const MEMBER: BnMeansAssetMemberRef = {
  member_id: 'm1',
  display_name: 'Jane Doe',
  relationship_label: 'Spouse',
  is_current: true,
  member_from: '2026-01-01',
  member_to: null,
  dependency_decision_label: 'Dependant',
};

function completeDraft(overrides: Partial<ReturnType<typeof emptyAssetDraft>> = {}) {
  return {
    ...emptyAssetDraft('2026-01-01'),
    memberId: 'm1',
    categoryCode: 'CASH_AND_BANK',
    institutionName: 'National Bank',
    valuationAmount: '5000',
    valuationDate: '2026-02-01',
    factSource: 'APPLICANT_DECLARATION',
    effectiveFrom: '2026-01-01',
    ...overrides,
  };
}

const baseContext = {
  category: CASH,
  rules: {},
  assessmentFrom: '2026-01-01',
  assessmentTo: null as string | null,
  member: MEMBER,
  today: '2026-03-01',
};

describe('asset ownership context', () => {
  it('requires an owner drawn from the assessment household', () => {
    const errors = validateAssetDraft(completeDraft({ memberId: '' }), baseContext);
    expect(errors.memberId).toBe(assetReasonLabel('ASSET_OWNER_REQUIRED'));
  });

  it('permits household-level assets only when the policy allows it', () => {
    const errors = validateAssetDraft(completeDraft({ memberId: '' }), {
      ...baseContext,
      rules: { allow_household_level_asset: true },
    });
    expect(errors.memberId).toBeUndefined();
  });

  it.each([
    ['', 'ASSET_OWNERSHIP_SHARE_REQUIRED'],
    ['0', 'INVALID_OWNERSHIP_SHARE'],
    ['120', 'INVALID_OWNERSHIP_SHARE'],
  ])('rejects ownership share %s', (share, code) => {
    const errors = validateAssetDraft(
      completeDraft({ ownershipSharePercent: share }),
      baseContext,
    );
    expect(errors.ownershipShare).toBe(assetReasonLabel(code));
  });

  it('rejects a holding period outside the member household membership', () => {
    const errors = validateAssetDraft(completeDraft({ effectiveFrom: '2025-06-01' }), baseContext);
    expect(errors.effectiveFrom).toBe(assetReasonLabel('ASSET_OUTSIDE_HOUSEHOLD_MEMBERSHIP'));
  });
});

describe('category-driven form behaviour', () => {
  it('requires the institution for cash and bank balances', () => {
    const errors = validateAssetDraft(completeDraft({ institutionName: '' }), baseContext);
    expect(errors.institutionName).toBe(assetReasonLabel('ASSET_INSTITUTION_REQUIRED'));
  });

  it('requires the address for property', () => {
    const errors = validateAssetDraft(
      completeDraft({ categoryCode: 'REAL_PROPERTY', institutionName: '', valuationBasis: 'MARKET_VALUE' }),
      { ...baseContext, category: PROPERTY },
    );
    expect(errors.propertyAddress).toBe(assetReasonLabel('ASSET_PROPERTY_ADDRESS_REQUIRED'));
  });

  it('requires the registration number for a vehicle', () => {
    const errors = validateAssetDraft(
      completeDraft({ categoryCode: 'VEHICLE', institutionName: '', valuationBasis: 'MARKET_VALUE' }),
      { ...baseContext, category: VEHICLE },
    );
    expect(errors.registrationNumber).toBe(assetReasonLabel('ASSET_REGISTRATION_REQUIRED'));
  });

  it('requires the business name for a business interest', () => {
    const errors = validateAssetDraft(
      completeDraft({ categoryCode: 'BUSINESS_INTEREST', institutionName: '', valuationBasis: 'MARKET_VALUE' }),
      { ...baseContext, category: BUSINESS },
    );
    expect(errors.businessName).toBe(assetReasonLabel('ASSET_BUSINESS_NAME_REQUIRED'));
  });

  it('fixes the valuation basis when the category offers no choice', () => {
    expect(resolveValuationBasis(CASH, 'MARKET_VALUE')).toEqual({
      value: 'ACCOUNT_BALANCE',
      readOnly: true,
    });
    expect(resolveValuationBasis(PROPERTY, 'MARKET_VALUE')).toEqual({
      value: 'MARKET_VALUE',
      readOnly: false,
    });
  });

  it('resolves categories from the governed reference list only', () => {
    expect(findAssetCategory(REFERENCE, 'VEHICLE')).toBe(VEHICLE);
    expect(findAssetCategory(REFERENCE, 'NOT_A_CATEGORY')).toBeNull();
    expect(findAssetCategory(null, 'VEHICLE')).toBeNull();
  });
});

describe('valuation rules', () => {
  it('requires a valuation and a valuation date', () => {
    const errors = validateAssetDraft(
      completeDraft({ valuationAmount: '', valuationDate: '' }),
      baseContext,
    );
    expect(errors.valuationAmount).toBe(assetReasonLabel('ASSET_VALUATION_REQUIRED'));
    expect(errors.valuationDate).toBe(assetReasonLabel('ASSET_VALUATION_DATE_REQUIRED'));
  });

  it('rejects a future valuation date', () => {
    const errors = validateAssetDraft(completeDraft({ valuationDate: '2026-06-01' }), baseContext);
    expect(errors.valuationDate).toBe(assetReasonLabel('ASSET_VALUATION_DATE_IN_FUTURE'));
  });

  it('rejects a negative valuation unless the policy permits it', () => {
    expect(validateAssetDraft(completeDraft({ valuationAmount: '-10' }), baseContext).valuationAmount)
      .toBe(assetReasonLabel('NEGATIVE_VALUATION_NOT_PERMITTED'));
    expect(
      validateAssetDraft(completeDraft({ valuationAmount: '-10' }), {
        ...baseContext,
        rules: { allow_negative_valuation: true },
      }).valuationAmount,
    ).toBeUndefined();
  });

  it('previews the attributable amount without ever posting it', () => {
    const draft = completeDraft({ valuationAmount: '5000', ownershipSharePercent: '50' });
    expect(previewAttributableAmount(draft)).toBe(2500);
    expect(Object.keys(assetPayload(draft, { category: CASH, currency: 'XCD' })))
      .not.toContain('attributable_amount');
  });
});

describe('disregard handling', () => {
  it('requires a reason once an asset is flagged', () => {
    const errors = validateAssetDraft(completeDraft({ disregardCandidate: true }), baseContext);
    expect(errors.disregardReasonCode).toBe(assetReasonLabel('ASSET_DISREGARD_REASON_REQUIRED'));
  });

  it('never posts a decided disregard — only a flag and a reason', () => {
    const payload = assetPayload(
      completeDraft({ disregardCandidate: true, disregardReasonCode: 'PRIMARY_RESIDENCE' }),
      { category: CASH, currency: 'XCD' },
    );
    expect(payload.disregard_candidate).toBe(true);
    expect(payload.disregard_reason_code).toBe('PRIMARY_RESIDENCE');
    expect(payload).not.toHaveProperty('disregard_applied');
    expect(payload).not.toHaveProperty('disregarded_amount');
  });

  it('clears the reason when the flag is not set', () => {
    const payload = assetPayload(
      completeDraft({ disregardCandidate: false, disregardReasonCode: 'PRIMARY_RESIDENCE' }),
      { category: CASH, currency: 'XCD' },
    );
    expect(payload.disregard_reason_code).toBeNull();
  });
});

describe('command payload', () => {
  it('posts the ownership share as a fraction and the policy valuation basis', () => {
    const payload = assetPayload(completeDraft({ ownershipSharePercent: '25' }), {
      category: CASH,
      currency: 'XCD',
    });
    expect(payload.ownership_share).toBe(0.25);
    expect(payload.valuation_basis).toBe('ACCOUNT_BALANCE');
    expect(payload.currency_code).toBe('XCD');
    expect(payload.asset_details).toEqual({ institution_name: 'National Bank' });
  });

  it('carries the fact id only when correcting an existing record', () => {
    expect(assetPayload(completeDraft(), { category: CASH, currency: 'XCD' }))
      .not.toHaveProperty('asset_fact_id');
    expect(
      assetPayload(completeDraft({ assetFactId: 'f1' }), { category: CASH, currency: 'XCD' })
        .asset_fact_id,
    ).toBe('f1');
  });

  it('round-trips a stored fact back into an editable draft', () => {
    const fact: BnMeansAssetFact = {
      asset_fact_id: 'f1',
      member_id: 'm1',
      member_name: 'Jane Doe',
      member_relationship: 'Spouse',
      member_is_current: true,
      category_code: 'CASH_AND_BANK',
      category_label: 'Cash and bank balances',
      description: 'Savings account',
      asset_details: { institution_name: 'National Bank', account_reference: '****12' },
      ownership_type: 'JOINT',
      ownership_type_label: 'Joint',
      ownership_share: 0.5,
      co_owner_note: 'Held with spouse',
      valuation_amount: 5000,
      attributable_amount: 2500,
      currency_code: 'XCD',
      valuation_basis: 'ACCOUNT_BALANCE',
      valuation_basis_label: 'Account balance',
      valuation_date: '2026-02-01',
      valuation_source: 'Bank statement',
      effective_from: '2026-01-01',
      effective_to: null,
      fact_source: 'APPLICANT_DECLARATION',
      fact_source_label: 'Applicant declaration',
      evidence_status: 'NOT_PROVIDED',
      verification_status: 'UNVERIFIED',
      disregard_candidate: false,
      disregard_reason_code: null,
      disregard_reason_label: null,
      asset_notes: null,
      fact_version: 1,
      supersedes_fact_id: null,
      created_at: '2026-02-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z',
    };
    const draft = draftFromAssetFact(fact);
    expect(draft.assetFactId).toBe('f1');
    expect(draft.ownershipSharePercent).toBe('50');
    expect(draft.institutionName).toBe('National Bank');
    expect(draft.accountReference).toBe('****12');
  });
});

describe('command catalogue', () => {
  it.each([
    'BN_MEANS_ADD_ASSET',
    'BN_MEANS_CORRECT_ASSET',
    'BN_MEANS_VOID_ASSET',
    'BN_MEANS_DECLARE_NO_ASSETS',
    'BN_MEANS_WITHDRAW_NO_ASSETS',
    'BN_MEANS_MARK_ASSETS_COMPLETE',
  ] as const)('registers %s as an implemented write command', (command) => {
    const spec = getMeansCommandSpec(command);
    expect(spec?.implemented).toBe(true);
    expect(spec?.capability).toBe('bn_means_tests:write');
  });

  it('keeps every catalogue entry unique', () => {
    const names = BN_MEANS_COMMANDS.map((c) => c.command);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('no direct browser mutation of bn_means_asset tables', () => {
  const roots = [
    'src/services/bn/meansTests',
    'src/components/bn/meansTests/assets',
    'src/types/bn/meansTests',
  ];

  function walk(dir: string): string[] {
    let out: string[] = [];
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return out;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out = out.concat(walk(full));
      else if (/\.tsx?$/.test(full)) out.push(full);
    }
    return out;
  }

  it('contains no supabase.from("bn_means_asset*") chains', () => {
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of walk(root)) {
        const source = readFileSync(file, 'utf8');
        if (/from\(\s*['"]bn_means_/.test(source)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
