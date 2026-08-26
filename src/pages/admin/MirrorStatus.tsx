import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { CheckCircle2, Clock, Loader2, UserCog, AlertTriangle } from 'lucide-react';
import { mirrorSnapshot, type MirrorStepState } from './mirrorStatusData';

const stateMeta: Record<MirrorStepState, { label: string; icon: React.ElementType; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  done: { label: 'Done', icon: CheckCircle2, variant: 'default' },
  in_progress: { label: 'In progress', icon: Loader2, variant: 'secondary' },
  pending: { label: 'Next up', icon: Clock, variant: 'outline' },
  manual: { label: 'Manual step', icon: UserCog, variant: 'outline' },
  blocked: { label: 'Blocked', icon: AlertTriangle, variant: 'destructive' },
};

const StateBadge: React.FC<{ state: MirrorStepState }> = ({ state }) => {
  const meta = stateMeta[state];
  const Icon = meta.icon;
  return (
    <Badge variant={meta.variant} className="gap-1 whitespace-nowrap">
      <Icon className={`h-3 w-3 ${state === 'in_progress' ? 'animate-spin' : ''}`} />
      {meta.label}
    </Badge>
  );
};

const MirrorStatus: React.FC = () => {
  const { steps, verification, capturedAt, sourceLabel, targetLabel } = mirrorSnapshot;
  const completed = steps.filter((s) => s.state === 'done').length;
  const overall = Math.round((completed / steps.length) * 100);

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Database mirror status</h1>
        <p className="text-sm text-muted-foreground">
          Temporary internal page tracking the one-off copy from {sourceLabel} to {targetLabel}. Remove this page once
          the mirror is signed off.
        </p>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Overall progress</CardTitle>
          <CardDescription>
            {completed} of {steps.length} stages complete · snapshot captured {new Date(capturedAt).toLocaleString()}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Progress value={overall} />
          <p className="text-xs text-muted-foreground">
            Figures are refreshed by the migration operator; this page does not connect to the target project.
          </p>
        </CardContent>
      </Card>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Work items</h2>
        {steps.map((step) => (
          <Card key={step.id}>
            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-3">
              <div className="space-y-1">
                <CardTitle className="text-base">{step.title}</CardTitle>
                <CardDescription>{step.detail}</CardDescription>
              </div>
              <StateBadge state={step.state} />
            </CardHeader>
            <CardContent className="space-y-3">
              {typeof step.progress === 'number' && <Progress value={step.progress} />}
              {step.metrics && step.metrics.length > 0 && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {step.metrics.map((m) => (
                    <div key={m.label} className="rounded-md border bg-muted/40 p-2">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{m.label}</p>
                      <p className="text-sm font-medium">{m.value}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </section>

      <Separator />

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Verification checklist</h2>
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="p-3 font-medium">Check</th>
                    <th className="p-3 font-medium">Expected</th>
                    <th className="p-3 font-medium">Observed</th>
                    <th className="p-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {verification.map((row) => (
                    <tr key={row.id} className="border-t">
                      <td className="p-3">{row.check}</td>
                      <td className="p-3 text-muted-foreground">{row.expected}</td>
                      <td className="p-3 text-muted-foreground">{row.observed}</td>
                      <td className="p-3">
                        <StateBadge state={row.state} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
};

export default MirrorStatus;
