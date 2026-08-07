/**
 * MEANS-TEST EPIC 3 — Income assessment section.
 *
 * Readiness, blockers, warnings, the declared annualised total and the
 * normalised annual amount of every record all come from the backend
 * (`bn_means_income_readiness_v1`, `bn_means_income_v1`). The section never
 * decides completeness locally and never annualises money in React.
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
  AlertTriangle, CheckCircle2, Coins, Info, Loader2, Pencil, Plus, Trash2, UserX,
} from 'lucide-react';
import { toast } from 'sonner';
import { MeansStateNotice } from '@/components/bn/meansTests/controls/MeansControls';
import { meansQueryService } from '@/services/bn/meansTests/meansQueryService';
import { meansCommandService } from '@/services/bn/meansTests/meansCommandService';
import type { BnMeansCommandName } from '@/types/bn/meansTests/meansCommands';
import type { BnMeansLoadState } from '@/types/bn/meansTests/meansFieldContract';
import { formatWithCurrency } from '@/utils/formatCurrency';
import BnMeansIncomeDialog from './BnMeansIncomeDialog';
import BnMeansNoIncomeDialog from './BnMeansNoIncomeDialog';
import {
  draftFromIncomeFact,
  incomeReasonLabel,
  type BnMeansIncomeDraft,
  type BnMeansIncomeFact,
} from '@/types/bn/meansTests/meansIncome';

export interface BnMeansIncomeSectionProps {
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

export const BnMeansIncomeSection: React.FC<BnMeansIncomeSectionProps> = ({
  assessmentId, assessmentFrom, assessmentTo, editable, availableActions, onSectionComplete,
}) => {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [noIncomeOpen, setNoIncomeOpen] = React.useState(false);
  const [editingDraft, setEditingDraft] = React.useState<BnMeansIncomeDraft | null>(null);
  const [removeTarget, setRemoveTarget] = React.useState<BnMeansIncomeFact | null>(null);
  const [contextMemberId, setContextMemberId] = React.useState<string | null>(null);
  const [commandError, setCommandError] = React.useState<{ code: string; message: string } | null>(null);

  const incomeQuery = useQuery({
    queryKey: ['bn-means-income', assessmentId],
    queryFn: () => meansQueryService.income(assessmentId),
  });
  const readinessQuery = useQuery({
    queryKey: ['bn-means-income-readiness', assessmentId],
    queryFn: () => meansQueryService.incomeReadiness(assessmentId),
  });
  const referenceQuery = useQuery({
    queryKey: ['bn-means-income-reference'],
    queryFn: () => meansQueryService.incomeReference(),
  });
  const contextQuery = useQuery({
    queryKey: ['bn-means-income-context', assessmentId, contextMemberId],
    queryFn: () => meansQueryService.incomeContext(assessmentId, contextMemberId as string),
    enabled: dialogOpen && Boolean(contextMemberId),
  });

  function refresh() {
    void qc.invalidateQueries({ queryKey: ['bn-means-income', assessmentId] });
    void qc.invalidateQueries({ queryKey: ['bn-means-income-readiness', assessmentId] });
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
        setNoIncomeOpen(false);
        setRemoveTarget(null);
        refresh();
        const warnings = (result.data?.result as Record<string, unknown> | undefined)?.warnings;
        if (Array.isArray(warnings) && warnings.length > 0) {
          toast.warning(warnings.map((w) => incomeReasonLabel(String(w))).join(' '));
        } else {
          toast.success('Income information updated');
        }
        if (input.command === 'BN_MEANS_MARK_INCOME_COMPLETE') onSectionComplete?.();
        return;
      }
      const code = result.errorCode ?? 'UNKNOWN';
      const detail = result.errorDetail ?? '';
      const message = incomeReasonLabel(detail || code);
      setCommandError({ code: detail || code, message });
      if (!dialogOpen && !noIncomeOpen) toast.error(message);
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'The command could not be completed.';
      setCommandError({ code: 'UNKNOWN', message });
      toast.error(message);
    },
  });

  if (incomeQuery.isLoading || readinessQuery.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading income information…
        </CardContent>
      </Card>
    );
  }

  const incomeResult = incomeQuery.data;
  const readinessResult = readinessQuery.data;

  if (!incomeResult || incomeResult.status !== 'OK' || !incomeResult.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Income assessment</CardTitle>
        </CardHeader>
        <CardContent>
          <MeansStateNotice
            state={toLoadState(incomeResult?.status)}
            reason={incomeResult?.detail ?? 'Income information could not be loaded.'}
            testId="means-income-section-state"
          />
        </CardContent>
      </Card>
    );
  }

  const income = incomeResult.data;
  const readiness = readinessResult?.status === 'OK' ? readinessResult.data : null;
  const reference = referenceQuery.data?.status === 'OK' ? referenceQuery.data.data : null;
  const referenceState: Exclude<BnMeansLoadState, 'EMPTY'> = referenceQuery.isLoading
    ? 'LOADING'
    : reference
      ? 'SUCCESS'
      : toLoadState(referenceQuery.data?.status);
  const facts = income.facts ?? [];
  const currency = income.currency_code;
  const canEdit = editable && income.editable;
  const canMarkComplete =
    canEdit &&
    Boolean(readiness?.section_complete) &&
    availableActions.includes('BN_MEANS_MARK_INCOME_COMPLETE');

  const memberById = new Map(income.household_members.map((m) => [m.member_id, m]));

  return (
    <div className="space-y-4" data-testid="means-income-section">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Coins className="h-4 w-4" /> Income assessment
            </CardTitle>
            <CardDescription>
              What income is received by members of this household, from what source, at what
              amount and frequency, and during what period.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={readiness?.section_complete ? 'default' : 'secondary'}
              data-testid="means-income-status"
            >
              {readiness ? readiness.section_status.replace(/_/g, ' ') : 'UNAVAILABLE'}
            </Badge>
            {canEdit && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="means-income-declare-none"
                  onClick={() => {
                    setCommandError(null);
                    setNoIncomeOpen(true);
                  }}
                >
                  <UserX className="mr-1 h-4 w-4" /> Declare no income
                </Button>
                <Button
                  size="sm"
                  data-testid="means-income-add"
                  onClick={() => {
                    setEditingDraft(null);
                    setContextMemberId(null);
                    setCommandError(null);
                    setDialogOpen(true);
                  }}
                >
                  <Plus className="mr-1 h-4 w-4" /> Add income
                </Button>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!readiness && (
            <MeansStateNotice
              state={toLoadState(readinessResult?.status)}
              reason={readinessResult?.detail ?? 'Income readiness could not be evaluated.'}
              testId="means-income-readiness-state"
            />
          )}

          {readiness && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="means-income-summary">
              {[
                ['Income records', String(readiness.current_income_count)],
                ['Members with income', `${readiness.members_with_income} of ${readiness.household_members_total}`],
                ['No-income declarations', String(readiness.members_with_no_income_declaration)],
                [
                  'Declared annualised total',
                  formatWithCurrency(readiness.declared_annualised_total, readiness.currency_code),
                ],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border p-3">
                  <p className="text-xs uppercase text-muted-foreground">{label}</p>
                  <p className="text-lg font-semibold">{value}</p>
                </div>
              ))}
            </div>
          )}

          {readiness && readiness.members_without_declaration > 0 && (
            <p className="text-xs text-muted-foreground" data-testid="means-income-missing-members">
              {readiness.members_without_declaration} member(s) still need either an income
              record or an explicit no-income declaration.
            </p>
          )}

          {readiness && readiness.blockers.length > 0 && (
            <Alert variant="destructive" data-testid="means-income-blockers">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Resolve before completing this section</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {readiness.blockers.map((b) => (
                    <li key={b.code}>{b.message || incomeReasonLabel(b.code)}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {readiness && readiness.warnings.length > 0 && (
            <Alert data-testid="means-income-warnings">
              <Info className="h-4 w-4" />
              <AlertTitle>Check before continuing</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {readiness.warnings.map((w) => (
                    <li key={w.code}>{w.message || incomeReasonLabel(w.code)}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {facts.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center" data-testid="means-income-empty">
              <p className="text-sm font-medium">No income recorded yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Add each income received by a household member, or declare explicitly that a
                member receives none.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead>Category &amp; source</TableHead>
                    <TableHead>Declared</TableHead>
                    <TableHead>Annualised</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Status</TableHead>
                    {canEdit && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {facts.map((fact) => (
                    <TableRow key={fact.income_fact_id} data-testid={`means-income-row-${fact.income_fact_id}`}>
                      <TableCell>
                        <span className="font-medium">{fact.member_name ?? 'Household level'}</span>
                        <span className="block text-xs text-muted-foreground">
                          {fact.member_relationship ?? '—'}
                          {fact.member_is_current === false ? ' · membership ended' : ''}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">{fact.category_label}</span>
                        <span className="block text-xs text-muted-foreground">
                          {fact.employer_name ?? fact.source_name ?? 'Source not named'}
                          {fact.employer_status ? ` · ${fact.employer_status}` : ''}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatWithCurrency(fact.declared_amount, fact.currency_code)}
                        <span className="block text-xs text-muted-foreground">
                          {fact.declared_frequency_label} · {fact.basis_label}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap" data-testid={`means-income-annualised-${fact.income_fact_id}`}>
                        {formatWithCurrency(fact.normalised_annual_amount, fact.currency_code)}
                        {fact.is_one_off && (
                          <span className="block text-xs text-muted-foreground">One-off amount</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {fact.effective_from} → {fact.effective_to ?? 'present'}
                        <span className="block text-xs text-muted-foreground">
                          {fact.fact_source_label}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="outline">{fact.verification_status.replace(/_/g, ' ')}</Badge>
                        <span className="mt-1 block text-muted-foreground">
                          Evidence: {fact.evidence_status.replace(/_/g, ' ')}
                        </span>
                      </TableCell>
                      {canEdit && (
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Edit income for ${fact.member_name ?? 'household'}`}
                            onClick={() => {
                              setEditingDraft(draftFromIncomeFact(fact));
                              setContextMemberId(fact.member_id);
                              setCommandError(null);
                              setDialogOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Remove income for ${fact.member_name ?? 'household'}`}
                            onClick={() => setRemoveTarget(fact)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {income.no_income_declarations.length > 0 && (
            <div className="rounded-md border p-3" data-testid="means-income-no-income-list">
              <p className="text-sm font-medium">No-income declarations</p>
              <ul className="mt-2 space-y-1 text-xs">
                {income.no_income_declarations.map((d) => (
                  <li key={d.declaration_id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="font-medium">
                        {memberById.get(d.member_id)?.display_name ?? 'Household member'}
                      </span>{' '}
                      · {d.reason_label ?? '—'} · {d.effective_from} → {d.effective_to ?? 'present'} ·{' '}
                      {d.declaration_source_label}
                    </span>
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          mutation.mutate({
                            command: 'BN_MEANS_WITHDRAW_NO_INCOME',
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
              data-testid="means-income-mark-complete"
              onClick={() => mutation.mutate({ command: 'BN_MEANS_MARK_INCOME_COMPLETE', payload: {} })}
            >
              {mutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              Mark income complete
            </Button>
          </div>
        </CardContent>
      </Card>

      <BnMeansIncomeDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setCommandError(null);
        }}
        initialDraft={editingDraft}
        currency={currency}
        assessmentFrom={assessmentFrom}
        assessmentTo={assessmentTo}
        members={income.household_members}
        rules={income.income_rules}
        reference={reference}
        referenceState={referenceState}
        referenceReason={referenceQuery.data?.detail ?? null}
        contextRecord={contextQuery.data?.status === 'OK' ? contextQuery.data.data : null}
        contextState={
          !contextMemberId
            ? 'SUCCESS'
            : contextQuery.isLoading
              ? 'LOADING'
              : contextQuery.data?.status === 'OK'
                ? 'SUCCESS'
                : toLoadState(contextQuery.data?.status)
        }
        onMemberSelected={setContextMemberId}
        onEmployerSearch={async (term) => {
          const result = await meansQueryService.employerSearch(term);
          if (result.status !== 'OK' || !result.data) {
            return {
              state: toLoadState(result.status) as BnMeansLoadState,
              reason: result.detail ?? result.code,
            };
          }
          return {
            state: 'SUCCESS' as const,
            records: result.data.map((e) => ({
              id: e.employer_regno,
              primary: e.employer_name,
              secondary: `Registration ${e.employer_regno} · ${e.employer_status}`,
            })),
          };
        }}
        busy={mutation.isPending}
        commandError={commandError}
        onSubmit={(payload, draft) =>
          mutation.mutate({
            command: draft.incomeFactId ? 'BN_MEANS_CORRECT_INCOME' : 'BN_MEANS_ADD_INCOME',
            payload,
          })
        }
      />

      <BnMeansNoIncomeDialog
        open={noIncomeOpen}
        onOpenChange={(open) => {
          setNoIncomeOpen(open);
          if (!open) setCommandError(null);
        }}
        members={income.household_members}
        reference={reference}
        referenceState={referenceState}
        referenceReason={referenceQuery.data?.detail ?? null}
        assessmentFrom={assessmentFrom}
        busy={mutation.isPending}
        commandError={commandError}
        onSubmit={(payload) => mutation.mutate({ command: 'BN_MEANS_DECLARE_NO_INCOME', payload })}
      />

      <AlertDialog open={Boolean(removeTarget)} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this income record?</AlertDialogTitle>
            <AlertDialogDescription>
              The record is voided rather than deleted: it stays in the assessment audit trail
              and can be explained later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep record</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                removeTarget &&
                mutation.mutate({
                  command: 'BN_MEANS_VOID_INCOME',
                  payload: { income_fact_id: removeTarget.income_fact_id },
                })
              }
            >
              Remove income
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default BnMeansIncomeSection;
