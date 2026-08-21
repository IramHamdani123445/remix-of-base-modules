import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Heart, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { DASHBOARD_QUERY_KEYS, fetchBenefitsDistribution } from '@/services/dashboardDataService';

const barColors = [
  'hsl(217 91% 60%)',
  'hsl(280 60% 55%)',
  'hsl(153 73% 21%)',
  'hsl(44 90% 57%)',
  'hsl(2 74% 50%)',
  'hsl(144 65% 34%)',
  'hsl(30 80% 55%)',
];

export function BenefitsDistribution({ onTitleClick }: { onTitleClick?: () => void } = {}) {
  const { data: rawData, isLoading } = useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.benefitsDistribution,
    queryFn: fetchBenefitsDistribution,
  });

  const chartData = (rawData ?? []).map(d => ({
    type: d.type,
    amount: Number(d.amount) / 1000000, // Convert to millions
    count: Number(d.claim_count),
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
          <Heart className="h-5 w-5 text-primary" />
          Benefits Distribution
        </CardTitle>
        <p className="text-xs text-muted-foreground">EC$ millions by benefit type</p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-[260px] flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">
            No benefits data available
          </div>
        ) : (
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(214 20% 91%)" />
                <XAxis dataKey="type" tick={{ fontSize: 11 }} stroke="hsl(217 10% 50%)" />
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(217 10% 50%)" tickFormatter={(v) => `$${v}M`} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(0 0% 100%)',
                    border: '1px solid hsl(214 20% 91%)',
                    borderRadius: '8px',
                    fontSize: '13px',
                  }}
                  formatter={(val: number) => [`$${val.toFixed(2)}M`, 'Amount']}
                />
                <Bar dataKey="amount" radius={[4, 4, 0, 0]} barSize={36}>
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={barColors[i % barColors.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
