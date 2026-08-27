import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Gavel, Scale, DollarSign, Clock, ArrowRight, FileText,
  Calendar, Building2, Loader2, Inbox,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const STAGE_COLORS: Record<string, string> = {
  WARNING_NOTICE: 'hsl(var(--warning))',
  DEMAND_NOTICE: 'hsl(210, 70%, 55%)',
  FINAL_DEMAND: 'hsl(25, 90%, 55%)',
  LAR: 'hsl(var(--destructive))',
  SUMMONS: 'hsl(280, 60%, 55%)',
  JUDGMENT: 'hsl(330, 60%, 50%)',
  ENFORCEMENT: 'hsl(0, 70%, 40%)',
};

const formatStage = (s: string) =>
  s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

const fmtCurrency = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'XCD', minimumFractionDigits: 0 }).format(n || 0);

const LegalDashboard = () => {
  const navigate = useNavigate();

  // Pipeline aggregation by stage from ce_legal_escalations
  const { data: pipelineData = [], isLoading: pl } = useQuery({
    queryKey: ['legal-dashboard-pipeline'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ce_legal_escalations')
        .select('current_stage');
      if (error) throw error;
      const grouped = (data || []).reduce<Record<string, number>>((acc, row: any) => {
        const stage = row.current_stage || 'WARNING_NOTICE';
        acc[stage] = (acc[stage] || 0) + 1;
        return acc;
      }, {});
      return Object.entries(grouped).map(([stage, count]) => ({
        stage: formatStage(stage),
        rawStage: stage,
        count,
        color: STAGE_COLORS[stage] || 'hsl(var(--primary))',
      }));
    },
  });

  // Upcoming hearings from ce_legal_proceedings
  const { data: upcomingHearings = [], isLoading: hl } = useQuery({
    queryKey: ['legal-dashboard-hearings'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('ce_legal_proceedings')
        .select('id, case_number, employer_name, next_hearing, court, stage')
        .gte('next_hearing', today)
        .order('next_hearing', { ascending: true })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
  });

  // Pending escalations from ce_legal_referrals (DRAFT/PENDING)
  const { data: pendingEscalations = [], isLoading: el } = useQuery({
    queryKey: ['legal-dashboard-escalations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ce_legal_referrals')
        .select('id, referral_number, employer_id, employer_name, employer_zone, grand_total, status, created_at')
        .in('status', ['DRAFT', 'PENDING', 'SUBMITTED'])
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
  });

  // KPIs derived from queries
  const activeLegalCases = pipelineData.reduce((sum, d) => sum + Number(d.count || 0), 0);
  const recoveryTarget = pendingEscalations.reduce((sum, e: any) => sum + Number(e.grand_total || 0), 0);
  const next30Days = (() => {
    const today = new Date();
    const horizon = new Date(); horizon.setDate(today.getDate() + 30);
    return upcomingHearings.filter((h: any) => h.next_hearing && new Date(h.next_hearing) <= horizon).length;
  })();

  const kpis = [
    { label: 'Active Legal Cases', value: String(activeLegalCases), icon: Gavel, color: 'text-primary' },
    { label: 'Pending Escalations', value: String(pendingEscalations.length), icon: Scale, color: 'text-warning' },
    { label: 'Hearings (30 days)', value: String(next30Days), icon: Clock, color: 'text-destructive' },
    { label: 'Recovery Target', value: fmtCurrency(recoveryTarget), icon: DollarSign, color: 'text-success' },
  ];

  const isLoading = pl || hl || el;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Gavel className="h-6 w-6 text-primary" />
            <h1 className="text-3xl font-semibold text-foreground">Legal Dashboard</h1>
          </div>
          <p className="text-muted-foreground">Legal escalation pipeline, court proceedings, and enforcement tracking</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate('/compliance/enforcement/recommendation-queue')}>
            <Scale className="h-4 w-4 mr-1" />Recommendations
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/compliance/enforcement/legal-queue')}>
            <Scale className="h-4 w-4 mr-1" />Referral Approval
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/compliance/enforcement/notices')}>
            <FileText className="h-4 w-4 mr-1" />Notices
          </Button>
          <Button size="sm" onClick={() => navigate('/compliance/enforcement/proceedings')}>
            <Gavel className="h-4 w-4 mr-1" />Proceedings
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi, idx) => (
          <Card key={idx}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">{kpi.label}</CardTitle>
              <kpi.icon className={`h-4 w-4 ${kpi.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{isLoading ? '—' : kpi.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pipeline Chart + Upcoming Hearings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Legal Pipeline Stages</CardTitle>
          </CardHeader>
          <CardContent>
            {pl ? (
              <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : pipelineData.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                <Inbox className="h-10 w-10 mx-auto mb-2 opacity-50" />
                No legal escalations on file
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={pipelineData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="stage" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--popover-foreground))' }} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {pipelineData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Upcoming Court Hearings</CardTitle>
            <Badge variant="destructive">{upcomingHearings.length} scheduled</Badge>
          </CardHeader>
          <CardContent>
            {hl ? (
              <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : upcomingHearings.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                <Inbox className="h-10 w-10 mx-auto mb-2 opacity-50" />
                No upcoming hearings
              </div>
            ) : (
              <div className="space-y-3">
                {upcomingHearings.map((h: any) => (
                  <div key={h.id} className="p-3 border border-border rounded-lg space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium font-mono text-foreground">{h.case_number}</span>
                      <Badge variant="outline" className="text-[10px]">{h.stage}</Badge>
                    </div>
                    <p className="text-sm text-foreground"><Building2 className="h-3 w-3 inline mr-1" />{h.employer_name}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{h.next_hearing}</span>
                      <span>{h.court || '—'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Pending Escalations */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Pending Legal Escalations</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => navigate('/compliance/enforcement/legal-queue')}>
            View Queue <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </CardHeader>
        <CardContent>
          {el ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : pendingEscalations.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <Inbox className="h-10 w-10 mx-auto mb-2 opacity-50" />
              No pending escalations
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 text-muted-foreground font-medium">Employer</th>
                    <th className="text-left py-2 px-3 text-muted-foreground font-medium">Reg No</th>
                    <th className="text-right py-2 px-3 text-muted-foreground font-medium">Total</th>
                    <th className="text-left py-2 px-3 text-muted-foreground font-medium">Zone</th>
                    <th className="text-left py-2 px-3 text-muted-foreground font-medium">Status</th>
                    <th className="text-right py-2 px-3 text-muted-foreground font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingEscalations.map((e: any) => (
                    <tr key={e.id} className="border-b last:border-0 border-border hover:bg-muted/50">
                      <td className="py-2 px-3 font-medium text-foreground">{e.employer_name}</td>
                      <td className="py-2 px-3 font-mono text-xs text-muted-foreground">{e.employer_id}</td>
                      <td className="py-2 px-3 text-right font-medium text-foreground">{fmtCurrency(Number(e.grand_total || 0))}</td>
                      <td className="py-2 px-3 text-muted-foreground">{e.employer_zone || '—'}</td>
                      <td className="py-2 px-3">
                        <Badge variant={e.status === 'SUBMITTED' ? 'destructive' : 'secondary'} className="text-[10px]">
                          {e.status}
                        </Badge>
                      </td>
                      <td className="py-2 px-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs h-7"
                          onClick={() => navigate('/compliance/enforcement/legal-queue')}
                        >
                          Review
                        </Button>
                      </td>
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
};

export default LegalDashboard;
