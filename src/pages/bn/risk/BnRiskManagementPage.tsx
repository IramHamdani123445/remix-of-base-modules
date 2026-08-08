/**
 * BN Risk / Fraud — operational surface (EPIC 0 signals, EPIC 1 assessments).
 *
 * Access is gated by `BnModuleRouteGate`; mutation controls are only offered
 * when the module permits actions and the governed action query allows them.
 * The assessment workspace is a deep link on this single governed route — no
 * new route is registered.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BnModuleRouteGate,
  type BnModuleAccessContext,
} from '@/components/bn/access/BnModuleRouteGate';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ShieldAlert } from 'lucide-react';
import { BnRiskSignalQueue } from '@/components/bn/risk/BnRiskSignalQueue';
import { BnRiskSignalDetailPanel } from '@/components/bn/risk/BnRiskSignalDetailPanel';
import { BnRiskManualSignalDialog } from '@/components/bn/risk/BnRiskManualSignalDialog';
import { BnRiskAssessmentQueue } from '@/components/bn/risk/BnRiskAssessmentQueue';
import { BnRiskAssessmentWorkspace } from '@/components/bn/risk/BnRiskAssessmentWorkspace';
import { BnRiskControlApprovalQueue } from '@/components/bn/risk/BnRiskControlApprovalQueue';
import { BnRiskScoringConfigurationPanel } from '@/components/bn/risk/BnRiskScoringConfigurationPanel';
import { riskQueryService } from '@/services/bn/risk/riskQueryService';

const OVERVIEW_TILES: readonly { code: string; label: string }[] = [
  { code: 'NEW', label: 'Awaiting triage' },
  { code: 'TRIAGED', label: 'Triaged' },
  { code: 'LINKED', label: 'Linked' },
  { code: 'UNDER_REVIEW', label: 'Under review' },
  { code: 'DISMISSED', label: 'Dismissed' },
];

const RiskWorkspace: React.FC<{ ctx: BnModuleAccessContext }> = ({ ctx }) => {
  const [openSignalId, setOpenSignalId] = React.useState<string | null>(null);
  const [manualOpen, setManualOpen] = React.useState(false);
  const [confirmation, setConfirmation] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState('signals');
  const [openAssessmentId, setOpenAssessmentId] = React.useState<string | null>(null);
  const [focusApproval, setFocusApproval] = React.useState(false);

  const counts = useQuery({
    queryKey: ['bn-risk-signal-queue', 'counts'],
    queryFn: async () => {
      const result = await riskQueryService.signalQueue({}, 1, 1);
      if (result.status !== 'OK' || !result.data) throw new Error(result.code ?? result.status);
      return result.data.status_counts;
    },
  });

  const canWrite = ctx.actionsEnabled && ctx.can('write');

  const openAssessment = React.useCallback((assessmentId: string) => {
    setFocusApproval(false);
    setOpenAssessmentId(assessmentId);
    setTab('assessments');
  }, []);

  /** Deep link from the approval queue straight to the decision section. */
  const openApprovalDecision = React.useCallback((assessmentId: string) => {
    setFocusApproval(true);
    setOpenAssessmentId(assessmentId);
    setTab('assessments');
  }, []);



  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ShieldAlert className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">Fraud, Error &amp; Risk</h1>
            <p className="text-sm text-muted-foreground">
              Signal intake, triage and governed risk assessments.
            </p>
          </div>
          {ctx.rolloutState === 'internal_pilot' && (
            <Badge variant="secondary">Internal pilot</Badge>
          )}
        </div>
        {canWrite && (
          <Button onClick={() => setManualOpen(true)}>Register manual signal</Button>
        )}
      </div>

      {!ctx.actionsEnabled && (
        <Alert>
          <AlertTitle>Read-only</AlertTitle>
          <AlertDescription>
            Risk actions are currently disabled. You can review signals but not change them.
          </AlertDescription>
        </Alert>
      )}

      {confirmation && (
        <Alert><AlertDescription>{confirmation}</AlertDescription></Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {OVERVIEW_TILES.map((tile) => (
          <Card key={tile.code}>
            <CardHeader className="pb-2">
              <CardDescription>{tile.label}</CardDescription>
              <CardTitle className="text-2xl">
                {counts.data?.[tile.code] ?? (counts.isLoading ? '—' : 0)}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-xs text-muted-foreground">
              {tile.code === 'NEW' ? 'Requires an officer decision' : 'In the risk pipeline'}
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={(v) => { setTab(v); if (v === 'signals') setOpenAssessmentId(null); }}>
        <TabsList>
          <TabsTrigger value="signals">Signals</TabsTrigger>
          <TabsTrigger value="assessments">Assessments</TabsTrigger>
          <TabsTrigger value="control-decisions">Control decisions</TabsTrigger>
          <TabsTrigger value="scoring-configuration">Scoring configuration</TabsTrigger>
        </TabsList>

        <TabsContent value="signals" className="space-y-6">
          <BnRiskSignalQueue onOpenSignal={setOpenSignalId} />

          <Alert>
            <AlertTitle>What happens after triage</AlertTitle>
            <AlertDescription>
              A confirmed signal can be taken forward into a risk assessment, where facts
              and evidence are gathered, then scored for review. A score is decision support
              only — no signal, assessment or score can affect a benefit on its own.
            </AlertDescription>
          </Alert>
        </TabsContent>

        <TabsContent value="assessments" className="space-y-6">
          {openAssessmentId
            ? (
              <BnRiskAssessmentWorkspace
                assessmentId={openAssessmentId}
                focusSection={focusApproval ? 'approval' : null}
                onBack={() => { setOpenAssessmentId(null); setFocusApproval(false); }}
              />
            )
            : (
              <BnRiskAssessmentQueue
                onOpenAssessment={(id) => { setFocusApproval(false); setOpenAssessmentId(id); }}
              />
            )}
        </TabsContent>

        <TabsContent value="control-decisions" className="space-y-6">
          <BnRiskControlApprovalQueue onOpenApproval={openApprovalDecision} />

          <Alert>
            <AlertTitle>Approval authorises a control</AlertTitle>
            <AlertDescription>
              Approving a recommended control authorises it for later governed execution.
              No payment, award, claim, overpayment or referral changes from this screen.
            </AlertDescription>
          </Alert>
        </TabsContent>

        <TabsContent value="scoring-configuration" className="space-y-6">
          <BnRiskScoringConfigurationPanel />
        </TabsContent>
      </Tabs>



      <BnRiskSignalDetailPanel
        signalId={openSignalId}
        onOpenChange={(open) => !open && setOpenSignalId(null)}
        actionsEnabled={ctx.actionsEnabled}
        onOpenAssessment={openAssessment}
      />


      <BnRiskManualSignalDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        canRecordRestrictedNote={ctx.can('restricted_notes')}
        onCompleted={(reference) =>
          setConfirmation(
            reference ? `Signal ${reference} was registered.` : 'The signal was registered.',
          )
        }
      />
    </div>
  );
};

export default function BnRiskManagementPage() {
  return (
    <BnModuleRouteGate moduleCode="bn_risk_management" requiredAction="view">
      {(ctx: BnModuleAccessContext) => <RiskWorkspace ctx={ctx} />}
    </BnModuleRouteGate>
  );
}
