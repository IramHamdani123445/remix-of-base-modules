/**
 * BN Means-Test Assessments — module experience.
 *
 * Operational UX pattern:
 *   MODULE → FIND WORK → OPEN RECORD → UNDERSTAND STAGE → NEXT ACTION
 *
 * Navigation is URL driven. Every destination and every assessment has a
 * stable, refresh-survivable address:
 *   /bn/means-tests                      module overview
 *   /bn/means-tests/assessments          operational queues
 *   /bn/means-tests/search               search all assessments
 *   /bn/means-tests/verification         verification work
 *   /bn/means-tests/decisions            adjustment and approval work
 *   /bn/means-tests/reassessments        reassessment work
 *   /bn/means-tests/configuration        governed policy configuration
 *   /bn/means-tests/assessments/:assessmentId/:section   record workflow screen
 *
 * Access is enforced by `BnModuleRouteGate` (fail-closed, database-driven)
 * for every one of those addresses. Menu and nav visibility is convenience,
 * never security — the gate protects direct URL entry.
 */
import React from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BnModuleRouteGate,
  type BnModuleAccessContext,
} from '@/components/bn/access/BnModuleRouteGate';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { BnMeansDecisionQueue } from '@/components/bn/meansTests/decision/BnMeansDecisionQueue';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, ClipboardList, Plus, ShieldAlert } from 'lucide-react';
import {
  meansQueryService,
  type BnMeansWorkQueueFilters,
  type BnMeansWorkQueueRow,
} from '@/services/bn/meansTests/meansQueryService';
import { BnMeansAssessmentWorkspace } from '@/components/bn/meansTests/BnMeansAssessmentWorkspace';
import { BnMeansInitiationWizard } from '@/components/bn/meansTests/initiation/BnMeansInitiationWizard';
import { humaniseMeansCode } from '@/types/bn/meansTests/meansFieldContract';
import {
  MEANS_WORK_AREAS,
  MeansHowItWorksPanel,
  MeansProcessJourney,
  MeansTechnicalDetails,
  MeansWorkAreaCard,
} from '@/components/bn/meansTests/landing/MeansLanding';
import { BnMeansVerificationQueue } from '@/components/bn/meansTests/verification/BnMeansVerificationQueue';
import { BnMeansReassessmentQueuePanel } from '@/components/bn/meansTests/lifecycle/BnMeansReassessmentQueue';
import { BnMeansPolicyConfiguration } from '@/components/bn/meansTests/configuration/BnMeansPolicyConfiguration';
import BnMeansOperationsWorkspace from '@/components/bn/meansTests/operations/BnMeansOperationsWorkspace';
import {
  BnDataState,
  BnFilterBar,
  BnModuleBreadcrumbs,
  BnModuleHeader,
  BnModulePage,
  BnModuleTrail,
} from '@/components/bn/ux';

const STATUS_FILTERS = [
  'DRAFT', 'INFORMATION_PENDING', 'SUBMITTED', 'VERIFICATION_PENDING', 'CALCULATED',
  'APPROVAL_PENDING', 'APPROVED', 'ACTIVE', 'REASSESSMENT_DUE', 'REJECTED', 'CLOSED',
];

/** Nine authoritative Means-Test module actions. */
export const MEANS_MODULE_ACTIONS = [
  'view', 'write', 'verify', 'decide', 'adjust_request', 'adjust_approve', 'approve', 'reassess', 'config',
] as const;

export const MEANS_MODULE_BASE = '/bn/means-tests';

function accessLevelLabel(ctx: BnModuleAccessContext): string {
  if (ctx.isAdmin) return 'Administrator — all Means-Test actions';
  const held = MEANS_MODULE_ACTIONS.filter((a) => ctx.can(a));
  if (held.length === 0) return 'View only';
  return held.map((a) => humaniseMeansCode(a)).join(', ');
}

/**
 * Route helper: an assessment always has one canonical address, and each
 * workflow step of that assessment is its own routed screen.
 */
export const MEANS_DEFAULT_SECTION = 'context';

export function meansAssessmentPath(assessmentId: string, section?: string | null): string {
  const step = section && section.trim() ? section.trim() : MEANS_DEFAULT_SECTION;
  return `${MEANS_MODULE_BASE}/assessments/${assessmentId}/${encodeURIComponent(step)}`;
}

/** Hook used by every queue to open a record without losing its own URL. */
function useOpenAssessment() {
  const navigate = useNavigate();
  return React.useCallback(
    (assessmentId: string, section?: string | null) => {
      navigate(meansAssessmentPath(assessmentId, section));
    },
    [navigate],
  );
}

/** Screen-level "where am I", replacing the module-local tab bar. */
const MEANS_SCREEN_LABELS: Record<string, string> = {
  '': 'Overview',
  assessments: 'Assessments',
  search: 'Search assessments',
  verification: 'Verification',
  decisions: 'Decisions',
  reassessments: 'Reassessments',
  configuration: 'Configuration',
};

const MeansBreadcrumbs: React.FC = () => (
  <BnModuleTrail
    moduleLabel="Means-Test Assessments"
    moduleBase={MEANS_MODULE_BASE}
    screenLabels={MEANS_SCREEN_LABELS}
  />
);

// ---------------------------------------------------------------- module shell

const MeansModuleShell: React.FC<{ ctx: BnModuleAccessContext }> = ({ ctx }) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const openAssessment = useOpenAssessment();
  const [wizardOpen, setWizardOpen] = React.useState(false);

  return (
    <BnModulePage>
      <BnModuleHeader
        icon={ClipboardList}
        title="Means-Test Assessments"
        description="Record and verify a household's income, assets and allowable deductions, calculate assessed means under the policy in force, and publish the approved result to Eligibility."
        badges={[
          {
            label: 'In development — available to authorised development users',
            variant: 'secondary',
            testId: 'means-development-status',
          },
          {
            label: `Your access: ${accessLevelLabel(ctx)}`,
            variant: 'outline',
            testId: 'means-access-level',
          },
        ]}
        actions={
          ctx.can('write') && ctx.actionsEnabled ? (
            <Button onClick={() => setWizardOpen(true)} data-testid="means-start-assessment">
              <Plus className="mr-2 h-4 w-4" /> Start assessment
            </Button>
          ) : undefined
        }
      />

      {ctx.can('write') && ctx.actionsEnabled && (
        <BnMeansInitiationWizard
          open={wizardOpen}
          onOpenConfiguration={
            ctx.can('config') ? () => navigate(`${MEANS_MODULE_BASE}/configuration`) : undefined
          }
          onOpenChange={setWizardOpen}
          prefill={{ originSurface: 'MEANS_LANDING' }}
          onCreated={(assessmentId) => {
            queryClient.invalidateQueries({ queryKey: ['bn-means-queue'] });
            queryClient.invalidateQueries({ queryKey: ['bn-means-operational-queue'] });
            queryClient.invalidateQueries({ queryKey: ['bn-means-operational-counts'] });
            openAssessment(assessmentId, 'household');
          }}
        />
      )}

      {/*
        Module navigation lives in the left sidebar (Benefit Management →
        Means-Test Assessments). The screen states only where it is.
      */}
      <MeansBreadcrumbs />

      <Outlet />

      <MeansTechnicalDetails
        details={{
          'Module code': ctx.moduleCode,
          'Rollout state': ctx.rolloutState,
          'Routes enabled': String(ctx.routesEnabled),
          'Actions enabled': String(ctx.actionsEnabled),
          'Module id': ctx.moduleId,
        }}
      />
    </BnModulePage>
  );
};

// ------------------------------------------------------------------- overview

const MeansOverviewRoute: React.FC<{ ctx: BnModuleAccessContext }> = ({ ctx }) => {
  const navigate = useNavigate();
  const destinationFor = (code: string) => {
    switch (code) {
      case 'APPROVAL_QUEUE':
        return `${MEANS_MODULE_BASE}/decisions`;
      case 'VERIFICATION_QUEUE':
        return `${MEANS_MODULE_BASE}/verification`;
      case 'REASSESSMENT_QUEUE':
        return `${MEANS_MODULE_BASE}/reassessments`;
      case 'CONFIGURATION':
        return `${MEANS_MODULE_BASE}/configuration`;
      default:
        return `${MEANS_MODULE_BASE}/assessments`;
    }
  };

  return (
    <div className="space-y-6">
      <MeansProcessJourney />

      <section className="space-y-3" aria-labelledby="means-work-areas-heading">
        <h2 id="means-work-areas-heading" className="text-lg font-semibold">Work areas</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {MEANS_WORK_AREAS.map((area) => (
            <MeansWorkAreaCard
              key={area.code}
              area={area}
              permitted={area.requiredAction ? ctx.can(area.requiredAction) : true}
              onOpen={() => navigate(destinationFor(area.code))}
            />
          ))}
        </div>
      </section>

      <MeansHowItWorksPanel />
    </div>
  );
};

// ---------------------------------------------------------------- assessments

/**
 * FIND WORK. Operational queues are their own screen; searching every
 * assessment is a separate, directly addressable screen in the left nav.
 */
const MeansAssessmentsRoute: React.FC<{ ctx: BnModuleAccessContext }> = ({ ctx }) => {
  const openAssessment = useOpenAssessment();
  return (
    <BnMeansOperationsWorkspace
      onOpen={(assessmentId, section) => openAssessment(assessmentId, section)}
      canAssign={ctx.can('write')}
      actionsEnabled={ctx.actionsEnabled}
    />
  );
};

const MeansSearchRoute: React.FC = () => {
  const openAssessment = useOpenAssessment();
  return <MeansTeamQueue onOpen={(id) => openAssessment(id)} />;
};

// ------------------------------------------------------------ record workspace

const MeansAssessmentRecordRoute: React.FC = () => {
  const { assessmentId, section } = useParams<{ assessmentId: string; section?: string }>();
  const navigate = useNavigate();

  if (!assessmentId) return <Navigate to={`${MEANS_MODULE_BASE}/assessments`} replace />;
  if (!section) {
    return <Navigate to={meansAssessmentPath(assessmentId, MEANS_DEFAULT_SECTION)} replace />;
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <BnModuleBreadcrumbs
        items={[
          { label: 'Benefit Management' },
          { label: 'Means-Test Assessments', to: MEANS_MODULE_BASE },
          { label: 'Assessments', to: `${MEANS_MODULE_BASE}/assessments` },
          { label: humaniseMeansCode(section) },
        ]}
      />
      <BnMeansAssessmentWorkspace
        assessmentId={assessmentId}
        section={section}
        sectionHref={(next) => meansAssessmentPath(assessmentId, next)}
        onSectionChange={(next) => navigate(meansAssessmentPath(assessmentId, next))}
        onBack={() => navigate(`${MEANS_MODULE_BASE}/assessments`)}
      />
    </div>
  );
};

// ---------------------------------------------------------------- team queue

const MeansTeamQueue: React.FC<{ onOpen: (assessmentId: string) => void }> = ({ onOpen }) => {
  const [filters, setFilters] = React.useState<BnMeansWorkQueueFilters>({});
  const [search, setSearch] = React.useState('');

  const queue = useQuery({
    queryKey: ['bn-means-queue', filters, search],
    queryFn: () => meansQueryService.workQueue({ ...filters, search: search || undefined }),
  });

  const rows = (queue.data?.status === 'OK' ? queue.data.data ?? [] : []) as readonly BnMeansWorkQueueRow[];

  const hasFilters = Boolean(
    search || filters.status || filters.benefit_programme || filters.reassessment_due_before,
  );

  const state = queue.isLoading
    ? 'loading'
    : queue.data?.status === 'DENIED'
      ? 'denied'
      : queue.isError || (queue.data && queue.data.status !== 'OK')
        ? 'error'
        : rows.length === 0
          ? 'empty'
          : 'ready';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Team work queue</CardTitle>
        <CardDescription>
          {queue.data?.status === 'OK'
            ? `${queue.data.totalCount ?? rows.length} assessment(s)`
            : 'Assessment count is unavailable until the queue loads.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <BnFilterBar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search by reference, e.g. MT-2026-…"
          searchLabel="Search Means-Test assessments"
          hasFilters={hasFilters}
          onClear={() => { setSearch(''); setFilters({}); }}
        >
          <div className="space-y-1">
            <Label htmlFor="mt-status" className="sr-only">Status</Label>
            <select
              id="mt-status"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-48"
              value={filters.status ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value || undefined }))}
            >
              <option value="">All statuses</option>
              {STATUS_FILTERS.map((s) => (
                <option key={s} value={s}>{humaniseMeansCode(s)}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="mt-programme" className="sr-only">Benefit programme</Label>
            <Input
              id="mt-programme"
              className="sm:w-48"
              placeholder="Benefit programme"
              value={filters.benefit_programme ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, benefit_programme: e.target.value || undefined }))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mt-reassess" className="text-xs text-muted-foreground">
              Reassessment due before
            </Label>
            <Input
              id="mt-reassess"
              type="date"
              className="sm:w-44"
              value={filters.reassessment_due_before ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, reassessment_due_before: e.target.value || undefined }))}
            />
          </div>
        </BnFilterBar>

        <BnDataState
          state={state}
          testId="means-team-queue"
          deniedMessage="You do not hold read permission for Means-Test assessments."
          errorTitle="The work queue could not be loaded"
          errorDetail={queue.data?.detail ?? queue.data?.code ?? null}
          onRetry={() => void queue.refetch()}
          emptyTitle="No assessments found"
          emptyMessage={
            hasFilters
              ? 'No assessments match the current filters. Clear the filters to see the full queue.'
              : 'No Means-Test assessments have been created yet.'
          }
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Programme</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Effective from</TableHead>
                <TableHead>Missing info</TableHead>
                <TableHead>Evidence</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.assessment_id}>
                  <TableCell className="font-medium">{row.assessment_reference}</TableCell>
                  <TableCell>{humaniseMeansCode(row.benefit_programme)}</TableCell>
                  <TableCell>{humaniseMeansCode(row.assessment_reason)}</TableCell>
                  <TableCell><Badge variant="outline">{humaniseMeansCode(row.status)}</Badge></TableCell>
                  <TableCell>{row.effective_from}</TableCell>
                  <TableCell>{row.open_information_requests > 0 ? `${row.open_information_requests} open` : '—'}</TableCell>
                  <TableCell>{row.evidence_count}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => onOpen(row.assessment_id)}>
                      Open
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </BnDataState>
      </CardContent>
    </Card>
  );
};


/** Permission-scoped destination: the nav hides it, the route refuses it. */
const MeansPermissionBoundary: React.FC<{
  permitted: boolean;
  action: string;
  children: React.ReactNode;
}> = ({ permitted, action, children }) => {
  if (!permitted) {
    return (
      <Alert variant="destructive" data-testid="means-route-permission-denied">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Permission denied</AlertTitle>
        <AlertDescription>
          Your account lacks the &apos;{action}&apos; permission on Means-Test Assessments.
        </AlertDescription>
      </Alert>
    );
  }
  return <>{children}</>;
};

export default function BnMeansTestsPage() {
  return (
    <BnModuleRouteGate moduleCode="bn_means_tests" requiredAction="view">
      {(ctx: BnModuleAccessContext) => (
        <Routes>
          {/* Record workspaces are full-width and outside the module shell. */}
          <Route path="assessments/:assessmentId" element={<MeansAssessmentRecordRoute />} />
          <Route path="assessments/:assessmentId/:section" element={<MeansAssessmentRecordRoute />} />

          <Route element={<MeansModuleShell ctx={ctx} />}>
            <Route index element={<MeansOverviewRoute ctx={ctx} />} />
            <Route path="assessments" element={<MeansAssessmentsRoute ctx={ctx} />} />
            <Route path="search" element={<MeansSearchRoute />} />
            <Route path="verification" element={<MeansVerificationRoute />} />
            <Route path="decisions" element={<MeansDecisionsRoute />} />
            <Route
              path="reassessments"
              element={
                <MeansPermissionBoundary permitted={ctx.can('reassess')} action="reassess">
                  <MeansReassessmentsRoute />
                </MeansPermissionBoundary>
              }
            />
            <Route
              path="configuration"
              element={
                <MeansPermissionBoundary permitted={ctx.can('config')} action="config">
                  <BnMeansPolicyConfiguration
                    actionsEnabled={ctx.actionsEnabled}
                    canConfigure={ctx.can('config')}
                  />
                </MeansPermissionBoundary>
              }
            />
            <Route path="*" element={<Navigate to={MEANS_MODULE_BASE} replace />} />
          </Route>
        </Routes>
      )}
    </BnModuleRouteGate>
  );
}

const MeansVerificationRoute: React.FC = () => {
  const openAssessment = useOpenAssessment();
  return <BnMeansVerificationQueue onOpen={(id) => openAssessment(id, 'verification')} />;
};

const MeansDecisionsRoute: React.FC = () => {
  const openAssessment = useOpenAssessment();
  return <BnMeansDecisionQueue onOpenAssessment={(id) => openAssessment(id, 'decision')} />;
};

const MeansReassessmentsRoute: React.FC = () => {
  const openAssessment = useOpenAssessment();
  return <BnMeansReassessmentQueuePanel onOpen={(id) => openAssessment(id, 'lifecycle')} />;
};
