/**
 * GAP-039 — a catalogue-linked product rule should read its structural shape
 * live from the catalogue once the catalogue carries a value, but must fall
 * back to its own column when the catalogue doesn't (this is what makes the
 * fix deployable before the bn_rule_catalogue schema extension has been run,
 * and safe for rules whose catalogue parent simply hasn't been backfilled
 * yet).
 */
import { describe, it, expect } from 'vitest';
import { resolveEffectiveRuleShape, collectCatalogueRuleIds } from '../effectiveRuleShape';

describe('resolveEffectiveRuleShape', () => {
  it('falls back entirely to local columns when the rule has no catalogue_rule_id', () => {
    const rule = { rule_kind: 'LITERAL', fact_key: 'person.age_at_claim_date' };
    const shape = resolveEffectiveRuleShape(rule, new Map());
    expect(shape.rule_kind).toBe('LITERAL');
    expect(shape.fact_key).toBe('person.age_at_claim_date');
  });

  it('falls back to local columns when the catalogue row has no matching value yet (pre-DDL / not backfilled)', () => {
    const rule = {
      catalogue_rule_id: 'cat-1',
      rule_kind: 'DATE_DIFFERENCE',
      start_fact_key: 'claim.death_date',
      end_fact_key: 'claim.submission_date',
    };
    // Catalogue row exists but carries none of the new shape columns —
    // exactly what every catalogue row looks like before the schema
    // extension is run, or before this specific rule is backfilled.
    const catalogueById = new Map([['cat-1', { id: 'cat-1' }]]);
    const shape = resolveEffectiveRuleShape(rule, catalogueById);
    expect(shape.rule_kind).toBe('DATE_DIFFERENCE');
    expect(shape.start_fact_key).toBe('claim.death_date');
    expect(shape.end_fact_key).toBe('claim.submission_date');
  });

  it('prefers the catalogue value once the catalogue actually carries one', () => {
    const rule = {
      catalogue_rule_id: 'cat-1',
      rule_kind: 'DATE_DIFFERENCE',
      start_fact_key: 'claim.death_date',
      end_fact_key: 'claim.submission_date',
    };
    // The catalogue has since been corrected — a wrong fact key fixed once
    // here must reach the product rule with no per-product resave.
    const catalogueById = new Map([[
      'cat-1',
      { id: 'cat-1', rule_kind: 'DATE_DIFFERENCE', start_fact_key: 'deceased.death_date', end_fact_key: 'claim.submission_date' },
    ]]);
    const shape = resolveEffectiveRuleShape(rule, catalogueById);
    expect(shape.start_fact_key).toBe('deceased.death_date');
  });

  it('never reads operator/value fields from the catalogue — those stay product-specific overrides', () => {
    // resolveEffectiveRuleShape's return type has no operator/value_from/etc
    // fields at all — this test locks that contract so a future edit can't
    // silently widen it and erase allow_product_override's whole purpose.
    const shape = resolveEffectiveRuleShape({ catalogue_rule_id: 'cat-1' }, new Map([['cat-1', { id: 'cat-1' }]]));
    expect(shape).not.toHaveProperty('operator');
    expect(shape).not.toHaveProperty('value_from');
  });

  it('is unaffected by a rule not linked to any catalogue row (the majority of rules today)', () => {
    const rule = { rule_kind: 'LITERAL', fact_key: 'contribution.total_weeks' };
    const shape = resolveEffectiveRuleShape(rule, undefined);
    expect(shape.fact_key).toBe('contribution.total_weeks');
  });
});

describe('collectCatalogueRuleIds', () => {
  it('dedupes and drops rules with no catalogue_rule_id', () => {
    const ids = collectCatalogueRuleIds([
      { catalogue_rule_id: 'a' },
      { catalogue_rule_id: 'a' },
      { catalogue_rule_id: 'b' },
      { catalogue_rule_id: null },
      {},
    ]);
    expect(ids.sort()).toEqual(['a', 'b']);
  });
});
