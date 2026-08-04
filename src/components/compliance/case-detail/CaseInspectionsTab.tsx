/**
 * Read-only summary of inspections related to a compliance case
 * (matched by case link, falling back to the employer).
 */
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Eye } from 'lucide-react';

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

interface Props {
  caseId: string;
  employerId?: string | null;
}

export function CaseInspectionsTab({ caseId, employerId }: Props) {
  const navigate = useNavigate();

  const { data: inspections = [], isLoading } = useQuery({
    queryKey: ['ce_case_inspections', caseId, employerId ?? null],
    enabled: !!caseId,
    queryFn: async () => {
      const columns =
        'id, inspection_number, inspection_type, status, scheduled_date, visit_date, inspector_name, case_id, employer_id';

      const { data: byCase } = await supabase
        .from('ce_inspections')
        .select(columns)
        .eq('case_id', caseId)
        .order('visit_date', { ascending: false });

      const rows = [...((byCase ?? []) as any[])];

      if (employerId) {
        const { data: byEmployer } = await supabase
          .from('ce_inspections')
          .select(columns)
          .eq('employer_id', employerId)
          .order('visit_date', { ascending: false })
          .limit(25);
        const seen = new Set(rows.map((r: any) => r.id));
        ((byEmployer ?? []) as any[]).forEach((r: any) => {
          if (!seen.has(r.id)) rows.push(r);
        });
      }

      return rows;
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Inspections ({inspections.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : inspections.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No inspections recorded for this case or employer
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Inspection #</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Scheduled</TableHead>
                <TableHead>Visited</TableHead>
                <TableHead>Inspector</TableHead>
                <TableHead>Link</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inspections.map((i: any) => (
                <TableRow key={i.id}>
                  <TableCell className="font-mono text-xs font-medium">{i.inspection_number}</TableCell>
                  <TableCell>{i.inspection_type || '-'}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{(i.status || 'UNKNOWN').replace(/_/g, ' ')}</Badge>
                  </TableCell>
                  <TableCell>{i.scheduled_date ? formatDate(i.scheduled_date) : '-'}</TableCell>
                  <TableCell>{i.visit_date ? formatDate(i.visit_date) : '-'}</TableCell>
                  <TableCell>{i.inspector_name || '-'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {i.case_id === caseId ? 'This case' : 'Employer'}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => navigate(`/compliance/field/audit-report/${i.id}`)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default CaseInspectionsTab;
