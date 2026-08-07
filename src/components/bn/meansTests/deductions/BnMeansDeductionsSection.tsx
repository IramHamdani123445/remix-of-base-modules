/**
 * MEANS-TEST EPIC 5 — Deductions and disregards section.
 *
 * Readiness, blockers, warnings, the gross claimed total and the annualised
 * claim values are all backend-owned (`bn_means_deduction_readiness_v1`,
 * `bn_means_deductions_v1`). This section records what is claimed — it never
 * decides how much is allowed and never decides the means-test outcome.
 */
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertTriangle, CheckCircle2, Info, Loader2, Pencil, Plus, Scale, ShieldQuestion, Trash2, UserX,
} from 'lucide-react';
import { toast } from 'sonner';
import { MeansStateNotice } from '@/components/bn/meansTests/controls/MeansControls';
import { meansQueryService } from '@/services/bn/meansTests/meansQueryService';
import { meansCommandService } from '@/services/bn/meansTests/meansCommandService';
import type { BnMeansCommandName } from '@/types/bn/meansTests/meansCommands';
import type { BnMeansLoadState } from '@/types/bn/meansTests/meansFieldContract';
import { formatWithCurrency } from '@/utils/formatCurrency';
import BnMeansDeductionDialog from './BnMeansDeductionDialog';
import BnMeansNoDeductionsDialog from './BnMeansNoDeductionsDialog';
import {
  deductionReasonLabel,
  draftFromDeductionClaim,
  emptyDeductionDraft,
  type BnMeansClaimKind,
  type BnMeansDeductionClaim,
  type BnMeansDeductionDraft,
  type BnMeansDisregardCandidate,
} from '@/types/bn/meansTests/meansDeductions';

export interface BnMeansDeductionsSectionProps {
  assessmentId: string;
  assessmentFrom: string;
  assessmentTo: string | null;
  editable: boolean;
  availableActions: readonly string[];
  onSectionComplete?: () => void;
}

function toLoadState(status: string | undefined): Exclude<BnMeansLoadState, 'SUCCESS' | 'EMPTY'> {
  if (status === 'DENIED') return 'DENIED';
  if (status === 'NOT_IMPLEMENTED') return 'NOT_IMPLEMENTED';
  if (status === undefined) return 'LOADING';
  return 'FAILED';
}

export const BnMeansDeductionsSection: React.FC<BnMeansDeductionsSectionProps> = ({
  assessmentId, assessmentFrom, assessmentTo, editable, availableActions, onSectionComplete,
}) => {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [noneOpen, setNoneOpen] = React.useState(false);
  const [editingDraft, setEditingDraft] = React.useState<BnMeansDeductionDraft | null>(null);
  const [removeTarget, setRemoveTarget] = React.useState<BnMeansDeductionClaim | null>(null);
  const [commandError, setCommandError] = React.useState<{ code: string; message: string } | null>(null);

  const deductionQuery = useQuery({
    queryKey: ['bn-means-deductions', assessmentId],
    queryFn: () => meansQueryService.deductions(assessmentId),
  });
  const readinessQuery = useQuery({
    queryKey: ['bn-means-deduction-readiness', assessmentId],
    queryFn: () => meansQueryService.deductionReadiness(assessmentId),
  });
  const referenceQuery = useQuery({
    queryKey: ['bn-means-deduction-reference'],
    queryFn: () => meansQueryService.deductionReference(),
  });

  function refresh() {
    void qc.invalidateQueries({ queryKey: ['bn-means-deductions', assessmentId] });
    void qc.invalidateQueries({ queryKey: ['bn-means-deduction-readiness', assessmentId] });
    void qc.invalidateQueries({ queryKey: ['bn-means-detail', assessmentId] });
    void qc.invalidateQueries({ queryKey: ['bn-means-actions', assessmentId] });
  }

  const mutation = useMutation({
    mutationFn: (input: { command: BnMeansCommandName; payload: Record<string, unknown> }) =>
      meansCommandService.execute({
        command: input.command,
        assessmentId,
        payload: input.payload,
      }),
    onSuccess: (result, input) => {
      if (result.status !== 'FAILED') {
        setCommandError(null);
        setDialogOpen(false);
        setNoneOpen(false);
        setRemoveTarget(null);
        refresh();
        const warnings = (result.data?.result as Record<string, unknown> | undefined)?.warnings;
        if (Array.isArray(warnings) && warnings.length > 0) {
          toast.warning(warnings.map((w) => deductionReasonLabel(String(w))).join(' '));
        } else {
          toast.success('Deduction information updated');
        }
        if (input.command === 'BN_MEANS_MARK_DEDUCTIONS_COMPLETE') onSectionComplete?.();
        return;
      }
      const code = result.errorCode ?? 'UNKNOWN';
      const detail = result.errorDetail ?? '';
      const message = deductionReasonLabel(detail || code);
      setCommandError({ code: detail || code, message });
      if (!dialogOpen && !noneOpen) toast.error(message);
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'The command could not be completed.';
      setCommandError({ code: 'UNKNOWN', message });
      toast.error(message);
    },
  });

  if (deductionQuery.isLoading || readinessQuery.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading deduction information…
        </CardContent>
      </Card>
    );
  }

  const deductionResult = deductionQuery.data;
  const readinessResult = readinessQuery.data;

  if (!deductionResult || deductionResult.status !== 'OK' || !deductionResult.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Deductions and disregards</CardTitle>
        </CardHeader>
        <CardContent>
          <MeansStateNotice
            state={toLoadState(deductionResult?.status)}
            reason={deductionResult?.detail ?? 'Deduction information could not be loaded.'}
            testId="means-deduction-section-state"
          />
        </CardContent>
      </Card>
    );
  }

  const detail = deductionResult.data;
  const readiness = readinessResult?.status === 'OK' ? readinessResult.data : null;
  const reference = referenceQuery.data?.status === 'OK' ? referenceQuery.data.data : null;
  const referenceState: Exclude<BnMeansLoadState, 'EMPTY'> = referenceQuery.isLoading
    ? 'LOADING'
    : reference
      ? 'SUCCESS'
      : toLoadState(referenceQuery.data?.status);

  const claims = detail.claims ?? [];
  const deductionClaims = claims.filter((c) => c.claim_kind === 'DEDUCTION_CLAIM');
  const disregardClaims = claims.filter((c) => c.claim_kind === 'DISREGARD_CANDIDATE');
  const currency = detail.currency_code;
  const canEdit = editable && detail.editable;
  const canMarkComplete =
    canEdit &&
    Boolean(readiness?.section_complete) &&
    availableActions.includes('BN_MEANS_MARK_DEDUCTIONS_COMPLETE');
  const assetsIncomplete = Boolean(
    readiness?.blockers.some((b) => b.code === 'ASSET_SECTION_INCOMPLETE'),
  );
  const memberById = new Map(detail.household_members.map((m) => [m.member_id, m]));
  const outstandingIssues =
    (readiness?.blockers.length ?? 0) + (readiness?.warnings.length ?? 0);

  function openClaim(kind: BnMeansClaimKind, candidate?: BnMeansDisregardCandidate) {
    const draft = emptyDeductionDraft(assessmentFrom, kind);
    setEditingDraft(
      candidate
        ? {
            ...draft,
            targetKind: candidate.source_type === 'ASSET' ? 'ASSET_FACT' : 'INCOME_FACT',
            targetRefId: candidate.source_fact_id,
            memberId: candidate.member_id ?? '',
          }
        : draft,
    );
    setCommandError(null);
    setDialogOpen(true);
  }

  function renderClaimRows(rows: readonly BnMeansDeductionClaim[]) {
    return rows.map((claim) => (
      <TableRow key={claim.deduction_fact_id} data-testid={`means-deduction-row-${claim.deduction_fact_id}`}>
        <TableCell>
          <span className="font-medium">{claim.category_label}</span>
          <span className="block text-xs text-muted-foreground">{claim.claim_kind_label}</span>
        </TableCell>
        <TableCell>
          <span className="font-medium">{claim.target_label}</span>
          <span className="block text-xs text-muted-foreground">
            {claim.target_detail ?? claim.target_kind_label}
          </span>
        </TableCell>
        <TableCell className="whitespace-nowrap">
          {claim.claimed_amount === null
            ? '—'
            : formatWithCurrency(claim.claimed_amount, claim.currency_code)}
          <span className="block text-xs text-muted-foreground">
            {claim.declared_frequency_label ?? 'No frequency'}
            {claim.claimed_percentage !== null ? ` · ${claim.claimed_percentage}% claimed` : ''}
          </span>
        </TableCell>
        <TableCell className="whitespace-nowrap text-sm">
          {claim.claim_reason_label ?? '—'}
          <span className="block text-xs text-muted-foreground">{claim.fact_source_label}</span>
        </TableCell>
        <TableCell className="whitespace-nowrap text-sm">
          {claim.effective_from ?? '—'} → {claim.effective_to ?? 'present'}
        </TableCell>
        <TableCell className="text-xs">
          <Badge variant="outline">{claim.treatment_status_label}</Badge>
          <span className="mt-1 block text-muted-foreground">
            Evidence:{' '}
            {claim.evidence_requirement === 'REQUIRED' ? 'required' : 'not required'} ·{' '}
            {claim.linked_evidence_count} attached
          </span>
        </TableCell>
        {canEdit && (
          <TableCell className="text-right">
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Correct claim ${claim.category_label}`}
              onClick={() => {
                setEditingDraft(draftFromDeductionClaim(claim));
                setCommandError(null);
                setDialogOpen(true);
              }}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Remove claim ${claim.category_label}`}
              onClick={() => setRemoveTarget(claim)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </TableCell>
        )}
      </TableRow>
    ));
  }

  return (
    <div className="space-y-4" data-testid="means-deduction-section">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Scale className="h-4 w-4" /> Deductions and disregards
            </CardTitle>
            <CardDescription>
              What is being claimed, against which subject, for what reason and for what period.
              How much is allowed is decided later, at calculation.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={readiness?.section_complete ? 'default' : 'secondary'}
              data-testid="means-deduction-status"
            >
              {readiness ? readiness.section_status.replace(/_/g, ' ') : 'UNAVAILABLE'}
            </Badge>
            {canEdit && !assetsIncomplete && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="means-deduction-declare-none"
                  onClick={() => {
                    setCommandError(null);
                    setNoneOpen(true);
                  }}
                >
                  <UserX className="mr-1 h-4 w-4" /> Confirm none claimed
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="means-deduction-add-disregard"
                  onClick={() => openClaim('DISREGARD_CANDIDATE')}
                >
                  <ShieldQuestion className="mr-1 h-4 w-4" /> Record disregard
                </Button>
                <Button
                  size="sm"
                  data-testid="means-deduction-add"
                  onClick={() => openClaim('DEDUCTION_CLAIM')}
                >
                  <Plus className="mr-1 h-4 w-4" /> Claim deduction
                </Button>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!readiness && (
            <MeansStateNotice
              state={toLoadState(readinessResult?.status)}
              reason={readinessResult?.detail ?? 'Deduction readiness could not be evaluated.'}
              testId="means-deduction-readiness-state"
            />
          )}

          {assetsIncomplete && (
            <Alert data-testid="means-deduction-asset-gate">
              <Info className="h-4 w-4" />
              <AlertTitle>Asset assessment first</AlertTitle>
              <AlertDescription>
                {deductionReasonLabel('ASSET_SECTION_INCOMPLETE')}
              </AlertDescription>
            </Alert>
          )}

          {readiness && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="means-deduction-summary">
              {[
                [
                  'Gross claimed deductions',
                  formatWithCurrency(
                    readiness.gross_claimed_deduction_total,
                    readiness.currency_code,
                  ),
                ],
                ['Deduction claims', String(readiness.deduction_claim_count)],
                ['Potential disregards', String(readiness.disregard_candidate_count)],
                ['Outstanding issues', String(outstandingIssues)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border p-3">
                  <p className="text-xs uppercase text-muted-foreground">{label}</p>
                  <p className="text-lg font-semibold">{value}</p>
                </div>
              ))}
            </div>
          )}

          <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="means-deduction-claimed-note">
            <Info className="h-3.5 w-3.5" />
            These are claimed amounts. Nothing here reduces assessable income or capital until
            the assessment is calculated.
          </p>

          {readiness && readiness.claims_requiring_evidence > 0 && (
            <p className="text-xs text-muted-foreground" data-testid="means-deduction-evidence-count">
              {readiness.claims_requiring_evidence} claim(s) require evidence. Evidence is
              attached in the evidence stage.
            </p>
          )}

          {readiness && readiness.blockers.length > 0 && (
            <Alert variant="destructive" data-testid="means-deduction-blockers">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Resolve before completing this section</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {readiness.blockers.map((b) => (
                    <li key={b.code}>{b.message || deductionReasonLabel(b.code)}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {readiness && readiness.warnings.length > 0 && (
            <Alert data-testid="means-deduction-warnings">
              <Info className="h-4 w-4" />
              <AlertTitle>Check before continuing</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {readiness.warnings.map((w) => (
                    <li key={w.code}>{w.message || deductionReasonLabel(w.code)}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {detail.disregard_candidates.length > 0 && (
            <div className="rounded-md border p-3" data-testid="means-deduction-candidates">
              <p className="text-sm font-medium">Potential disregards flagged earlier</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Raised while recording income and assets. Each one needs an officer decision here.
              </p>
              <ul className="mt-2 space-y-2 text-xs">
                {detail.disregard_candidates.map((candidate) => (
                  <li
                    key={`${candidate.source_type}-${candidate.source_fact_id}`}
                    className="flex flex-wrap items-center justify-between gap-2"
                    data-testid={`means-deduction-candidate-${candidate.source_fact_id}`}
                  >
                    <span>
                      <span className="font-medium">{candidate.candidate_label}</span> ·{' '}
                      {candidate.member_name ?? 'Household'} · {candidate.category_label}
                      {candidate.candidate_reason_label
                        ? ` · ${candidate.candidate_reason_label}`
                        : ''}
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge variant={candidate.claim_recorded ? 'default' : 'secondary'}>
                        {candidate.status_label}
                      </Badge>
                      {canEdit && !candidate.claim_recorded && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openClaim('DISREGARD_CANDIDATE', candidate)}
                        >
                          Review
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {claims.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center" data-testid="means-deduction-empty">
              <p className="text-sm font-medium">Nothing claimed yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Record each deduction claimed or potential disregard, or confirm explicitly that
                nothing is claimed.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {[
                ['Deductions claimed', deductionClaims] as const,
                ['Potential disregards', disregardClaims] as const,
              ]
                .filter(([, rows]) => rows.length > 0)
                .map(([title, rows]) => (
                  <div key={title} className="space-y-2">
                    <p className="text-sm font-medium">{title}</p>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Category</TableHead>
                            <TableHead>Claimed against</TableHead>
                            <TableHead>Claimed</TableHead>
                            <TableHead>Basis</TableHead>
                            <TableHead>Period</TableHead>
                            <TableHead>Status</TableHead>
                            {canEdit && <TableHead className="text-right">Actions</TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>{renderClaimRows(rows)}</TableBody>
                      </Table>
                    </div>
                  </div>
                ))}
            </div>
          )}

          {detail.none_declarations.length > 0 && (
            <div className="rounded-md border p-3" data-testid="means-deduction-none-list">
              <p className="text-sm font-medium">Nothing-claimed confirmations</p>
              <ul className="mt-2 space-y-1 text-xs">
                {detail.none_declarations.map((d) => (
                  <li key={d.declaration_id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="font-medium">
                        {d.declaration_scope === 'ASSESSMENT'
                          ? 'Whole assessment'
                          : memberById.get(d.member_id ?? '')?.display_name ?? 'Household member'}
                      </span>{' '}
                      · {d.reason_label ?? '—'} · {d.declaration_source_label}
                    </span>
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          mutation.mutate({
                            command: 'BN_MEANS_WITHDRAW_NO_DEDUCTIONS',
                            payload: { declaration_id: d.declaration_id },
                          })
                        }
                      >
                        Withdraw
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="text-xs text-muted-foreground">
              {readiness?.section_complete
                ? 'The backend reports this section as ready to complete.'
                : 'Completion is decided by the backend once every requirement is met.'}
            </p>
            <Button
              disabled={!canMarkComplete || mutation.isPending}
              data-testid="means-deduction-mark-complete"
              onClick={() =>
                mutation.mutate({ command: 'BN_MEANS_MARK_DEDUCTIONS_COMPLETE', payload: {} })
              }
            >
              {mutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              Mark deductions complete
            </Button>
          </div>
        </CardContent>
      </Card>

      <BnMeansDeductionDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setCommandError(null);
        }}
        initialDraft={editingDraft}
        currency={currency}
        assessmentFrom={assessmentFrom}
        assessmentTo={assessmentTo}
        members={detail.household_members}
        incomeTargets={detail.income_targets}
        assetTargets={detail.asset_targets}
        rules={detail.deduction_rules}
        reference={reference}
        referenceState={referenceState}
        referenceReason={referenceQuery.data?.detail ?? null}
        busy={mutation.isPending}
        commandError={commandError}
        onSubmit={(payload, draft) =>
          mutation.mutate({
            command: draft.deductionFactId
              ? 'BN_MEANS_CORRECT_DEDUCTION'
              : 'BN_MEANS_ADD_DEDUCTION',
            payload,
          })
        }
      />

      <BnMeansNoDeductionsDialog
        open={noneOpen}
        onOpenChange={(open) => {
          setNoneOpen(open);
          if (!open) setCommandError(null);
        }}
        members={detail.household_members}
        rules={detail.deduction_rules}
        reference={reference}
        referenceState={referenceState}
        referenceReason={referenceQuery.data?.detail ?? null}
        busy={mutation.isPending}
        commandError={commandError}
        onSubmit={(payload) =>
          mutation.mutate({ command: 'BN_MEANS_DECLARE_NO_DEDUCTIONS', payload })
        }
      />

      <AlertDialog open={Boolean(removeTarget)} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this claim?</AlertDialogTitle>
            <AlertDialogDescription>
              The claim is voided rather than deleted: it stays in the assessment audit trail and
              can be explained later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep claim</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                removeTarget &&
                mutation.mutate({
                  command: 'BN_MEANS_VOID_DEDUCTION',
                  payload: { deduction_fact_id: removeTarget.deduction_fact_id },
                })
              }
            >
              Remove claim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default BnMeansDeductionsSection;
