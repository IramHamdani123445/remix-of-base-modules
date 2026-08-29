import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import ViolationReportShell from './ViolationReportShell';

export default function ViolationsByTypeReport() {
  return (
    <ViolationReportShell
      title="Violations by Type"
      subtitle="Distribution of violations by violation type"
      breadcrumbLabel="Violations by Type"
      dimension="type"
      filters={['dateRange', 'status', 'fund', 'zone', 'severity']}
      exportFilename="violations_by_type"
      exportColumns={[
        { header: 'Violation Type', key: 'type', width: 36 },
        { header: 'Count', key: 'count', width: 12 },
        { header: 'Total Amount', key: 'total_amount', width: 18 },
      ]}
      mapExportRow={(r) => ({ type: r.bucket, count: r.violation_count, total_amount: r.total_amount.toFixed(2) })}
      renderBody={(rows) => {
        const agg = rows.map(r => ({ type: r.bucket, count: r.violation_count, total_amount: r.total_amount }));
        return (
          <>
            <Card>
              <CardHeader><CardTitle>Type Distribution</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={Math.max(320, agg.length * 28)}>
                  <BarChart data={agg} layout="vertical" margin={{ left: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis type="number" />
                    <YAxis dataKey="type" type="category" width={180} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="hsl(var(--primary))" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Breakdown</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Violation Type</TableHead>
                      <TableHead className="text-right">Count</TableHead>
                      <TableHead className="text-right">Total Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {agg.map(r => (
                      <TableRow key={r.type}>
                        <TableCell className="font-medium">{r.type}</TableCell>
                        <TableCell className="text-right">{r.count.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{r.total_amount.toFixed(2)}</TableCell>
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
