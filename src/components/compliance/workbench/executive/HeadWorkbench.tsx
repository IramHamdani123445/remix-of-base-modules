/**
 * Compliance Executive (Head) Workbench.
 *
 * Answers: what needs my attention, where is compliance deteriorating,
 * what is overdue, what is the financial exposure, and how is the team
 * performing. All figures come from live Compliance data; failed queries
 * render explicit "Unavailable" states rather than misleading zeros.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PageHeader } from '@/components/shared/PageHeader';
import { RefreshCw } from 'lucide-react';
import {
  defaultExecFilters,
  hasActiveFilters,
  useExecutiveKpis,
  type ExecFilters,
} from '@/hooks/compliance/useExecutiveWorkbench';
import { ExecutiveFilterBar } from './ExecutiveFilterBar';
import { ExecutiveKpiStrip } from './ExecutiveKpiStrip';
import { RequiresAttentionPanel } from './RequiresAttentionPanel';
import { EnforcementPipelinePanel } from './EnforcementPipelinePanel';
import { ViolationIntelligencePanel } from './ViolationIntelligencePanel';
import { RiskOverviewPanel } from './RiskOverviewPanel';
import { FinancialExposurePanel } from './FinancialExposurePanel';
import { FieldOperationsPanel } from './FieldOperationsPanel';
import { TeamPerformancePanel } from './TeamPerformancePanel';
import { LegalSnapshotPanel } from './LegalSnapshotPanel';
import { PriorityEmployersTable } from './PriorityEmployersTable';
import { ViolationTrendChart } from '@/components/compliance/analytics/ViolationTrendChart';

interface Props {
  title: string;
  subtitle: string;
}

export default function HeadWorkbench({ title, subtitle }: Props) {
  const [filters, setFilters] = useState<ExecFilters>(defaultExecFilters());
  const { kpis } = useExecutiveKpis(filters);
  const queryClient = useQueryClient();
  const filtered = hasActiveFilters(filters);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PageHeader
            title={title}
            subtitle={subtitle}
            breadcrumbs={[{ label: 'Compliance', href: '/compliance' }, { label: 'Workbench' }]}
            className="mb-0"
          />
          <div className="flex items-center gap-2">
            {filtered && <Badge variant="secondary">Filters applied</Badge>}
            <Button
              variant="outline"
              size="sm"
              onClick={() => queryClient.invalidateQueries({ queryKey: ['ce-exec-attention'] })}
            >
              <RefreshCw className="mr-1 h-4 w-4" /> Refresh
            </Button>
          </div>
        </div>

        <ExecutiveFilterBar filters={filters} onChange={setFilters} />

        <ExecutiveKpiStrip kpis={kpis} />

        <RequiresAttentionPanel filters={filters} />

        <EnforcementPipelinePanel filters={filters} />

        <div className="grid gap-5 xl:grid-cols-2">
          <ViolationTrendChart />
          <RiskOverviewPanel onSelectBand={(band) => setFilters({ ...filters, riskBand: band })} />
        </div>

        <ViolationIntelligencePanel />

        <div className="grid gap-5 xl:grid-cols-2">
          <FinancialExposurePanel />
          <FieldOperationsPanel />
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <TeamPerformancePanel />
          <LegalSnapshotPanel />
        </div>

        <PriorityEmployersTable filters={filters} />
      </div>
    </TooltipProvider>
  );
}
