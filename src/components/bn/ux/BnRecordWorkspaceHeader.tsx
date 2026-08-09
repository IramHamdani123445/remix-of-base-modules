/**
 * BnRecordWorkspaceHeader — consistent header for every Benefits record
 * workspace (assessment, run, case).
 *
 * Never headlines a technical identifier: the business reference leads,
 * technical metadata belongs in the activity/details drawer.
 */
import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface BnRecordFact {
  readonly label: string;
  readonly value: React.ReactNode;
  readonly emphasis?: boolean;
}

interface BackLinkProps {
  readonly label: string;
  readonly onBack: () => void;
  readonly className?: string;
}

/**
 * The single back control for record workspaces — used by the header and by
 * the loading / error states that render before the header can appear, so a
 * record screen never shows two differently styled ways back to its queue.
 */
export const BnRecordBackLink: React.FC<BackLinkProps> = ({ label, onBack, className }) => (
  <Button
    variant="ghost"
    size="sm"
    onClick={onBack}
    className={className}
    data-testid="bn-record-back"
  >
    <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" /> {label}
  </Button>
);

interface Props {
  readonly backLabel: string;
  readonly onBack: () => void;
  /** Business reference — e.g. MT-2026-0001, not a UUID. */
  readonly reference: string;
  /** Person/case context, where permitted. */
  readonly context?: React.ReactNode;
  readonly status?: string;
  readonly owner?: string | null;
  /** Current workflow stage in officer language. */
  readonly stage?: string | null;
  readonly facts?: readonly BnRecordFact[];
  readonly actions?: React.ReactNode;
  readonly badges?: React.ReactNode;
  /** Standard refresh control; owned by the header so queues and records match. */
  readonly onRefresh?: () => void;
  readonly refreshing?: boolean;
  readonly className?: string;
}

export const BnRecordWorkspaceHeader: React.FC<Props> = ({
  backLabel,
  onBack,
  reference,
  context,
  status,
  owner,
  stage,
  facts = [],
  actions,
  badges,
  onRefresh,
  refreshing = false,
  className,
}) => (
  <header className={cn('space-y-3', className)} data-testid="bn-record-workspace-header">
    <BnRecordBackLink label={backLabel} onBack={onBack} />


    <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-card p-4">
      <div className="min-w-0 space-y-1">
        <h1 className="truncate text-xl font-semibold">{reference}</h1>
        {context && <p className="text-sm text-muted-foreground">{context}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {status && (
            <Badge variant="secondary" data-testid="bn-record-status">
              {status}
            </Badge>
          )}
          {stage && (
            <Badge variant="outline" data-testid="bn-record-stage">
              Stage: {stage}
            </Badge>
          )}
          {owner && <Badge variant="outline">Owner: {owner}</Badge>}
          {badges}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        {facts.map((fact) => (
          <div key={fact.label} className="min-w-[7rem]">
            <p className="text-xs text-muted-foreground">{fact.label}</p>
            <p className={cn('font-medium', fact.emphasis && 'text-lg')}>{fact.value}</p>
          </div>
        ))}
        {actions}
      </div>
    </div>
  </header>
);
