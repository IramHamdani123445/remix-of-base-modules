/**
 * MEANS-TEST EPIC 1 — shared "start an assessment" entry point.
 *
 * Used by the Claim workspace, Award 360 and Benefit 360 so an officer
 * never has to leave their case, find the Means-Test module and re-type
 * identifiers. The launcher only carries context: every value is
 * re-validated by the backend initiation check and again by the create
 * command.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { BnMeansInitiationWizard } from '@/components/bn/meansTests/initiation/BnMeansInitiationWizard';
import type { BnMeansInitiationPrefill } from '@/types/bn/meansTests/meansInitiation';

export interface MeansStartAssessmentActionProps {
  prefill: BnMeansInitiationPrefill;
  label?: string;
  size?: 'sm' | 'default';
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  testId?: string;
}

/** Derive a Means-Test person id from a social security number. */
export function personIdFromSsn(ssn: string | null | undefined): number | null {
  const digits = (ssn ?? '').replace(/[^0-9]/g, '');
  if (!digits) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

export const MeansStartAssessmentAction: React.FC<MeansStartAssessmentActionProps> = ({
  prefill, label = 'Start means-test assessment', size = 'sm', variant = 'outline',
  testId = 'means-start-assessment-action',
}) => {
  const [open, setOpen] = React.useState(false);
  const navigate = useNavigate();

  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)} data-testid={testId}>
        <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
        {label}
      </Button>
      <BnMeansInitiationWizard
        open={open}
        onOpenChange={setOpen}
        prefill={prefill}
        onCreated={() => navigate('/bn/means-tests')}
      />
    </>
  );
};

export default MeansStartAssessmentAction;
