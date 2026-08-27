import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/common';
import { Calendar, AlertTriangle, CheckCircle, TrendingUp } from 'lucide-react';

interface AuditHistoryTimelineProps {
  audits: any[];
  findings: any[];
  actions: any[];
  departmentName: string;
}

export function AuditHistoryTimeline({ audits, findings, actions, departmentName }: AuditHistoryTimelineProps) {
  const sortedAudits = [...audits].sort((a, b) => 
    new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  );

  const findingsForAudit = (auditId: string) => 
    findings.filter((f: any) => f.engagement_id === auditId);

  const actionsForAudit = (auditId: string) => {
    const auditFindings = findingsForAudit(auditId);
    const findingIds = auditFindings.map((f: any) => f.id);
    return actions.filter((a: any) => findingIds.includes(a.finding_id));
  };

  if (sortedAudits.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-muted-foreground">
          <Calendar className="h-10 w-10 mx-auto mb-2 opacity-50" />
          <p>No audit history for {departmentName}.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          Audit History – {departmentName}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative border-l-2 border-muted ml-4 space-y-6">
          {sortedAudits.map((audit: any) => {
            const auditFindings = findingsForAudit(audit.id);
            const auditActions = actionsForAudit(audit.id);
            const completedActions = auditActions.filter((a: any) => a.status === 'Completed');
            const highFindings = auditFindings.filter((f: any) => f.risk_rating === 'High').length;

            return (
              <div key={audit.id} className="relative pl-6">
                <div className="absolute -left-[9px] top-1 w-4 h-4 rounded-full bg-primary border-2 border-background" />
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">
                      {audit.created_at ? new Date(audit.created_at).toLocaleDateString() : 'Unknown'}
                    </span>
                    <StatusBadge status={audit.status || 'Draft'} />
                    <StatusBadge status={audit.audit_type === 'ad_hoc' ? 'Ad-Hoc' : 'Planned'} />
                  </div>
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {auditFindings.length} findings ({highFindings} high)
                    </span>
                    <span className="flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" />
                      {completedActions.length}/{auditActions.length} actions completed
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
