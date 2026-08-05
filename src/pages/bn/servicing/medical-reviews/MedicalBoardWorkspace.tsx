/**
 * Medical Board Workspace — canonical route `/bn/medical-reviews/board`.
 *
 * Distinct actor surface for Medical Board members and Board secretaries.
 * Board membership scoping happens inside the secured RPCs — this screen only
 * renders what `bn_medical_review_board_worklist_v1` returns for the caller.
 *
 * Authority separation is explicit here: the Board records a medical
 * determination. It never approves an administrative decision, and it never
 * mutates an award, payment or suspension.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, ArrowLeft, Gavel, RefreshCw } from 'lucide-react';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { useActionPermissions } from '@/hooks/useActionPermission';
import { useMedicalReviewActionsState } from '@/hooks/bn/useMedicalReviewActionsState';
import {
  medicalReviewQueryService,
  type BoardCaseRow,
} from '@/services/bn/medicalReviewQueryService';
import { describeMedicalReviewFailure } from '@/features/bn/medical-reviews/model/errors';
import { MEDICAL_REVIEW_ACTIONS } from '@/features/bn/medical-reviews/model/permissions';
import {
  MedicalReviewActionButton,
  MedicalReviewDarkLaunchBanner,
  MedicalReviewStatusBadge,
} from '@/components/bn/medical-reviews/MedicalReviewActionControls';

const MedicalBoardWorkspace: React.FC = () => {
  const { isAuthReady, isAuthenticated } = useSupabaseAuth();
  const { can, isAdmin, isLoading: permsLoading } = useActionPermissions('bn_medical_review');
  const actionsState = useMedicalReviewActionsState();

  const allow = useCallback((a: string) => isAdmin || can(a), [isAdmin, can]);
  const canView = allow(MEDICAL_REVIEW_ACTIONS.view);

  const [rows, setRows] = useState<BoardCaseRow[]>([]);
  const [selected, setSelected] = useState<BoardCaseRow | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailure(null);
    try {
      const result = await medicalReviewQueryService.boardWorklist();
      setRows(result.rows);
    } catch (e) {
      setFailure(describeMedicalReviewFailure(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthReady && isAuthenticated && canView) void load();
  }, [isAuthReady, isAuthenticated, canView, load]);

  useEffect(() => {
    let cancelled = false;
    if (!selected) {
      setDetail(null);
      return;
    }
    medicalReviewQueryService
      .boardCaseDetail(selected.boardCaseId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => {
        if (!cancelled) setFailure(describeMedicalReviewFailure(e));
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  if (!isAuthReady || permsLoading) {
    return <div className="p-6"><Skeleton className="h-64 w-full" /></div>;
  }

  if (!canView) {
    return (
      <div className="p-6">
        <Alert variant="destructive" data-testid="mr-board-permission-denied">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Permission denied</AlertTitle>
          <AlertDescription>
            Your account does not hold <code>bn.medical_review.view</code>.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const participants = Array.isArray(detail?.participants)
    ? (detail!.participants as Record<string, unknown>[])
    : [];

  return (
    <div className="space-y-4 p-6" data-testid="mr-board-workspace">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Gavel className="h-6 w-6" /> Medical Board Workspace
          </h1>
          <p className="text-sm text-muted-foreground">
            Board cases assigned to the boards you sit on or service. Determinations recorded here
            are medical findings only.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
          <Link to="/bn/medical-reviews">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" /> Medical Review Centre
            </Button>
          </Link>
        </div>
      </header>

      <MedicalReviewDarkLaunchBanner
        actionsEnabled={actionsState.actionsEnabled}
        isLoading={actionsState.isLoading}
      />

      <Alert>
        <AlertTitle>Authority separation</AlertTitle>
        <AlertDescription>
          The Medical Board issues the medical determination. Accepting or departing from it, and
          any consequential award action, is an administrative decision taken separately in the
          Medical Review Centre and executed only through the Award Suspension boundary.
        </AlertDescription>
      </Alert>

      {failure && (
        <Alert variant="destructive" data-testid="mr-board-error">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Unable to load Board cases</AlertTitle>
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4"><Skeleton className="h-40 w-full" /></div>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground" data-testid="mr-board-empty">
              No Board cases are assigned to you.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Case</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Quorum</TableHead>
                  <TableHead>Binding</TableHead>
                  <TableHead>Complete by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow
                    key={r.boardCaseId}
                    className="cursor-pointer"
                    data-state={selected?.boardCaseId === r.boardCaseId ? 'selected' : undefined}
                    onClick={() => setSelected(r)}
                  >
                    <TableCell className="font-medium">{r.caseReference ?? '—'}</TableCell>
                    <TableCell><MedicalReviewStatusBadge status={r.status} /></TableCell>
                    <TableCell>{r.requiredQuorum ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.determinationBinding ? 'Binding' : 'Advisory'}</Badge>
                    </TableCell>
                    <TableCell>{r.requiredCompletionDate ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {selected && (
        <Card data-testid="mr-board-case-detail">
          <CardHeader>
            <CardTitle className="text-base">
              {selected.caseReference ?? 'Board case'} — session and determination
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <div className="text-xs uppercase text-muted-foreground">Required quorum</div>
                <div className="text-sm">{selected.requiredQuorum ?? '—'}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Participants</div>
                <div className="text-sm">{participants.length}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Determination</div>
                <div className="text-sm">
                  {selected.determinationBinding ? 'Binding on the decision maker' : 'Advisory'}
                </div>
              </div>
            </div>

            {participants.length > 0 && (
              <div className="space-y-1">
                {participants.map((p, i) => (
                  <div key={i} className="flex items-center justify-between rounded-md border p-2 text-sm">
                    <span>{String(p.member_name ?? p.member_id ?? 'Member')}</span>
                    <Badge variant="outline">
                      {String(p.attendance_status ?? p.participation_status ?? '—')}
                    </Badge>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.manageBoardSession}
                hasPermission={allow(MEDICAL_REVIEW_ACTIONS.manageBoardSession)}
                actionsEnabled={actionsState.actionsEnabled}
                size="sm"
              >
                Schedule session
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.recordBoardParticipation}
                hasPermission={allow(MEDICAL_REVIEW_ACTIONS.recordBoardParticipation)}
                actionsEnabled={actionsState.actionsEnabled}
                size="sm"
                variant="outline"
              >
                Record attendance
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.declareConflict}
                hasPermission={allow(MEDICAL_REVIEW_ACTIONS.declareConflict)}
                actionsEnabled={actionsState.actionsEnabled}
                size="sm"
                variant="outline"
              >
                Declare conflict / recuse
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.recordBoardDetermination}
                hasPermission={allow(MEDICAL_REVIEW_ACTIONS.recordBoardDetermination)}
                actionsEnabled={actionsState.actionsEnabled}
                size="sm"
              >
                Finalise determination
              </MedicalReviewActionButton>
              {/* Deliberately absent: approve decision, suspend award, reinstate award. */}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default MedicalBoardWorkspace;
