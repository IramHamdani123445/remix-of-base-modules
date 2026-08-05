/**
 * BN Medical Reviews — obligation detail panel (Benefits Centre).
 *
 * Read-only by construction: everything on this panel comes from secured
 * query RPCs. Confidential clinical evidence is fetched from a SEPARATE RPC
 * and only when the caller holds the confidential permission, so the
 * non-clinical summary can be shown safely to general Benefits staff.
 */
import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { AlertTriangle, Gavel, Stethoscope, ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  medicalReviewQueryService,
  type MedicalReviewDetail,
  type BoardRequirement,
} from '@/services/bn/medicalReviewQueryService';
import { describeMedicalReviewFailure } from '@/features/bn/medical-reviews/model/errors';
import {
  MedicalReviewStatusBadge,
  ConfidentialWithheldNotice,
} from '@/components/bn/medical-reviews/MedicalReviewActionControls';

interface Props {
  obligationId: string;
  canViewConfidential: boolean;
  canViewAudit: boolean;
}

const Field: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div>
    <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
    <div className="text-sm">{value ?? '—'}</div>
  </div>
);

export const MedicalReviewDetailPanel: React.FC<Props> = ({
  obligationId,
  canViewConfidential,
  canViewAudit,
}) => {
  const [detail, setDetail] = useState<MedicalReviewDetail | null>(null);
  const [board, setBoard] = useState<BoardRequirement | null>(null);
  const [assessment, setAssessment] = useState<Record<string, unknown>[]>([]);
  const [decisions, setDecisions] = useState<Record<string, unknown>[]>([]);
  const [proposals, setProposals] = useState<Record<string, unknown>[]>([]);
  const [timeline, setTimeline] = useState<Record<string, unknown>[]>([]);
  const [confidential, setConfidential] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const [d, b, a, dec, p] = await Promise.all([
          medicalReviewQueryService.detail(obligationId),
          medicalReviewQueryService.boardRequirement(obligationId).catch(() => null),
          medicalReviewQueryService.assessmentSummary(obligationId).catch(() => ({ rows: [] })),
          medicalReviewQueryService.decisionDetail(obligationId).catch(() => []),
          medicalReviewQueryService.proposalLinks(obligationId).catch(() => []),
        ]);
        if (cancelled) return;
        setDetail(d);
        setBoard(b);
        setAssessment(a.rows as Record<string, unknown>[]);
        setDecisions(dec as Record<string, unknown>[]);
        setProposals(p as Record<string, unknown>[]);

        if (canViewAudit) {
          const t = await medicalReviewQueryService.auditTimeline(obligationId).catch(() => null);
          if (!cancelled && t) setTimeline(t.rows as unknown as Record<string, unknown>[]);
        }
        // Confidential clinical evidence is a distinct, separately audited read.
        if (canViewConfidential) {
          const c = await medicalReviewQueryService
            .confidentialEvidence(obligationId)
            .catch(() => null);
          if (!cancelled && c) setConfidential(c.rows as Record<string, unknown>[]);
        }
      } catch (e) {
        if (!cancelled) setError(describeMedicalReviewFailure(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [obligationId, canViewConfidential, canViewAudit]);

  if (loading) return <Skeleton className="h-64 w-full" />;

  if (error) {
    return (
      <Alert variant="destructive" data-testid="mr-detail-error">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Unable to open this review</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!detail) return null;

  return (
    <Card data-testid="mr-detail-panel">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">
            {detail.obligationReference ?? 'Medical review'}
          </CardTitle>
          <div className="mt-1 flex items-center gap-2">
            <MedicalReviewStatusBadge status={detail.obligationStatus} />
            {board?.boardRequired && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Gavel className="h-3.5 w-3.5" /> Board required ({board.boardMode})
              </span>
            )}
          </div>
        </div>
        {detail.awardId && (
          <Link
            to={`/bn/awards/${detail.awardId}`}
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            Open Award 360 <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </CardHeader>

      <CardContent>
        <Tabs defaultValue="overview">
          <TabsList className="flex-wrap">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="assessment">Assessment</TabsTrigger>
            <TabsTrigger value="decision">Decision</TabsTrigger>
            <TabsTrigger value="proposals">Award proposals</TabsTrigger>
            {canViewAudit && <TabsTrigger value="audit">Audit</TabsTrigger>}
          </TabsList>

          <TabsContent value="overview" className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Review type" value={detail.reviewType} />
            <Field label="Reason" value={detail.reviewReason} />
            <Field label="Due date" value={detail.dueDate} />
            <Field label="Notice due" value={detail.noticeDueDate} />
            <Field label="Grace end" value={detail.graceEndDate} />
            <Field label="Deferred until" value={detail.deferredUntil} />
            <Field label="Risk" value={detail.riskClassification} />
            <Field label="Board mode" value={board?.boardMode ?? '—'} />
            <Field label="Assessment model" value={board?.assessmentModel ?? '—'} />
          </TabsContent>

          <TabsContent value="assessment" className="mt-4 space-y-3">
            {assessment.length === 0 ? (
              <p className="text-sm text-muted-foreground">No assessment recorded yet.</p>
            ) : (
              assessment.map((row, i) => (
                <div key={i} className="rounded-md border p-3 text-sm">
                  <div className="flex items-center gap-2 font-medium">
                    <Stethoscope className="h-4 w-4" />
                    {String(row.assessment_reference ?? row.assessment_id ?? `Assessment ${i + 1}`)}
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    Status: {String(row.assessment_status ?? row.status ?? '—')}
                  </div>
                </div>
              ))
            )}
            <Separator />
            {canViewConfidential ? (
              confidential.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No confidential clinical evidence released for this review.
                </p>
              ) : (
                <div className="space-y-2">
                  {confidential.map((row, i) => (
                    <div key={i} className="rounded-md border border-amber-300 bg-amber-500/5 p-3 text-sm">
                      <div className="font-medium">
                        {String(row.evidence_type ?? row.field_code ?? 'Clinical evidence')}
                      </div>
                      <div className="text-muted-foreground">
                        {String(row.summary ?? row.value ?? '—')}
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <ConfidentialWithheldNotice />
            )}
          </TabsContent>

          <TabsContent value="decision" className="mt-4 space-y-3">
            {decisions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No administrative decision has been prepared.
              </p>
            ) : (
              decisions.map((row, i) => (
                <div key={i} className="rounded-md border p-3 text-sm">
                  <div className="font-medium">
                    {String(row.outcome_code ?? 'Decision')} —{' '}
                    {String(row.decision_status ?? row.status ?? '—')}
                  </div>
                  <div className="text-muted-foreground">
                    Effective {String(row.effective_date ?? '—')} · Medical recommendation{' '}
                    {row.medical_recommendation_accepted === false ? 'departed from' : 'accepted'}
                  </div>
                </div>
              ))
            )}
          </TabsContent>

          <TabsContent value="proposals" className="mt-4 space-y-3">
            <Alert>
              <AlertTitle>Proposal boundary</AlertTitle>
              <AlertDescription>
                Medical Reviews only <strong>propose</strong> suspension or reinstatement. Awards,
                payments and suspensions are executed exclusively by the Award Suspension command
                boundary under its own approvals.
              </AlertDescription>
            </Alert>
            {proposals.length === 0 ? (
              <p className="text-sm text-muted-foreground">No award proposals raised.</p>
            ) : (
              proposals.map((row, i) => (
                <div key={i} className="rounded-md border p-3 text-sm">
                  <div className="font-medium">{String(row.proposal_type ?? 'Proposal')}</div>
                  <div className="text-muted-foreground">
                    Status {String(row.proposal_status ?? row.status ?? '—')}
                  </div>
                </div>
              ))
            )}
          </TabsContent>

          {canViewAudit && (
            <TabsContent value="audit" className="mt-4 space-y-2">
              {timeline.length === 0 ? (
                <p className="text-sm text-muted-foreground">No audit entries visible.</p>
              ) : (
                timeline.map((row, i) => (
                  <div key={i} className="rounded-md border p-2 text-sm">
                    <span className="font-medium">{String(row.eventType ?? 'Event')}</span>
                    <span className="ml-2 text-muted-foreground">
                      {String(row.occurredAt ?? '')}
                    </span>
                  </div>
                ))
              )}
            </TabsContent>
          )}
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default MedicalReviewDetailPanel;
