import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import ViolationReportShell from './ViolationReportShell';

export default function ViolationsByStatusReport() {
  return (
    <ViolationReportShell
      title="Violations by Status"
      subtitle="Grouped counts and amounts of violations by current status"
      breadcrumbLabel="Violations by Status"
      dimension="status"
      filters={['dateRange', 'fund', 'zone', 'type', 'severity']}
      exportFilename="violations_by_status"
      exportColumns={[
        { header: 'Status', key: 'status', width: 22 },
        { header: 'Count', key: 'count', width: 12 },
        { header: 'Total Amount', key: 'total_amount', width: 18 },
      ]}
      mapExportRow={(r) => ({
        status: r.bucket.replace(/_/g, ' '),
        count: r.violation_count,
        total_amount: r.total_amount.toFixed(2),
      })}
      renderBody={(rows) => {
        const agg = rows.map(r => ({
          status: r.bucket.replace(/_/g, ' '),
          count: r.violation_count,
          total_amount: r.total_amount,
        }));
        return (
          <>
            <Card>
              <CardHeader><CardTitle>Status Distribution</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={agg}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="status" tick={{ fontSize: 12 }} />
                    <YAxis />
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
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Count</TableHead>
                      <TableHead className="text-right">Total Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {agg.map(r => (
                      <TableRow key={r.status}>
                        <TableCell className="font-medium">{r.status}</TableCell>
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
