/**
 * Omni-Comms — guided Go-Live workflow card.
 *
 * Presentation only. It renders the server-derived stage projection and never
 * performs an action itself; every button lives on the card that owns the
 * action it triggers.
 */
import React from 'react';
import { CheckCircle2, CircleDashed, CircleSlash, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { GoLiveStage, GoLiveWorkflow } from './goLiveWorkflow';

const ICON: Record<GoLiveStage['state'], React.ReactNode> = {
  complete: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
  action_required: <CircleDashed className="h-4 w-4 text-amber-600" />,
  blocked: <CircleSlash className="h-4 w-4 text-muted-foreground" />,
  waiting: <Clock className="h-4 w-4 text-muted-foreground" />,
};

const STATE_LABEL: Record<GoLiveStage['state'], string> = {
  complete: 'Done',
  action_required: 'Your action',
  blocked: 'Not yet',
  waiting: 'Second person',
};

export const GoLiveWorkflowCard: React.FC<{ workflow: GoLiveWorkflow }> = ({ workflow }) => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        Go-Live workflow
        <Badge variant="secondary">{workflow.progressLabel}</Badge>
      </CardTitle>
      <CardDescription>
        {workflow.currentStage
          ? `Next: ${workflow.currentStage.title}.`
          : 'Every governance step is complete.'}
        {' '}
        Steps are evaluated server-side; completing one here never relaxes a database gate.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <ol className="space-y-3">
        {workflow.stages.map((stage) => (
          <li key={stage.id} className="flex items-start gap-3 rounded-md border p-3">
            <span className="mt-0.5">{ICON[stage.state]}</span>
            <div className="flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{stage.step}. {stage.title}</span>
                <Badge variant={stage.state === 'complete' ? 'default' : 'outline'}>
                  {STATE_LABEL[stage.state]}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{stage.summary}</p>
              {stage.nextAction && (
                <p className="text-sm">
                  <span className="font-medium">Do this: </span>
                  {stage.nextAction}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </CardContent>
  </Card>
);

export default GoLiveWorkflowCard;
