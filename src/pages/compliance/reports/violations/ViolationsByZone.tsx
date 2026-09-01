import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import ViolationReportShell from './ViolationReportShell';

export default function ViolationsByZoneReport() {
  return (
    <ViolationReportShell
      title="Violations by Zone"
      subtitle="Distribution of violations by employer zone. Records without a zone are grouped as Unassigned."
      breadcrumbLabel="Violations by Zone"
      dimension="zone"
      filters={['dateRange', 'status', 'type', 'fund', 'severity']}
      exportFilename="violations_by_zone"
      exportColumns={[
        { header: 'Zone', key: 'zone', width: 28 },
        { header: 'Count', key: 'count', width: 12 },
        { header: 'Total Amount', key: 'total_amount', width: 18 },
      ]}
      mapExportRow={(r) => ({ zone: r.bucket, count: r.violation_count, total_amount: r.total_amount.toFixed(2) })}
      renderBody={(rows) => {
        const agg = rows.map(r => ({ zone: r.bucket, count: r.violation_count, total_amount: r.total_amount }));
        return (
          <>
            <Card>
              <CardHeader><CardTitle>Zone Distribution</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={340}>
                  <BarChart data={agg}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="zone" tick={{ fontSize: 12 }} />
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
                      <TableHead>Zone</TableHead>
                      <TableHead className="text-right">Count</TableHead>
                      <TableHead className="text-right">Total Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {agg.map(r => (
                      <TableRow key={r.zone}>
                        <TableCell className="font-medium">{r.zone}</TableCell>
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
