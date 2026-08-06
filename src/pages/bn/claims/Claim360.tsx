/**
 * Claim 360° View — Enhanced with all tab panels and integration adapters
 */
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ArrowLeft, User, FileText, Calculator, CheckCircle2,
  Clock, MessageSquare, Shield, GitBranch, DollarSign, BarChart3
} from 'lucide-react';
import { useBnClaim, useBnClaimEvents, useBnClaimNotes, useBnClaimEligibility, useBnClaimCalculations } from '@/hooks/bn/useBnClaim';
import { BN_CLAIM_STATUS_LABELS } from '@/types/bn';
import { formatDateForDisplay } from '@/lib/format-config';
import { ClaimDecisionPanel } from '@/components/bn/claim/ClaimDecisionPanel';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { ClaimDecisionTimeline } from '@/components/bn/claim/ClaimDecisionTimeline';
import { EvidenceChecklist } from '@/components/bn/evidence/EvidenceChecklist';
import { EvidenceAuditTimeline } from '@/components/bn/evidence/EvidenceAuditTimeline';
import { ClaimantProfileTab } from '@/components/bn/claim/ClaimantProfileTab';
import { ContributionsWagesTab } from '@/components/bn/claim/ContributionsWagesTab';
import { WorkflowAuditTab } from '@/components/bn/claim/WorkflowAuditTab';
import { BnStatusBadge, BnStatCard, BnEmptyState } from '@/components/bn/shared';
import ReferToLegalButton from '@/components/legal/lg/ReferToLegalButton';
import {
  MeansStartAssessmentAction,
  personIdFromSsn,
} from '@/components/bn/meansTests/initiation/MeansStartAssessmentAction';

export default function Claim360() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: claim, isLoading } = useBnClaim(id);
  const { data: events = [] } = useBnClaimEvents(id);
  const { data: notes = [] } = useBnClaimNotes(id);
  const { data: eligibility = [] } = useBnClaimEligibility(id);
  const { data: calculations = [] } = useBnClaimCalculations(id);

  const { roles: authRoles } = useSupabaseAuth();
  const userRoles = (authRoles ?? []).map((r) => String(r));

  if (isLoading) return <BnEmptyState type="loading" title="Loading claim..." />;
  if (!claim) return <BnEmptyState type="error" title="Claim not found" description="The requested claim does not exist." />;

  const product = (claim as any).bn_product;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/bn/claims')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="t-page-title">
              {claim.claim_number || claim.id.slice(0, 8)}
            </h1>
            <BnStatusBadge
              status={claim.status}
              label={BN_CLAIM_STATUS_LABELS[claim.status] || claim.status}
              dot
            />
            <BnStatusBadge status={claim.priority} size="sm" />
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {product?.benefit_name || 'Unknown Benefit'} • SSN: {claim.ssn} • Filed: {formatDateForDisplay(claim.claim_date)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* MEANS-TEST EPIC 1 — start a means test without leaving the claim. */}
          <MeansStartAssessmentAction
            testId="claim360-means-start"
            prefill={{
              entryContext: 'NEW_CLAIM_ASSESSMENT',
              personId: personIdFromSsn(claim.ssn),
              personLabel: claim.ssn ? `Claimant on ${claim.claim_number || 'this claim'}` : null,
              claimId: claim.id,
              benefitProgramme: product?.benefit_code ?? null,
              effectiveFrom: claim.claim_date ?? null,
              originSurface: 'CLAIM_WORKSPACE',
            }}
          />
          <ReferToLegalButton module="benefits" claimId={claim.id} variant="outline" />
        </div>
      </div>


      {/* Decision Panel */}
      <ClaimDecisionPanel claimId={claim.id} userRoles={userRoles} productCategory={product?.category} />

      {/* Summary Strip */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <BnStatCard title="Claimant" value={claim.ssn} icon={User} subtitle={product?.benefit_name} />
        <BnStatCard
          title="Eligibility"
          value={eligibility.length > 0 ? (eligibility[0].overall_result ? 'Passed' : 'Failed') : 'Pending'}
          icon={CheckCircle2}
        />
        <BnStatCard
          title="Calculated Rate"
          value={calculations.length > 0 ? `$${(calculations[0].weekly_rate || 0).toFixed(2)}/wk` : 'Pending'}
          icon={Calculator}
        />
        <BnStatCard title="Events" value={events.length} icon={Clock} subtitle={`${notes.length} notes`} />
      </div>

      {/* Tab Panel */}
      <Tabs defaultValue="claimant" className="w-full">
        <TabsList className="w-full justify-start overflow-x-auto bg-muted/50 p-1">
          <TabsTrigger value="claimant" className="gap-1.5"><User className="h-3.5 w-3.5" /> Claimant</TabsTrigger>
          <TabsTrigger value="contributions" className="gap-1.5"><BarChart3 className="h-3.5 w-3.5" /> Contributions</TabsTrigger>
          <TabsTrigger value="eligibility" className="gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" /> Eligibility</TabsTrigger>
          <TabsTrigger value="calculation" className="gap-1.5"><Calculator className="h-3.5 w-3.5" /> Calculation</TabsTrigger>
          <TabsTrigger value="documents" className="gap-1.5"><FileText className="h-3.5 w-3.5" /> Documents</TabsTrigger>
          <TabsTrigger value="decisions" className="gap-1.5"><Shield className="h-3.5 w-3.5" /> Decisions</TabsTrigger>
          <TabsTrigger value="workflow" className="gap-1.5"><GitBranch className="h-3.5 w-3.5" /> Workflow</TabsTrigger>
          <TabsTrigger value="notes" className="gap-1.5"><MessageSquare className="h-3.5 w-3.5" /> Notes</TabsTrigger>
        </TabsList>

        {/* Claimant Profile */}
        <TabsContent value="claimant" className="mt-6">
          <ClaimantProfileTab ssn={claim.ssn} />
        </TabsContent>

        {/* Contributions */}
        <TabsContent value="contributions" className="mt-6">
          <ContributionsWagesTab ssn={claim.ssn} />
        </TabsContent>

        {/* Eligibility */}
        <TabsContent value="eligibility" className="mt-6">
          <Card>
            <CardContent className="pt-6">
              {eligibility.length === 0 ? (
                <BnEmptyState type="empty" title="No eligibility checks" description="Run an eligibility check to see results here." />
              ) : (
                <div className="space-y-4">
                  {eligibility.map((check: any) => (
                    <div key={check.id} className="rounded-lg border p-4">
                      <div className="flex items-center justify-between">
                        <BnStatusBadge status={check.overall_result ? 'APPROVED' : 'DENIED'} label={check.overall_result ? 'ELIGIBLE' : 'NOT ELIGIBLE'} />
                        <span className="text-sm text-muted-foreground">{formatDateForDisplay(check.check_date)}</span>
                      </div>
                      {check.override_applied && (
                        <p className="mt-2 text-sm text-destructive">Override by {check.override_by}: {check.override_reason}</p>
                      )}
                      {Array.isArray(check.rule_results) && check.rule_results.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {check.rule_results.map((r: any, i: number) => (
                            <div key={i} className="flex items-center gap-2 text-sm">
                              <span className={r.passed ? 'text-emerald-600' : 'text-destructive'}>{r.passed ? '✓' : '✗'}</span>
                              <span>{r.rule_name}: {r.message}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Calculation */}
        <TabsContent value="calculation" className="mt-6">
          <Card>
            <CardContent className="pt-6">
              {calculations.length === 0 ? (
                <BnEmptyState type="empty" title="No calculations" description="Run a calculation to see results here." />
              ) : (
                <div className="space-y-4">
                  {calculations.map((calc: any) => (
                    <div key={calc.id} className="rounded-lg border p-4">
                      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                        {calc.weekly_rate != null && (
                          <div><p className="text-sm text-muted-foreground">Weekly Rate</p><p className="text-xl font-bold">${calc.weekly_rate.toFixed(2)}</p></div>
                        )}
                        {calc.monthly_rate != null && (
                          <div><p className="text-sm text-muted-foreground">Monthly Rate</p><p className="text-xl font-bold">${calc.monthly_rate.toFixed(2)}</p></div>
                        )}
                        {calc.lump_sum != null && (
                          <div><p className="text-sm text-muted-foreground">Lump Sum</p><p className="text-xl font-bold">${calc.lump_sum.toFixed(2)}</p></div>
                        )}
                      </div>
                      <p className="mt-3 text-xs text-muted-foreground">Calculated: {formatDateForDisplay(calc.calc_date)}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Documents */}
        <TabsContent value="documents" className="mt-6 space-y-6">
          <EvidenceChecklist claimId={claim.id} userRoles={userRoles} />
          <EvidenceAuditTimeline claimId={claim.id} />
        </TabsContent>

        {/* Decisions */}
        <TabsContent value="decisions" className="mt-6">
          <ClaimDecisionTimeline claimId={claim.id} />
        </TabsContent>

        {/* Workflow */}
        <TabsContent value="workflow" className="mt-6">
          <WorkflowAuditTab claimId={claim.id} />
        </TabsContent>

        {/* Notes */}
        <TabsContent value="notes" className="mt-6">
          <Card>
            <CardContent className="pt-6">
              {notes.length === 0 ? (
                <BnEmptyState type="empty" title="No notes" description="Add a note to document findings or actions." />
              ) : (
                <div className="space-y-4">
                  {notes.map((note: any) => (
                    <div key={note.id} className="rounded-lg border p-4">
                      {note.subject && <p className="font-medium text-sm">{note.subject}</p>}
                      <p className="mt-1 text-sm text-foreground">{note.body}</p>
                      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <span>by {note.entered_by}</span>
                        <span>•</span>
                        <span>{formatDateForDisplay(note.entered_at)}</span>
                        <span>•</span>
                        <BnStatusBadge status={note.is_internal ? 'DRAFT' : 'ACTIVE'} label={note.is_internal ? 'Internal' : 'External'} size="sm" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
