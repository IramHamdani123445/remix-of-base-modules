/**
 * Financial exposure — arrears, penalties/interest and arrangement health.
 * Amounts come from existing compliance ledger/arrangement views only.
 */
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Wallet } from 'lucide-react';
import { MetricValue } from './MetricValue';
import { useFinancialExposure, type MetricResult } from '@/hooks/compliance/useExecutiveWorkbench';

const res = (
  query: { isError: boolean; isSuccess: boolean },
  value: number | undefined,
): MetricResult<number> =>
  query.isError || !query.isSuccess ? { status: 'unavailable' } : { status: 'ok', value: value ?? 0 };

export function FinancialExposurePanel() {
  const { outstanding, arrangements } = useFinancialExposure();

  const rows = [
    {
      key: 'principal',
      label: 'Principal arrears',
      hint: 'Outstanding contributions',
      result: res(outstanding, outstanding.data?.principal),
      isLoading: outstanding.isLoading,
      format: 'currency' as const,
    },
    {
      key: 'penalty',
      label: 'Penalties outstanding',
      hint: 'Statutory penalties not yet paid',
      result: res(outstanding, outstanding.data?.penalty),
      isLoading: outstanding.isLoading,
      format: 'currency' as const,
    },
    {
      key: 'interest',
      label: 'Interest outstanding',
      hint: 'Accrued interest not yet paid',
      result: res(outstanding, outstanding.data?.interest),
      isLoading: outstanding.isLoading,
      format: 'currency' as const,
    },
    {
      key: 'total',
      label: 'Total exposure',
      hint: `Across ${outstanding.data?.employers ?? 0} employers`,
      result: res(outstanding, outstanding.data?.total),
      isLoading: outstanding.isLoading,
      format: 'currency' as const,
    },
    {
      key: 'under-arrangement',
      label: 'Under arrangement',
      hint: `${arrangements.data?.activeCount ?? 0} active arrangements`,
      result: res(arrangements, arrangements.data?.underArrangement),
      isLoading: arrangements.isLoading,
      format: 'currency' as const,
    },
    {
      key: 'overdue-instalments',
      label: 'Arrangements with overdue instalments',
      hint: `${arrangements.data?.overdueCount ?? 0} arrangements behind schedule`,
      result: res(arrangements, arrangements.data?.overdueAmount),
      isLoading: arrangements.isLoading,
      format: 'currency' as const,
    },
    {
      key: 'breached',
      label: 'Breached / defaulted exposure',
      hint: `${arrangements.data?.breachedCount ?? 0} arrangements breached`,
      result: res(arrangements, arrangements.data?.breachedAmount),
      isLoading: arrangements.isLoading,
      format: 'currency' as const,
    },
  ];

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet className="h-4 w-4 text-primary" />
          Financial Exposure
        </CardTitle>
        <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
          <Link to="/compliance/reports">Reports</Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((row) => (
          <div
            key={row.key}
            className="flex items-center justify-between gap-3 rounded-md border p-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{row.label}</p>
              <p className="text-[11px] text-muted-foreground">{row.hint}</p>
            </div>
            <MetricValue
              result={row.result}
              isLoading={row.isLoading}
              format={row.format}
              className="text-base font-semibold"
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
