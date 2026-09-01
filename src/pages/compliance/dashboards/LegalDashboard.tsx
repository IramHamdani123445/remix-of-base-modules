/**
 * Compliance Legal Performance, Progress & Strategy Workbench.
 *
 * All analytics come from the server-side ce_legal_workbench_analytics RPC so
 * the page performs one aggregate call per range/scope instead of pulling raw
 * legal datasets into the browser. Errors are surfaced as "Unavailable" —
 * never silently rendered as zero.
 */
import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  AlertTriangle, CalendarClock, DollarSign, FileText, Gavel, Inbox,
  RefreshCw, Scale, ShieldAlert, TrendingUp,
} from 'lucide-react';
import {
  useLegalWorkbenchAnalytics, pctDelta,
} from '@/hooks/compliance/useLegalWorkbenchAnalytics';
import { useActionPermissions } from '@/hooks/useActionPermission';
import {
  ComplianceEscalationWorkflowStrip, LegalAgeingPanel, LegalArrangementHealth,
  LegalAttentionQueue, LegalCourtForecast, LegalKpiCard, LegalOfficerWorkload,
  LegalOutcomesPanel, LegalPipelinePanel, LegalPriorityMatters, LegalRangeSelector,
  LegalRecoveryPanel, LegalReferralQualityPanel, LegalRepeatEscalations,
  LegalTimelinessPanel, LegalTrendChart, LegalUpcomingHearings, fmtCurrency, fmtNum,
  type KpiSpec,
} from '@/components/compliance/legal/analytics/LegalWorkbenchPanels';

const LegalDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { isAdmin, can } = useActionPermissions('manage_compliance');

  // Managers / admins see the whole legal portfolio; officers default to their own matters.
  const isOversight = isAdmin || can('approve') || can('manage');
  const [scopeMine, setScopeMine] = React.useState(!isOversight);
  React.useEffect(() => { setScopeMine(!isOversight); }, [isOversight]);

  const {
    data, isLoading, isFetching, unavailable, error, refetch, rangeKey, setRangeKey,
  } = useLegalWorkbenchAnalytics({ scopeMine });

  const k = data?.kpis;

  const kpis: KpiSpec[] = useMemo(() => [
    {
      label: 'Awaiting Legal Acceptance', value: fmtNum(k?.awaiting_legal_acceptance), icon: Inbox, tone: 'warning',
      hint: `${fmtNum(k?.pending_recommendations)} recommended · ${fmtNum(k?.pending_referral_approval)} awaiting approval`,
      onClick: () => navigate('/compliance/enforcement/legal-queue'),
    },
    {
      label: 'Active Legal Cases', value: fmtNum(k?.active_cases), icon: Gavel, tone: 'primary',
      hint: `${fmtNum(k?.cases_opened_period)} opened · ${fmtNum(k?.cases_closed_period)} closed in period`,
      delta: pctDelta(k?.cases_opened_period, k?.cases_opened_prev),
      onClick: () => navigate('/compliance/enforcement/proceedings'),
    },
    {
      label: 'Overdue Legal Actions', value: fmtNum((k?.overdue_next_actions ?? 0) + (k?.hearings_overdue ?? 0)),
      icon: ShieldAlert, tone: 'destructive',
      hint: `${fmtNum(k?.overdue_next_actions)} next actions · ${fmtNum(k?.hearings_overdue)} hearings past due`,
      invertDelta: true,
    },
    {
      label: 'Hearings Next 30 Days', value: fmtNum(k?.hearings_30d), icon: CalendarClock, tone: 'warning',
      hint: `${fmtNum(k?.hearings_today)} today · ${fmtNum(k?.hearings_7d)} within 7 days`,
      onClick: () => navigate('/compliance/enforcement/proceedings'),
    },
    {
      label: 'Amount Under Legal Recovery', value: fmtCurrency(k?.amount_under_legal), icon: Scale, tone: 'muted',
      hint: `${fmtCurrency(k?.amount_pending_referral)} pending referral`,
    },
    {
      label: 'Recovered in Period', value: fmtCurrency(k?.recovered_period), icon: DollarSign, tone: 'success',
      hint: 'Allocated against legal liabilities',
      delta: pctDelta(k?.recovered_period, k?.recovered_prev),
    },
    {
      label: 'Referrals Received', value: fmtNum(k?.referrals_period), icon: TrendingUp, tone: 'primary',
      hint: 'Submitted by Compliance in period',
      delta: pctDelta(k?.referrals_period, k?.referrals_prev),
      onClick: () => navigate('/compliance/enforcement/recommendation-queue'),
    },
    {
      label: 'Awaiting Enforcement', value: fmtNum(k?.awaiting_enforcement), icon: FileText, tone: 'warning',
      hint: 'Judgment obtained, enforcement outstanding',
      onClick: () => navigate('/compliance/enforcement/proceedings'),
    },
  ], [k, navigate]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Gavel className="h-6 w-6 text-primary" />
            <h1 className="text-3xl font-semibold text-foreground">Legal Performance Workbench</h1>
          </div>
          <p className="text-muted-foreground">
            Referral intake, case progression, court workload, outcomes and recovery across the
            Compliance-to-Legal lifecycle
          </p>
          {data?.generated_at && (
            <p className="text-[11px] text-muted-foreground">
              Aggregated {new Date(data.generated_at).toLocaleString()} · {data.range.from} to {data.range.to}
              {scopeMine ? ' · my matters' : ' · all legal matters'}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LegalRangeSelector value={rangeKey} onChange={setRangeKey} />
          <div className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5">
            <Switch id="scope-mine" checked={scopeMine} onCheckedChange={setScopeMine} />
            <Label htmlFor="scope-mine" className="text-xs cursor-pointer">My matters only</Label>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? 'animate-spin' : ''}`} />Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/compliance/enforcement/legal-queue')}>
            <Scale className="h-4 w-4 mr-1" />Referral Queue
          </Button>
          <Button size="sm" onClick={() => navigate('/compliance/enforcement/proceedings')}>
            <Gavel className="h-4 w-4 mr-1" />Proceedings
          </Button>
        </div>
      </div>

      <ComplianceEscalationWorkflowStrip workflow={data?.workflow ?? []} isLoading={isLoading} />

      {unavailable && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Legal analytics could not be produced{error instanceof Error ? `: ${error.message}` : ''}.
            Figures below are shown as unavailable rather than zero.
          </AlertDescription>
        </Alert>
      )}

      {/* KPI band */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpis.map(kpi => (
          <LegalKpiCard key={kpi.label} kpi={kpi} isLoading={isLoading} unavailable={unavailable} />
        ))}
      </div>

      {/* Attention queue */}
      <LegalAttentionQueue
        items={data?.attention ?? []}
        isLoading={isLoading}
        unavailable={unavailable}
        onOpen={link => navigate(link)}
      />

      {/* Trend + pipeline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <LegalTrendChart data={data?.trend ?? []} grain={data?.grain ?? 'week'} isLoading={isLoading} unavailable={unavailable} />
        <LegalPipelinePanel
          data={data?.pipeline ?? []}
          isLoading={isLoading}
          unavailable={unavailable}
          onDrill={stage => navigate(
            stage.lane === 'COMPLIANCE'
              ? '/compliance/enforcement/legal-queue'
              : `/compliance/enforcement/proceedings?stage=${encodeURIComponent(stage.stage_code)}`,
          )}
        />
      </div>

      {/* Ageing + timeliness */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <LegalAgeingPanel
          ageing={data?.ageing ?? { buckets: [], avg_days: null, median_days: null, oldest: null }}
          isLoading={isLoading}
          unavailable={unavailable}
          onDrill={bucket => navigate(`/compliance/enforcement/proceedings?age=${encodeURIComponent(bucket)}`)}
        />
        <LegalTimelinessPanel t={data?.timeliness as never} isLoading={isLoading} unavailable={unavailable} />
      </div>

      {/* Court workload */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <LegalCourtForecast
          hearings={data?.hearings as never}
          kpis={data?.kpis as never}
          isLoading={isLoading}
          unavailable={unavailable}
          onDrill={() => navigate('/compliance/enforcement/proceedings')}
        />
        <LegalUpcomingHearings
          hearings={data?.hearings as never}
          isLoading={isLoading}
          unavailable={unavailable}
          onOpen={() => navigate('/compliance/enforcement/proceedings')}
        />
      </div>

      {/* Outcomes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <LegalOutcomesPanel outcomes={data?.outcomes as never} isLoading={isLoading} unavailable={unavailable} />
        <LegalReferralQualityPanel outcomes={data?.outcomes as never} isLoading={isLoading} unavailable={unavailable} />
      </div>

      {/* Recovery */}
      <LegalRecoveryPanel recovery={data?.recovery as never} isLoading={isLoading} unavailable={unavailable} />

      {/* Arrangements + officers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <LegalArrangementHealth
          arr={data?.arrangements as never}
          isLoading={isLoading}
          unavailable={unavailable}
          onDrill={() => navigate('/compliance/enforcement/arrangements')}
        />
        {isOversight ? (
          <LegalOfficerWorkload items={data?.officers ?? []} isLoading={isLoading} unavailable={unavailable} />
        ) : (
          <LegalRepeatEscalations
            items={data?.repeats ?? []}
            isLoading={isLoading}
            unavailable={unavailable}
            onOpenEmployer={id => navigate(`/compliance/employers/${encodeURIComponent(id)}`)}
          />
        )}
      </div>

      {/* Priority matters */}
      <LegalPriorityMatters
        items={data?.priority_matters ?? []}
        isLoading={isLoading}
        unavailable={unavailable}
        onOpenCase={() => navigate('/compliance/enforcement/proceedings')}
        onOpenEmployer={id => navigate(id ? `/compliance/employers/${encodeURIComponent(id)}` : '/compliance/employers')}
      />

      {isOversight && (
        <LegalRepeatEscalations
          items={data?.repeats ?? []}
          isLoading={isLoading}
          unavailable={unavailable}
          onOpenEmployer={id => navigate(`/compliance/employers/${encodeURIComponent(id)}`)}
        />
      )}

      {!isLoading && !unavailable && !data?.attention?.length && !data?.priority_matters?.length && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">Portfolio clear</Badge>
          No legal matters currently require action in this scope.
        </div>
      )}
    </div>
  );
};

export default LegalDashboard;
