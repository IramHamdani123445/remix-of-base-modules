
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Heart, DollarSign, Clock, CheckCircle, XCircle, AlertCircle, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { DASHBOARD_QUERY_KEYS, fetchAdminKPIs, fetchBenefitsDistribution, fetchRecentClaims } from '@/services/dashboardDataService';

export const BenefitsDashboard = () => {
  const navigate = useNavigate();
  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.adminKpis,
    queryFn: fetchAdminKPIs,
  });

  const { data: distribution = [], isLoading: distLoading } = useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.benefitsDistribution,
    queryFn: fetchBenefitsDistribution,
  });

  const { data: recentClaims = [], isLoading: claimsLoading } = useQuery({
    queryKey: ['benefits_dashboard_claims'],
    queryFn: fetchRecentClaims,
  });

  const isLoading = kpisLoading || distLoading || claimsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const totalClaims = distribution.reduce((s, d) => s + Number(d.claim_count), 0);
  const totalAmount = distribution.reduce((s, d) => s + Number(d.amount), 0);

  const benefitsStats = [
    { label: 'Total Claims', value: totalClaims.toLocaleString(), icon: Heart, color: 'text-primary', route: '/bn/claims' },
    { label: 'Total Benefits', value: `$${(totalAmount / 1_000_000).toFixed(1)}M`, icon: CheckCircle, color: 'text-secondary', route: '/bn/claims' },
    { label: 'Active Claims', value: (kpis?.active_claims ?? 0).toLocaleString(), icon: Clock, color: 'text-accent-foreground', route: '/bn/claims' },
    { label: 'Benefit Types', value: String(distribution.length), icon: DollarSign, color: 'text-primary', route: '/bn/config/products' },
  ];

  const statusMap: Record<string, string> = { A: 'Approved', P: 'Pending', O: 'Open', C: 'Closed', S: 'Suspended' };
  const claimTypeMap: Record<string, string> = { S: 'Sickness', M: 'Maternity', A: 'Age', I: 'Invalidity', F: 'Funeral', E: 'Employment Injury', V: 'Survivors' };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Benefits Management Dashboard</h1>
        <p className="text-muted-foreground">Monitor and manage benefit claims and payments</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {benefitsStats.map((stat, index) => (
          <Card
            key={index}
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => navigate(stat.route)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(stat.route); } }}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.label}</CardTitle>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2"><Clock className="h-5 w-5 text-primary" />Recent Claims</span>
              <Button size="sm" onClick={() => navigate('/bn/claims')}>Process New</Button>
            </CardTitle>
            <CardDescription>Latest benefit claims</CardDescription>
          </CardHeader>
          <CardContent>
            {recentClaims.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No recent claims</div>
            ) : (
              <div className="space-y-4">
                {recentClaims.slice(0, 4).map((claim, index) => (
                  <div
                    key={claim.claim_number || index}
                    className="border rounded-lg p-4 space-y-2 cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => navigate('/bn/claims')}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/bn/claims'); } }}
                  >
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium">{claim.claim_number}</h4>
                      <Badge variant={claim.status === 'A' ? 'default' : claim.status === 'P' ? 'secondary' : 'outline'}>
                        {statusMap[claim.status ?? ''] ?? claim.status}
                      </Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">{[claim.payee_firstname, claim.payee_surname].filter(Boolean).join(' ') || 'N/A'}</span>
                      <span className="text-sm font-medium">${Number(claim.benefit_amount ?? 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{claimTypeMap[claim.claim_type_code ?? ''] ?? claim.claim_type_code}</span>
                      <span>{claim.date_received ?? ''}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><DollarSign className="h-5 w-5 text-secondary" />Benefit Types Overview</CardTitle>
            <CardDescription>Claims breakdown by benefit category</CardDescription>
          </CardHeader>
          <CardContent>
            {distribution.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No benefits data</div>
            ) : (
              <div className="space-y-4">
                {distribution.map((benefit, index) => (
                  <div
                    key={index}
                    className="border rounded-lg p-4 space-y-2 cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => navigate('/bn/config/products')}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/bn/config/products'); } }}
                  >
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium">{benefit.type}</h4>
                      <span className="text-lg font-bold text-secondary">${(Number(benefit.amount) / 1000).toFixed(0)}K</span>
                    </div>
                    <div className="text-sm text-center">
                      <span className="font-medium">{Number(benefit.claim_count).toLocaleString()}</span>
                      <span className="text-muted-foreground ml-1">claims</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
