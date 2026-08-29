import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import ViolationReportShell from './ViolationReportShell';

const fmt = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString());

export default function ViolationResolutionTimeReport() {
  return (
    <ViolationReportShell
      title="Violation Resolution Time"
      subtitle="Average days from discovery to resolution. Unresolved violations are excluded from timing stats and reported separately."
      breadcrumbLabel="Violation Resolution Time"
      dimension="type"
      filters={['dateRange', 'type', 'fund', 'zone', 'severity']}
      exportFilename="violation_resolution_time"
      exportColumns={[
        { header: 'Violation Type', key: 'type', width: 32 },
        { header: 'Resolved Count', key: 'resolved', width: 16 },
        { header: 'Unresolved Count', key: 'unresolved', width: 18 },
        { header: 'Avg Days', key: 'avg', width: 12 },
        { header: 'Median Days', key: 'median', width: 14 },
        { header: 'Min Days', key: 'min', width: 12 },
        { header: 'Max Days', key: 'max', width: 12 },
      ]}
      mapExportRow={(r) => ({
        type: r.bucket,
        resolved: r.resolved_count,
        unresolved: r.unresolved_count,
        avg: r.avg_resolution_days ?? '',
        median: r.median_resolution_days ?? '',
        min: r.min_resolution_days ?? '',
        max: r.max_resolution_days ?? '',
      })}
      renderBody={(rows) => {
        const resolved = rows.reduce((s, r) => s + r.resolved_count, 0);
        const unresolved = rows.reduce((s, r) => s + r.unresolved_count, 0);
        const weightedAvg = resolved
          ? rows.reduce((s, r) => s + (r.avg_resolution_days ?? 0) * r.resolved_count, 0) / resolved
          : null;
        const mins = rows.map(r => r.min_resolution_days).filter((n): n is number => n != null);
        const maxs = rows.map(r => r.max_resolution_days).filter((n): n is number => n != null);
        const sorted = [...rows].sort((a, b) => (b.avg_resolution_days ?? -1) - (a.avg_resolution_days ?? -1));

        return (
          <>
            <div className="grid gap-4 md:grid-cols-4">
              <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Avg Days</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold text-primary">{fmt(weightedAvg)}</div></CardContent></Card>
              <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Groups Reported</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold">{rows.length}</div></CardContent></Card>
              <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Min / Max</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold">{fmt(mins.length ? Math.min(...mins) : null)} / {fmt(maxs.length ? Math.max(...maxs) : null)}</div></CardContent></Card>
              <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Resolved / Unresolved</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold">{resolved.toLocaleString()} / {unresolved.toLocaleString()}</div></CardContent></Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>By Violation Type</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Unresolved violations are excluded from average / median computation but are shown in the
                  Unresolved column for transparency.
                </p>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Violation Type</TableHead>
                      <TableHead className="text-right">Resolved</TableHead>
                      <TableHead className="text-right">Unresolved</TableHead>
                      <TableHead className="text-right">Avg Days</TableHead>
                      <TableHead className="text-right">Median</TableHead>
                      <TableHead className="text-right">Min</TableHead>
                      <TableHead className="text-right">Max</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sorted.map(r => (
                      <TableRow key={r.bucket}>
                        <TableCell className="font-medium">{r.bucket}</TableCell>
                        <TableCell className="text-right">{r.resolved_count.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{r.unresolved_count.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{fmt(r.avg_resolution_days)}</TableCell>
                        <TableCell className="text-right">{fmt(r.median_resolution_days)}</TableCell>
                        <TableCell className="text-right">{fmt(r.min_resolution_days)}</TableCell>
                        <TableCell className="text-right">{fmt(r.max_resolution_days)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        );
      }}
    />
  );
}
