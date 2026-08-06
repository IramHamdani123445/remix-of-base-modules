/**
 * Screen 24: Medical Review Scheduler
 *
 * Real-data wiring against bn_medical_review_schedule + bn_award + ip_master.
 * Role visibility: Claims Officer, Medical Admin, Supervisor
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Search, Stethoscope, Calendar, AlertTriangle, CheckCircle2, Clock, Filter, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import {
  fetchAwards,
  fetchClaimantsBySsns,
  fetchMedicalReviews,
  type BnAwardRow,
  type BnMedicalReviewRow,
} from '@/services/bn/awardServicingService';
import { medicalReviewLegacyScheduleCommands } from '@/services/bn/medicalReviewLegacyScheduleCommands';
import { describeMedicalReviewFailure, MedicalReviewError } from '@/features/bn/medical-reviews/model/errors';

const statusConfig: Record<string, { label: string; color: string }> = {
  SCHEDULED: { label: 'Scheduled', color: 'bg-blue-500/10 text-blue-700 border-blue-300' },
  COMPLETED: { label: 'Completed', color: 'bg-emerald-500/10 text-emerald-700 border-emerald-300' },
  OVERDUE: { label: 'Overdue', color: 'bg-destructive/10 text-destructive border-destructive/30' },
  CANCELLED: { label: 'Cancelled', color: 'bg-muted text-muted-foreground border-muted' },
  REFERRED_BOARD: { label: 'Referred to Board', color: 'bg-purple-500/10 text-purple-700 border-purple-300' },
  PENDING_SCHEDULE: { label: 'Needs Scheduling', color: 'bg-amber-500/10 text-amber-700 border-amber-300' },
};

interface EnrichedReview extends BnMedicalReviewRow {
  awardNumber: string | null;
  ssn: string;
  benefitCode: string | null;
  claimantName: string;
}

const MedicalReviewScheduler: React.FC = () => {
  const { isAuthReady, isAuthenticated, profile, hasAnyRole } = useSupabaseAuth();
  const canAct = hasAnyRole(['admin', 'supervisor', 'claims_officer', 'medical_admin', 'BN_MEDICAL_OFFICER', 'BN_MANAGER']);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [rows, setRows] = useState<EnrichedReview[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<EnrichedReview | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleDr, setScheduleDr] = useState('');
  const [outcomeResult, setOutcomeResult] = useState('CONTINUE');
  const [outcomeNotes, setOutcomeNotes] = useState('');
  const [nextReview, setNextReview] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [reviews, awards] = await Promise.all([fetchMedicalReviews(), fetchAwards()]);
      const awardMap = new Map(awards.map((a) => [a.id, a] as const));
      const ssns = reviews.map((r) => awardMap.get(r.bn_award_id)?.ssn).filter(Boolean) as string[];
      const claimants = await fetchClaimantsBySsns(ssns);
      const enriched: EnrichedReview[] = reviews.map((r) => {
        const a = awardMap.get(r.bn_award_id) as BnAwardRow | undefined;
        const ssn = a?.ssn ?? '';
        return {
          ...r,
          awardNumber: a?.award_number ?? null,
          ssn,
          benefitCode: a?.benefit_code ?? null,
          claimantName: claimants[ssn]?.full_name ?? ssn,
        };
      });
      setRows(enriched);
    } catch (e) {
      console.error(e);
      toast.error('Unable to load medical reviews');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthReady && isAuthenticated) void load();
  }, [isAuthReady, isAuthenticated]);

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        const matchSearch = !search || r.claimantName.toLowerCase().includes(search.toLowerCase()) || r.ssn.includes(search);
        const matchStatus = statusFilter === 'all' || r.status === statusFilter;
        return matchSearch && matchStatus;
      }),
    [rows, search, statusFilter]
  );

  const counts = useMemo(
    () => ({
      scheduled: rows.filter((r) => r.status === 'SCHEDULED').length,
      overdue: rows.filter((r) => r.status === 'OVERDUE').length,
      needsScheduling: rows.filter((r) => r.status === 'PENDING_SCHEDULE').length,
      boardReferrals: rows.filter((r) => r.status === 'REFERRED_BOARD').length,
    }),
    [rows]
  );

  const commandMessage = (e: unknown, fallback: string) =>
    e instanceof MedicalReviewError ? describeMedicalReviewFailure(e) : fallback;

  const doSchedule = async () => {
    if (!selected) return;
    if (!scheduleDate) { toast.error('Pick an appointment date'); return; }
    setSubmitting(true);
    try {
      const res = await medicalReviewLegacyScheduleCommands.schedule({
        scheduleId: selected.id,
        scheduledDate: scheduleDate,
        examiningProvider: scheduleDr || null,
        expectedRowVersion: selected.row_version ?? 1,
        reason: 'Legacy periodic review scheduling',
      });
      toast.success(res.replayed ? 'Review already scheduled' : 'Review scheduled');
      setScheduleOpen(false);
      setScheduleDate(''); setScheduleDr('');
      await load();
    } catch (e) {
      console.error(e);
      toast.error(commandMessage(e, 'Schedule failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const doOutcome = async () => {
    if (!selected) return;
    setSubmitting(true);
    try {
      const res = await medicalReviewLegacyScheduleCommands.recordOutcome({
        scheduleId: selected.id,
        outcome: outcomeResult as 'CONTINUE' | 'UPGRADE' | 'DOWNGRADE' | 'CEASE' | 'REFER_BOARD',
        notes: outcomeNotes || null,
        nextReviewDate: nextReview || null,
        expectedRowVersion: selected.row_version ?? 1,
        reason: 'Legacy periodic review outcome',
      });
      toast.success(res.replayed ? 'Outcome already recorded' : 'Outcome recorded');
      setOutcomeOpen(false);
      setOutcomeNotes(''); setNextReview(''); setOutcomeResult('CONTINUE');
      await load();
    } catch (e) {
      console.error(e);
      toast.error(commandMessage(e, 'Save failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="t-page-title flex items-center gap-2"><Stethoscope className="h-6 w-6" />Medical Review Scheduler</h1>
          <p className="text-sm text-muted-foreground mt-1">Schedule and track periodic medical reviews for invalidity and injury awards</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Upcoming', value: counts.scheduled, icon: Calendar, color: 'text-blue-600' },
          { label: 'Overdue', value: counts.overdue, icon: AlertTriangle, color: 'text-destructive' },
          { label: 'Needs Scheduling', value: counts.needsScheduling, icon: Clock, color: 'text-amber-600' },
          { label: 'Board Referrals', value: counts.boardReferrals, icon: FileText, color: 'text-purple-600' },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="p-3 flex items-center gap-3">
              <kpi.icon className={`h-5 w-5 ${kpi.color}`} />
              <div>
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
                <p className="text-xl font-bold">{kpi.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search by name or SSN..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
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
                <TableHead>Name</TableHead>
                <TableHead>Benefit</TableHead>
                <TableHead>Review Type</TableHead>
                <TableHead>Scheduled</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No medical reviews scheduled</TableCell></TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id} className={r.status === 'OVERDUE' ? 'bg-destructive/5' : ''}>
                    <TableCell className="font-mono text-xs">{r.awardNumber ?? r.bn_award_id.slice(0, 8)}</TableCell>
                    <TableCell className="font-medium">{r.claimantName}</TableCell>
                    <TableCell className="text-sm">{r.benefitCode ?? '—'}</TableCell>
                    <TableCell className="text-sm capitalize">{(r.review_type ?? '').replace('_', ' ').toLowerCase() || '—'}</TableCell>
                    <TableCell>{r.scheduled_date ?? '—'}</TableCell>
                    <TableCell>{r.examining_provider ?? '—'}</TableCell>
                    <TableCell><Badge variant="outline" className={statusConfig[r.status]?.color ?? ''}>{statusConfig[r.status]?.label ?? r.status}</Badge></TableCell>
                    <TableCell className="text-right space-x-1">
                      {canAct && ['PENDING_SCHEDULE', 'OVERDUE'].includes(r.status) && (
                        <Button size="sm" variant="outline" onClick={() => { setSelected(r); setScheduleDate(''); setScheduleDr(''); setScheduleOpen(true); }}>
                          <Calendar className="h-3 w-3 mr-1" />Schedule
                        </Button>
                      )}
                      {canAct && r.status === 'SCHEDULED' && (
                        <Button size="sm" variant="outline" onClick={() => { setSelected(r); setOutcomeOpen(true); }}>
                          <CheckCircle2 className="h-3 w-3 mr-1" />Record Outcome
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule Medical Review</DialogTitle>
            <DialogDescription>Schedule a review for {selected?.claimantName}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Appointment Date *</Label>
              <Input type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Examining Provider</Label>
              <Input placeholder="Doctor / clinic name..." value={scheduleDr} onChange={(e) => setScheduleDr(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleOpen(false)} disabled={submitting}>Cancel</Button>
            <Button onClick={doSchedule} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Calendar className="h-4 w-4 mr-1" />}
              Confirm Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={outcomeOpen} onOpenChange={setOutcomeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Review Outcome</DialogTitle>
            <DialogDescription>Record the medical review result for {selected?.claimantName}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Outcome</Label>
              <Select value={outcomeResult} onValueChange={setOutcomeResult}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CONTINUE">Continue Award</SelectItem>
                  <SelectItem value="UPGRADE">Upgrade Rating</SelectItem>
                  <SelectItem value="DOWNGRADE">Downgrade Rating</SelectItem>
                  <SelectItem value="CEASE">Cease Award</SelectItem>
                  <SelectItem value="REFER_BOARD">Refer to Medical Board</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Next Review Date</Label>
              <Input type="date" value={nextReview} onChange={(e) => setNextReview(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={outcomeNotes} onChange={(e) => setOutcomeNotes(e.target.value)} placeholder="Medical findings and recommendations..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOutcomeOpen(false)} disabled={submitting}>Cancel</Button>
            <Button onClick={doOutcome} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
              Save Outcome
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MedicalReviewScheduler;
