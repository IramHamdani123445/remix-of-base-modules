/**
 * BN Means-Test Assessments — module experience.
 *
 * Operational UX pattern:
 *   MODULE → FIND WORK → OPEN RECORD → UNDERSTAND STAGE → NEXT ACTION
 *
 * Navigation is URL driven. Every destination and every assessment has a
 * stable, refresh-survivable address:
 *   /bn/means-tests                      module overview
 *   /bn/means-tests/assessments          find work (queues + search)
 *   /bn/means-tests/verification         verification work
 *   /bn/means-tests/decisions            adjustment and approval work
 *   /bn/means-tests/reassessments        reassessment work
 *   /bn/means-tests/configuration        governed policy configuration
 *   /bn/means-tests/assessments/:assessmentId?section=…   record workspace
 *
 * Access is enforced by `BnModuleRouteGate` (fail-closed, database-driven)
 * for every one of those addresses. Menu and nav visibility is convenience,
 * never security — the gate protects direct URL entry.
 */
import React from 'react';
import { Navigate, Outlet, Route, Routes, useNavigate, useParams } from 'react-router-dom';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { BnModuleSectionNav, useBnWorkspaceSection } from '@/components/bn/ux';

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

/** Route helper: an assessment always has one canonical address. */
export function meansAssessmentPath(assessmentId: string, section?: string | null): string {
  const query = section ? `?section=${encodeURIComponent(section)}` : '';
  return `${MEANS_MODULE_BASE}/assessments/${assessmentId}${query}`;
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

// ---------------------------------------------------------------- module shell

const MeansModuleShell: React.FC<{ ctx: BnModuleAccessContext }> = ({ ctx }) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const openAssessment = useOpenAssessment();
  const [wizardOpen, setWizardOpen] = React.useState(false);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <ClipboardList className="mt-1 h-6 w-6 text-primary" aria-hidden="true" />
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">Means-Test Assessments</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Record and verify a household&apos;s income, assets and allowable deductions, calculate
              assessed means under the policy in force, and publish the approved result to Eligibility.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Badge variant="secondary" data-testid="means-development-status">
                In development — available to authorised development users
              </Badge>
              <Badge variant="outline" data-testid="means-access-level">
                Your access: {accessLevelLabel(ctx)}
              </Badge>
            </div>
          </div>
        </div>
        {ctx.can('write') && ctx.actionsEnabled && (
          <>
            <Button onClick={() => setWizardOpen(true)} data-testid="means-start-assessment">
              <Plus className="mr-2 h-4 w-4" /> Start assessment
            </Button>
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
          </>
        )}
      </header>

      <MeansTechnicalDetails
        details={{
          'Module code': ctx.moduleCode,
          'Rollout state': ctx.rolloutState,
          'Routes enabled': String(ctx.routesEnabled),
          'Actions enabled': String(ctx.actionsEnabled),
          'Module id': ctx.moduleId,
        }}
      />

      <BnModuleSectionNav
        ariaLabel="Means-Test destinations"
        items={[
          { to: MEANS_MODULE_BASE, label: 'Overview', end: true },
          { to: `${MEANS_MODULE_BASE}/assessments`, label: 'Assessments' },
          { to: `${MEANS_MODULE_BASE}/verification`, label: 'Verification' },
          { to: `${MEANS_MODULE_BASE}/decisions`, label: 'Decisions' },
          {
            to: `${MEANS_MODULE_BASE}/reassessments`,
            label: 'Reassessments',
            visible: ctx.can('reassess'),
          },
          {
            to: `${MEANS_MODULE_BASE}/configuration`,
            label: 'Configuration',
            visible: ctx.can('config'),
          },
        ]}
      />

      <Outlet />
    </div>
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
 * FIND WORK. Operational queues and the searchable team work queue live on
 * one destination so an officer never hunts across tab bars.
 */
const MeansAssessmentsRoute: React.FC<{ ctx: BnModuleAccessContext }> = ({ ctx }) => {
  const openAssessment = useOpenAssessment();
  const [view, setView] = useBnWorkspaceSection('queues', 'view');

  return (
    <Tabs value={view} onValueChange={(next) => setView(next, { replace: true })}>
      <TabsList>
        <TabsTrigger value="queues">Operational queues</TabsTrigger>
        <TabsTrigger value="search">Search all assessments</TabsTrigger>
      </TabsList>
      <TabsContent value="queues" className="pt-4">
        <BnMeansOperationsWorkspace
          onOpen={(assessmentId, section) => openAssessment(assessmentId, section)}
          canAssign={ctx.can('write')}
          actionsEnabled={ctx.actionsEnabled}
        />
      </TabsContent>
      <TabsContent value="search" className="pt-4">
        <MeansTeamQueue onOpen={(id) => openAssessment(id)} />
      </TabsContent>
    </Tabs>
  );
};

// ------------------------------------------------------------ record workspace

const MeansAssessmentRecordRoute: React.FC = () => {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const navigate = useNavigate();
  const [section, setSection] = useBnWorkspaceSection('context');

  if (!assessmentId) return <Navigate to={`${MEANS_MODULE_BASE}/assessments`} replace />;

  return (
    <div className="p-4 sm:p-6">
      <BnMeansAssessmentWorkspace
        assessmentId={assessmentId}
        section={section}
        onSectionChange={(next) => setSection(next, { replace: true })}
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Narrow the team work queue.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="mt-search">Reference search</Label>
            <Input id="mt-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="MT-2026-…" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mt-status">Status</Label>
            <select
              id="mt-status"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
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
            <Label htmlFor="mt-programme">Benefit programme</Label>
            <Input
              id="mt-programme"
              value={filters.benefit_programme ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, benefit_programme: e.target.value || undefined }))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mt-reassess">Reassessment due before</Label>
            <Input
              id="mt-reassess"
              type="date"
              value={filters.reassessment_due_before ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, reassessment_due_before: e.target.value || undefined }))}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Team work queue</CardTitle>
          <CardDescription>
            {queue.data?.status === 'OK'
              ? `${queue.data.totalCount ?? rows.length} assessment(s)`
              : 'Assessment count is unavailable until the queue loads.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {queue.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : queue.data && queue.data.status === 'DENIED' ? (
            <Alert variant="destructive" data-testid="means-team-queue-denied">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Access denied</AlertTitle>
              <AlertDescription>You do not hold read permission for Means-Test assessments.</AlertDescription>
            </Alert>
          ) : queue.isError || (queue.data && queue.data.status !== 'OK') ? (
            <Alert variant="destructive" data-testid="means-team-queue-failed">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>The work queue could not be loaded</AlertTitle>
              <AlertDescription>{queue.data?.detail ?? queue.data?.code ?? 'Unknown error'}</AlertDescription>
            </Alert>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No assessments match the current filters.</p>
          ) : (
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
          )}
        </CardContent>
      </Card>
    </div>
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

          <Route element={<MeansModuleShell ctx={ctx} />}>
            <Route index element={<MeansOverviewRoute ctx={ctx} />} />
            <Route path="assessments" element={<MeansAssessmentsRoute ctx={ctx} />} />
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
