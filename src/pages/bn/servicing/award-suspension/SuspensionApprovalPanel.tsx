/**
 * Compact approval-review panel intended for embedding in the drawer or a
 * dedicated review workspace. Approve/Reject are delegated to
 * `SuspensionDecisionPanel`, which is the only sanctioned command surface.
 */
import type { SuspensionRequestDetails } from '@/services/bn/awardSuspensionViewService';
import { SuspensionDecisionPanel } from './SuspensionDecisionPanel';
import { formatDate, formatMoney } from './suspensionViewModels';

export function SuspensionApprovalPanel({
  details,
  canApprove,
  actionsEnabled = false,
  canPropose = false,
  currentUserId = null,
  onChanged,
}: {
  details: SuspensionRequestDetails;
  canApprove: boolean;
  actionsEnabled?: boolean;
  canPropose?: boolean;
  currentUserId?: string | null;
  onChanged?: () => void;
}) {
  if (!canApprove) return null;
  return (
    <div className="space-y-3 rounded-md border p-4">
      <h3 className="text-sm font-semibold">Approval review</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Award</dt>
        <dd>{details.award.awardNumber ?? details.award.awardId.slice(0, 8)}</dd>
        <dt className="text-muted-foreground">Claimant</dt>
        <dd>{details.award.claimantName}</dd>
        <dt className="text-muted-foreground">Effective</dt>
        <dd>{formatDate(details.request.requestedEffectiveDate)}</dd>
        <dt className="text-muted-foreground">Base amount</dt>
        <dd>{formatMoney(details.award.baseAmount, details.award.currency)}</dd>
      </dl>
      <p className="text-xs text-muted-foreground italic">
        Maker-checker enforced: administrators cannot bypass the assigned approval level.
      </p>
      <SuspensionDecisionPanel
        details={details}
        currentUserId={currentUserId}
        canApprove={canApprove}
        canPropose={canPropose}
        actionsEnabled={actionsEnabled}
        onChanged={() => onChanged?.()}
      />
    </div>
  );
}
