import { Card, CardContent } from '@/components/ui/card';
import { DollarSign, TrendingUp, TrendingDown, Wallet, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { DASHBOARD_QUERY_KEYS, fetchFinancialSummary } from '@/services/dashboardDataService';

function formatCurrency(val: number): string {
  const abs = Math.abs(val);
  if (abs >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val.toFixed(0)}`;
}

export function FinancialSummaryStrip() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.financialSummary,
    queryFn: fetchFinancialSummary,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4 flex items-center justify-center h-[80px]">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const financials = [
    { label: 'Monthly Contributions', value: formatCurrency(Number(data?.monthly_contributions ?? 0)), icon: DollarSign, route: '/c3-management/c3-contribution' },
    { label: 'Benefits Paid (MTD)', value: formatCurrency(Number(data?.benefits_paid_mtd ?? 0)), icon: TrendingDown, route: '/bn/claims' },
    { label: 'Net Fund Surplus', value: formatCurrency(Number(data?.net_surplus ?? 0)), icon: TrendingUp, route: '/reports/cashier' },
    { label: 'Outstanding Arrears', value: formatCurrency(Number(data?.outstanding_arrears ?? 0)), icon: Wallet, route: '/compliance/reports/arrears' },
  ];

  return (
    <Card>
      <CardContent className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {financials.map((f, i) => (
            <div
              key={i}
              className="flex items-center gap-3 cursor-pointer rounded-md p-1.5 -m-1.5 hover:bg-muted/60 transition-colors"
              onClick={() => navigate(f.route)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(f.route); } }}
            >
              <div className="p-2 rounded-lg bg-primary/10">
                <f.icon className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground leading-none">{f.label}</p>
                <p className="text-lg font-bold text-foreground mt-0.5">{f.value}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
