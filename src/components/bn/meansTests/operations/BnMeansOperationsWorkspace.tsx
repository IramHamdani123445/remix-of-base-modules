/**
 * BN Means-Test — EPIC 13 operations workspace.
 *
 * Brings the operational overview, every governed queue, cross-assessment
 * search and management reporting together behind one navigation surface.
 */
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import BnMeansOperationalOverview from '@/components/bn/meansTests/operations/BnMeansOperationalOverview';
import BnMeansWorkQueue from '@/components/bn/meansTests/operations/BnMeansWorkQueue';
import BnMeansReports from '@/components/bn/meansTests/operations/BnMeansReports';
import {
  BN_MEANS_QUEUE_GROUPS,
  meansQueueLabel,
  type BnMeansOperationalQueueCode,
} from '@/types/bn/meansTests/meansOperations';

export interface BnMeansOperationsWorkspaceProps {
  onOpen: (assessmentId: string, section?: string | null) => void;
  canAssign?: boolean;
  actionsEnabled?: boolean;
}

export const BnMeansOperationsWorkspace: React.FC<BnMeansOperationsWorkspaceProps> = ({
  onOpen,
  canAssign = false,
  actionsEnabled = false,
}) => {
  const [view, setView] = React.useState('overview');
  const [queue, setQueue] = React.useState<BnMeansOperationalQueueCode>('MY_WORK');

  const openQueue = (code: BnMeansOperationalQueueCode) => {
    setQueue(code);
    setView('queues');
  };

  return (
    <div className="space-y-4" data-testid="means-operations-workspace">
      <Tabs value={view} onValueChange={setView}>
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="queues">Queues</TabsTrigger>
          <TabsTrigger value="search">Search</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-4">
          <BnMeansOperationalOverview onOpenQueue={openQueue} />
        </TabsContent>

        <TabsContent value="queues" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Queue</CardTitle>
              <CardDescription>
                Currently showing <strong>{meansQueueLabel(queue)}</strong>.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {BN_MEANS_QUEUE_GROUPS.map((group) => (
                <div key={group.code} className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground">{group.label}</p>
                  <div className="flex flex-wrap gap-2">
                    {group.queues.map((code) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => setQueue(code)}
                        aria-pressed={queue === code}
                        data-testid={`means-ops-queue-chip-${code}`}
                        className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                          queue === code
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'hover:border-primary hover:bg-accent/40'
                        }`}
                      >
                        {meansQueueLabel(code)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <BnMeansWorkQueue
            queueCode={queue}
            onOpen={onOpen}
            canAssign={canAssign}
            actionsEnabled={actionsEnabled}
          />
        </TabsContent>

        <TabsContent value="search" className="pt-4">
          <BnMeansWorkQueue
            queueCode="SEARCH"
            onOpen={onOpen}
            canAssign={canAssign}
            actionsEnabled={actionsEnabled}
            description="Search every assessment, including closed and superseded work."
          />
        </TabsContent>

        <TabsContent value="reports" className="pt-4">
          <BnMeansReports />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default BnMeansOperationsWorkspace;
