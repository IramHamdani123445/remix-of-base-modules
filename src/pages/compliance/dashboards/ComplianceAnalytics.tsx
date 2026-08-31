/**
 * Compliance Intelligence & Trend Analysis Workspace
 * (/compliance/workbench/analytics).
 *
 * Longitudinal analysis — trends, segmentation and effectiveness — distinct
 * from the Executive Workbench (current state) and the operational dashboards.
 * Every figure comes from the server-aggregated ce_compliance_analytics_v1 RPC;
 * failures are surfaced as "Unavailable" rather than rendered as zero.
 */
import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertTriangle, Activity, BarChart3, DollarSign, Gauge, RefreshCw,
  ShieldAlert, Timer, TrendingUp, Users,
} from 'lucide-react';
import {
  useComplianceAnalytics, pctDelta, ppDelta,
} from '@/hooks/compliance/useComplianceAnalytics';
import { ComplianceExport } from '@/components/compliance/analytics/ComplianceExport';
import {
  AnalyticsFilterBar, AnalyticsKpiCard, ArrearsPanel, C3BehaviourPanel,
  EnforcementActivityPanel, ImprovingEmployersPanel, KeyObservations,
  PaymentBehaviourPanel, PersistentEmployersPanel, ResolutionEffectivenessPanel,
  RiskPanel, SegmentComparisonPanel, ViolationFlowPanel, ViolationTypeTrendPanel,
  fmtCurrency, fmtNum, fmtPct, type AnalyticsKpi,
} from '@/components/compliance/analytics/workspace/ComplianceAnalyticsPanels';

export default function ComplianceAnalytics() {
  const navigate = useNavigate();
  const {
    data, isLoading, isFetching, unavailable, error, refetch,
    rangeKey, setRangeKey, filters, setFilters, clearFilters, activeFilterCount, availability,
  } = useComplianceAnalytics();

  const k = data?.kpis;

  const kpis: AnalyticsKpi[] = useMemo(() => [
    {
      label: 'Violations Raised', value: fmtNum(k?.violations_new), icon: BarChart3, tone: 'primary',
      hint: `${fmtNum(k?.violations_new_prev)} in previous window`,
      definition: 'Violations discovered within the selected window (excludes deleted and merged records).',
      delta: pctDelta(k?.violations_new, k?.violations_new_prev), invertDelta: true,
      onClick: () => navigate('/compliance/violations'),
    },
    {
      label: 'Violations Resolved', value: fmtNum(k?.violations_resolved), icon: Activity, tone: 'success',
      hint: `${fmtNum(k?.violations_resolved_prev)} in previous window`,
      definition: 'Violations whose resolution date falls inside the selected window.',
      delta: pctDelta(k?.violations_resolved, k?.violations_resolved_prev),
    },
    {
      label: 'Resolution Rate', value: fmtPct(k?.resolution_rate), icon: Gauge, tone: 'primary',
      hint: `${fmtNum(k?.resolution_numerator)} resolved / ${fmtNum(k?.resolution_denominator)} raised`,
      definition: 'Resolved in window ÷ raised in window, expressed as a percentage.',
      delta: ppDelta(k?.resolution_rate, k?.resolution_rate_prev), deltaSuffix: 'pp',
    },
    {
      label: 'Avg Days to Resolve', value: k?.avg_resolution_days != null ? `${k.avg_resolution_days}` : '—',
      icon: Timer, tone: 'warning',
      hint: k?.avg_resolution_days_prev != null ? `${k.avg_resolution_days_prev} previously` : 'No prior baseline',
      definition: 'Mean of resolved_at minus discovered_date for violations closed in the window.',
      delta: pctDelta(k?.avg_resolution_days, k?.avg_resolution_days_prev), invertDelta: true,
    },
    {
      label: 'Open Violations', value: fmtNum(k?.violations_open), icon: ShieldAlert, tone: 'destructive',
      hint: `${fmtNum(k?.violations_overdue)} open beyond 30 days`,
      definition: 'Violations currently in Open, In Progress, Under Review or Escalated status.',
      onClick: () => navigate('/compliance/violations'),
    },
    {
      label: 'Outstanding Balance', value: fmtCurrency(k?.total_outstanding), icon: DollarSign, tone: 'muted',
      hint: `${fmtNum(k?.employers_in_arrears)} employers in arrears`,
      definition: 'Total outstanding across the filtered employer set (compliance arrears summary).',
      onClick: () => navigate('/compliance/reports'),
    },
    {
      label: 'Employers with Violations', value: fmtNum(k?.employers_with_violations), icon: Users, tone: 'warning',
      hint: `of ${fmtNum(k?.employers_in_scope)} employers in scope`,
      definition: 'Distinct employers with at least one violation raised in the window.',
    },
    {
      label: 'High / Critical Risk', value: fmtNum(k?.high_risk_employers), icon: TrendingUp, tone: 'destructive',
      hint: `${fmtNum(k?.risk_profiles)} scored · avg score ${k?.avg_risk_score ?? '—'}`,
      definition: 'Employers whose current (or overridden) risk band is High or Critical.',
      onClick: () => navigate('/compliance/risk'),
    },
  ], [k, navigate]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <PageHeader
          title="Compliance Intelligence & Trend Analysis"
          subtitle="Longitudinal compliance performance, behaviour, risk migration and segmentation"
          breadcrumbs={[
            { label: 'Compliance', href: '/compliance' },
            { label: 'Analytics' },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? 'animate-spin' : ''}`} />Refresh
          </Button>
          <ComplianceExport />
        </div>
      </div>

      {data?.generated_at && (
        <p className="text-[11px] text-muted-foreground">
          Aggregated {new Date(data.generated_at).toLocaleString()} · {data.range.from} to {data.range.to}
          {' '}· compared against {data.range.prev_from} to {data.range.prev_to}
        </p>
      )}

      <AnalyticsFilterBar
        rangeKey={rangeKey}
        onRangeChange={setRangeKey}
        filters={filters}
        onFiltersChange={setFilters}
        onClear={clearFilters}
        options={data?.options}
        activeFilterCount={activeFilterCount}
      />

      {unavailable && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Compliance analytics could not be produced{error instanceof Error ? `: ${error.message}` : ''}.
            Figures below are shown as unavailable rather than zero.
          </AlertDescription>
        </Alert>
      )}

      {/* Outcome */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpis.map(kpi => (
          <AnalyticsKpiCard key={kpi.label} kpi={kpi} isLoading={isLoading} unavailable={unavailable} />
        ))}
      </div>

      {/* Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <ViolationFlowPanel
          data={data?.violation_flow ?? []}
          isLoading={isLoading}
          unavailable={unavailable}
          onDrill={() => navigate('/compliance/violations')}
          className="lg:col-span-2"
        />
        <ViolationTypeTrendPanel
          data={data?.violation_type_trend ?? []}
          isLoading={isLoading}
          unavailable={unavailable}
          onSelect={code => setFilters({ ...filters, violationType: code })}
        />
      </div>

      <KeyObservations data={data} isLoading={isLoading} unavailable={unavailable} />

      {/* Cause — filing and payment behaviour */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <C3BehaviourPanel
          data={data?.c3_behaviour ?? []}
          missing={data?.c3_missing ?? []}
          isLoading={isLoading}
          unavailable={unavailable}
          availability={availability.c3}
        />
        <PaymentBehaviourPanel
          data={data?.payment_behaviour ?? []}
          isLoading={isLoading}
          unavailable={unavailable}
          availability={availability.payments}
        />
      </div>

      <ArrearsPanel
        trend={data?.arrears_trend ?? []}
        top={data?.arrears_top ?? []}
        isLoading={isLoading}
        unavailable={unavailable}
        availability={availability.arrears}
        onOpenEmployer={id => navigate(`/compliance/employers/${encodeURIComponent(id)}`)}
      />

      <RiskPanel
        bands={data?.risk_bands ?? []}
        migration={data?.risk_migration ?? []}
        drivers={data?.risk_drivers as never}
        isLoading={isLoading}
        unavailable={unavailable}
        migrationAvailability={availability.risk_migration}
      />

      <ResolutionEffectivenessPanel
        resolution={data?.resolution_time as never}
        isLoading={isLoading}
        unavailable={unavailable}
      />

      <EnforcementActivityPanel
        inspections={data?.inspections as never}
        arrangements={data?.arrangements as never}
        legal={data?.legal_trend ?? []}
        availability={availability}
        isLoading={isLoading}
        unavailable={unavailable}
        onDrill={path => navigate(path)}
      />

      {/* Segmentation */}
      <SegmentComparisonPanel
        zones={data?.zone_comparison ?? []}
        sectors={data?.sector_comparison ?? []}
        sizes={data?.size_comparison ?? []}
        isLoading={isLoading}
        unavailable={unavailable}
        onSelectZone={seg => setFilters({ ...filters, zone: seg })}
        onSelectSector={seg => setFilters({ ...filters, sector: seg })}
        onSelectSize={seg => setFilters({ ...filters, sizeTier: seg })}
      />

      {/* Watchlists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PersistentEmployersPanel
          items={data?.persistent_employers ?? []}
          isLoading={isLoading}
          unavailable={unavailable}
          onOpenEmployer={id => navigate(`/compliance/employers/${encodeURIComponent(id)}`)}
        />
        <ImprovingEmployersPanel
          items={data?.improving_employers ?? []}
          isLoading={isLoading}
          unavailable={unavailable}
          onOpenEmployer={id => navigate(`/compliance/employers/${encodeURIComponent(id)}`)}
        />
      </div>
    </div>
  );
}
