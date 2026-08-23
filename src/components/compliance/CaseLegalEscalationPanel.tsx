import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Scale } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  REFERRAL_STAGE_ORDER,
  REFERRAL_STATUS,
  REFERRAL_STATUS_LABEL,
  referralStatusVariant,
  type CaseLegalStatus,
} from '@/services/compliance/legalEscalationFlow';

/**
 * Shows exactly where a compliance case sits in the legal escalation lifecycle,
 * so a referral is never invisible between creation and Legal acceptance.
 */
export function CaseLegalEscalationPanel({ status }: { status: CaseLegalStatus | null | undefined }) {
  const navigate = useNavigate();
  if (!status) return null;

  const currentIndex = REFERRAL_STAGE_ORDER.indexOf(status.status);

  const nextStep =
    status.status === REFERRAL_STATUS.DRAFT || status.status === REFERRAL_STATUS.RETURNED_BY_LEGAL
      ? { label: 'Open Legal Pack Preparation', to: `/compliance/legal/pack-preparation?referral=${status.referral_id}` }
      : status.status === REFERRAL_STATUS.PENDING_APPROVAL || status.status === REFERRAL_STATUS.APPROVED_FOR_SUBMISSION
        ? { label: 'Open Legal Queue', to: '/compliance/enforcement/legal-queue' }
        : status.lg_intake_id
          ? { label: `View Legal Intake ${status.lg_intake_no ?? ''}`.trim(), to: `/legal/cases/intake/${status.lg_intake_id}` }
          : null;

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Scale className="h-4 w-4 text-primary" />
          Legal Escalation
          <Badge variant={referralStatusVariant(status.status)} className="text-[10px]">
            {REFERRAL_STATUS_LABEL[status.status] ?? status.status}
          </Badge>
          <span className="font-mono text-xs text-muted-foreground">{status.referral_number}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {REFERRAL_STAGE_ORDER.map((stage, i) => (
            <Badge
              key={stage}
              variant={i <= currentIndex && currentIndex >= 0 ? 'default' : 'outline'}
              className="text-[10px]"
            >
              {REFERRAL_STATUS_LABEL[stage]}
            </Badge>
          ))}
        </div>

        <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
          <span>Raised via: {status.created_via ?? 'REFERRAL_WIZARD'}</span>
          <span>Created: {new Date(status.created_at).toLocaleDateString()}</span>
          {status.approval_requested_by && <span>Approval requested by {status.approval_requested_by}</span>}
          {status.approved_by && <span>Approved by {status.approved_by}</span>}
          {status.submitted_date && (
            <span>Submitted to Legal: {new Date(status.submitted_date).toLocaleDateString()}</span>
          )}
          {status.lg_intake_no && <span>Legal intake: {status.lg_intake_no}</span>}
        </div>

        {status.return_reason && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
            <span className="font-medium">Returned by Legal:</span> {status.return_reason}
          </p>
        )}
        {status.rejection_reason && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
            <span className="font-medium">Rejected:</span> {status.rejection_reason}
          </p>
        )}

        {nextStep && (
          <Button variant="outline" size="sm" onClick={() => navigate(nextStep.to)}>
            {nextStep.label}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
