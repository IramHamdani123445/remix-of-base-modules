/**
 * Next-Step Guidance Panel
 *
 * Inspects the claim's current state (status, eligibility, calculation,
 * decision, entitlement, payable) and tells the officer exactly what to
 * do next, with a one-click action button.
 *
 * Spec sections 1, 8, 9.
 */
import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ArrowRight, CheckCircle2, AlertTriangle, Sparkles } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBlockingMutation } from '@/hooks/useBlockingMutation';
import { useUserCode } from '@/hooks/useUserCode';
import { toast } from 'sonner';
import {
  submitClaimForDecision,
  approveClaim,
  generatePayableForApprovedClaim,
} from '@/services/bn/postApprovalOrchestrator';

const db = supabase as any;

interface Props {
  claimId: string;
  status: string;
  hasEligibilityPass: boolean;
  hasCalculation: boolean;
}

interface DownstreamState {
  hasEntitlement: boolean;
  hasPayable: boolean;
  payableId?: string;
}

async function fetchDownstream(claimId: string): Promise<DownstreamState> {
  const [{ data: ents }, { data: pis }] = await Promise.all([
    db.from('bn_entitlement').select('id').eq('claim_id', claimId).limit(1),
    db.from('bn_payment_instruction').select('id').eq('claim_id', claimId).limit(1),
  ]);
  return {
    hasEntitlement: (ents?.length || 0) > 0,
    hasPayable: (pis?.length || 0) > 0,
    payableId: pis?.[0]?.id,
  };
}

export const NextStepGuidance: React.FC<Props> = ({
  claimId, status, hasEligibilityPass, hasCalculation,
}) => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  // isLoading and error matter here: userCode starts null and the profile is
  // fetched asynchronously, so acting on `!userCode` alone reports a missing
  // user code while it is merely still loading.
  const { userCode, isLoading: userCodeLoading, error: userCodeError } = useUserCode();

  const { data: downstream } = useQuery({
    queryKey: ['bn', 'next-step-downstream', claimId, status],
    queryFn: () => fetchDownstream(claimId),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['bn', 'claim', claimId] });
    qc.invalidateQueries({ queryKey: ['bn', 'next-step-downstream', claimId] });
    qc.invalidateQueries({ queryKey: ['bn', 'payables'] });
    qc.invalidateQueries({ queryKey: ['bn', 'entitlements'] });
  };

  /**
   * Four different situations used to produce one message, so an officer could
   * not tell a still-loading profile from an account that needs configuring.
   */
  const guard = () => {
    if (userCodeLoading) {
      toast.error('Still loading your profile', {
        description: 'Your user code has not arrived yet. Try again in a moment.',
      });
      return false;
    }
    if (userCodeError) {
      toast.error('Could not read your profile', {
        description: `${userCodeError}. Your user code is required to record this action.`,
      });
      return false;
    }
    if (!userCode) {
      toast.error('Your account has no user code', {
        description:
          'Every Benefits action is recorded against a user code, and none is set on your ' +
          'profile. Ask an administrator to set one before continuing.',
      });
      return false;
    }
    return true;
  };

  /** True while no action can be taken, so buttons can be disabled rather than fail on click. */
  const actionsBlocked = userCodeLoading || !!userCodeError || !userCode;

  const submitMut = useBlockingMutation({
    mutationFn: () => submitClaimForDecision(claimId, userCode!),
    onSuccess: () => { toast.success('Submitted for decision'); invalidate(); },
    onError: (e: any) => toast.error('Failed', { description: e?.message }),
  }, 'Submitting for decision...');

  const approveMut = useBlockingMutation({
    mutationFn: () => approveClaim(claimId, userCode!),
    onSuccess: (r: any) => { toast.success(r.message || 'Approved'); invalidate(); },
    onError: (e: any) => toast.error('Approval failed', { description: e?.message }),
  }, 'Approving claim...');

  const generateMut = useBlockingMutation({
    mutationFn: () => generatePayableForApprovedClaim(claimId, userCode!),
    onSuccess: (r: any) => { toast.success(r.message || 'Generated'); invalidate(); },
    onError: (e: any) => toast.error('Generation failed', { description: e?.message }),
  }, 'Generating payable...');

  const step = useMemo(() => {
    // Blocked states first
    if (!hasEligibilityPass && !['APPROVED', 'AWARD_SETUP', 'IN_PAYMENT', 'PAYMENT_QUEUE', 'DENIED', 'CLOSED'].includes(status)) {
      return {
        tone: 'blocked' as const,
        title: 'Eligibility not yet passed',
        body: 'Run eligibility (or have an override approved) before submitting for decision.',
      };
    }
    if (!hasCalculation && ['INTAKE', 'CALCULATION', 'ELIGIBILITY_CHECK', 'EVIDENCE_REVIEW'].includes(status)) {
      return {
        tone: 'action' as const,
        title: 'Eligibility passed — Run Calculation',
        body: 'Open the Calculation tab and run the calculation engine. Once complete, you can submit for decision.',
        actionLabel: 'Go to Calculation',
        onAction: () => {
          const url = new URL(window.location.href);
          url.searchParams.set('tab', 'calculation');
          window.location.hash = '';
          navigate(url.pathname + url.search);
        },
      };
    }

    // CALCULATION → submit for decision (also handles INTAKE if officer skipped status change)
    if (['CALCULATION', 'INTAKE', 'ELIGIBILITY_CHECK'].includes(status) && hasCalculation) {
      return {
        tone: 'action' as const,
        title: 'Calculation complete — Submit for Decision',
        body: 'Send this claim to the decision queue for approval.',
        actionLabel: 'Submit for Decision',
        onAction: () => { if (guard()) submitMut.mutate(); },
        pending: submitMut.isPending,
      };
    }

    if (status === 'DECISION' || status === 'PENDING_APPROVAL') {
      return {
        tone: 'action' as const,
        title: 'Awaiting decision',
        body: 'Approve, deny or send back. Approval auto-creates the entitlement or payable.',
        actionLabel: 'Approve Claim',
        onAction: () => { if (guard()) approveMut.mutate(); },
        pending: approveMut.isPending,
      };
    }

    if (status === 'APPROVED' && !downstream?.hasEntitlement && !downstream?.hasPayable) {
      return {
        tone: 'action' as const,
        title: 'Decision approved — no payable yet',
        body: 'Generate the entitlement / payable record so the claim can be paid.',
        actionLabel: 'Generate Payable',
        onAction: () => { if (guard()) generateMut.mutate(); },
        pending: generateMut.isPending,
      };
    }

    if (downstream?.hasPayable && ['PAYMENT_QUEUE', 'AWARD_SETUP', 'IN_PAYMENT', 'APPROVED'].includes(status)) {
      return {
        tone: 'success' as const,
        title: 'Payment instruction created',
        body: 'Continue in the Payables Queue to schedule, batch and issue payment.',
        actionLabel: 'Open Payables Queue',
        onAction: () => navigate('/bn/payables'),
      };
    }

    if (downstream?.hasEntitlement && !downstream?.hasPayable) {
      return {
        tone: 'info' as const,
        title: 'Entitlement active',
        body: 'No outstanding payable. Generate the next scheduled payment from the Payables Queue when due.',
        actionLabel: 'Open Payables Queue',
        onAction: () => navigate('/bn/payables'),
      };
    }

    if (status === 'DENIED' || status === 'CLOSED' || status === 'WITHDRAWN') {
      return {
        tone: 'success' as const,
        title: `Claim ${status.toLowerCase()}`,
        body: 'No further action required on this claim.',
      };
    }

    return null;
  }, [status, hasEligibilityPass, hasCalculation, downstream, submitMut.isPending, approveMut.isPending, generateMut.isPending]);

  if (!step) return null;

  const Icon = step.tone === 'success' ? CheckCircle2 : step.tone === 'blocked' ? AlertTriangle : Sparkles;
  const variant: 'default' | 'destructive' = step.tone === 'blocked' ? 'destructive' : 'default';

  return (
    <Alert variant={variant}>
      <Icon className="h-4 w-4" />
      <AlertTitle>{step.title}</AlertTitle>
      <AlertDescription className="flex items-center justify-between gap-3 flex-wrap">
        <span>{step.body}</span>
        {('actionLabel' in step) && step.actionLabel && step.onAction && (
          <Button
            size="sm"
            onClick={step.onAction}
            // Disabled while the user code is unavailable, so the action cannot
            // be attempted and then refused.
            disabled={actionsBlocked || (('pending' in step) ? !!step.pending : false)}
            title={
              userCodeLoading
                ? 'Loading your profile…'
                : userCodeError
                  ? `Your profile could not be read: ${userCodeError}`
                  : !userCode
                    ? 'Your account has no user code — ask an administrator to set one'
                    : undefined
            }
          >
            {userCodeLoading ? 'Loading…' : step.actionLabel}
            <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
};
