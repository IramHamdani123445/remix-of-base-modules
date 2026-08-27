import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Lock, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  usePlanClosureGate,
  useCloseAnnualPlan,
  type PlanDispositionInput,
} from '@/hooks/useAuditClosureCommands';
import { useInternalAuditPermissions } from '@/hooks/useInternalAuditPermissions';

interface Props {
  planId: string;
  plan: any;
}

type Choice = { disposition: '' | 'Cancelled' | 'Carried Forward'; reason: string };

export function PlanClosurePanel({ planId, plan }: Props) {
  const { data: gate, isLoading } = usePlanClosureGate(planId);
  const closePlan = useCloseAnnualPlan();
  const { can } = useInternalAuditPermissions();
  const canClose = can('close_annual_plan');

  const [choices, setChoices] = React.useState<Record<string, Choice>>({});
  const [notes, setNotes] = React.useState('');

  const pending = (gate?.engagements || []).filter((e) => e.disposition_required);
  const summary = plan?.closure_summary;

  const setChoice = (id: string, patch: Partial<Choice>) =>
    setChoices((prev) => ({
      ...prev,
      [id]: { disposition: '', reason: '', ...prev[id], ...patch },
    }));

  const dispositions: PlanDispositionInput[] = pending
    .map((e) => ({ ...choices[e.engagement_id], engagement_id: e.engagement_id }))
    .filter((d): d is PlanDispositionInput => !!d.disposition && !!d.reason?.trim())
    .map((d) => ({ ...d, reason: d.reason.trim() }));

  const allResolved = pending.every((e) =>
    dispositions.some((d) => d.engagement_id === e.engagement_id),
  );

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Checking plan closure readiness...
        </CardContent>
      </Card>
    );
  }

  if (gate?.already_closed) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" /> Plan Closed
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-5 text-sm">
          <Metric label="Planned" value={summary?.planned ?? '—'} />
          <Metric label="Completed" value={summary?.completed ?? '—'} />
          <Metric label="Carried forward" value={summary?.carried_forward ?? '—'} />
          <Metric label="Cancelled" value={summary?.cancelled ?? '—'} />
          <Metric label="Completion rate" value={summary?.completion_rate != null ? `${summary.completion_rate}%` : '—'} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Lock className="h-4 w-4 text-primary" /> Annual Plan Closure
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {pending.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-primary">
            <CheckCircle2 className="h-4 w-4" /> Every audit in this plan carries a final disposition.
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Each audit below needs a disposition before the plan can be closed. Audits that are still
              open must be Cancelled or Carried Forward, each with a reason. Audits ready for closure
              should be closed from their own workspace first.
            </p>
            {pending.map((e) => (
              <div key={e.engagement_id} className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm font-medium">
                    {e.engagement_code ? `${e.engagement_code} — ` : ''}{e.engagement_name || 'Untitled audit'}
                  </span>
                  <Badge variant={e.untouched ? 'destructive' : 'outline'}>{e.execution_status}</Badge>
                </div>
                <div className="grid gap-2 sm:grid-cols-[200px_1fr]">
                  <Select
                    value={choices[e.engagement_id]?.disposition || ''}
                    onValueChange={(v) => setChoice(e.engagement_id, { disposition: v as Choice['disposition'] })}
                  >
                    <SelectTrigger><SelectValue placeholder="Disposition" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Carried Forward">Carried Forward</SelectItem>
                      <SelectItem value="Cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Reason (required)"
                    value={choices[e.engagement_id]?.reason || ''}
                    onChange={(ev) => setChoice(e.engagement_id, { reason: ev.target.value })}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        <Textarea
          rows={3}
          placeholder="Plan closure notes..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        {!canClose && (
          <div className="flex items-center gap-2 text-xs text-amber-600">
            <AlertTriangle className="h-3 w-3" />
            You do not hold the annual plan closure permission.
          </div>
        )}

        <Button
          disabled={!canClose || !allResolved || closePlan.isPending}
          onClick={() => closePlan.mutate({ planId, dispositions, notes: notes || null })}
        >
          {closePlan.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Close Annual Plan
        </Button>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="text-[11px] uppercase text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}
