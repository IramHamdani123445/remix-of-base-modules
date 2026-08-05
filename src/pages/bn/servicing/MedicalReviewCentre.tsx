/**
 * Benefits Medical Review Centre — canonical route `/bn/medical-reviews`.
 *
 * Internal Benefits staff surface. Read-only while the module is
 * dark-launched: every mutating control renders disabled with a reason.
 *
 * Supports the Award 360 deep link `?awardId=<uuid>`. A malformed award
 * parameter is NEVER downgraded to the general worklist — no RPC runs and an
 * explicit "invalid award link" state is shown.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, ArrowUpRight, Gavel, RefreshCw, Search, Stethoscope, X } from 'lucide-react';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { useActionPermissions } from '@/hooks/useActionPermission';
import { useMedicalReviewActionsState } from '@/hooks/bn/useMedicalReviewActionsState';
import {
  medicalReviewQueryService,
  type MedicalReviewAwardContext,
  type MedicalReviewWorklistRow,
} from '@/services/bn/medicalReviewQueryService';
import { describeMedicalReviewFailure } from '@/features/bn/medical-reviews/model/errors';
import { MEDICAL_REVIEW_ACTIONS } from '@/features/bn/medical-reviews/model/permissions';
import {
  MedicalReviewActionButton,
  MedicalReviewDarkLaunchBanner,
  MedicalReviewStatusBadge,
} from '@/components/bn/medical-reviews/MedicalReviewActionControls';
import MedicalReviewDetailPanel from '@/components/bn/medical-reviews/MedicalReviewDetailPanel';

const PAGE_SIZE = 25;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v: string | null | undefined): v is string => !!v && UUID_RE.test(v);

const MedicalReviewCentre: React.FC = () => {
  const { isAuthReady, isAuthenticated } = useSupabaseAuth();
  const { can, isAdmin, isLoading: permsLoading } = useActionPermissions('bn_medical_review');
  const actionsState = useMedicalReviewActionsState();

  const allow = useCallback(
    (action: string) => isAdmin || can(action),
    [isAdmin, can],
  );
  const canView = allow(MEDICAL_REVIEW_ACTIONS.view);

  const [searchParams, setSearchParams] = useSearchParams();
  const rawAwardId = searchParams.get('awardId');
  const awardId = isUuid(rawAwardId) ? rawAwardId : null;
  const invalidAwardParam = !!rawAwardId && !awardId;

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<MedicalReviewWorklistRow[]>([]);
  const [total, setTotal] = useState(0);
  const [awardContext, setAwardContext] = useState<MedicalReviewAwardContext | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search);
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const clearAwardScope = useCallback(() => {
    const next = new URLSearchParams(
      Array.from(searchParams.entries()).filter(([k]) => k !== 'awardId'),
    );
    setSearchParams(next, { replace: true });
    setOffset(0);
    setSelectedId(null);
  }, [searchParams, setSearchParams]);

  const load = useCallback(async () => {
    setLoading(true);
    setFailure(null);
    try {
      const [worklist, context] = await Promise.all([
        medicalReviewQueryService.worklist({
          awardId,
          search: debounced || null,
          limit: PAGE_SIZE,
          offset,
        }),
        awardId
          ? medicalReviewQueryService.awardContext(awardId).catch(() => null)
          : Promise.resolve(null),
      ]);
      setRows(worklist.rows);
      setTotal(worklist.total ?? worklist.rows.length);
      setAwardContext(context);
    } catch (e) {
      setFailure(describeMedicalReviewFailure(e));
      setRows([]);
      setTotal(0);
      setAwardContext(null);
    } finally {
      setLoading(false);
    }
  }, [awardId, debounced, offset]);

  useEffect(() => {
    // Fail fast on a malformed deep link: no RPC call at all.
    if (invalidAwardParam) {
      setRows([]);
      setTotal(0);
      setAwardContext(null);
      setLoading(false);
      return;
    }
    if (isAuthReady && isAuthenticated && canView) void load();
  }, [isAuthReady, isAuthenticated, canView, load, invalidAwardParam]);

  const counts = useMemo(
    () => ({
      due: rows.filter((r) => /DUE|SCHEDULED|PENDING/.test(r.status ?? '')).length,
      overdue: rows.filter((r) => /OVERDUE|BREACH/.test(r.status ?? '')).length,
      board: rows.filter((r) => /BOARD/.test(r.status ?? '')).length,
      decision: rows.filter((r) => /DECISION/.test(r.status ?? '')).length,
    }),
    [rows],
  );

  if (!isAuthReady || permsLoading) {
    return <div className="p-6"><Skeleton className="h-64 w-full" /></div>;
  }

  if (!canView) {
    return (
      <div className="p-6">
        <Alert variant="destructive" data-testid="mr-permission-denied">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Permission denied</AlertTitle>
          <AlertDescription>
            Your account does not hold <code>bn.medical_review.view</code>.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (invalidAwardParam) {
    return (
      <div className="space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Medical Review Centre</h1>
        <Alert variant="destructive" data-testid="mr-invalid-award-link">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Invalid award link</AlertTitle>
          <AlertDescription>
            The award reference in this link is not a valid identifier, so no records were loaded.
            Open the Medical Review Centre without the award filter to browse the general worklist.
          </AlertDescription>
        </Alert>
        <Button variant="outline" onClick={clearAwardScope}>
          Open general worklist
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6" data-testid="mr-centre">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Stethoscope className="h-6 w-6" /> Medical Review Centre
          </h1>
          <p className="text-sm text-muted-foreground">
            Benefits staff workspace for medical review obligations, referrals, assessments and
            administrative decisions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
          <Link to="/bn/medical-reviews/board">
            <Button variant="outline" size="sm">
              <Gavel className="mr-2 h-4 w-4" /> Medical Board workspace
            </Button>
          </Link>
        </div>
      </header>

      <MedicalReviewDarkLaunchBanner
        actionsEnabled={actionsState.actionsEnabled}
        isLoading={actionsState.isLoading}
      />

      {awardContext && (
        <Card data-testid="mr-award-scope">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="text-sm">
              <span className="font-medium">Scoped to award {awardContext.awardNumber ?? '—'}</span>
              <span className="ml-2 text-muted-foreground">
                {awardContext.benefitCode ?? '—'} · {awardContext.awardStatus ?? '—'} ·{' '}
                {awardContext.openReviews} open review(s)
              </span>
            </div>
            <div className="flex items-center gap-2">
              {awardContext.awardId && (
                <Link
                  to={`/bn/awards/${awardContext.awardId}`}
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  Award 360 <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              )}
              <Button variant="ghost" size="sm" onClick={clearAwardScope}>
                <X className="mr-1 h-3.5 w-3.5" /> Clear filter
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ['Due', counts.due],
          ['Overdue', counts.overdue],
          ['At Board', counts.board],
          ['At decision', counts.decision],
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <CardContent className="p-4">
              <div className="text-xs uppercase text-muted-foreground">{label}</div>
              <div className="text-2xl font-semibold">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search by obligation reference…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search medical reviews"
          />
        </div>
        <MedicalReviewActionButton
          action={MEDICAL_REVIEW_ACTIONS.generateObligations}
          hasPermission={allow(MEDICAL_REVIEW_ACTIONS.generateObligations)}
          actionsEnabled={actionsState.actionsEnabled}
          size="sm"
        >
          Generate obligations
        </MedicalReviewActionButton>
        <MedicalReviewActionButton
          action={MEDICAL_REVIEW_ACTIONS.issueReferral}
          hasPermission={allow(MEDICAL_REVIEW_ACTIONS.issueReferral)}
          actionsEnabled={actionsState.actionsEnabled}
          size="sm"
          variant="outline"
          blockedReason={selectedId ? null : 'Select a review first.'}
        >
          Issue referral
        </MedicalReviewActionButton>
        <MedicalReviewActionButton
          action={MEDICAL_REVIEW_ACTIONS.prepareDecision}
          hasPermission={allow(MEDICAL_REVIEW_ACTIONS.prepareDecision)}
          actionsEnabled={actionsState.actionsEnabled}
          size="sm"
          variant="outline"
          blockedReason={selectedId ? null : 'Select a review first.'}
        >
          Prepare decision
        </MedicalReviewActionButton>
        <MedicalReviewActionButton
          action={MEDICAL_REVIEW_ACTIONS.approveDecision}
          hasPermission={allow(MEDICAL_REVIEW_ACTIONS.approveDecision)}
          actionsEnabled={actionsState.actionsEnabled}
          size="sm"
          variant="outline"
          blockedReason={selectedId ? null : 'Select a review first.'}
        >
          Approve decision
        </MedicalReviewActionButton>
      </div>

      {failure && (
        <Alert variant="destructive" data-testid="mr-worklist-error">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Unable to load the worklist</AlertTitle>
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4"><Skeleton className="h-40 w-full" /></div>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground" data-testid="mr-worklist-empty">
              No medical review obligations are visible to you for this filter.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Award</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Risk</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow
                    key={r.obligationId}
                    className="cursor-pointer"
                    data-state={selectedId === r.obligationId ? 'selected' : undefined}
                    onClick={() => setSelectedId(r.obligationId)}
                  >
                    <TableCell className="font-medium">{r.obligationReference ?? '—'}</TableCell>
                    <TableCell>{r.awardNumber ?? '—'}</TableCell>
                    <TableCell>{r.reviewType ?? '—'}</TableCell>
                    <TableCell><MedicalReviewStatusBadge status={r.status} /></TableCell>
                    <TableCell>{r.dueDate ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.riskClassification ?? '—'}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {selectedId && (
        <MedicalReviewDetailPanel
          obligationId={selectedId}
          canViewConfidential={allow(MEDICAL_REVIEW_ACTIONS.viewConfidentialMedicalEvidence)}
          canViewAudit={allow(MEDICAL_REVIEW_ACTIONS.viewAudit)}
        />
      )}
    </div>
  );
};

export default MedicalReviewCentre;
