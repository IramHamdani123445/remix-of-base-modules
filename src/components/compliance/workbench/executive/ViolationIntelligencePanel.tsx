/**
 * Violation intelligence — open violations by type and by age bucket,
 * sourced from module-wide summary views.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PieChart as PieIcon } from 'lucide-react';
import { useViolationMix } from '@/hooks/compliance/useExecutiveWorkbench';

const AGE_COLORS = [
  'hsl(142, 60%, 40%)',
  'hsl(90, 55%, 42%)',
  'hsl(45, 85%, 45%)',
  'hsl(25, 85%, 50%)',
  'hsl(0, 72%, 50%)',
];

function Unavailable({ label }: { label: string }) {
  return (
    <p className="py-10 text-center text-sm text-muted-foreground">
      {label} could not be loaded — this is not an empty result.
    </p>
  );
}

export function ViolationIntelligencePanel() {
  const { types, ageing } = useViolationMix();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <PieIcon className="h-4 w-4 text-primary" />
          Violation Mix &amp; Ageing
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Module-wide open violations. Not affected by the date filter.
        </p>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">By violation type</p>
          {types.isLoading ? (
            <Skeleton className="h-56 w-full" />
          ) : types.isError ? (
            <Unavailable label="Violations by type" />
          ) : (types.data || []).length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No open violations.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={224}>
              <BarChart
                data={types.data}
                layout="vertical"
                margin={{ left: 8, right: 16, top: 4, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis
                  type="category"
                  dataKey="type_name"
                  width={140}
                  tick={{ fontSize: 11 }}
                />
                <RTooltip />
                <Bar dataKey="open_count" fill="hsl(var(--primary))" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Ageing of open violations</p>
          {ageing.isLoading ? (
            <Skeleton className="h-56 w-full" />
          ) : ageing.isError ? (
            <Unavailable label="Violation ageing" />
          ) : (ageing.data || []).length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No open violations.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={224}>
              <BarChart data={ageing.data} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <RTooltip />
                <Bar dataKey="open_count" radius={[3, 3, 0, 0]}>
                  {(ageing.data || []).map((_, i) => (
                    <Cell key={i} fill={AGE_COLORS[i % AGE_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
