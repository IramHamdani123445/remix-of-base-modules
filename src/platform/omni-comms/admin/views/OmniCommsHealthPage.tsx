/**
 * Omnichannel Communications — Health page.
 *
 * Renders a tabbed shell whose only tab in Story 2 is Readiness. The
 * Readiness tab consumes the source-controlled readiness manifest and does
 * NOT reach out to providers, queues, communication runtime tables, Legacy
 * tables, or monitoring backends.
 */
import React from 'react';
import { Radio } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ReadinessTab from './readiness/ReadinessTab';

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
            Omnichannel Communications — architecture and implementation readiness.
          </p>
        </div>
      </header>

      <Tabs defaultValue="readiness" className="w-full">
        <TabsList aria-label="Health tabs">
          <TabsTrigger value="readiness">Readiness</TabsTrigger>
        </TabsList>
        <TabsContent value="readiness" className="mt-4">
          <ReadinessTab />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default OmniCommsHealthPage;
