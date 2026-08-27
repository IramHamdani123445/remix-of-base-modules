import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, ShieldCheck, History } from 'lucide-react';
import {
  useTransitionFinding,
  useChangeFindingSeverity,
  useFindingSeverityHistory,
  type FindingLifecycleStatus,
} from '@/hooks/useAuditLifecycleCommands';
import { formatDateForDisplay } from '@/lib/format-config';

/**
 * Wave 2 — governed finding lifecycle.
 *
 * The lifecycle status and severity of a finding are NEVER written directly by
 * the UI. Every change is issued as a server command that enforces the allowed
 * transition, segregation of duties and immutable event logging.
 */
const NEXT_STATUSES: Record<string, FindingLifecycleStatus[]> = {
  Draft: ['Under Review', 'Withdrawn'],
  'Under Review': ['Confirmed', 'Withdrawn'],
  Confirmed: ['Released', 'Withdrawn'],
  Released: ['Responded'],
  Responded: ['Closed'],
  Closed: [],
  Withdrawn: [],
};

const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'] as const;

interface Props {
  finding: any;
}

export function FindingLifecycleControls({ finding }: Props) {
  const current: string = finding?.lifecycle_status || 'Draft';
  const transition = useTransitionFinding();
  const changeSeverity = useChangeFindingSeverity();
  const { data: history = [] } = useFindingSeverityHistory(finding?.id);

  const [pending, setPending] = React.useState<FindingLifecycleStatus | null>(null);
  const [reason, setReason] = React.useState('');
  const [severity, setSeverity] = React.useState('');
  const [severityReason, setSeverityReason] = React.useState('');

  const options = NEXT_STATUSES[current] ?? [];

  const submitTransition = () => {
    if (!pending) return;
    transition.mutate(
      { findingId: finding.id, targetStatus: pending, reason: reason || null },
      { onSuccess: () => { setPending(null); setReason(''); } },
    );
  };

  const submitSeverity = () => {
    if (!severity || !severityReason.trim()) return;
    changeSeverity.mutate(
      { findingId: finding.id, severity: severity as any, reason: severityReason.trim() },
      { onSuccess: () => { setSeverity(''); setSeverityReason(''); } },
    );
  };

  return (
    <div className="rounded-lg border border-border/50 p-3 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <ShieldCheck className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold">Governed lifecycle</span>
        <Badge variant="outline" className="text-[10px]">{current}</Badge>
        {options.length === 0 && (
          <span className="text-[11px] text-muted-foreground italic">Terminal state — no further transitions.</span>
        )}
      </div>

      {options.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {options.map((target) => (
            <Button
              key={target}
              size="sm"
              variant={pending === target ? 'default' : 'outline'}
              className="h-7 text-xs"
              onClick={() => setPending(pending === target ? null : target)}
            >
              {target}
            </Button>
          ))}
        </div>
      )}

      {pending && (
        <div className="space-y-2">
          <Textarea
            rows={2}
            className="text-xs"
            placeholder={pending === 'Withdrawn' ? 'Withdrawal reason (required)' : 'Reason / notes (optional)'}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={transition.isPending || (pending === 'Withdrawn' && !reason.trim())}
            onClick={submitTransition}
          >
            {transition.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Move to {pending}
          </Button>
        </div>
      )}

      <div className="border-t border-border/30 pt-2 space-y-2">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Severity change</p>
        <div className="flex gap-2 items-start">
          <Select value={severity} onValueChange={setSeverity}>
            <SelectTrigger className="h-7 w-36 text-xs"><SelectValue placeholder="New severity" /></SelectTrigger>
            <SelectContent>
              {SEVERITIES.filter((s) => s !== finding?.severity && s !== finding?.risk_rating).map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            rows={1}
            className="text-xs flex-1"
            placeholder="Justification (required)"
            value={severityReason}
            onChange={(e) => setSeverityReason(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={!severity || !severityReason.trim() || changeSeverity.isPending}
            onClick={submitSeverity}
          >
            {changeSeverity.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Apply
          </Button>
        </div>

        {history.length > 0 && (
          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <History className="h-3 w-3" /> Severity history
            </p>
            {history.map((h: any) => (
              <div key={h.id} className="text-[11px] text-muted-foreground">
                {h.old_severity || '—'} → <span className="text-foreground">{h.new_severity}</span>
                {h.changed_at && <> · {formatDateForDisplay(h.changed_at)}</>}
                {h.reason && <> · {h.reason}</>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
