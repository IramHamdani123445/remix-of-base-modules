import { Building2, Users, FileText, AlertTriangle, Calendar, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { DashboardKPICard } from './widgets/DashboardKPICard';
import { ContributionTrendChart } from './widgets/ContributionTrendChart';
import { ComplianceDonut } from './widgets/ComplianceDonut';
import { RegistrationPipeline } from './widgets/RegistrationPipeline';
import { BenefitsDistribution } from './widgets/BenefitsDistribution';
import { RecentSystemActivity } from './widgets/RecentSystemActivity';
import { QuickActions } from './widgets/QuickActions';
import { AlertsWidget } from './widgets/AlertsWidget';
import { FinancialSummaryStrip } from './widgets/FinancialSummaryStrip';
import { useQuery } from '@tanstack/react-query';
import { DASHBOARD_QUERY_KEYS, fetchAdminKPIs } from '@/services/dashboardDataService';

export const AdminDashboard = () => {
  const navigate = useNavigate();
  const today = new Date();
  const greeting = today.getHours() < 12 ? 'Good Morning' : today.getHours() < 17 ? 'Good Afternoon' : 'Good Evening';

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.adminKpis,
    queryFn: fetchAdminKPIs,
  });

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
        <div>
          <h1 className="text-[26px] font-semibold text-foreground tracking-tight">
            {greeting}, Administrator
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            System overview for {today.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" />
          Last updated: {today.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>

      {/* KPI Row */}
      {kpisLoading ? (
        <div className="flex items-center justify-center h-[100px]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <DashboardKPICard
            title="Total Employers"
            value={(kpis?.total_employers ?? 0).toLocaleString()}
            icon={Building2}
            iconBg="bg-primary/10 text-primary"
            onClick={() => navigate('/employers-management/dashboard')}
          />
          <DashboardKPICard
            title="Insured Persons"
            value={(kpis?.insured_persons ?? 0).toLocaleString()}
            icon={Users}
            iconBg="bg-secondary/15 text-secondary"
            onClick={() => navigate('/bn/person-360')}
          />
          <DashboardKPICard
            title="Active Claims"
            value={(kpis?.active_claims ?? 0).toLocaleString()}
            icon={FileText}
            iconBg="bg-[hsl(217_91%_60%/0.12)] text-[hsl(217_91%_60%)]"
            onClick={() => navigate('/bn/claims')}
          />
          <DashboardKPICard
            title="Compliance Issues"
            value={(kpis?.compliance_issues ?? 0).toLocaleString()}
            icon={AlertTriangle}
            iconBg="bg-destructive/10 text-destructive"
            onClick={() => navigate('/compliance/violations')}
          />
        </div>
      )}

      {/* Financial Summary Strip */}
      <FinancialSummaryStrip />

      {/* Alerts */}
      <AlertsWidget />

      {/* Charts Row 1: Contribution Trend (2/3) + Compliance Donut (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <ContributionTrendChart onTitleClick={() => navigate('/c3-management/reports/payments-history')} />
        </div>
        <div className="lg:col-span-1">
          <ComplianceDonut onTitleClick={() => navigate('/compliance/workbench/analytics')} />
        </div>
      </div>

      {/* Charts Row 2: Registration Pipeline + Benefits Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RegistrationPipeline onTitleClick={() => navigate('/employers-management/manage')} />
        <BenefitsDistribution onTitleClick={() => navigate('/bn/dashboard')} />
      </div>

      {/* Bottom Row: Activity Feed + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <RecentSystemActivity />
        </div>
        <div className="lg:col-span-1">
          <QuickActions />
        </div>
      </div>
    </div>
  );
};
