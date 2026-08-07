/**
 * MEANS-TEST EPIC 4 — Asset assessment section.
 *
 * Readiness, blockers, warnings, attributable values and the declared total
 * are all backend-owned (`bn_means_asset_readiness_v1`, `bn_means_assets_v1`).
 * This section never decides completeness and never applies a disregard.
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
  AlertTriangle, CheckCircle2, Info, Landmark, Loader2, Pencil, Plus, ShieldQuestion, Trash2, UserX,
} from 'lucide-react';
import { toast } from 'sonner';
import { MeansStateNotice } from '@/components/bn/meansTests/controls/MeansControls';
import { meansQueryService } from '@/services/bn/meansTests/meansQueryService';
import { meansCommandService } from '@/services/bn/meansTests/meansCommandService';
import type { BnMeansCommandName } from '@/types/bn/meansTests/meansCommands';
import type { BnMeansLoadState } from '@/types/bn/meansTests/meansFieldContract';
import { formatWithCurrency } from '@/utils/formatCurrency';
import BnMeansAssetDialog from './BnMeansAssetDialog';
import BnMeansNoAssetsDialog from './BnMeansNoAssetsDialog';
import {
  assetReasonLabel,
  draftFromAssetFact,
  type BnMeansAssetDraft,
  type BnMeansAssetFact,
} from '@/types/bn/meansTests/meansAssets';

export interface BnMeansAssetSectionProps {
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

export const BnMeansAssetSection: React.FC<BnMeansAssetSectionProps> = ({
  assessmentId, assessmentFrom, assessmentTo, editable, availableActions, onSectionComplete,
}) => {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [noAssetsOpen, setNoAssetsOpen] = React.useState(false);
  const [editingDraft, setEditingDraft] = React.useState<BnMeansAssetDraft | null>(null);
  const [removeTarget, setRemoveTarget] = React.useState<BnMeansAssetFact | null>(null);
  const [commandError, setCommandError] = React.useState<{ code: string; message: string } | null>(null);

  const assetQuery = useQuery({
    queryKey: ['bn-means-assets', assessmentId],
    queryFn: () => meansQueryService.assets(assessmentId),
  });
  const readinessQuery = useQuery({
    queryKey: ['bn-means-asset-readiness', assessmentId],
    queryFn: () => meansQueryService.assetReadiness(assessmentId),
  });
  const referenceQuery = useQuery({
    queryKey: ['bn-means-asset-reference'],
    queryFn: () => meansQueryService.assetReference(),
  });

  function refresh() {
    void qc.invalidateQueries({ queryKey: ['bn-means-assets', assessmentId] });
    void qc.invalidateQueries({ queryKey: ['bn-means-asset-readiness', assessmentId] });
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
        setNoAssetsOpen(false);
        setRemoveTarget(null);
        refresh();
        const warnings = (result.data?.result as Record<string, unknown> | undefined)?.warnings;
        if (Array.isArray(warnings) && warnings.length > 0) {
          toast.warning(warnings.map((w) => assetReasonLabel(String(w))).join(' '));
        } else {
          toast.success('Asset information updated');
        }
        if (input.command === 'BN_MEANS_MARK_ASSETS_COMPLETE') onSectionComplete?.();
        return;
      }
      const code = result.errorCode ?? 'UNKNOWN';
      const detail = result.errorDetail ?? '';
      const message = assetReasonLabel(detail || code);
      setCommandError({ code: detail || code, message });
      if (!dialogOpen && !noAssetsOpen) toast.error(message);
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'The command could not be completed.';
      setCommandError({ code: 'UNKNOWN', message });
      toast.error(message);
    },
  });

  if (assetQuery.isLoading || readinessQuery.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading asset information…
        </CardContent>
      </Card>
    );
  }

  const assetResult = assetQuery.data;
  const readinessResult = readinessQuery.data;

  if (!assetResult || assetResult.status !== 'OK' || !assetResult.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Asset assessment</CardTitle>
        </CardHeader>
        <CardContent>
          <MeansStateNotice
            state={toLoadState(assetResult?.status)}
            reason={assetResult?.detail ?? 'Asset information could not be loaded.'}
            testId="means-asset-section-state"
          />
        </CardContent>
      </Card>
    );
  }

  const assets = assetResult.data;
  const readiness = readinessResult?.status === 'OK' ? readinessResult.data : null;
  const reference = referenceQuery.data?.status === 'OK' ? referenceQuery.data.data : null;
  const referenceState: Exclude<BnMeansLoadState, 'EMPTY'> = referenceQuery.isLoading
    ? 'LOADING'
    : reference
      ? 'SUCCESS'
      : toLoadState(referenceQuery.data?.status);
  const facts = assets.facts ?? [];
  const currency = assets.currency_code;
  const canEdit = editable && assets.editable;
  const canMarkComplete =
    canEdit &&
    Boolean(readiness?.section_complete) &&
    availableActions.includes('BN_MEANS_MARK_ASSETS_COMPLETE');
  const incomeIncomplete = Boolean(
    readiness?.blockers.some((b) => b.code === 'INCOME_SECTION_INCOMPLETE'),
  );

  const memberById = new Map(assets.household_members.map((m) => [m.member_id, m]));

  return (
    <div className="space-y-4" data-testid="means-asset-section">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Landmark className="h-4 w-4" /> Asset assessment
            </CardTitle>
            <CardDescription>
              What each household member owns, how it is held, what it is worth, when it was
              valued and where that information came from.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={readiness?.section_complete ? 'default' : 'secondary'}
              data-testid="means-asset-status"
            >
              {readiness ? readiness.section_status.replace(/_/g, ' ') : 'UNAVAILABLE'}
            </Badge>
            {canEdit && !incomeIncomplete && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="means-asset-declare-none"
                  onClick={() => {
                    setCommandError(null);
                    setNoAssetsOpen(true);
                  }}
                >
                  <UserX className="mr-1 h-4 w-4" /> Declare no assets
                </Button>
                <Button
                  size="sm"
                  data-testid="means-asset-add"
                  onClick={() => {
                    setEditingDraft(null);
                    setCommandError(null);
                    setDialogOpen(true);
                  }}
                >
                  <Plus className="mr-1 h-4 w-4" /> Add asset
                </Button>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!readiness && (
            <MeansStateNotice
              state={toLoadState(readinessResult?.status)}
              reason={readinessResult?.detail ?? 'Asset readiness could not be evaluated.'}
              testId="means-asset-readiness-state"
            />
          )}

          {incomeIncomplete && (
            <Alert data-testid="means-asset-income-gate">
              <Info className="h-4 w-4" />
              <AlertTitle>Income assessment first</AlertTitle>
              <AlertDescription>
                {assetReasonLabel('INCOME_SECTION_INCOMPLETE')}
              </AlertDescription>
            </Alert>
          )}

          {readiness && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="means-asset-summary">
              {[
                ['Asset records', String(readiness.current_asset_count)],
                ['Members with assets', `${readiness.members_with_assets} of ${readiness.household_members_total}`],
                ['No-asset declarations', String(readiness.members_with_no_asset_declaration)],
                [
                  'Declared attributable total',
                  formatWithCurrency(readiness.declared_attributable_total, readiness.currency_code),
                ],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border p-3">
                  <p className="text-xs uppercase text-muted-foreground">{label}</p>
                  <p className="text-lg font-semibold">{value}</p>
                </div>
              ))}
            </div>
          )}

          {readiness && readiness.disregard_flagged_count > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="means-asset-disregard-count">
              <ShieldQuestion className="h-3.5 w-3.5" />
              {readiness.disregard_flagged_count} asset(s) flagged as possible disregards. The
              disregard is applied by policy at calculation, not here.
            </p>
          )}

          {readiness && readiness.members_without_declaration > 0 && (
            <p className="text-xs text-muted-foreground" data-testid="means-asset-missing-members">
              {readiness.members_without_declaration} member(s) still need either an asset record
              or an explicit no-assets declaration.
            </p>
          )}

          {readiness && readiness.blockers.length > 0 && (
            <Alert variant="destructive" data-testid="means-asset-blockers">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Resolve before completing this section</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {readiness.blockers.map((b) => (
                    <li key={b.code}>{b.message || assetReasonLabel(b.code)}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {readiness && readiness.warnings.length > 0 && (
            <Alert data-testid="means-asset-warnings">
              <Info className="h-4 w-4" />
              <AlertTitle>Check before continuing</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {readiness.warnings.map((w) => (
                    <li key={w.code}>{w.message || assetReasonLabel(w.code)}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {facts.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center" data-testid="means-asset-empty">
              <p className="text-sm font-medium">No assets recorded yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Record each asset held by a household member, or declare explicitly that a member
                holds none.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Owner</TableHead>
                    <TableHead>Asset</TableHead>
                    <TableHead>Ownership</TableHead>
                    <TableHead>Valuation</TableHead>
                    <TableHead>Attributable</TableHead>
                    <TableHead>Held</TableHead>
                    <TableHead>Status</TableHead>
                    {canEdit && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {facts.map((fact) => (
                    <TableRow key={fact.asset_fact_id} data-testid={`means-asset-row-${fact.asset_fact_id}`}>
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
                          {fact.description ?? 'No description recorded'}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {fact.ownership_type_label}
                        <span className="block text-xs text-muted-foreground">
                          {Math.round((fact.ownership_share ?? 1) * 10000) / 100}% share
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatWithCurrency(fact.valuation_amount, fact.currency_code)}
                        <span className="block text-xs text-muted-foreground">
                          {fact.valuation_basis_label} · {fact.valuation_date}
                        </span>
                      </TableCell>
                      <TableCell
                        className="whitespace-nowrap"
                        data-testid={`means-asset-attributable-${fact.asset_fact_id}`}
                      >
                        {formatWithCurrency(fact.attributable_amount, fact.currency_code)}
                        {fact.disregard_candidate && (
                          <span className="block text-xs text-muted-foreground">
                            Possible disregard: {fact.disregard_reason_label ?? '—'}
                          </span>
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
                            aria-label={`Edit asset for ${fact.member_name ?? 'household'}`}
                            onClick={() => {
                              setEditingDraft(draftFromAssetFact(fact));
                              setCommandError(null);
                              setDialogOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Remove asset for ${fact.member_name ?? 'household'}`}
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

          {assets.no_asset_declarations.length > 0 && (
            <div className="rounded-md border p-3" data-testid="means-asset-no-assets-list">
              <p className="text-sm font-medium">No-asset declarations</p>
              <ul className="mt-2 space-y-1 text-xs">
                {assets.no_asset_declarations.map((d) => (
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
                            command: 'BN_MEANS_WITHDRAW_NO_ASSETS',
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
              data-testid="means-asset-mark-complete"
              onClick={() => mutation.mutate({ command: 'BN_MEANS_MARK_ASSETS_COMPLETE', payload: {} })}
            >
              {mutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              Mark assets complete
            </Button>
          </div>
        </CardContent>
      </Card>

      <BnMeansAssetDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setCommandError(null);
        }}
        initialDraft={editingDraft}
        currency={currency}
        assessmentFrom={assessmentFrom}
        assessmentTo={assessmentTo}
        members={assets.household_members}
        rules={assets.asset_rules}
        reference={reference}
        referenceState={referenceState}
        referenceReason={referenceQuery.data?.detail ?? null}
        busy={mutation.isPending}
        commandError={commandError}
        onSubmit={(payload, draft) =>
          mutation.mutate({
            command: draft.assetFactId ? 'BN_MEANS_CORRECT_ASSET' : 'BN_MEANS_ADD_ASSET',
            payload,
          })
        }
      />

      <BnMeansNoAssetsDialog
        open={noAssetsOpen}
        onOpenChange={(open) => {
          setNoAssetsOpen(open);
          if (!open) setCommandError(null);
        }}
        members={assets.household_members}
        reference={reference}
        referenceState={referenceState}
        referenceReason={referenceQuery.data?.detail ?? null}
        assessmentFrom={assessmentFrom}
        busy={mutation.isPending}
        commandError={commandError}
        onSubmit={(payload) => mutation.mutate({ command: 'BN_MEANS_DECLARE_NO_ASSETS', payload })}
      />

      <AlertDialog open={Boolean(removeTarget)} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this asset record?</AlertDialogTitle>
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
                  command: 'BN_MEANS_VOID_ASSET',
                  payload: { asset_fact_id: removeTarget.asset_fact_id },
                })
              }
            >
              Remove asset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default BnMeansAssetSection;
