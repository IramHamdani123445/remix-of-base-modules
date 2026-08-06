/**
 * BN Mortality — Query façade.
 *
 * Domain-shaped read API over the secure Benefits Query Client. Pages
 * and hooks import from here — never directly from `supabase.from(...)`.
 */
import { getBenefitsQueryClient, buildQueryEnvelope } from '@/services/bn/queries';
import type { BnBenefitsQueryResult } from '@/types/bn/queries';
import type {
  BnMortalityEventSummaryDto,
  BnMortalityEventListItemDto,
  BnMortalityEventDetailDto,
  BnMortalityPersonMatchDto,
} from '@/types/bn/mortality/mortalityDtos';

const MODULE = 'bn_mortality';

export const mortalityQueryService = {
  async getSummary(eventId: string): Promise<BnBenefitsQueryResult<BnMortalityEventSummaryDto>> {
    return getBenefitsQueryClient().execute(
      buildQueryEnvelope('BN_MORTALITY_GET_SUMMARY', MODULE, { eventId }),
    );
  },
  async listEvents(
    params: { status?: string; assignedTo?: string; search?: string },
    page: { pageSize?: number; pageToken?: string | null } = {},
  ): Promise<BnBenefitsQueryResult<readonly BnMortalityEventListItemDto[]>> {
    return getBenefitsQueryClient().execute(
      buildQueryEnvelope('BN_MORTALITY_LIST_EVENTS', MODULE, params, page),
    );
  },
  async getEvent(eventId: string): Promise<BnBenefitsQueryResult<BnMortalityEventDetailDto>> {
    return getBenefitsQueryClient().execute(
      buildQueryEnvelope('BN_MORTALITY_GET_EVENT', MODULE, { eventId }),
    );
  },
  async getEventHistory(eventId: string, pageSize = 100) {
    return getBenefitsQueryClient().execute(
      buildQueryEnvelope('BN_MORTALITY_GET_EVENT_HISTORY', MODULE, { eventId }, { pageSize }),
    );
  },
  async getAwardImpacts(eventId: string) {
    return getBenefitsQueryClient().execute(
      buildQueryEnvelope('BN_MORTALITY_GET_AWARD_IMPACTS', MODULE, { eventId }),
    );
  },
  async getReferrals(eventId: string) {
    return getBenefitsQueryClient().execute(
      buildQueryEnvelope('BN_MORTALITY_GET_REFERRALS', MODULE, { eventId }),
    );
  },
  async searchPersonMatches(
    params: { nationalId?: string; fullName?: string; dob?: string },
    page: { pageSize?: number; pageToken?: string | null } = {},
  ): Promise<BnBenefitsQueryResult<readonly BnMortalityPersonMatchDto[]>> {
    return getBenefitsQueryClient().execute(
      buildQueryEnvelope('BN_MORTALITY_SEARCH_PERSON_MATCHES', MODULE, params, page),
    );
  },
  async getEvidenceLinks(eventId: string) {
    return getBenefitsQueryClient().execute(
      buildQueryEnvelope('BN_MORTALITY_GET_EVIDENCE_LINKS', MODULE, { eventId }),
    );
  },
  async getCommunications(eventId: string) {
    return getBenefitsQueryClient().execute(
      buildQueryEnvelope('BN_MORTALITY_GET_COMMUNICATIONS', MODULE, { eventId }),
    );
  },
  async getEvidenceRegister(eventId: string) {
    return getBenefitsQueryClient().execute(
      buildQueryEnvelope('BN_MORTALITY_GET_EVIDENCE', MODULE, { eventId }),
    );
  },
  async getRequiredActions(eventId: string) {
    return getBenefitsQueryClient().execute(
      buildQueryEnvelope('BN_MORTALITY_GET_REQUIRED_ACTIONS', MODULE, { eventId }),
    );
  },
  async getHandoffs(eventId: string) {
    return getBenefitsQueryClient().execute(
      buildQueryEnvelope('BN_MORTALITY_GET_HANDOFFS', MODULE, { eventId }),
    );
  },
  async getWorklistIndicators(eventIds: readonly string[]) {
    return getBenefitsQueryClient().execute(
      buildQueryEnvelope('BN_MORTALITY_GET_WORKLIST_INDICATORS', MODULE, { eventIds: [...eventIds] }),
    );
  },
  async getAwardSnapshot(awardId: string) {
    return getBenefitsQueryClient().execute(
      buildQueryEnvelope('BN_MORTALITY_GET_AWARD_SNAPSHOT', MODULE, { awardId }),
    );
  },
};
