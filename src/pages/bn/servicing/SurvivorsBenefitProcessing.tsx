/**
 * Screen 27: Survivors' Benefit Processing
 *
 * Real-data wiring: bn_award (award_type = 'SURVIVORS') + bn_award_beneficiary
 * + bn_claim (deceased context) + ip_master (names + date_died).
 * Role visibility: Claims Officer, Pension Admin, Supervisor
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, AlertTriangle, CheckCircle2, Clock, FileText, Filter, ArrowRight, Heart, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import {
  advanceSurvivorAward,
  fetchAwards,
  fetchBeneficiariesByAward,
  fetchClaimantsBySsns,
  type BnAwardBeneficiaryRow,
  type BnAwardRow,
  type ClaimantInfo,
} from '@/services/bn/awardServicingService';

const statusConfig: Record<string, { label: string; color: string; step: number; next: string | null }> = {
  INTAKE:                { label: 'Intake',           color: 'bg-blue-500/10 text-blue-700 border-blue-300', step: 1, next: 'DECEASED_VERIFIED' },
  DECEASED_VERIFIED:     { label: 'Deceased Verified',color: 'bg-blue-500/10 text-blue-700 border-blue-300', step: 2, next: 'DEPENDANTS_IDENTIFIED' },
  DEPENDANTS_IDENTIFIED: { label: "Dependants ID'd",  color: 'bg-amber-500/10 text-amber-700 border-amber-300', step: 3, next: 'SHARES_ALLOCATED' },
  SHARES_ALLOCATED:      { label: 'Shares Set',       color: 'bg-amber-500/10 text-amber-700 border-amber-300', step: 4, next: 'APPROVED' },
  APPROVED:              { label: 'Approved',         color: 'bg-emerald-500/10 text-emerald-700 border-emerald-300', step: 5, next: 'ACTIVE' },
  ACTIVE:                { label: 'In Payment',       color: 'bg-emerald-600/10 text-emerald-700 border-emerald-400', step: 6, next: null },
  IN_PAYMENT:            { label: 'In Payment',       color: 'bg-emerald-600/10 text-emerald-700 border-emerald-400', step: 6, next: null },
  CLOSED:                { label: 'Closed',           color: 'bg-muted text-muted-foreground border-muted', step: 7, next: null },
  TERMINATED:            { label: 'Terminated',       color: 'bg-muted text-muted-foreground border-muted', step: 7, next: null },
  DENIED:                { label: 'Denied',           color: 'bg-destructive/10 text-destructive border-destructive/30', step: 0, next: null },
};

const fmt = (n: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`);

const SurvivorsBenefitProcessing: React.FC = () => {
  const { isAuthReady, isAuthenticated, profile, hasAnyRole } = useSupabaseAuth();
  const canAdvance = hasAnyRole(['admin', 'supervisor', 'claims_officer', 'pension_admin', 'BN_PAYMENT_OFFICER', 'BN_MANAGER', 'BN_DIRECTOR']);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [cases, setCases] = useState<BnAwardRow[]>([]);
  const [claimants, setClaimants] = useState<Record<string, ClaimantInfo>>({});
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<BnAwardRow | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [beneficiaries, setBeneficiaries] = useState<BnAwardBeneficiaryRow[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await fetchAwards({ award_type: 'SURVIVORS' });
      setCases(rows);
      const map = await fetchClaimantsBySsns(rows.map((r) => r.ssn));
      setClaimants(map);
    } catch (e) {
      console.error(e);
      toast.error('Unable to load survivor cases');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthReady && isAuthenticated) void load();
  }, [isAuthReady, isAuthenticated]);

  const openCase = async (c: BnAwardRow) => {
    setSelected(c);
    setDetailOpen(true);
    try {
      const list = await fetchBeneficiariesByAward(c.id);
      setBeneficiaries(list);
    } catch (e) {
      console.error(e);
      toast.error('Unable to load beneficiaries');
      setBeneficiaries([]);
    }
  };

  const advance = async () => {
    if (!selected) return;
    const next = statusConfig[selected.status]?.next;
    if (!next) return;
    setSubmitting(true);
    try {
      await advanceSurvivorAward(selected.id, next, profile?.user_code ?? null);
      toast.success(`Case advanced to ${statusConfig[next]?.label ?? next}`);
      setDetailOpen(false);
      await load();
    } catch (e) {
      console.error(e);
      toast.error('Stage advance failed');
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = useMemo(
    () =>
      cases.filter((c) => {
        const name = claimants[c.ssn]?.full_name ?? '';
        const matchSearch = !search || name.toLowerCase().includes(search.toLowerCase()) || c.ssn.includes(search) || (c.award_number ?? '').toLowerCase().includes(search.toLowerCase());
        const matchStatus = statusFilter === 'all' || c.status === statusFilter;
        return matchSearch && matchStatus;
      }),
    [cases, claimants, search, statusFilter]
  );

  const counts = useMemo(
    () => ({
      active: cases.filter((c) => !['CLOSED', 'DENIED', 'TERMINATED'].includes(c.status)).length,
      intake: cases.filter((c) => c.status === 'INTAKE').length,
      inPayment: cases.filter((c) => c.status === 'ACTIVE' || c.status === 'IN_PAYMENT').length,
    }),
    [cases]
  );

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="t-page-title flex items-center gap-2"><Heart className="h-6 w-6" />Survivors' Benefit Processing</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage survivor claims: deceased verification, dependant shares, and payments</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Active Cases</p><p className="text-2xl font-bold">{counts.active}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Awaiting Intake</p><p className="text-2xl font-bold text-blue-600">{counts.intake}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">In Payment</p><p className="text-2xl font-bold text-emerald-600">{counts.inPayment}</p></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search by deceased name, SSN, or award ID..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]"><Filter className="h-4 w-4 mr-1" /><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {Object.entries(statusConfig).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Award</TableHead>
                <TableHead>Deceased</TableHead>
                <TableHead>SSN</TableHead>
                <TableHead>Date of Death</TableHead>
                <TableHead className="text-right">Base Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No survivor cases</TableCell></TableRow>
              ) : (
                filtered.map((c) => {
                  const info = claimants[c.ssn];
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs">{c.award_number ?? c.id.slice(0, 8)}</TableCell>
                      <TableCell className="font-medium">{info?.full_name ?? '—'}</TableCell>
                      <TableCell className="font-mono">{c.ssn}</TableCell>
                      <TableCell>{info?.date_died ?? '—'}</TableCell>
                      <TableCell className="text-right font-mono">{fmt(c.base_amount)}</TableCell>
                      <TableCell><Badge variant="outline" className={statusConfig[c.status]?.color ?? ''}>{statusConfig[c.status]?.label ?? c.status}</Badge></TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => void openCase(c)}>
                          <FileText className="h-3 w-3 mr-1" />View
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Survivors' Case — {selected?.award_number ?? selected?.id.slice(0, 8)}</DialogTitle>
            <DialogDescription>Deceased: {selected ? (claimants[selected.ssn]?.full_name ?? '—') : ''} (SSN: {selected?.ssn})</DialogDescription>
          </DialogHeader>

          {selected && (
            <Tabs defaultValue="overview" className="mt-2">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="dependants">Beneficiaries ({beneficiaries.length})</TabsTrigger>
                <TabsTrigger value="timeline">Progress</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><span className="text-muted-foreground">Date of Death:</span> {claimants[selected.ssn]?.date_died ?? '—'}</div>
                  <div><span className="text-muted-foreground">Start Date:</span> {selected.start_date}</div>
                  <div><span className="text-muted-foreground">Base Amount:</span> {fmt(selected.base_amount)}</div>
                  <div><span className="text-muted-foreground">Frequency:</span> {selected.frequency ?? '—'}</div>
                  <div><span className="text-muted-foreground">Beneficiary Count:</span> {beneficiaries.length}</div>
                  <div><span className="text-muted-foreground">Status:</span> <Badge variant="outline" className={statusConfig[selected.status]?.color ?? ''}>{statusConfig[selected.status]?.label ?? selected.status}</Badge></div>
                </div>
              </TabsContent>

              <TabsContent value="dependants" className="mt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Relationship</TableHead>
                      <TableHead>Share %</TableHead>
                      <TableHead>Weekly Amount</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {beneficiaries.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No beneficiaries recorded</TableCell></TableRow>
                    ) : beneficiaries.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium">{d.full_name}</TableCell>
                        <TableCell>{d.relationship ?? '—'}</TableCell>
                        <TableCell>{d.share_percent != null ? `${d.share_percent.toFixed(2)}%` : '—'}</TableCell>
                        <TableCell className="font-mono">
                          {d.share_amount != null
                            ? fmt(d.share_amount)
                            : d.share_percent != null && selected.base_amount != null
                              ? fmt((selected.base_amount * d.share_percent) / 100)
                              : '—'}
                        </TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{d.status}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {beneficiaries.length > 0 && (
                  <div className="mt-3 text-sm text-muted-foreground text-right">
                    Total allocated: {beneficiaries.reduce((s, d) => s + (d.share_percent ?? 0), 0).toFixed(2)}% of {fmt(selected.base_amount)}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="timeline" className="mt-4">
                <div className="space-y-3">
                  {Object.entries(statusConfig).filter(([k, cfg]) => cfg.step > 0 && k !== 'IN_PAYMENT' && k !== 'TERMINATED').map(([key, cfg]) => {
                    const current = statusConfig[selected.status]?.step ?? 0;
                    const isComplete = cfg.step < current;
                    const isCurrent = cfg.step === current;
                    return (
                      <div key={key} className={`flex items-center gap-3 p-3 rounded-md border ${isCurrent ? 'border-primary bg-primary/5' : isComplete ? 'border-emerald-300 bg-emerald-50/50' : 'border-muted'}`}>
                        {isComplete ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : isCurrent ? <Clock className="h-4 w-4 text-primary" /> : <div className="h-4 w-4 rounded-full border-2 border-muted" />}
                        <span className={`text-sm ${isCurrent ? 'font-semibold' : isComplete ? 'text-emerald-700' : 'text-muted-foreground'}`}>{cfg.label}</span>
                        {isCurrent && <Badge className="ml-auto text-xs">Current</Badge>}
                      </div>
                    );
                  })}
                </div>
              </TabsContent>
            </Tabs>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(false)} disabled={submitting}>Close</Button>
            {canAdvance && selected && statusConfig[selected.status]?.next && (
              <Button onClick={advance} disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ArrowRight className="h-4 w-4 mr-1" />}
                Advance Stage
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SurvivorsBenefitProcessing;
