import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Search, FileCheck2, AlertTriangle, Clock, CheckCircle2, RefreshCw, Loader2,
  ShieldAlert, Lock, PauseCircle, PlayCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { useActionPermissions } from '@/hooks/useActionPermission';
import {
  fetchWorklist, isUuid, LIFE_CERTIFICATE_BUCKETS,
  type LifeCertificateBucket, type LifeCertificateWorklist, type LifeCertificateWorklistRow,
} from '@/services/bn/lifeCertificateViewService';
import { LifeCertificateCommandError } from '@/services/bn/lifeCertificateCommandService';
import LifeCertificateDetailPanel from '@/components/bn/life-certificates/LifeCertificateDetailPanel';

const PAGE_SIZE = 50;

const statusTone: Record<string, string> = {
  NOT_DUE: 'bg-muted text-muted-foreground border-muted',
  DUE: 'bg-blue-500/10 text-blue-700 border-blue-300',
  REMINDER_SENT: 'bg-blue-500/10 text-blue-700 border-blue-300',
  GRACE: 'bg-amber-500/10 text-amber-700 border-amber-300',
  OVERDUE: 'bg-destructive/10 text-destructive border-destructive/30',
  RECEIVED: 'bg-amber-500/10 text-amber-700 border-amber-300',
  UNDER_REVIEW: 'bg-amber-500/10 text-amber-700 border-amber-300',
  VERIFIED: 'bg-emerald-500/10 text-emerald-700 border-emerald-300',
  REJECTED: 'bg-destructive/10 text-destructive border-destructive/30',
  RESUBMISSION_REQUIRED: 'bg-destructive/10 text-destructive border-destructive/30',
  WAIVED: 'bg-muted text-muted-foreground border-muted',
  DEFERRED: 'bg-muted text-muted-foreground border-muted',
};

const LifeCertificateManagement: React.FC = () => {
  const { isAuthReady, isAuthenticated } = useSupabaseAuth();
  const { can, isAdmin, isLoading: permsLoading } = useActionPermissions('bn_life_certificate');

  const canView = isAdmin || can('view');
  const [bucket, setBucket] = useState<LifeCertificateBucket>('ALL');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<LifeCertificateWorklistRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<{ code: string; message: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Award 360 deep link: /bn/life-certificates?awardId=<uuid>
  const [searchParams, setSearchParams] = useSearchParams();
  const rawAwardId = searchParams.get('awardId');
  const awardId = isUuid(rawAwardId) ? rawAwardId : null;
  const invalidAwardParam = !!rawAwardId && !awardId;
  const [awardContext, setAwardContext] =
    useState<LifeCertificateWorklist['award']>(null);

  const clearAwardScope = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('awardId');
    setSearchParams(next, { replace: true });
    setOffset(0);
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setOffset(0); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setFailure(null);
    try {
      const result = await fetchWorklist({
        bucket, search: debounced || null, limit: PAGE_SIZE, offset, awardId,
      });
      setRows(result.rows ?? []);
      setTotal(result.total ?? 0);
      setAwardContext(result.award ?? null);
    } catch (e) {
      const err = e as LifeCertificateCommandError;
      setFailure({ code: err.code ?? 'E_UNKNOWN', message: err.message });
      setRows([]);
      setTotal(0);
      setAwardContext(null);
    } finally {
      setLoading(false);
    }
  }, [bucket, debounced, offset, awardId]);

  useEffect(() => {
    if (isAuthReady && isAuthenticated && canView) void load();
  }, [isAuthReady, isAuthenticated, canView, load]);

  const counts = useMemo(() => ({
    due: rows.filter((r) => ['DUE', 'REMINDER_SENT'].includes(r.obligation_status)).length,
    grace: rows.filter((r) => r.obligation_status === 'GRACE').length,
    overdue: rows.filter((r) => r.obligation_status === 'OVERDUE').length,
    review: rows.filter((r) => ['RECEIVED', 'UNDER_REVIEW'].includes(r.obligation_status)).length,
    verified: rows.filter((r) => r.obligation_status === 'VERIFIED').length,
    escalated: rows.filter((r) => r.suspension_event_id || r.reinstatement_event_id).length,
  }), [rows]);

  if (!isAuthReady || permsLoading) {
    return <div className="p-6 space-y-3"><Skeleton className="h-8 w-72" /><Skeleton className="h-64 w-full" /></div>;
  }

  if (!canView) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <Lock className="h-4 w-4" />
          <AlertTitle>Permission denied</AlertTitle>
          <AlertDescription>
            You do not hold the Life Certificate <code>view</code> permission for this module.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="t-page-title">Life Certificates</h1>
          <p className="t-page-subtitle mt-1">
            Policy-driven proof-of-life obligations, verification and controlled escalation
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />Refresh
        </Button>
      </div>

      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Dark launch</AlertTitle>
        <AlertDescription>
          Life Certificate actions are disabled until controlled Test validation completes. Suspension and
          reinstatement always run through the Award Suspension boundary — this module never changes an award,
          releases payment holds or raises arrears directly.
        </AlertDescription>
      </Alert>

      {invalidAwardParam && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Invalid award link</AlertTitle>
          <AlertDescription className="flex items-center gap-3">
            The award reference in the link is not valid, so the full worklist is shown instead.
            <Button size="sm" variant="outline" onClick={clearAwardScope}>Clear</Button>
          </AlertDescription>
        </Alert>
      )}

      {awardId && (
        <Alert>
          <FileCheck2 className="h-4 w-4" />
          <AlertTitle>Filtered to one award</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>
              Showing life certificate obligations for award{' '}
              <strong>{awardContext?.award_number ?? awardId.slice(0, 8)}</strong>
              {awardContext?.ssn ? <> — SSN <span className="font-mono">{awardContext.ssn}</span></> : null}
              {awardContext?.benefit_code ? <> ({awardContext.benefit_code})</> : null}.
            </span>
            <Button size="sm" variant="outline" onClick={clearAwardScope}>
              Show all obligations
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Due', value: counts.due, icon: Clock, tone: 'text-blue-600', bucket: 'DUE' as const },
          { label: 'In grace', value: counts.grace, icon: Clock, tone: 'text-amber-600', bucket: 'GRACE' as const },
          { label: 'Overdue', value: counts.overdue, icon: AlertTriangle, tone: 'text-destructive', bucket: 'OVERDUE' as const },
          { label: 'Awaiting review', value: counts.review, icon: FileCheck2, tone: 'text-amber-600', bucket: 'AWAITING_REVIEW' as const },
          { label: 'Verified', value: counts.verified, icon: CheckCircle2, tone: 'text-emerald-600', bucket: 'VERIFIED' as const },
          { label: 'Escalated', value: counts.escalated, icon: PauseCircle, tone: 'text-destructive', bucket: 'SUSPENSIONS' as const },
        ].map((kpi) => (
          <Card key={kpi.label} className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => { setBucket(kpi.bucket); setOffset(0); }}>
            <CardContent className="p-3 flex items-center gap-3">
              <kpi.icon className={`h-5 w-5 ${kpi.tone}`} />
              <div>
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
                <p className="text-xl font-bold">{kpi.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search by SSN or award number…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {LIFE_CERTIFICATE_BUCKETS.map((b) => (
              <Button
                key={b.key}
                size="sm"
                variant={bucket === b.key ? 'default' : 'outline'}
                onClick={() => { setBucket(b.key); setOffset(0); }}
              >
                {b.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {failure && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{failure.code === 'E_FORBIDDEN' ? 'Permission denied' : 'Could not load worklist'}</AlertTitle>
          <AlertDescription>{failure.message}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Award</TableHead>
                <TableHead>SSN</TableHead>
                <TableHead>Benefit</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Grace ends</TableHead>
                <TableHead>Obligation</TableHead>
                <TableHead>Evidence</TableHead>
                <TableHead>Verification</TableHead>
                <TableHead>Escalation</TableHead>
                <TableHead>Comms</TableHead>
                <TableHead className="text-right">Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={12} className="text-center py-8">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading obligations…
                </TableCell></TableRow>
              ) : failure ? (
                <TableRow><TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                  Nothing could be loaded for this view.
                </TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                  No life certificate obligations in this bucket.
                </TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.id} className={r.obligation_status === 'OVERDUE' ? 'bg-destructive/5' : ''}>
                  <TableCell className="font-mono text-xs">{r.award_number ?? r.bn_award_id.slice(0, 8)}</TableCell>
                  <TableCell className="font-mono">{r.ssn}</TableCell>
                  <TableCell>{r.benefit_code ?? '—'}</TableCell>
                  <TableCell className="text-xs">{r.obligation_period ?? '—'}</TableCell>
                  <TableCell>{r.due_date ?? '—'}</TableCell>
                  <TableCell>{r.grace_end_date ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusTone[r.obligation_status] ?? ''}>
                      {r.obligation_status.replace(/_/g, ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{r.evidence_status}</TableCell>
                  <TableCell className="text-xs">{r.verification_status}</TableCell>
                  <TableCell className="text-xs">
                    {r.suspension_event_id ? (
                      <span className="inline-flex items-center gap-1"><PauseCircle className="h-3 w-3" />Suspension</span>
                    ) : r.reinstatement_event_id ? (
                      <span className="inline-flex items-center gap-1"><PlayCircle className="h-3 w-3" />Reinstatement</span>
                    ) : r.escalation_status}
                  </TableCell>
                  <TableCell className="text-xs">{r.communication_status}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setSelectedId(r.id)}>Open</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={offset === 0 || loading}
                    onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</Button>
            <Button size="sm" variant="outline" disabled={offset + PAGE_SIZE >= total || loading}
                    onClick={() => setOffset(offset + PAGE_SIZE)}>Next</Button>
          </div>
        </div>
      )}

      <LifeCertificateDetailPanel
        lifeCertificateId={selectedId}
        onClose={() => setSelectedId(null)}
        onChanged={() => { void load(); toast.success('Life certificate updated'); }}
      />
    </div>
  );
};

export default LifeCertificateManagement;
