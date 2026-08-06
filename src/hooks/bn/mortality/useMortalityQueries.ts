/**
 * BN Mortality — React Query hooks (thin bindings over mortalityQueryService).
 *
 * Every hook enforces the tenancy scope by including the `moduleCode`
 * in the cache key and always going through the secure query client.
 */
import { useBenefitsQuery } from '@/hooks/bn/queries';
import type {
  BnMortalityAwardImpactDto,
  BnMortalityDashboardDto,
  BnMortalityEventDetailDto,
  BnMortalityEventListItemDto,
  BnMortalityEventSummaryDto,
  BnMortalityPersonMatchDto,
  MortalityAwardSnapshotDto,
  MortalityCommunicationEntry,
  MortalityEvidenceLink,
  MortalityEvidenceRegisterEntry,
  MortalityHandoffEntry,
  MortalityHistoryEntry,
  MortalityReferralEntry,
  MortalityRegistrationImpactPreviewDto,
  MortalityRequiredActionEntry,
  MortalityWorklistIndicator,
} from '@/types/bn/mortality/mortalityDtos';
import type { MortalityActionAvailabilityResponse } from '@/types/bn/mortality/mortalityActionAvailability';



const MODULE = 'bn_mortality';

export function useMortalityDashboard() {
  return useBenefitsQuery<Record<string, never>, BnMortalityDashboardDto>({
    queryCode: 'BN_MORTALITY_GET_SUMMARY',
    moduleCode: MODULE,
    params: {},
  });
}

export function useMortalitySummary(eventId: string | null) {
  return useBenefitsQuery<{ eventId: string }, BnMortalityEventSummaryDto>({
    queryCode: 'BN_MORTALITY_GET_SUMMARY',
    moduleCode: MODULE,
    params: { eventId: eventId ?? '' },
    enabled: !!eventId,
  });
}

export function useMortalityEvent(eventId: string | null) {
  return useBenefitsQuery<{ eventId: string }, BnMortalityEventDetailDto>({
    queryCode: 'BN_MORTALITY_GET_EVENT',
    moduleCode: MODULE,
    params: { eventId: eventId ?? '' },
    enabled: !!eventId,
  });
}

export interface MortalityListFilters {
  status?: string;
  assignedTo?: string;
  unassignedOnly?: boolean;
  search?: string;
  source?: string;
  overdueOnly?: boolean;
  /** BN-MORT-UX-2 §2 — exclude CLOSED/CANCELLED/DUPLICATE/REVERSED/REJECTED. */
  openOnly?: boolean;
  /** BN-MORT-UX-2 §2 — CLOSED events with closed_at ≥ first day of current UTC month. */
  closedThisMonthOnly?: boolean;
  reportedFrom?: string;
  reportedTo?: string;
  sortBy?: 'reported_at' | 'updated_at' | 'sla_due_at' | 'status' | 'death_date';
  sortDir?: 'asc' | 'desc';
}

export function useMortalityEventList(
  filters: MortalityListFilters = {},
  pageSize = 25,
  pageToken: string | null = null,
) {
  return useBenefitsQuery<MortalityListFilters, readonly BnMortalityEventListItemDto[]>({
    queryCode: 'BN_MORTALITY_LIST_EVENTS',
    moduleCode: MODULE,
    params: filters,
    pageSize,
    pageToken,
  });
}

export function useMortalityEventHistory(eventId: string | null) {
  return useBenefitsQuery<{ eventId: string }, readonly MortalityHistoryEntry[]>({
    queryCode: 'BN_MORTALITY_GET_EVENT_HISTORY',
    moduleCode: MODULE,
    params: { eventId: eventId ?? '' },
    enabled: !!eventId,
  });
}


export function useMortalityAwardImpacts(eventId: string | null) {
  return useBenefitsQuery<{ eventId: string }, readonly BnMortalityAwardImpactDto[]>({
    queryCode: 'BN_MORTALITY_GET_AWARD_IMPACTS',
    moduleCode: MODULE,
    params: { eventId: eventId ?? '' },
    enabled: !!eventId,
  });
}

export function useMortalityAffectedAwards(eventId: string | null) {
  return useBenefitsQuery<{ eventId: string }, readonly BnMortalityAwardImpactDto[]>({
    queryCode: 'BN_MORTALITY_GET_AFFECTED_AWARDS',
    moduleCode: MODULE,
    params: { eventId: eventId ?? '' },
    enabled: !!eventId,
  });
}

export function useMortalityReferrals(eventId: string | null) {
  return useBenefitsQuery<{ eventId: string }, readonly MortalityReferralEntry[]>({
    queryCode: 'BN_MORTALITY_GET_REFERRALS',
    moduleCode: MODULE,
    params: { eventId: eventId ?? '' },
    enabled: !!eventId,
  });
}

export function useMortalityEvidence(eventId: string | null) {
  return useBenefitsQuery<{ eventId: string }, readonly MortalityEvidenceLink[]>({
    queryCode: 'BN_MORTALITY_GET_EVIDENCE_LINKS',
    moduleCode: MODULE,
    params: { eventId: eventId ?? '' },
    enabled: !!eventId,
  });
}

export function useMortalityCommunications(eventId: string | null) {
  return useBenefitsQuery<{ eventId: string }, readonly MortalityCommunicationEntry[]>({
    queryCode: 'BN_MORTALITY_GET_COMMUNICATIONS',
    moduleCode: MODULE,
    params: { eventId: eventId ?? '' },
    enabled: !!eventId,
  });
}

export interface RegistrationImpactPreviewParams {
  matchedIpId?: string | null;
  deathDate: string;
  source?: string;
  externalReference?: string;
}

export function useMortalityRegistrationImpactPreview(
  params: RegistrationImpactPreviewParams | null,
  enabled = true,
) {
  return useBenefitsQuery<RegistrationImpactPreviewParams, MortalityRegistrationImpactPreviewDto>({
    queryCode: 'BN_MORTALITY_PREVIEW_REGISTRATION_IMPACT',
    moduleCode: MODULE,
    params: params ?? { deathDate: '' },
    enabled: enabled && !!params?.deathDate,
  });
}


export function useMortalityPersonMatches(
  params: { nationalId?: string; fullName?: string; dob?: string },
  enabled = true,
) {
  return useBenefitsQuery<typeof params, readonly BnMortalityPersonMatchDto[]>({
    queryCode: 'BN_MORTALITY_SEARCH_PERSON_MATCHES',
    moduleCode: MODULE,
    params,
    enabled: enabled && !!(params.nationalId || params.fullName),
  });
}

/**
 * Server-authoritative action availability for the 26 mortality commands.
 * Pass `eventId=null` on screens that need capability-only availability
 * (e.g. dashboard). Detail screens pass the event id so lifecycle,
 * maker-checker, and data-readiness gates are computed against the
 * real event snapshot.
 */
export function useMortalityActionAvailability(eventId: string | null) {
  return useBenefitsQuery<{ eventId: string | null }, MortalityActionAvailabilityResponse>({
    queryCode: 'BN_MORTALITY_GET_ACTION_AVAILABILITY',
    moduleCode: MODULE,
    params: { eventId },
  });
}

/**
 * BN-MORT-UX-1 §2 — Assignable Benefits users for the worklist filter.
 * Returns approved-role active users only. The browser never reads
 * auth.users / profiles / user_roles / roles / role_permissions directly.
 */
export interface MortalityAssignableUser {
  userId: string;
  displayName: string;
  userCode: string | null;
  roleNames: string[];
}

export function useMortalityAssignableUsers() {
  return useBenefitsQuery<Record<string, never>, readonly MortalityAssignableUser[]>(
    {
      queryCode: 'BN_MORTALITY_GET_ASSIGNABLE_USERS',
      moduleCode: MODULE,
      params: {},
      staleTime: 5 * 60_000,
    },
  );
}


