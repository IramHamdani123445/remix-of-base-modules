/**
 * MEANS-TEST EPIC 0 — landing-page building blocks.
 *
 * Process journey, work-area cards and the "How Means Tests work" panel.
 * Nothing here fabricates a count: a work area either has a delivered
 * backend read or it states, in plain words, that it is not implemented yet.
 */
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Check, ChevronDown, CircleDashed, Wrench } from 'lucide-react';

/** The complete Means-Test process, in operational order. */
export const MEANS_PROCESS_JOURNEY: readonly {
  code: string;
  label: string;
  status: 'DELIVERED' | 'IN_PROGRESS' | 'NOT_IMPLEMENTED';
}[] = [
  { code: 'ASSESSMENT', label: 'Assessment', status: 'DELIVERED' },
  { code: 'HOUSEHOLD', label: 'Household', status: 'DELIVERED' },
  { code: 'INCOME', label: 'Income', status: 'DELIVERED' },
  { code: 'ASSETS', label: 'Assets', status: 'DELIVERED' },
  { code: 'DEDUCTIONS', label: 'Deductions', status: 'DELIVERED' },
  { code: 'EVIDENCE', label: 'Evidence', status: 'DELIVERED' },
  { code: 'SUBMISSION', label: 'Submission', status: 'DELIVERED' },
  { code: 'VERIFICATION', label: 'Verification', status: 'DELIVERED' },
  { code: 'CALCULATION', label: 'Calculation', status: 'DELIVERED' },
  { code: 'APPROVAL', label: 'Approval', status: 'DELIVERED' },
  { code: 'ACTIVATION', label: 'Activation', status: 'NOT_IMPLEMENTED' },
  { code: 'REASSESSMENT', label: 'Reassessment', status: 'NOT_IMPLEMENTED' },
];

const STATUS_TEXT: Record<string, string> = {
  DELIVERED: 'Available',
  IN_PROGRESS: 'In build',
  NOT_IMPLEMENTED: 'Not implemented yet',
};

export const MeansProcessJourney: React.FC = () => (
  <Card data-testid="means-process-journey">
    <CardHeader>
      <CardTitle>The Means-Test journey</CardTitle>
      <CardDescription>
        Each stage below is a step an officer completes. Stages marked
        “Not implemented yet” are still being built and offer no actions.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <ol className="flex flex-wrap gap-2">
        {MEANS_PROCESS_JOURNEY.map((step, index) => (
          <li
            key={step.code}
            data-testid={`means-journey-${step.code}`}
            className="flex items-center gap-2 rounded-md border px-3 py-2"
          >
            <span className="text-xs font-semibold text-muted-foreground">{index + 1}</span>
            {step.status === 'DELIVERED' ? (
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <CircleDashed className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span className="text-sm font-medium">{step.label}</span>
            <span className="text-[11px] text-muted-foreground">{STATUS_TEXT[step.status]}</span>
          </li>
        ))}
      </ol>
    </CardContent>
  </Card>
);

export interface MeansWorkAreaDefinition {
  code: string;
  label: string;
  description: string;
  implemented: boolean;
  /** Reason shown when the area is unavailable (permission or build state). */
  unavailableReason?: string;
  requiredAction?: string;
}

export const MEANS_WORK_AREAS: readonly MeansWorkAreaDefinition[] = [
  {
    code: 'MY_ASSESSMENTS',
    label: 'My assessments',
    description: 'Assessments assigned to you personally.',
    implemented: false,
    unavailableReason: 'A per-officer assignment read has not been delivered yet.',
    requiredAction: 'view',
  },
  {
    code: 'TEAM_QUEUE',
    label: 'Team work queue',
    description: 'All assessments your team can see, with filters.',
    implemented: true,
    requiredAction: 'view',
  },
  {
    code: 'VERIFICATION_QUEUE',
    label: 'Verification queue',
    description: 'Submitted assessments awaiting independent fact verification.',
    implemented: true,
    requiredAction: 'verify',
  },
  {
    code: 'APPROVAL_QUEUE',
    label: 'Approval queue',
    description: 'Calculated assessments and adjustments awaiting an independent decision.',
    implemented: true,
    requiredAction: 'approve',
  },
  {
    code: 'REASSESSMENT_QUEUE',
    label: 'Reassessment queue',
    description: 'Active assessments due for review or affected by a reported change.',
    implemented: false,
    unavailableReason: 'Reassessment is not implemented yet.',
    requiredAction: 'reassess',
  },
  {
    code: 'CONFIGURATION',
    label: 'Configuration',
    description: 'Means-Test policy, thresholds and reference data.',
    implemented: false,
    unavailableReason: 'Means-Test configuration screens are not implemented yet.',
    requiredAction: 'config',
  },
];

export const MeansWorkAreaCard: React.FC<{
  area: MeansWorkAreaDefinition;
  permitted: boolean;
  onOpen?: () => void;
}> = ({ area, permitted, onOpen }) => {
  const unavailable = !area.implemented || !permitted;
  const reason = !permitted
    ? `You do not hold the '${area.requiredAction}' permission for this area.`
    : area.unavailableReason;

  return (
    <Card data-testid={`means-work-area-${area.code}`} data-implemented={area.implemented ? 'true' : 'false'}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">{area.label}</CardTitle>
          {unavailable ? (
            <Badge variant="secondary" className="shrink-0">
              {permitted ? 'Not implemented yet' : 'No access'}
            </Badge>
          ) : (
            <Badge variant="outline" className="shrink-0">Available</Badge>
          )}
        </div>
        <CardDescription>{area.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {unavailable ? (
          <p className="text-xs text-muted-foreground">{reason}</p>
        ) : (
          <Button size="sm" variant="outline" onClick={onOpen}>
            Open {area.label.toLowerCase()}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

export const MeansHowItWorksPanel: React.FC = () => (
  <Card data-testid="means-how-it-works">
    <CardHeader>
      <CardTitle>How Means Tests work</CardTitle>
      <CardDescription>A short guide for Benefits officers.</CardDescription>
    </CardHeader>
    <CardContent>
      <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
        <li>Select the person, claim or award the assessment belongs to.</li>
        <li>Record the household members and the financial facts — income, assets and allowable deductions.</li>
        <li>Attach the evidence that supports each fact.</li>
        <li>Submit the assessment. Submission freezes the facts so they cannot change during review.</li>
        <li>A second officer independently verifies each fact against its evidence.</li>
        <li>The system calculates the assessed means under the policy in force on the effective date.</li>
        <li>An independent approver approves or rejects the assessment. The calculator cannot approve their own work.</li>
        <li>Once approved, the assessment is activated and its facts are published to Eligibility.</li>
        <li>Reassess whenever circumstances change or a scheduled review falls due.</li>
      </ol>
    </CardContent>
  </Card>
);

/** Technical detail is available, but never in the officer's normal view. */
export const MeansTechnicalDetails: React.FC<{ details: Record<string, string | undefined | null> }> = ({
  details,
}) => {
  const [open, setOpen] = React.useState(false);
  const entries = Object.entries(details).filter(([, v]) => v != null && v !== '');
  if (entries.length === 0) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" data-testid="means-technical-details-trigger">
          <Wrench className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
          Technical details
          <ChevronDown className="ml-2 h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <dl
          data-testid="means-technical-details"
          className="mt-2 grid gap-1 rounded-md border bg-muted/30 p-3 text-xs sm:grid-cols-2"
        >
          {entries.map(([key, value]) => (
            <div key={key} className="flex gap-2">
              <dt className="font-medium">{key}</dt>
              <dd className="break-all text-muted-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
};
