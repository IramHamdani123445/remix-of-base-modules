import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Building2,
  MapPin,
  Clock,
  ShieldAlert,
  AlertOctagon,
  Pin,
  PinOff,
  EyeOff,
  ArrowDownToLine,
  RefreshCw,
  GitMerge,
  Sparkles,
  MoreHorizontal,
  CalendarPlus,
  ScrollText,
} from 'lucide-react';
import type { PlanCandidateV3 } from '@/types/weeklyPlan';
import type { PlannerCandidateAction } from '@/services/plannerCandidateActionsService';
import { formatDateForDisplay } from '@/lib/format-config';
import { cn } from '@/lib/utils';

export interface CandidateCardV3Props {
  candidate: PlanCandidateV3;
  /** Active governance actions on this employer for the active week. */
  actions: PlannerCandidateAction[];
  /** Inspector can pin only; supervisor+ can use the full set. */
  canPin: boolean;
  canGovern: boolean;
  isAdded: boolean;
  onAddToPlan: (c: PlanCandidateV3) => void;
  onPin: (c: PlanCandidateV3) => void;
  onUnpin: (action: PlannerCandidateAction) => void;
  onSuppress: (c: PlanCandidateV3) => void;
  onDemote: (c: PlanCandidateV3) => void;
  onConvertException: (c: PlanCandidateV3) => void;
  onMerge: (c: PlanCandidateV3) => void;
  onRecalc: (c: PlanCandidateV3) => void;
}

function bandTone(band: string | null): string {
  switch ((band || '').toUpperCase()) {
    case 'CRITICAL':
      return 'bg-destructive/15 text-destructive border-destructive/30';
    case 'HIGH':
      return 'bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-950/40 dark:text-orange-300';
    case 'MEDIUM':
      return 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300';
    case 'LOW':
      return 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

function classChip(c: PlanCandidateV3['mandatory_class']): string {
  switch (c) {
    case 'MANDATORY':
      return 'bg-destructive text-destructive-foreground';
    case 'PRIORITY':
      return 'bg-orange-500 text-white';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

function bucketLabel(b: PlanCandidateV3['bucket']): string {
  switch (b) {
    case 'MUST_SCHEDULE': return 'Must schedule';
    case 'REACTIVE_ENFORCEMENT': return 'Reactive enforcement';
    case 'RISK_MONITORING': return 'Risk monitoring';
    case 'ROUTINE_COVERAGE': return 'Routine coverage';
    case 'CAMPAIGN_INTEL': return 'Campaign / intel';
    default: return 'Unclassified';
  }
}

export function CandidateCardV3(props: CandidateCardV3Props) {
  const {
    candidate: c, actions, canPin, canGovern, isAdded,
    onAddToPlan, onPin, onUnpin, onSuppress, onDemote,
    onConvertException, onMerge, onRecalc,
  } = props;

  const pin = actions.find(a => a.action_type === 'pin');
  const isSuppressed = actions.some(a => a.action_type === 'suppress');
  const isDemoted = actions.some(a => a.action_type === 'demote_watchlist');
  const isException = actions.some(a => a.action_type === 'convert_exception');

  const overdueDays = c.overdue_days ?? 0;
  const dueLabel =
    overdueDays > 0
      ? `${overdueDays}d overdue`
      : c.next_due_date
      ? `Due ${formatDateForDisplay(c.next_due_date)}`
      : 'No cycle date';

  return (
    <Card
      className={cn(
        'p-3 space-y-2 transition-shadow hover:shadow-md',
        c.mandatory_class === 'MANDATORY' && 'ring-1 ring-destructive/40',
        pin && 'ring-2 ring-primary/60 bg-primary/5',
        isSuppressed && 'opacity-60 grayscale',
      )}
    >
      {/* Header row */}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <h4 className="font-semibold text-sm truncate">{c.employer_name || c.employer_id}</h4>
            {pin && <Pin className="h-3.5 w-3.5 text-primary fill-primary" />}
            {isException && <AlertOctagon className="h-3.5 w-3.5 text-warning" />}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
            {c.territory && (
              <span className="inline-flex items-center gap-0.5">
                <MapPin className="h-3 w-3" /> {c.territory}
              </span>
            )}
            {c.audit_program && (
              <span className="inline-flex items-center gap-0.5">
                <ScrollText className="h-3 w-3" /> {c.audit_program}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Badge className={cn('text-[10px] px-1.5 py-0', classChip(c.mandatory_class))}>
            {c.mandatory_class}
          </Badge>
        </div>
      </div>

      {/* Score + band line */}
      <div className="flex items-center gap-2 text-xs flex-wrap">
        <Badge variant="outline" className={cn('text-[10px]', bandTone(c.risk_band))}>
          <ShieldAlert className="h-2.5 w-2.5 mr-1" />
          {c.risk_band || '—'}
        </Badge>
        <span className="text-muted-foreground">
          Inherent <b className="text-foreground">{Math.round(c.inherent_risk_score)}</b>
        </span>
        <span className="text-muted-foreground">
          Priority <b className="text-foreground">{Math.round(c.audit_priority_score)}</b>
        </span>
        <span className="text-muted-foreground inline-flex items-center gap-0.5">
          <Clock className="h-3 w-3" /> ~{c.estimated_effort}h
        </span>
      </div>

      {/* Due / last visit / exposure */}
      <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
        <span className={cn(overdueDays > 0 && 'text-destructive font-medium')}>{dueLabel}</span>
        {c.last_audit_date && (
          <span>Last visit {formatDateForDisplay(c.last_audit_date)}</span>
        )}
        {c.financial_exposure > 0 && (
          <span className="text-warning">Exp ${c.financial_exposure.toLocaleString()}</span>
        )}
        <span className="text-[11px] uppercase tracking-wide">{bucketLabel(c.bucket)}</span>
      </div>

      {/* Why selected */}
      {c.why_selected && (
        <p className="text-[11px] leading-snug text-muted-foreground italic line-clamp-2">
          “{c.why_selected}”
        </p>
      )}

      {/* Reason badges — defensive: the engine may return empty slots */}
      {safeReasons.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {safeReasons.slice(0, 4).map((r, i) => (
            <Badge key={`${r.code}-${i}`} variant="secondary" className="text-[10px] py-0 px-1.5">
              {r.label}
            </Badge>
          ))}
        </div>
      )}

      {/* Data-quality notice — never hide a defective record silently */}
      {dataIssues.length > 0 && (
        <div
          className="flex items-start gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-1 text-[10px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
          title={dataIssues.map((i) => i.message).join('\n')}
        >
          <AlertTriangle className="h-3 w-3 mt-[1px] shrink-0" />
          <span className="leading-snug">
            Data needs correction — {dataIssues[0].message}
            {dataIssues.length > 1 ? ` (+${dataIssues.length - 1} more)` : ''}
          </span>
        </div>
      )}



      {/* Action row */}
      <div className="flex items-center justify-between pt-1 border-t">
        <Button
          size="sm"
          variant={isAdded ? 'outline' : 'default'}
          className="h-7 text-xs"
          disabled={isAdded || isSuppressed}
          onClick={() => onAddToPlan(c)}
        >
          <CalendarPlus className="h-3 w-3 mr-1" />
          {isAdded ? 'Added' : 'Add to plan'}
        </Button>

        <div className="flex items-center gap-0.5">
          {canPin && !pin && (
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Pin"
              onClick={() => onPin(c)}>
              <Pin className="h-3.5 w-3.5" />
            </Button>
          )}
          {pin && (
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Unpin"
              onClick={() => onUnpin(pin)}>
              <PinOff className="h-3.5 w-3.5" />
            </Button>
          )}
          {canGovern && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={() => onSuppress(c)} disabled={isSuppressed}>
                  <EyeOff className="h-3.5 w-3.5 mr-2" /> Suppress this week
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onDemote(c)} disabled={isDemoted}>
                  <ArrowDownToLine className="h-3.5 w-3.5 mr-2" /> Demote to watchlist
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onConvertException(c)}>
                  <AlertOctagon className="h-3.5 w-3.5 mr-2" /> Convert to exception
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onMerge(c)}>
                  <GitMerge className="h-3.5 w-3.5 mr-2" /> Merge duplicate reasons
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onRecalc(c)}>
                  <RefreshCw className="h-3.5 w-3.5 mr-2" /> Request recalculation
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </Card>
  );
}
