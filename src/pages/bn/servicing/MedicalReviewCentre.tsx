/**
 * Benefits Medical Review Centre — canonical route `/bn/medical-reviews`.
 *
 * Internal Benefits staff surface.
 *
 * Deep-link ordering (`?awardId=<uuid>`):
 *   1. validate the UUID locally — a malformed id issues NO RPC at all
 *   2. call the secured award-context RPC
 *   3. only when valid context is returned, call the worklist with the filter
 * An award-context failure is never downgraded to the general worklist and is
 * never converted into `null`.
 *
 * Search honours the backend minimum: 1–2 characters issue no RPC.
 * Summary figures are explicitly labelled "Current page" — they are not
 * total-workload figures and no direct table query is used to obtain counts.
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
import { medicalReviewCommandService } from '@/services/bn/medicalReviewCommandService';
import {
  describeMedicalReviewFailure,
  medicalReviewUiState,
} from '@/features/bn/medical-reviews/model/errors';
import {
  MEDICAL_REVIEW_ACTIONS,
  type MedicalReviewAction,
} from '@/features/bn/medical-reviews/model/permissions';
import { obligationActionAvailability } from '@/features/bn/medical-reviews/model/actionAvailability';
import {
  MedicalReviewActionButton,
  MedicalReviewDarkLaunchBanner,
  MedicalReviewStatusBadge,
} from '@/components/bn/medical-reviews/MedicalReviewActionControls';
import MedicalReviewCommandDialog from '@/components/bn/medical-reviews/MedicalReviewCommandDialog';
import MedicalReviewDetailPanel from '@/components/bn/medical-reviews/MedicalReviewDetailPanel';

const PAGE_SIZE = 25;
export const SEARCH_MIN_CHARS = 3;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v: string | null | undefined): v is string => !!v && UUID_RE.test(v);

type AwardContextState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'loaded'; context: MedicalReviewAwardContext }
  | { status: 'forbidden'; message: string }
  | { status: 'unavailable'; message: string }
  | { status: 'failed'; message: string };

const MedicalReviewCentre: React.FC = () => {
  const { isAuthReady, isAuthenticated } = useSupabaseAuth();
  const { can, isAdmin, isLoading: permsLoading } = useActionPermissions('bn_medical_review');
  const actionsState = useMedicalReviewActionsState();

  const allow = useCallback((action: string) => isAdmin || can(action), [isAdmin, can]);
  const hasPermission = useCallback(
    (action: MedicalReviewAction) => allow(action),
    [allow],
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
  const [awardState, setAwardState] = useState<AwardContextState>({ status: 'none' });
  const [selected, setSelected] = useState<MedicalReviewWorklistRow | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);

  const trimmed = debounced.trim();
  const searchTooShort = trimmed.length > 0 && trimmed.length < SEARCH_MIN_CHARS;

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search);
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const clearAwardScope = useCallback(() => {
    // Preserve every unrelated query parameter.
    const next = new URLSearchParams(
      Array.from(searchParams.entries()).filter(([k]) => k !== 'awardId'),
    );
    setSearchParams(next, { replace: true });
    setOffset(0);
    setSelected(null);
    setAwardState({ status: 'none' });
  }, [searchParams, setSearchParams]);

  const load = useCallback(async () => {
    setLoading(true);
    setFailure(null);

    // Step 1 + 2: award context strictly BEFORE the award-scoped worklist.
    if (awardId) {
      setAwardState({ status: 'loading' });
      let context: MedicalReviewAwardContext;
      try {
        context = await medicalReviewQueryService.awardContext(awardId);
      } catch (err) {
        const uiState = medicalReviewUiState(err);
        const message = describeMedicalReviewFailure(err);
        // An access refusal on a real award is a permission problem, not a
        // missing record — the two must not be collapsed together.
        const forbidden =
          uiState === 'PERMISSION_DENIED' ||
          (err instanceof MedicalReviewError &&
            (err.code === 'E_RECORD_FORBIDDEN' || err.code === 'E_MEMBER_RECUSED'));
        setAwardState(
          forbidden
            ? { status: 'forbidden', message }
            : uiState === 'RECORD_UNAVAILABLE'
              ? { status: 'unavailable', message }
              : { status: 'failed', message },
        );
        // Never fall back to the general worklist.
        setRows([]);
        setTotal(0);
        setLoading(false);
        return;
      }
      setAwardState({ status: 'loaded', context });
    } else {
      setAwardState({ status: 'none' });
    }

    // Step 3: worklist.
    try {
      const worklist = await medicalReviewQueryService.worklist({
        awardId,
        search: trimmed.length >= SEARCH_MIN_CHARS ? trimmed : null,
        limit: PAGE_SIZE,
        offset,
      });
      setRows(worklist.rows);
      setTotal(worklist.total ?? worklist.rows.length);
    } catch (err) {
      setFailure(describeMedicalReviewFailure(err));
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [awardId, trimmed, offset]);

  useEffect(() => {
    if (invalidAwardParam) {
      setRows([]);
      setTotal(0);
      setAwardState({ status: 'none' });
      setLoading(false);
      return;
    }
    if (searchTooShort) {
      setLoading(false);
      return; // no RPC below the backend minimum
    }
    if (isAuthReady && isAuthenticated && canView) void load();
  }, [isAuthReady, isAuthenticated, canView, load, invalidAwardParam, searchTooShort]);

  const pageCounts = useMemo(
    () => ({
      due: rows.filter((r) => /DUE|SCHEDULED|PENDING/.test(r.status ?? '')).length,
      overdue: rows.filter((r) => /OVERDUE|BREACH/.test(r.status ?? '')).length,
      board: rows.filter((r) => /BOARD/.test(r.status ?? '')).length,
      decision: rows.filter((r) => /DECISION/.test(r.status ?? '')).length,
    }),
    [rows],
  );

  const obligationActions = useMemo(
    () =>
      obligationActionAvailability({
        hasPermission,
        actionsEnabled: actionsState.actionsEnabled,
        state: selected?.status ?? null,
        rowVersion: selected?.rowVersion ?? null,
      }),
    [hasPermission, actionsState.actionsEnabled, selected],
  );

  const generateAvailability = useMemo(() => {
    const base = obligationActions[MEDICAL_REVIEW_ACTIONS.generateObligations];
    if (!base.enabled) return base;
    if (!awardId)
      return {
        ...base,
        enabled: false,
        blockedReason: 'Open the Centre scoped to an award to generate obligations.',
      };
    return base;
  }, [obligationActions, awardId]);

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

  const awardContext = awardState.status === 'loaded' ? awardState.context : null;

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

      {awardState.status === 'forbidden' && (
        <Alert variant="destructive" data-testid="mr-award-forbidden">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Permission denied for this award</AlertTitle>
          <AlertDescription>
            {awardState.message} The worklist was not loaded for this award.
          </AlertDescription>
        </Alert>
      )}

      {awardState.status === 'unavailable' && (
        <Alert variant="destructive" data-testid="mr-award-unavailable">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Record unavailable</AlertTitle>
          <AlertDescription>{awardState.message}</AlertDescription>
        </Alert>
      )}

      {awardState.status === 'failed' && (
        <Alert variant="destructive" data-testid="mr-award-failed">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Award context could not be loaded</AlertTitle>
          <AlertDescription>{awardState.message}</AlertDescription>
        </Alert>
      )}

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

      <div className="grid gap-3 sm:grid-cols-4" data-testid="mr-page-counters">
        {[
          ['Due', pageCounts.due],
          ['Overdue', pageCounts.overdue],
          ['At Board', pageCounts.board],
          ['At decision', pageCounts.decision],
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <CardContent className="p-4">
              <div className="text-xs uppercase text-muted-foreground">
                {label} · Current page
              </div>
              <div className="text-2xl font-semibold">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Figures above count the rows on the current page only. They are not total workload figures.
      </p>

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
          blockedReason={generateAvailability.blockedReason}
          size="sm"
          onClick={() => setGenerateOpen(true)}
        >
          Generate obligations
        </MedicalReviewActionButton>
        <span className="text-xs text-muted-foreground">
          Referral, appointment, report, Board and decision actions open from the selected review
          below.
        </span>
      </div>

      {searchTooShort && (
        <p className="text-sm text-muted-foreground" data-testid="mr-search-min-hint">
          Enter at least {SEARCH_MIN_CHARS} characters to search.
        </p>
      )}

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
              {failure
                ? 'The worklist could not be loaded — this is not an empty result.'
                : 'No medical review obligations are visible to you for this filter.'}
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
                    data-state={selected?.obligationId === r.obligationId ? 'selected' : undefined}
                    onClick={() => setSelected(r)}
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

      {selected && (
        <MedicalReviewDetailPanel
          obligationId={selected.obligationId}
          reviewType={selected.reviewType}
          hasPermission={hasPermission}
          actionsEnabled={actionsState.actionsEnabled}
          canViewConfidential={allow(MEDICAL_REVIEW_ACTIONS.viewConfidentialMedicalEvidence)}
          canViewAudit={allow(MEDICAL_REVIEW_ACTIONS.viewAudit)}
        />
      )}

      <MedicalReviewCommandDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        title="Generate medical review obligation"
        description="Creates a review obligation for the scoped award under the selected published policy."
        testId="mr-dialog-generate-obligation"
        submitLabel="Generate obligation"
        availability={generateAvailability}
        rowVersion={null}
        fields={[
          { name: 'policyId', label: 'Policy', type: 'text', required: true, help: 'Published Medical Review policy identifier.' },
          { name: 'reviewType', label: 'Review type', type: 'text', required: true },
          { name: 'reviewReason', label: 'Review reason', type: 'text', required: true },
          { name: 'periodStart', label: 'Period start', type: 'date', required: true },
          { name: 'periodEnd', label: 'Period end', type: 'date', required: true },
          { name: 'riskClassification', label: 'Risk classification', type: 'text', required: true },
          { name: 'reason', label: 'Reason', type: 'textarea', required: true },
        ]}
        execute={(values, ctx) =>
          medicalReviewCommandService.generateObligation({
            awardId: awardId!,
            policyId: String(values.policyId),
            reviewType: String(values.reviewType),
            reviewReason: String(values.reviewReason),
            periodStart: String(values.periodStart),
            periodEnd: String(values.periodEnd),
            riskClassification: String(values.riskClassification),
            reason: String(values.reason),
            idempotencyKey: ctx.idempotencyKey,
          })
        }
        onCompleted={() => void load()}
      />
    </div>
  );
};

export default MedicalReviewCentre;
