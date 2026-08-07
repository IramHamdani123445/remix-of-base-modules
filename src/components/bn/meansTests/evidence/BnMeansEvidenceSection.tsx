/**
 * MEANS-TEST EPIC 6 — Evidence and information requests section.
 *
 * Requirements, readiness, blockers and outstanding counts are all
 * backend-owned (`bn_means_evidence_readiness_v1`, `bn_means_evidence_v1`).
 * This section answers: what evidence is required, what has been received,
 * what it supports, whether it is usable, and what is still outstanding.
 * It never decides whether a fact is true and never decides the outcome.
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
  AlertTriangle, CheckCircle2, ClipboardCheck, FileText, Info, Loader2, Link2,
  MailQuestion, ShieldCheck, Unlink,
} from 'lucide-react';
import { toast } from 'sonner';
import { MeansStateNotice } from '@/components/bn/meansTests/controls/MeansControls';
import { meansQueryService } from '@/services/bn/meansTests/meansQueryService';
import { meansCommandService } from '@/services/bn/meansTests/meansCommandService';
import type { BnMeansCommandName } from '@/types/bn/meansTests/meansCommands';
import type { BnMeansLoadState } from '@/types/bn/meansTests/meansFieldContract';
import { formatDateForDisplay } from '@/lib/format-config';
import BnMeansLinkEvidenceDialog from './BnMeansLinkEvidenceDialog';
import BnMeansUsabilityDialog from './BnMeansUsabilityDialog';
import BnMeansInformationRequestDialog from './BnMeansInformationRequestDialog';
import {
  groupRequirements,
  isRequestOpen,
  isRequestOverdue,
  isUsabilityIssue,
  linksForRequirement,
  type BnMeansEvidenceLink,
  type BnMeansEvidenceRequirement,
  type BnMeansInformationRequest,
} from '@/types/bn/meansTests/meansEvidence';

export interface BnMeansEvidenceSectionProps {
  assessmentId: string;
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

const GROUP_LABEL: Record<string, string> = {
  ASSESSMENT: 'Assessment level',
  HOUSEHOLD: 'Household composition',
  INCOME: 'Income',
  ASSETS: 'Assets',
  DEDUCTIONS: 'Deductions and disregards',
};

export const BnMeansEvidenceSection: React.FC<BnMeansEvidenceSectionProps> = ({
  assessmentId, editable, availableActions, onSectionComplete,
}) => {
  const qc = useQueryClient();
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [requestOpen, setRequestOpen] = React.useState(false);
  const [usabilityOpen, setUsabilityOpen] = React.useState(false);
  const [activeRequirement, setActiveRequirement] = React.useState<BnMeansEvidenceRequirement | null>(null);
  const [activeLink, setActiveLink] = React.useState<BnMeansEvidenceLink | null>(null);
  const [unlinkTarget, setUnlinkTarget] = React.useState<BnMeansEvidenceLink | null>(null);
  const [closeTarget, setCloseTarget] = React.useState<BnMeansInformationRequest | null>(null);
  const [responseTarget, setResponseTarget] = React.useState<BnMeansInformationRequest | null>(null);
  const [commandError, setCommandError] = React.useState<{ code: string; message: string } | null>(null);

  const evidenceQuery = useQuery({
    queryKey: ['bn-means-evidence', assessmentId],
    queryFn: () => meansQueryService.evidence(assessmentId),
  });
  const readinessQuery = useQuery({
    queryKey: ['bn-means-evidence-readiness', assessmentId],
    queryFn: () => meansQueryService.evidenceReadiness(assessmentId),
  });
  const referenceQuery = useQuery({
    queryKey: ['bn-means-evidence-reference'],
    queryFn: () => meansQueryService.evidenceReference(),
  });

  function refresh() {
    void qc.invalidateQueries({ queryKey: ['bn-means-evidence', assessmentId] });
    void qc.invalidateQueries({ queryKey: ['bn-means-evidence-readiness', assessmentId] });
    void qc.invalidateQueries({ queryKey: ['bn-means-detail', assessmentId] });
    void qc.invalidateQueries({ queryKey: ['bn-means-actions', assessmentId] });
  }

  const mutation = useMutation({
    mutationFn: (input: { command: BnMeansCommandName; payload: Record<string, unknown> }) =>
      meansCommandService.execute({ command: input.command, assessmentId, payload: input.payload }),
    onSuccess: (result, input) => {
      if (result.status !== 'FAILED') {
        setCommandError(null);
        setLinkOpen(false);
        setRequestOpen(false);
        setUsabilityOpen(false);
        setUnlinkTarget(null);
        setCloseTarget(null);
        setResponseTarget(null);
        refresh();
        toast.success('Evidence information updated');
        if (input.command === 'BN_MEANS_MARK_EVIDENCE_COMPLETE') onSectionComplete?.();
        return;
      }
      const message = result.errorDetail || result.errorCode || 'The command could not be completed.';
      setCommandError({ code: result.errorCode ?? 'UNKNOWN', message });
      if (!linkOpen && !requestOpen && !usabilityOpen) toast.error(message);
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'The command could not be completed.';
      setCommandError({ code: 'UNKNOWN', message });
      toast.error(message);
    },
  });

  function run(command: BnMeansCommandName, payload: Record<string, unknown>) {
    mutation.mutate({ command, payload });
  }

  if (evidenceQuery.isLoading || readinessQuery.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading evidence information…
        </CardContent>
      </Card>
    );
  }

  const evidenceResult = evidenceQuery.data;
  const readinessResult = readinessQuery.data;

  if (!evidenceResult || evidenceResult.status !== 'OK' || !evidenceResult.data) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Evidence and information requests</CardTitle></CardHeader>
        <CardContent>
          <MeansStateNotice
            state={toLoadState(evidenceResult?.status)}
            reason={evidenceResult?.detail ?? 'Evidence information could not be loaded.'}
            testId="means-evidence-section-state"
          />
        </CardContent>
      </Card>
    );
  }

  const detail = evidenceResult.data;
  const readiness =
    readinessResult?.status === 'OK' && readinessResult.data ? readinessResult.data : detail.readiness;
  const reference = referenceQuery.data?.status === 'OK' ? referenceQuery.data.data : null;

  const requirements = readiness?.requirements?.length ? readiness.requirements : detail.requirements;
  const links = detail.links ?? [];
  const requests = detail.information_requests ?? [];
  const responses = detail.information_responses ?? [];
  const groups = groupRequirements(requirements);
  const openRequests = requests.filter((r) => isRequestOpen(r.status));
  const canWrite = editable && detail.editable;
  const canComplete = availableActions.includes('BN_MEANS_MARK_EVIDENCE_COMPLETE');
  const canReopen = availableActions.includes('BN_MEANS_REOPEN_EVIDENCE');

  return (
    <div className="space-y-4" data-testid="means-evidence-section">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Evidence and information requests</CardTitle>
            <CardDescription>
              What evidence is required, what has arrived, and what is still outstanding. Nothing
              here decides whether a fact is true.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline" size="sm" disabled={!canWrite}
              onClick={() => { setActiveRequirement(null); setCommandError(null); setRequestOpen(true); }}
              data-testid="means-evidence-request-open"
            >
              <MailQuestion className="mr-2 h-4 w-4" /> Request information
            </Button>
            <Button
              size="sm" disabled={!canWrite}
              onClick={() => { setActiveRequirement(null); setCommandError(null); setLinkOpen(true); }}
              data-testid="means-evidence-link-open"
            >
              <Link2 className="mr-2 h-4 w-4" /> Link document
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {readiness && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Required" value={readiness.mandatory_total} />
              <Metric label="Satisfied" value={readiness.mandatory_satisfied} />
              <Metric label="Outstanding" value={readiness.mandatory_outstanding} tone={readiness.mandatory_outstanding > 0 ? 'warn' : undefined} />
              <Metric label="Open requests" value={readiness.open_information_requests} tone={readiness.blocking_information_requests > 0 ? 'warn' : undefined} />
            </div>
          )}

          {readiness?.completion_invalidated && (
            <Alert variant="destructive" data-testid="means-evidence-invalidated">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Evidence completion no longer valid</AlertTitle>
              <AlertDescription>
                Facts changed after this section was completed. Review the new requirements and
                mark the section complete again.
              </AlertDescription>
            </Alert>
          )}

          {(readiness?.blockers ?? []).map((b) => (
            <Alert key={b.code} variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{b.message}</AlertDescription>
            </Alert>
          ))}
          {(readiness?.warnings ?? []).map((w) => (
            <Alert key={w.code}>
              <Info className="h-4 w-4" />
              <AlertDescription>{w.message}</AlertDescription>
            </Alert>
          ))}
        </CardContent>
      </Card>

      {/* Requirement checklist ------------------------------------------------ */}
      {groups.map(({ group, items }) => (
        <Card key={group}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {GROUP_LABEL[group] ?? group}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {items.map((req) => {
              const reqLinks = linksForRequirement(links, req);
              const satisfied = req.satisfied ?? reqLinks.length >= (req.minimum_count || 1);
              return (
                <div
                  key={req.requirement_id}
                  className="rounded-md border p-3"
                  data-testid={`means-evidence-requirement-${req.requirement_code}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {satisfied
                          ? <CheckCircle2 className="h-4 w-4 text-primary" />
                          : <AlertTriangle className="h-4 w-4 text-muted-foreground" />}
                        <span className="text-sm font-medium">{req.requirement_label}</span>
                        <Badge variant={req.obligation === 'MANDATORY' ? 'default' : 'outline'}>
                          {req.obligation === 'MANDATORY' ? 'Required' : req.obligation === 'CONDITIONAL' ? 'If applicable' : 'Optional'}
                        </Badge>
                        {satisfied
                          ? <Badge variant="outline">Satisfied</Badge>
                          : <Badge variant="secondary">Outstanding</Badge>}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {req.subject_label ?? 'This assessment'}
                        {req.reason ? ` — ${req.reason}` : ''}
                      </p>
                      {req.minimum_count > 1 && (
                        <p className="text-xs text-muted-foreground">
                          {reqLinks.length} of {req.minimum_count} documents linked
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm" variant="outline" disabled={!canWrite}
                        onClick={() => { setActiveRequirement(req); setCommandError(null); setRequestOpen(true); }}
                      >
                        <MailQuestion className="mr-2 h-4 w-4" /> Request
                      </Button>
                      <Button
                        size="sm" variant="outline" disabled={!canWrite}
                        onClick={() => { setActiveRequirement(req); setCommandError(null); setLinkOpen(true); }}
                      >
                        <Link2 className="mr-2 h-4 w-4" /> Link
                      </Button>
                    </div>
                  </div>

                  {reqLinks.length > 0 && (
                    <ul className="mt-3 space-y-1 border-t pt-2">
                      {reqLinks.map((l) => (
                        <li key={l.link_id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span className="flex min-w-0 items-center gap-2">
                            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="truncate">{l.document_title ?? l.document_ref}</span>
                            <Badge variant={isUsabilityIssue(l.usability_status) ? 'destructive' : 'outline'}>
                              {l.usability_status}
                            </Badge>
                          </span>
                          <span className="flex gap-1">
                            <Button
                              size="sm" variant="ghost" disabled={!canWrite}
                              onClick={() => { setActiveLink(l); setCommandError(null); setUsabilityOpen(true); }}
                            >
                              <ShieldCheck className="mr-1 h-4 w-4" /> Check
                            </Button>
                            <Button
                              size="sm" variant="ghost" disabled={!canWrite}
                              onClick={() => setUnlinkTarget(l)}
                            >
                              <Unlink className="mr-1 h-4 w-4" /> Unlink
                            </Button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      {/* Information requests ------------------------------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Information requests</CardTitle>
          <CardDescription>Outstanding requests and the responses recorded against them.</CardDescription>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">No information has been requested.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Requested</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((r) => {
                  const overdue = isRequestOverdue(r, new Date().toISOString().slice(0, 10));
                  const responseCount = responses.filter((x) => x.request_id === r.request_id).length;
                  return (
                    <TableRow key={r.request_id} data-testid="means-evidence-request-row">
                      <TableCell>
                        <p className="text-sm font-medium">{r.information_required}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.request_reference ?? r.request_type}
                          {responseCount > 0 ? ` • ${responseCount} response(s)` : ''}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm">{r.recipient_label ?? r.recipient_kind ?? '—'}</TableCell>
                      <TableCell className="text-sm">
                        {r.due_date ? formatDateForDisplay(r.due_date) : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant={isRequestOpen(r.status) ? 'secondary' : 'outline'}>{r.status}</Badge>
                          {overdue && <Badge variant="destructive">Overdue</Badge>}
                          {r.is_blocking && isRequestOpen(r.status) && <Badge variant="outline">Blocking</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {isRequestOpen(r.status) && (
                          <span className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" disabled={!canWrite}
                              onClick={() => setResponseTarget(r)}>
                              <ClipboardCheck className="mr-1 h-4 w-4" /> Response
                            </Button>
                            <Button size="sm" variant="ghost" disabled={!canWrite}
                              onClick={() => setCloseTarget(r)}>
                              Close
                            </Button>
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Section completion --------------------------------------------------- */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="text-sm text-muted-foreground">
            {readiness?.section_complete
              ? 'Evidence has been marked complete for this assessment.'
              : readiness && readiness.mandatory_outstanding > 0
                ? `${readiness.mandatory_outstanding} required item(s) still outstanding.`
                : openRequests.some((r) => r.is_blocking)
                  ? 'A blocking information request is still open.'
                  : 'All required evidence has been received. Mark the section complete to continue.'}
          </div>
          <div className="flex gap-2">
            {readiness?.section_complete && canReopen && (
              <Button variant="outline" disabled={!canWrite || mutation.isPending}
                onClick={() => run('BN_MEANS_REOPEN_EVIDENCE', {})}
                data-testid="means-evidence-reopen">
                Reopen evidence
              </Button>
            )}
            <Button
              disabled={!canWrite || !canComplete || mutation.isPending || readiness?.section_complete}
              onClick={() => run('BN_MEANS_MARK_EVIDENCE_COMPLETE', {})}
              data-testid="means-evidence-complete"
            >
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Mark evidence complete
            </Button>
          </div>
        </CardContent>
      </Card>

      <BnMeansLinkEvidenceDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        assessmentId={assessmentId}
        requirement={activeRequirement}
        requirements={requirements}
        existingLinks={links}
        reference={reference}
        submitting={mutation.isPending}
        commandError={commandError}
        onSubmit={(payload) => run('BN_MEANS_ATTACH_EVIDENCE', payload)}
      />

      <BnMeansUsabilityDialog
        open={usabilityOpen}
        onOpenChange={setUsabilityOpen}
        link={activeLink}
        reference={reference}
        submitting={mutation.isPending}
        commandError={commandError}
        onSubmit={(payload) => run('BN_MEANS_RECORD_EVIDENCE_USABILITY', payload)}
      />

      <BnMeansInformationRequestDialog
        open={requestOpen}
        onOpenChange={setRequestOpen}
        requirement={activeRequirement}
        requirements={requirements}
        reference={reference}
        submitting={mutation.isPending}
        commandError={commandError}
        onSubmit={(payload) => run('BN_MEANS_REQUEST_INFORMATION', payload)}
      />

      <AlertDialog open={!!unlinkTarget} onOpenChange={(o) => !o && setUnlinkTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unlink this document?</AlertDialogTitle>
            <AlertDialogDescription>
              The document itself is not deleted. It will no longer count towards this requirement.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => unlinkTarget && run('BN_MEANS_UNLINK_EVIDENCE', {
                link_id: unlinkTarget.link_id,
                unlink_reason_code: 'OFFICER_CORRECTION',
              })}
            >
              Unlink
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!responseTarget} onOpenChange={(o) => !o && setResponseTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Record a response</AlertDialogTitle>
            <AlertDialogDescription>
              Record that the person or organisation responded to this request. Link any document
              they provided against the relevant requirement afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => responseTarget && run('BN_MEANS_RECORD_INFORMATION_RESPONSE', {
                request_id: responseTarget.request_id,
                response_kind: 'RECEIVED',
              })}
            >
              Record response
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!closeTarget} onOpenChange={(o) => !o && setCloseTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close this request?</AlertDialogTitle>
            <AlertDialogDescription>
              Closing the request means nothing further is expected. It will no longer block the
              evidence section.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => closeTarget && run('BN_MEANS_CLOSE_INFORMATION_REQUEST', {
                request_id: closeTarget.request_id,
                close_reason_code: 'RESOLVED',
              })}
            >
              Close request
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

const Metric: React.FC<{ label: string; value: number; tone?: 'warn' }> = ({ label, value, tone }) => (
  <div className={`rounded-md border p-3 ${tone === 'warn' ? 'border-destructive/40 bg-destructive/5' : 'bg-muted/30'}`}>
    <p className="text-xs uppercase text-muted-foreground">{label}</p>
    <p className="text-lg font-semibold">{value}</p>
  </div>
);

export default BnMeansEvidenceSection;
