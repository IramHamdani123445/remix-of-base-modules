/**
 * BN Means-Test — EPIC 13 operational reports.
 *
 * Every figure is produced by `bn_means_operational_report_v1`. React only
 * presents the returned rows and the period the backend actually applied.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, Download, ShieldAlert } from 'lucide-react';
import { meansOperationsService } from '@/services/bn/meansTests/meansOperationsService';
import {
  BN_MEANS_REPORT_CODES,
  BN_MEANS_REPORT_DESCRIPTION,
  BN_MEANS_REPORT_LABEL,
  type BnMeansReportCode,
  type BnMeansReportFilters,
} from '@/types/bn/meansTests/meansOperations';

function toCsv(reportCode: string, rows: readonly { key: string; label: string; count: number }[]) {
  const header = 'key,label,count';
  const body = rows
    .map((r) => `${r.key},"${r.label.replace(/"/g, '""')}",${r.count}`)
    .join('\n');
  const blob = new Blob([`${header}\n${body}\n`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `means-test-${reportCode.toLowerCase()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export const BnMeansReports: React.FC = () => {
  const [reportCode, setReportCode] = React.useState<BnMeansReportCode>('STAGE_DISTRIBUTION');
  const [filters, setFilters] = React.useState<BnMeansReportFilters>({});

  const report = useQuery({
    queryKey: ['bn-means-ops-report', reportCode, filters],
    queryFn: () => meansOperationsService.report(reportCode, filters),
  });

  const payload = report.data?.status === 'OK' ? report.data.data : null;
  const rows = payload?.rows ?? [];
  const totalCount = rows.reduce((sum, r) => sum + (r.count ?? 0), 0);

  return (
    <div className="space-y-4" data-testid="means-ops-reports">
      <Card>
        <CardHeader>
          <CardTitle>Report</CardTitle>
          <CardDescription>
            Management figures for Means-Test operations. Reports are produced by the database, so
            every user with the same permission sees the same numbers.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="means-report-code">Report</Label>
            <select
              id="means-report-code"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={reportCode}
              onChange={(e) => setReportCode(e.target.value as BnMeansReportCode)}
              data-testid="means-report-select"
            >
              {BN_MEANS_REPORT_CODES.map((code) => (
                <option key={code} value={code}>
                  {BN_MEANS_REPORT_LABEL[code]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="means-report-from">Period from</Label>
            <Input
              id="means-report-from"
              type="date"
              value={filters.date_from ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, date_from: e.target.value || undefined }))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="means-report-to">Period to</Label>
            <Input
              id="means-report-to"
              type="date"
              value={filters.date_to ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, date_to: e.target.value || undefined }))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="means-report-programme">Benefit programme</Label>
            <Input
              id="means-report-programme"
              value={filters.benefit_programme ?? ''}
              onChange={(e) =>
                setFilters((f) => ({ ...f, benefit_programme: e.target.value || undefined }))
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>{BN_MEANS_REPORT_LABEL[reportCode]}</CardTitle>
            <CardDescription>
              {BN_MEANS_REPORT_DESCRIPTION[reportCode]}
              {payload && ` Period ${payload.period_from} to ${payload.period_to}.`}
            </CardDescription>
          </div>
          {rows.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => toCsv(reportCode, rows)}
              data-testid="means-report-export"
            >
              <Download className="mr-2 h-4 w-4" /> Export CSV
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {report.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : report.data?.status === 'DENIED' ? (
            <Alert variant="destructive" data-testid="means-report-denied">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Access denied</AlertTitle>
              <AlertDescription>
                You do not hold read permission for Means-Test reporting.
              </AlertDescription>
            </Alert>
          ) : report.isError || (report.data && report.data.status !== 'OK') ? (
            <Alert variant="destructive" data-testid="means-report-failed">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>This report could not be produced</AlertTitle>
              <AlertDescription>
                {report.data?.detail ?? report.data?.code ?? 'Unknown error'}
              </AlertDescription>
            </Alert>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              There is nothing to report for the selected period.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Measure</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead className="text-right">Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>{row.label}</TableCell>
                    <TableCell className="text-right font-medium">{row.count}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {totalCount > 0 ? `${Math.round((row.count / totalCount) * 100)}%` : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default BnMeansReports;
