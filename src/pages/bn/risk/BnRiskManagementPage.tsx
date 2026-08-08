/**
 * BN Risk / Fraud — operational surface.
 *
 * Operational UX pattern:
 *   MODULE → FIND WORK → OPEN RECORD → UNDERSTAND STAGE → NEXT ACTION
 *
 * Navigation is URL driven and every assessment has a stable address:
 *   /bn/risk-management                      overview and operational queues
 *   /bn/risk-management/signals              signal intake and triage
 *   /bn/risk-management/assessments          assessment work
 *   /bn/risk-management/controls             control decisions, execution, outcomes
 *   /bn/risk-management/reporting            aggregate evidence
 *   /bn/risk-management/configuration        scoring configuration
 *   /bn/risk-management/assessments/:assessmentId?section=…
 *
 * Access is gated by `BnModuleRouteGate` for every address; mutation controls
 * are only offered when the module permits actions and the governed action
 * query allows them.
 */
import React from 'react';
import { Navigate, Outlet, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BnModuleRouteGate,
  type BnModuleAccessContext,
} from '@/components/bn/access/BnModuleRouteGate';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ShieldAlert } from 'lucide-react';
import { BnRiskSignalQueue } from '@/components/bn/risk/BnRiskSignalQueue';
import { BnRiskSignalDetailPanel } from '@/components/bn/risk/BnRiskSignalDetailPanel';
import { BnRiskManualSignalDialog } from '@/components/bn/risk/BnRiskManualSignalDialog';
import { BnRiskAssessmentQueue } from '@/components/bn/risk/BnRiskAssessmentQueue';
import { BnRiskAssessmentWorkspace } from '@/components/bn/risk/BnRiskAssessmentWorkspace';
import { BnRiskControlApprovalQueue } from '@/components/bn/risk/BnRiskControlApprovalQueue';
import { BnRiskControlExecutionQueue } from '@/components/bn/risk/BnRiskControlExecutionQueue';
import { BnRiskOutcomeQueue } from '@/components/bn/risk/BnRiskOutcomeQueue';
import { BnRiskOperationsDashboard } from '@/components/bn/risk/BnRiskOperationsDashboard';
import { BnRiskReportingPanel } from '@/components/bn/risk/BnRiskReportingPanel';
import { BnRiskScoringConfigurationPanel } from '@/components/bn/risk/BnRiskScoringConfigurationPanel';
import { riskQueryService } from '@/services/bn/risk/riskQueryService';
import {
  BnModuleSectionNav,
  BnQueueSummaryCards,
  useBnWorkspaceSection,
  type BnQueueSummaryItem,
} from '@/components/bn/ux';

export const RISK_MODULE_BASE = '/bn/risk-management';

/** Sections owned by the assessment workspace. */
export type BnRiskWorkspaceSection =
  | 'approval'
  | 'execution'
  | 'outcome'
  | 'closure'
  | 'feedback';

const WORKSPACE_SECTIONS: readonly BnRiskWorkspaceSection[] = [
  'approval', 'execution', 'outcome', 'closure', 'feedback',
];

const OVERVIEW_TILES: readonly { code: string; label: string }[] = [
  { code: 'NEW', label: 'Awaiting triage' },
  { code: 'TRIAGED', label: 'Triaged' },
  { code: 'LINKED', label: 'Linked' },
  { code: 'UNDER_REVIEW', label: 'Under review' },
  { code: 'DISMISSED', label: 'Dismissed' },
];

export function riskAssessmentPath(
  assessmentId: string,
  section?: BnRiskWorkspaceSection | null,
): string {
  const query = section ? `?section=${section}` : '';
  return `${RISK_MODULE_BASE}/assessments/${assessmentId}${query}`;
}

function useOpenRiskAssessment() {
  const navigate = useNavigate();
  return React.useCallback(
    (assessmentId: string, section?: BnRiskWorkspaceSection | null) =>
      navigate(riskAssessmentPath(assessmentId, section)),
    [navigate],
  );
}

// ---------------------------------------------------------------- module shell

const RiskModuleShell: React.FC<{ ctx: BnModuleAccessContext }> = ({ ctx }) => {
  const [manualOpen, setManualOpen] = React.useState(false);
  const [confirmation, setConfirmation] = React.useState<string | null>(null);
  const canWrite = ctx.actionsEnabled && ctx.can('write');

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

      {confirmation && <Alert><AlertDescription>{confirmation}</AlertDescription></Alert>}

      <BnModuleSectionNav
        ariaLabel="Fraud, Error and Risk destinations"
        items={[
          { to: RISK_MODULE_BASE, label: 'Overview', end: true },
          { to: `${RISK_MODULE_BASE}/signals`, label: 'Signals' },
          { to: `${RISK_MODULE_BASE}/assessments`, label: 'Assessments' },
          { to: `${RISK_MODULE_BASE}/controls`, label: 'Controls & outcomes' },
          { to: `${RISK_MODULE_BASE}/reporting`, label: 'Reporting' },
          { to: `${RISK_MODULE_BASE}/configuration`, label: 'Configuration' },
        ]}
      />

      <Outlet />

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

// ------------------------------------------------------------------- overview

const RiskOverviewRoute: React.FC = () => {
  const navigate = useNavigate();
  const counts = useQuery({
    queryKey: ['bn-risk-signal-queue', 'counts'],
    queryFn: async () => {
      const result = await riskQueryService.signalQueue({}, 1, 1);
      if (result.status !== 'OK' || !result.data) throw new Error(result.code ?? result.status);
      return result.data.status_counts;
    },
  });

  /** A failed count read is shown as unavailable, never as zero. */
  const items: readonly BnQueueSummaryItem[] = OVERVIEW_TILES.map((tile) => ({
    id: tile.code,
    label: tile.label,
    loading: counts.isLoading,
    unavailable: counts.isError,
    count: counts.isError ? undefined : counts.data?.[tile.code] ?? 0,
    description: tile.code === 'NEW' ? 'Requires an officer decision' : 'In the risk pipeline',
    onSelect: () => navigate(`${RISK_MODULE_BASE}/signals`),
  }));

  return (
    <div className="space-y-6">
      <BnQueueSummaryCards
        ariaLabel="Signal pipeline"
        items={items}
        className="xl:grid-cols-5"
      />
      <BnRiskOperationsDashboard
        onOpenQueue={(queue) => {
          const destination =
            queue === 'signals'
              ? 'signals'
              : queue === 'assessments'
                ? 'assessments'
                : queue === 'reporting'
                  ? 'reporting'
                  : 'controls';
          navigate(`${RISK_MODULE_BASE}/${destination}`);
        }}
      />
    </div>
  );
};

// -------------------------------------------------------------------- signals

const RiskSignalsRoute: React.FC<{ ctx: BnModuleAccessContext }> = ({ ctx }) => {
  const [openSignalId, setOpenSignalId] = React.useState<string | null>(null);
  const openAssessment = useOpenRiskAssessment();

  return (
    <div className="space-y-6">
      <BnRiskSignalQueue onOpenSignal={setOpenSignalId} />

      <Alert>
        <AlertTitle>What happens after triage</AlertTitle>
        <AlertDescription>
          A confirmed signal can be taken forward into a risk assessment, where facts
          and evidence are gathered, then scored for review. A score is decision support
          only — no signal, assessment or score can affect a benefit on its own.
        </AlertDescription>
      </Alert>

      <BnRiskSignalDetailPanel
        signalId={openSignalId}
        onOpenChange={(open) => !open && setOpenSignalId(null)}
        actionsEnabled={ctx.actionsEnabled}
        onOpenAssessment={(id) => openAssessment(id)}
      />
    </div>
  );
};

// ---------------------------------------------------------------- assessments

const RiskAssessmentsRoute: React.FC = () => {
  const openAssessment = useOpenRiskAssessment();
  return <BnRiskAssessmentQueue onOpenAssessment={(id) => openAssessment(id)} />;
};

const RiskAssessmentRecordRoute: React.FC = () => {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const navigate = useNavigate();
  const [section] = useBnWorkspaceSection('');
  const focusSection = WORKSPACE_SECTIONS.includes(section as BnRiskWorkspaceSection)
    ? (section as BnRiskWorkspaceSection)
    : null;

  if (!assessmentId) return <Navigate to={`${RISK_MODULE_BASE}/assessments`} replace />;

  return (
    <div className="space-y-6 p-6">
      <BnRiskAssessmentWorkspace
        assessmentId={assessmentId}
        focusSection={focusSection}
        onBack={() => navigate(`${RISK_MODULE_BASE}/assessments`)}
      />
    </div>
  );
};

// -------------------------------------------------------- controls & outcomes

/**
 * The former control-decision, control-execution and outcome tabs are one
 * destination: they are the same body of control work at different stages.
 */
const RiskControlsRoute: React.FC = () => {
  const openAssessment = useOpenRiskAssessment();
  const [stage, setStage] = useBnWorkspaceSection('decisions', 'stage');

  return (
    <Tabs value={stage} onValueChange={(next) => setStage(next, { replace: true })}>
      <TabsList>
        <TabsTrigger value="decisions">Awaiting decision</TabsTrigger>
        <TabsTrigger value="execution">Approved for execution</TabsTrigger>
        <TabsTrigger value="outcomes">Outcomes &amp; closure</TabsTrigger>
      </TabsList>

      <TabsContent value="decisions" className="space-y-6 pt-4">
        <BnRiskControlApprovalQueue onOpenApproval={(id) => openAssessment(id, 'approval')} />
        <Alert>
          <AlertTitle>Approval authorises a control</AlertTitle>
          <AlertDescription>
            Approving a recommended control authorises it for later governed execution.
            No payment, award, claim, overpayment or referral changes from this screen.
          </AlertDescription>
        </Alert>
      </TabsContent>

      <TabsContent value="execution" className="space-y-6 pt-4">
        <BnRiskControlExecutionQueue onOpenExecution={(id) => openAssessment(id, 'execution')} />
        <Alert>
          <AlertTitle>The owning domain performs the action</AlertTitle>
          <AlertDescription>
            Risk requests an approved control through a governed handoff. Payments, Legal,
            Investigation and the other owning domains decide whether and how it is applied,
            and Risk records only the reference and status they return.
          </AlertDescription>
        </Alert>
      </TabsContent>

      <TabsContent value="outcomes" className="space-y-6 pt-4">
        <BnRiskOutcomeQueue
          onOpenAssessment={(id, section) => openAssessment(id, section)}
        />
        <Alert>
          <AlertTitle>Outcome, completion and closure are governed</AlertTitle>
          <AlertDescription>
            An outcome records what the assessment concluded and why. Closure ends the
            assessment; a closed assessment can only be reopened exceptionally, with a
            recorded justification, and every reopening is audited.
          </AlertDescription>
        </Alert>
      </TabsContent>
    </Tabs>
  );
};

const RiskReportingRoute: React.FC = () => (
  <div className="space-y-6">
    <BnRiskReportingPanel />
    <Alert>
      <AlertTitle>Reporting is aggregate evidence</AlertTitle>
      <AlertDescription>
        Reports describe volumes, outcomes and rule behaviour. A referral is not a finding
        of fraud, and no rule is judged effective or ineffective by a figure alone —
        changing a rule remains a separate, versioned and authorised decision.
      </AlertDescription>
    </Alert>
  </div>
);

export default function BnRiskManagementPage() {
  return (
    <BnModuleRouteGate moduleCode="bn_risk_management" requiredAction="view">
      {(ctx: BnModuleAccessContext) => (
        <Routes>
          <Route path="assessments/:assessmentId" element={<RiskAssessmentRecordRoute />} />

          <Route element={<RiskModuleShell ctx={ctx} />}>
            <Route index element={<RiskOverviewRoute />} />
            <Route path="signals" element={<RiskSignalsRoute ctx={ctx} />} />
            <Route path="assessments" element={<RiskAssessmentsRoute />} />
            <Route path="controls" element={<RiskControlsRoute />} />
            <Route path="reporting" element={<RiskReportingRoute />} />
            <Route path="configuration" element={<BnRiskScoringConfigurationPanel />} />
            <Route path="*" element={<Navigate to={RISK_MODULE_BASE} replace />} />
          </Route>
        </Routes>
      )}
    </BnModuleRouteGate>
  );
}
