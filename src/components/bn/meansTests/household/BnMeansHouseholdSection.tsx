/**
 * MEANS-TEST EPIC 2 — Household composition section.
 *
 * Readiness, blockers and warnings are read from
 * `bn_means_household_readiness_v1`. The section never decides
 * completeness locally, and "Mark household complete" is only offered
 * when the backend reports the section as complete-able.
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
import { AlertTriangle, CheckCircle2, Info, Loader2, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { MeansStateNotice } from '@/components/bn/meansTests/controls/MeansControls';
import { meansQueryService } from '@/services/bn/meansTests/meansQueryService';
import { meansCommandService } from '@/services/bn/meansTests/meansCommandService';
import BnMeansHouseholdMemberDialog from './BnMeansHouseholdMemberDialog';
import {
  draftFromMember,
  householdReasonLabel,
  type BnMeansHouseholdMember,
  type BnMeansHouseholdMemberDraft,
} from '@/types/bn/meansTests/meansHousehold';
import type { BnMeansLoadState } from '@/types/bn/meansTests/meansFieldContract';

export interface BnMeansHouseholdSectionProps {
  assessmentId: string;
  assessmentFrom: string;
  assessmentTo: string | null;
  assessedPersonId: number | null;
  /** Backend-owned editability for the current assessment state. */
  editable: boolean;
  availableActions: readonly string[];
  onSectionComplete?: () => void;
}

function toLoadState(status: string | undefined): Exclude<BnMeansLoadState, 'SUCCESS'> {
  if (status === 'DENIED') return 'DENIED';
  if (status === 'NOT_IMPLEMENTED') return 'NOT_IMPLEMENTED';
  return 'FAILED';
}

export const BnMeansHouseholdSection: React.FC<BnMeansHouseholdSectionProps> = ({
  assessmentId, assessmentFrom, assessmentTo, assessedPersonId, editable,
  availableActions, onSectionComplete,
}) => {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingDraft, setEditingDraft] = React.useState<BnMeansHouseholdMemberDraft | null>(null);
  const [removeTarget, setRemoveTarget] = React.useState<BnMeansHouseholdMember | null>(null);
  const [commandError, setCommandError] = React.useState<{ code: string; message: string } | null>(null);

  const householdQuery = useQuery({
    queryKey: ['bn-means-household', assessmentId],
    queryFn: () => meansQueryService.household(assessmentId),
  });
  const readinessQuery = useQuery({
    queryKey: ['bn-means-household-readiness', assessmentId],
    queryFn: () => meansQueryService.householdReadiness(assessmentId),
  });
  const candidatesQuery = useQuery({
    queryKey: ['bn-means-household-candidates', assessmentId],
    queryFn: () => meansQueryService.householdCandidates(assessmentId),
    enabled: dialogOpen,
  });

  function refresh() {
    void qc.invalidateQueries({ queryKey: ['bn-means-household', assessmentId] });
    void qc.invalidateQueries({ queryKey: ['bn-means-household-readiness', assessmentId] });
    void qc.invalidateQueries({ queryKey: ['bn-means-household-candidates', assessmentId] });
    void qc.invalidateQueries({ queryKey: ['bn-means-assessment', assessmentId] });
  }

  const mutation = useMutation({
    mutationFn: (input: { command: string; payload: Record<string, unknown> }) =>
      meansCommandService.execute({
        command: input.command as never,
        assessmentId,
        payload: input.payload,
      }),
    onSuccess: (result, input) => {
      if (result.status !== 'FAILED') {
        setCommandError(null);
        setDialogOpen(false);
        setRemoveTarget(null);
        refresh();
        toast.success(
          input.command === 'BN_MEANS_REMOVE_HOUSEHOLD_MEMBER'
            ? 'Household member removed'
            : 'Household updated',
        );
        if (input.command === 'BN_MEANS_MARK_HOUSEHOLD_COMPLETE') onSectionComplete?.();
        return;
      }
      const code = result.errorCode ?? 'UNKNOWN';
      const message = result.errorDetail ?? householdReasonLabel(code);
      setCommandError({ code, message });
      if (!dialogOpen) toast.error(message);
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'The command could not be completed.';
      setCommandError({ code: 'UNKNOWN', message });
      toast.error(message);
    },
  });

  if (householdQuery.isLoading || readinessQuery.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading household composition…
        </CardContent>
      </Card>
    );
  }

  const householdResult = householdQuery.data;
  const readinessResult = readinessQuery.data;

  if (!householdResult || householdResult.status !== 'OK' || !householdResult.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Household composition</CardTitle>
        </CardHeader>
        <CardContent>
          <MeansStateNotice
            state={toLoadState(householdResult?.status)}
            reason={householdResult?.detail ?? 'Household composition could not be loaded.'}
            testId="means-household-section-state"
          />
        </CardContent>
      </Card>
    );
  }

  const household = householdResult.data;
  const readiness = readinessResult?.status === 'OK' ? readinessResult.data : null;
  const members = household.members ?? [];
  const canEdit = editable && household.editable;
  const canMarkComplete =
    canEdit &&
    Boolean(readiness?.section_complete) &&
    availableActions.includes('BN_MEANS_MARK_HOUSEHOLD_COMPLETE');

  return (
    <div className="space-y-4" data-testid="means-household-section">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" /> Household composition
            </CardTitle>
            <CardDescription>
              Record everyone who belonged to the assessed household during the assessment
              period, and decide dependency explicitly for each of them.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={readiness?.section_complete ? 'default' : 'secondary'}
              data-testid="means-household-status"
            >
              {readiness ? readiness.section_status.replace(/_/g, ' ') : 'UNAVAILABLE'}
            </Badge>
            {canEdit && (
              <Button
                size="sm"
                data-testid="means-household-add"
                onClick={() => {
                  setEditingDraft(null);
                  setCommandError(null);
                  setDialogOpen(true);
                }}
              >
                <Plus className="mr-1 h-4 w-4" /> Add household member
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!readiness && (
            <MeansStateNotice
              state={toLoadState(readinessResult?.status)}
              reason={readinessResult?.detail ?? 'Household readiness could not be evaluated.'}
              testId="means-household-readiness-state"
            />
          )}

          {readiness && (
            <div className="grid gap-3 sm:grid-cols-3" data-testid="means-household-summary">
              {[
                ['Household size', readiness.household_size],
                ['Current members', readiness.current_members],
                ['Dependants', readiness.current_dependants],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-md border p-3">
                  <p className="text-xs uppercase text-muted-foreground">{label}</p>
                  <p className="text-lg font-semibold">{String(value)}</p>
                </div>
              ))}
            </div>
          )}

          {readiness && readiness.blockers.length > 0 && (
            <Alert variant="destructive" data-testid="means-household-blockers">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Resolve before completing this section</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {readiness.blockers.map((b) => (
                    <li key={b.code}>{b.message || householdReasonLabel(b.code)}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {readiness && readiness.warnings.length > 0 && (
            <Alert data-testid="means-household-warnings">
              <Info className="h-4 w-4" />
              <AlertTitle>Check before continuing</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {readiness.warnings.map((w) => (
                    <li key={w.code}>{w.message || householdReasonLabel(w.code)}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {members.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center" data-testid="means-household-empty">
              <p className="text-sm font-medium">No household members recorded yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Start with the assessed person, then add everyone else who lived in the household.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead>Relationship</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Dependency</TableHead>
                    <TableHead>Source</TableHead>
                    {canEdit && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((member) => (
                    <TableRow key={member.member_id} data-testid={`means-household-row-${member.member_id}`}>
                      <TableCell>
                        <span className="font-medium">{member.display_name}</span>
                        {member.is_self && <Badge variant="outline" className="ml-2">Assessed person</Badge>}
                        <span className="block text-xs text-muted-foreground">
                          {member.masked_identifier ??
                            (member.source_kind === 'DECLARED' ? 'Declared member' : 'No identifier held')}
                        </span>
                      </TableCell>
                      <TableCell>{member.relationship_label}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {member.member_from} → {member.member_to ?? 'present'}
                        {!member.shares_residence && (
                          <span className="block text-xs text-muted-foreground">
                            {member.residence_inclusion_reason_label ?? 'Does not share residence'}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={member.dependency_decision === 'DEPENDANT' ? 'default' : 'secondary'}>
                          {member.dependency_decision_label}
                        </Badge>
                        {member.dependency_basis_label && (
                          <span className="block text-xs text-muted-foreground">
                            {member.dependency_basis_label}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{member.fact_source_label}</TableCell>
                      {canEdit && (
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Edit ${member.display_name}`}
                            onClick={() => {
                              setEditingDraft(draftFromMember(member));
                              setCommandError(null);
                              setDialogOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Remove ${member.display_name}`}
                            onClick={() => setRemoveTarget(member)}
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

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="text-xs text-muted-foreground">
              {readiness?.section_complete
                ? 'The backend reports this section as ready to complete.'
                : 'Completion is decided by the backend once every requirement is met.'}
            </p>
            <Button
              disabled={!canMarkComplete || mutation.isPending}
              data-testid="means-household-mark-complete"
              onClick={() =>
                mutation.mutate({ command: 'BN_MEANS_MARK_HOUSEHOLD_COMPLETE', payload: {} })
              }
            >
              {mutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              Mark household complete
            </Button>
          </div>
        </CardContent>
      </Card>

      <BnMeansHouseholdMemberDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setCommandError(null);
        }}
        initialDraft={editingDraft}
        assessmentFrom={assessmentFrom}
        assessmentTo={assessmentTo}
        assessedPersonId={assessedPersonId}
        allowDeclaredMembers={household.household_rules?.allow_declared_members !== false}
        candidates={candidatesQuery.data?.status === 'OK' ? candidatesQuery.data.data ?? [] : []}
        candidatesState={
          candidatesQuery.isLoading
            ? 'LOADING'
            : candidatesQuery.data?.status === 'OK'
              ? (candidatesQuery.data.data ?? []).length === 0
                ? 'EMPTY'
                : 'SUCCESS'
              : (toLoadState(candidatesQuery.data?.status) as 'DENIED' | 'FAILED')
        }
        candidatesReason={candidatesQuery.data?.detail ?? null}
        busy={mutation.isPending}
        commandError={commandError}
        onSubmit={(payload, draft) =>
          mutation.mutate({
            command: draft.memberId
              ? 'BN_MEANS_UPDATE_HOUSEHOLD_MEMBER'
              : 'BN_MEANS_ADD_HOUSEHOLD_MEMBER',
            payload,
          })
        }
      />

      <AlertDialog open={Boolean(removeTarget)} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this household member?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget?.display_name} will be removed from the household for this
              assessment. The removal is recorded in the assessment audit trail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep member</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                removeTarget &&
                mutation.mutate({
                  command: 'BN_MEANS_REMOVE_HOUSEHOLD_MEMBER',
                  payload: { member_id: removeTarget.member_id },
                })
              }
            >
              Remove member
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default BnMeansHouseholdSection;
