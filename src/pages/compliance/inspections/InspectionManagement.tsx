import { ComplianceHelpButton } from '@/components/help/ComplianceHelpButton';
import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ClipboardCheck, Plus, Eye, MapPin, Loader2, Inbox } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchInspections, InspectionRecord } from '@/services/complianceReportingService';
import { supabase } from '@/integrations/supabase/client';
import ReferToLegalButton from '@/components/legal/lg/ReferToLegalButton';
import { Link } from 'react-router-dom';

export default function InspectionManagement() {
  const [statusFilter, setStatusFilter] = useState('All');

  const { data: inspections = [], isLoading } = useQuery({
    queryKey: ['ce_inspections_list'],
    queryFn: () => fetchInspections(),
  });

  // Fetch findings counts for all inspections
  const { data: findingsCounts = {} } = useQuery({
    queryKey: ['ce_inspection_findings_counts', inspections.map(i => i.id)],
    queryFn: async () => {
      if (inspections.length === 0) return {};
      const { data } = await supabase
        .from('ce_inspection_findings')
        .select('inspection_id')
        .in('inspection_id', inspections.map(i => i.id));
      const counts: Record<string, number> = {};
      (data || []).forEach((f: any) => {
        counts[f.inspection_id] = (counts[f.inspection_id] || 0) + 1;
      });
      return counts;
    },
    enabled: inspections.length > 0,
  });

  const filtered = useMemo(() => {
    if (statusFilter === 'All') return inspections;
    return inspections.filter(i => i.status === statusFilter);
  }, [inspections, statusFilter]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { All: inspections.length };
    inspections.forEach(i => { counts[i.status] = (counts[i.status] || 0) + 1; });
    return counts;
  }, [inspections]);

  const statuses = ['All', 'Scheduled', 'In Progress', 'Completed', 'Overdue'];

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6 text-primary" />
            <h1 className="text-3xl font-semibold text-foreground">Inspection Management</h1>
          </div>
          <p className="text-muted-foreground">Schedule, assign, and track field compliance inspections</p>
        </div>
        <div className="flex items-center gap-2">
          <ComplianceHelpButton screenKey="inspections" />
          <Button variant="outline" asChild>
            <Link to="/compliance/field/findings">Findings</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/compliance/inspections/convert-finding">Convert Finding</Link>
          </Button>
          <ScheduleInspectionDialog />
          <ReferToLegalButton module="compliance" reasonCode="AUDIT_FINDING_RECOVERY" />

        </div>

      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {statuses.map(s => (
          <Card key={s} className={`cursor-pointer hover:shadow-md transition-shadow ${statusFilter === s ? 'ring-2 ring-primary' : ''}`} onClick={() => setStatusFilter(s)}>
            <CardContent className="pt-4 text-center">
              <p className="text-xs text-muted-foreground">{s}</p>
              <p className="text-xl font-bold text-foreground">{statusCounts[s] || 0}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Inbox className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium">No inspections found</p>
              <p className="text-sm mt-1">Schedule an inspection to get started</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 text-muted-foreground font-medium">Inspection</th>
                    <th className="text-left py-2 px-3 text-muted-foreground font-medium">Employer</th>
                    <th className="text-left py-2 px-3 text-muted-foreground font-medium">Type</th>
                    <th className="text-left py-2 px-3 text-muted-foreground font-medium">Inspector</th>
                    <th className="text-left py-2 px-3 text-muted-foreground font-medium">Date</th>
                    <th className="text-left py-2 px-3 text-muted-foreground font-medium">Location</th>
                    <th className="text-center py-2 px-3 text-muted-foreground font-medium">Status</th>
                    <th className="text-center py-2 px-3 text-muted-foreground font-medium">Findings</th>
                    <th className="text-right py-2 px-3 text-muted-foreground font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(ins => (
                    <tr key={ins.id} className="border-b last:border-0 border-border hover:bg-muted/50">
                      <td className="py-2 px-3 font-mono text-xs font-medium text-foreground">{ins.inspection_number}</td>
                      <td className="py-2 px-3">
                        <p className="font-medium text-foreground">{ins.employer_name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{ins.employer_id}</p>
                      </td>
                      <td className="py-2 px-3 text-foreground">{ins.inspection_type}</td>
                      <td className="py-2 px-3 text-foreground">{ins.inspector_name}</td>
                      <td className="py-2 px-3 text-foreground">{ins.scheduled_date}</td>
                      <td className="py-2 px-3 text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" />{ins.location_address || '-'}</td>
                      <td className="py-2 px-3 text-center">
                        <Badge variant={ins.status === 'Completed' ? 'default' : ins.status === 'Overdue' ? 'destructive' : ins.status === 'In Progress' ? 'secondary' : 'outline'} className="text-[10px]">
                          {ins.status}
                        </Badge>
                      </td>
                      <td className="py-2 px-3 text-center">{(findingsCounts[ins.id] || 0) > 0 ? findingsCounts[ins.id] : '—'}</td>
                      <td className="py-2 px-3 text-right"><Button variant="ghost" size="sm"><Eye className="h-4 w-4" /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
