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
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
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
import {
  BnModuleBreadcrumbs,
  useBnWorkspaceSection,
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

/** Screen-level "where am I", replacing the module-local tab bar. */
const RISK_SCREEN_LABELS: Record<string, string> = {
  '': 'Overview',
  signals: 'Signals',
  assessments: 'Assessments',
  controls: 'Controls & outcomes',
  reporting: 'Reporting',
  configuration: 'Configuration',
};

const RiskBreadcrumbs: React.FC = () => {
  const { pathname } = useLocation();
  const tail = pathname.replace(RISK_MODULE_BASE, '').replace(/^\/+|\/+$/g, '').split('/')[0] ?? '';
  return (
    <BnModuleBreadcrumbs
      items={[
        { label: 'Benefit Management' },
        { label: 'Fraud, Error & Risk', to: RISK_MODULE_BASE },
        { label: RISK_SCREEN_LABELS[tail] ?? 'Overview' },
      ]}
    />
  );
};

export function riskAssessmentPath(
  assessmentId: string,
  section?: BnRiskWorkspaceSection | null,
): string {
  const step = section ? `/${section}` : '';
  return `${RISK_MODULE_BASE}/assessments/${assessmentId}${step}`;
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

      {/* Module navigation lives in the left sidebar. */}
      <RiskBreadcrumbs />

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

  /**
   * The operational position dashboard already carries every actionable queue
   * (including new signals and awaiting triage) with backend-derived counts, so
   * the module overview deliberately shows one queue set rather than two.
   */
  return (
    <div className="space-y-6">
      <BnRiskOperationsDashboard
        onOpenQueue={(queue) => {
          /** Legacy queue codes map onto the consolidated destinations. */
          const destination =
            queue === 'control-decisions'
              ? 'controls?stage=decisions'
              : queue === 'control-execution'
                ? 'controls?stage=execution'
                : 'controls?stage=outcomes';
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
  const { assessmentId, section } = useParams<{ assessmentId: string; section?: string }>();
  const navigate = useNavigate();
  const focusSection = WORKSPACE_SECTIONS.includes(section as BnRiskWorkspaceSection)
    ? (section as BnRiskWorkspaceSection)
    : null;

  if (!assessmentId) return <Navigate to={`${RISK_MODULE_BASE}/assessments`} replace />;

  return (
    <div className="space-y-4 p-6">
      <BnModuleBreadcrumbs
        items={[
          { label: 'Benefit Management' },
          { label: 'Fraud, Error & Risk', to: RISK_MODULE_BASE },
          { label: 'Assessments', to: `${RISK_MODULE_BASE}/assessments` },
          { label: focusSection ? RISK_SCREEN_LABELS[focusSection] ?? focusSection : 'Assessment' },
        ]}
      />
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
