/**
 * Catalogue → product rule legal snapshot.
 *
 * When a catalogue rule is copied onto a product version, the legal approval
 * recorded against the catalogue rule must travel with it. The publish gate
 * (`checkLegalReadiness`) reads `bn_eligibility_rule.legislative_reference`
 * and `.confidence_status` — not the catalogue row — so a copy created
 * without them can never be published and there is no screen that can fill
 * them in afterwards.
 *
 * The values are copied rather than resolved live on purpose. A published
 * product version must retain the legal basis that applied when it went
 * live, so a later edit to the catalogue must not change the legal basis of
 * a version already in use.
 */

/**
 * Catalogue governance states that count as legally approved for the purpose
 * of publishing. This matches `findUngovernedAttachedRules`, which already
 * accepts these three when gating publish.
 */
const GOVERNED_STATUSES = new Set(['LEGAL_CONFIRMED', 'READY_FOR_PRODUCT_USE', 'ACTIVE']);

export interface CatalogueLegalSource {
  governance_status?: string | null;
  legal_reference?: string | null;
}

export interface CatalogueLegalSnapshot {
  legislative_reference: string | null;
  confidence_status: 'CONFIRMED' | 'DRAFT';
}

/**
 * Build the legal fields for a product rule from its catalogue rule.
 *
 * `confidence_status` is only CONFIRMED when the catalogue rule is both
 * governed **and** carries a legal reference — marking a rule confirmed
 * without a reference would leave the publish gate failing on the missing
 * reference while reporting the rule as approved.
 */
export function catalogueLegalSnapshot(rule: CatalogueLegalSource | null | undefined): CatalogueLegalSnapshot {
  const reference = (rule?.legal_reference ?? '').trim();
  const governed = GOVERNED_STATUSES.has(String(rule?.governance_status ?? '').toUpperCase());

  return {
    legislative_reference: reference || null,
    confidence_status: governed && reference ? 'CONFIRMED' : 'DRAFT',
  };
}
