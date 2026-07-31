/**
 * Omnichannel Communications — Health screen.
 *
 * ONE permanent route, three URL-addressable views (`?view=`):
 *   - operational   → live environment diagnostics for the selected tenant
 *   - certification → source-controlled privileged certification evidence
 *   - engineering   → static architecture readiness (registries, rules)
 *
 * Static readiness and live runtime state are never merged, and the screen
 * never executes a certification run.
 */
import React from 'react';
import { Radio } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  OMNI_COMMS_HEALTH_VIEWS,
  useOmniCommsViewParam,
  type OmniCommsHealthView,
} from '@/platform/omni-comms/admin/hooks/useOmniCommsTabParam';
import ReadinessTab from './readiness/ReadinessTab';
import LiveDiagnosticsTab from './health/LiveDiagnosticsTab';
import CertificationEvidenceTab from './health/CertificationEvidenceTab';

export const OmniCommsHealthPage: React.FC = () => {
  const [view, setView] = useOmniCommsViewParam<OmniCommsHealthView>(
    OMNI_COMMS_HEALTH_VIEWS,
    'operational',
  );

  return (
    <div data-testid="omni-comms-health-page" className="space-y-6">
      <header className="flex items-start gap-3">
        <Radio className="mt-1 h-6 w-6 text-primary" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-semibold">Health</h1>
          <p className="text-sm text-muted-foreground">
            Live environment diagnostics, privileged certification evidence and
            static architecture readiness — kept separate.
          </p>
        </div>
      </header>

      <Tabs value={view} onValueChange={setView} className="w-full">
        <TabsList aria-label="Health views">
          <TabsTrigger value="operational" data-testid="omni-comms-health-tab-live">
            Operational health
          </TabsTrigger>
          <TabsTrigger
            value="certification"
            data-testid="omni-comms-health-tab-certification"
          >
            Certification evidence
          </TabsTrigger>
          <TabsTrigger
            value="engineering"
            data-testid="omni-comms-health-tab-engineering"
          >
            Engineering readiness
          </TabsTrigger>
        </TabsList>

        <TabsContent value="operational" className="mt-4">
          <LiveDiagnosticsTab />
        </TabsContent>
        <TabsContent value="certification" className="mt-4">
          <CertificationEvidenceTab />
        </TabsContent>
        <TabsContent value="engineering" className="mt-4">
          <ReadinessTab />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default OmniCommsHealthPage;
