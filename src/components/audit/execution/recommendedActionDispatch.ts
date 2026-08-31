import type { NextActionKey } from '@/components/audit/workspace/AuditNextActionsPanel';

/**
 * IA-POST-UAT-01 hardening.
 *
 * Every NextActionKey must resolve to a canonical workspace tab. This is an
 * exhaustive Record, so adding a new key without a dispatcher fails typecheck.
 */
export const RECOMMENDED_ACTION_TAB: Record<NextActionKey, string> = {
  // Governed launch/readiness flow (LaunchReadinessPanel → ia_launch_engagement).
  LAUNCH_AUDIT: 'preparation',
  // Canonical execution lifecycle transition surface.
  BEGIN_FIELDWORK: 'activities',
  DOCUMENT_FINDINGS: 'findings',
  // Finding release / response-request workflow.
  REQUEST_MANAGEMENT_RESPONSES: 'responses',
  // Corrective-action tracking for this engagement.
  FOLLOW_UP_OVERDUE_ACTIONS: 'actions',
  // Governed closure workspace.
  CLOSE_AUDIT: 'closure',
};

export function resolveRecommendedActionTab(key: NextActionKey): string | undefined {
  return RECOMMENDED_ACTION_TAB[key];
}
