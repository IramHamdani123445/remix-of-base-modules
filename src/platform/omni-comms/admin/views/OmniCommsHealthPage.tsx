/**
 * Omnichannel Communications — Health page.
 *
 * Two clearly separated views on ONE permanent route:
 *   - Readiness: source-controlled, static architecture/implementation facts.
 *   - Live Diagnostics: actual deployed configuration and runtime state for
 *     the selected organisation (and optional department).
 *
 * Static and live status are never merged.
 */
import React from 'react';
import { Radio } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ReadinessTab from './readiness/ReadinessTab';
import LiveDiagnosticsTab from './health/LiveDiagnosticsTab';

export const OmniCommsHealthPage: React.FC = () => {
  return (
    <div
      data-testid="omni-comms-health-page"
      className="container mx-auto p-6 space-y-6"
    >
      <header className="flex items-start gap-3">
        <Radio className="h-6 w-6 text-primary mt-1" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-semibold">Health</h1>
          <p className="text-sm text-muted-foreground">
            Omnichannel Communications — architecture readiness and live
            environment diagnostics.
          </p>
        </div>
      </header>

      <Tabs defaultValue="readiness" className="w-full">
        <TabsList aria-label="Health tabs">
          <TabsTrigger value="readiness">Readiness</TabsTrigger>
          <TabsTrigger value="live" data-testid="omni-comms-health-tab-live">
            Live Diagnostics
          </TabsTrigger>
        </TabsList>
        <TabsContent value="readiness" className="mt-4">
          <ReadinessTab />
        </TabsContent>
        <TabsContent value="live" className="mt-4">
          <LiveDiagnosticsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default OmniCommsHealthPage;

