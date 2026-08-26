import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { TrendingUp, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { DASHBOARD_QUERY_KEYS, fetchContributionTrend } from '@/services/dashboardDataService';

const formatValue = (value: number) => `$${(value / 1000000).toFixed(1)}M`;

export function ContributionTrendChart({ onTitleClick }: { onTitleClick?: () => void } = {}) {
  const { data: trendData, isLoading } = useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.contributionTrend,
    queryFn: fetchContributionTrend,
  });

  const chartData = (trendData ?? []).map(d => ({
    month: d.month,
    contributions: Number(d.contributions),
    benefits: Number(d.benefits),
  }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle
          className={`flex items-center gap-2 text-base font-medium ${onTitleClick ? 'cursor-pointer hover:text-primary transition-colors' : ''}`}
          onClick={onTitleClick}
          role={onTitleClick ? 'button' : undefined}
          tabIndex={onTitleClick ? 0 : undefined}
          onKeyDown={onTitleClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTitleClick(); } } : undefined}
        >
          <TrendingUp className="h-5 w-5 text-primary" />
          Contributions vs Benefits Paid
        </CardTitle>
        <p className="text-xs text-muted-foreground">Monthly trend – last 12 months (EC$)</p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-[280px] flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
            No contribution data available
          </div>
        ) : (
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradContrib" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(153 73% 21%)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(153 73% 21%)" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gradBenefits" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(217 91% 60%)" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="hsl(217 91% 60%)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(214 20% 91%)" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(217 10% 50%)" />
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(217 10% 50%)" tickFormatter={formatValue} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(0 0% 100%)',
                    border: '1px solid hsl(214 20% 91%)',
                    borderRadius: '8px',
                    fontSize: '13px',
                  }}
                  formatter={(val: number) => [formatValue(val), undefined]}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                <Area
                  type="monotone"
                  dataKey="contributions"
                  name="Contributions"
                  stroke="hsl(153 73% 21%)"
                  strokeWidth={2}
                  fill="url(#gradContrib)"
                />
                <Area
                  type="monotone"
                  dataKey="benefits"
                  name="Benefits Paid"
                  stroke="hsl(217 91% 60%)"
                  strokeWidth={2}
                  fill="url(#gradBenefits)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
