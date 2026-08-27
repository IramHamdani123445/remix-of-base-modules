import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Shield } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useUserCode } from '@/hooks/useUserCode';

interface WorkboardCaseloadSummaryProps {
  inspectorId?: string;
}

interface CaseloadData {
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  total: number;
}

const STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-primary/10 text-primary',
  IN_PROGRESS: 'bg-accent/10 text-accent-foreground',
  UNDER_REVIEW: 'bg-warning/10 text-warning',
  ESCALATED: 'bg-destructive/10 text-destructive',
  RESOLVED: 'bg-green-100 text-green-800',
  OVERDUE: 'bg-red-100 text-red-800',
};

const PRIORITY_COLORS: Record<string, string> = {
  Critical: 'bg-destructive/10 text-destructive',
  High: 'bg-orange-100 text-orange-800',
  Medium: 'bg-warning/10 text-warning',
  Low: 'bg-muted text-muted-foreground',
};

export function WorkboardCaseloadSummary({ inspectorId }: WorkboardCaseloadSummaryProps) {
  const { userId, userCode } = useUserCode();
  // Assignment columns hold either the auth user id or the staff user_code,
  // so scope on every identity the signed-in user answers to.
  const identities = inspectorId
    ? [inspectorId]
    : ([userId, userCode].filter(Boolean) as string[]);
  const scopeKey = identities.join('|');

  const { data, isLoading } = useQuery({
    queryKey: ['workboard_caseload', scopeKey],
    queryFn: async (): Promise<CaseloadData> => {
      // Fetch active violations (assigned or all)
      let query = supabase
        .from('ce_violations')
        .select('status, priority')
        .eq('is_deleted', false)
        .not('status', 'in', '("CLOSED","CANCELLED")');

      if (identities.length === 1) query = query.eq('assigned_to_user_id', identities[0]);
      else if (identities.length > 1) query = query.in('assigned_to_user_id', identities);

      const { data: rows, error } = await query;
      if (error) throw error;

      const byStatus: Record<string, number> = {};
      const byPriority: Record<string, number> = {};
      (rows || []).forEach((r: any) => {
        byStatus[r.status] = (byStatus[r.status] || 0) + 1;
        byPriority[r.priority] = (byPriority[r.priority] || 0) + 1;
      });

      // Also count follow-up overdue
      let overdueQuery = supabase
        .from('ce_follow_up_actions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'OVERDUE');

      if (identities.length === 1) overdueQuery = overdueQuery.eq('assigned_to_user_id', identities[0]);
      else if (identities.length > 1) overdueQuery = overdueQuery.in('assigned_to_user_id', identities);

      const { count: overdueFollowUps } = await overdueQuery;

      byStatus['OVERDUE (Follow-Ups)'] = overdueFollowUps || 0;

      return { byStatus, byPriority, total: rows?.length || 0 };
    },
    staleTime: 30000,
    enabled: identities.length > 0 || !inspectorId, // allow global mode if no prop
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Shield className="h-4 w-4" />
          Caseload Summary
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* By Status */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">By Status</div>
            <div className="space-y-1.5">
              {Object.entries(data.byStatus)
                .sort(([, a], [, b]) => b - a)
                .map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between">
                    <Badge variant="outline" className={STATUS_COLORS[status] || 'bg-muted text-muted-foreground'}>
                      {status.replace(/_/g, ' ')}
                    </Badge>
                    <span className="font-semibold text-sm">{count}</span>
                  </div>
                ))}
              <div className="flex items-center justify-between pt-2 border-t">
                <span className="text-sm font-medium">Total Active</span>
                <span className="font-bold text-base">{data.total}</span>
              </div>
            </div>
          </div>

          {/* By Priority */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">By Priority</div>
            <div className="space-y-1.5">
              {['Critical', 'High', 'Medium', 'Low'].map((p) => (
                <div key={p} className="flex items-center justify-between">
                  <Badge variant="outline" className={PRIORITY_COLORS[p]}>
                    {p}
                  </Badge>
                  <span className="font-semibold text-sm">{data.byPriority[p] || 0}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
