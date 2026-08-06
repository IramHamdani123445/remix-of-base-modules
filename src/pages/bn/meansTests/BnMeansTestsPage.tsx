/**
 * BN Means-Test Assessments — module landing experience (Epic 0).
 *
 * The entry point for the module: what a Means Test is, where the process
 * stands, which work areas exist and which are still being built. The
 * delivered operational surfaces (team work queue, adjustment/approval
 * queues, assessment workspace) are reachable from here; everything else
 * states plainly that it is not implemented yet.
 *
 * Access is enforced by `BnModuleRouteGate` (fail-closed, database-driven).
 * Menu visibility is not security — the gate protects direct URL entry.
 */
import React from 'react';
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
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, ClipboardList, Plus, ShieldAlert } from 'lucide-react';
import {
  meansQueryService,
  type BnMeansWorkQueueFilters,
  type BnMeansWorkQueueRow,
} from '@/services/bn/meansTests/meansQueryService';
import { meansCommandService, type BnMeansCommandResult } from '@/services/bn/meansTests/meansCommandService';
import { BnMeansAssessmentWorkspace } from '@/components/bn/meansTests/BnMeansAssessmentWorkspace';
import { BN_MEANS_QUEUES, type BnMeansQueueCode } from '@/types/bn/meansTests/meansAdjustments';
import { humaniseMeansCode } from '@/types/bn/meansTests/meansFieldContract';
import {
  MEANS_WORK_AREAS,
  MeansHowItWorksPanel,
  MeansProcessJourney,
  MeansTechnicalDetails,
  MeansWorkAreaCard,
} from '@/components/bn/meansTests/landing/MeansLanding';

const STATUS_FILTERS = [
  'DRAFT', 'INFORMATION_PENDING', 'SUBMITTED', 'VERIFICATION_PENDING', 'CALCULATED',
  'APPROVAL_PENDING', 'APPROVED', 'ACTIVE', 'REASSESSMENT_DUE', 'REJECTED', 'CLOSED',
];

/** Nine authoritative Means-Test module actions. */
export const MEANS_MODULE_ACTIONS = [
  'view', 'write', 'verify', 'decide', 'adjust_request', 'adjust_approve', 'approve', 'reassess', 'config',
] as const;

function accessLevelLabel(ctx: BnModuleAccessContext): string {
  if (ctx.isAdmin) return 'Administrator — all Means-Test actions';
  const held = MEANS_MODULE_ACTIONS.filter((a) => ctx.can(a));
  if (held.length === 0) return 'View only';
  return held.map((a) => humaniseMeansCode(a)).join(', ');
}

const MeansTestsLanding: React.FC<{ ctx: BnModuleAccessContext }> = ({ ctx }) => {
  const queryClient = useQueryClient();
  const [selected, setSelected] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState('overview');

  if (selected) {
    return (
      <div className="p-4 sm:p-6">
        <BnMeansAssessmentWorkspace assessmentId={selected} onBack={() => setSelected(null)} />
      </div>
    );
  }

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
          <CreateAssessmentDialog
            onCreated={(assessmentId) => {
              queryClient.invalidateQueries({ queryKey: ['bn-means-queue'] });
              setSelected(assessmentId);
            }}
          />
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

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="team">Team work queue</TabsTrigger>
          <TabsTrigger value="approval">Approval queue</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 pt-4">
          <MeansProcessJourney />

          <section className="space-y-3" aria-labelledby="means-work-areas-heading">
            <h2 id="means-work-areas-heading" className="text-lg font-semibold">Work areas</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {MEANS_WORK_AREAS.map((area) => (
                <MeansWorkAreaCard
                  key={area.code}
                  area={area}
                  permitted={area.requiredAction ? ctx.can(area.requiredAction) : true}
                  onOpen={() => setTab(area.code === 'APPROVAL_QUEUE' ? 'approval' : 'team')}
                />
              ))}
            </div>
          </section>

          <MeansHowItWorksPanel />
        </TabsContent>

        <TabsContent value="team" className="pt-4">
          <MeansTeamQueue onOpen={setSelected} />
        </TabsContent>

        <TabsContent value="approval" className="pt-4">
          <BnMeansQueuesSection onOpen={setSelected} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

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

/**
 * MT7 work queues. Every queue is served by the secured
 * `bn_means_queues_v1` query — no direct table read, no client-side
 * derivation of who should act next.
 */
const BnMeansQueuesSection: React.FC<{ onOpen: (assessmentId: string) => void }> = ({ onOpen }) => {
  const [active, setActive] = React.useState<BnMeansQueueCode>('ASSESSMENTS_AWAITING_APPROVAL');
  const q = useQuery({
    queryKey: ['bn-means-queue', 'mt7', active],
    queryFn: () => meansQueryService.queue(active),
  });
  const rows = (q.data?.status === 'OK' ? q.data.data ?? [] : []) as readonly Record<string, unknown>[];
  const definition = BN_MEANS_QUEUES.find((x) => x.code === active)!;

  return (
    <Card data-testid="means-mt7-queues">
      <CardHeader>
        <CardTitle>Adjustment and approval queues</CardTitle>
        <CardDescription>{definition.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {BN_MEANS_QUEUES.map((qd) => (
            <Button
              key={qd.code}
              size="sm"
              variant={qd.code === active ? 'default' : 'outline'}
              onClick={() => setActive(qd.code)}
              data-testid={`means-queue-tab-${qd.code}`}
            >
              {qd.label}
            </Button>
          ))}
        </div>

        {q.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : q.isError || (q.data && q.data.status !== 'OK') ? (
          <Alert variant="destructive" data-testid="means-queue-unavailable">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>This queue could not be loaded</AlertTitle>
            <AlertDescription>
              {q.data && q.data.status === 'DENIED'
                ? 'You do not hold permission for this queue.'
                : (q.data?.detail ?? q.data?.code ?? 'Unknown error')}
            </AlertDescription>
          </Alert>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing is waiting in this queue.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Waiting on</TableHead>
                <TableHead>Since</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={String(row.queue_item_id ?? row.assessment_id)}>
                  <TableCell className="font-medium">{String(row.assessment_reference ?? '—')}</TableCell>
                  <TableCell><Badge variant="outline">{humaniseMeansCode(String(row.status ?? ''))}</Badge></TableCell>
                  <TableCell className="text-xs">{humaniseMeansCode(String(row.waiting_on ?? definition.label))}</TableCell>
                  <TableCell className="text-xs">{String(row.waiting_since ?? row.updated_at ?? '—')}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => onOpen(String(row.assessment_id))}>
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
  );
};

const CreateAssessmentDialog: React.FC<{
  onCreated: (assessmentId: string) => void;
}> = ({ onCreated }) => {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<BnMeansCommandResult | null>(null);
  const [form, setForm] = React.useState({
    person_id: '',
    claim_id: '',
    benefit_programme: '',
    assessment_reason: '',
    effective_from: '',
    currency_code: 'XCD',
    policy_version_id: '',
  });

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  async function submit() {
    setPending(true);
    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(form)) {
      if (value.trim()) payload[key] = value.trim();
    }
    const result = await meansCommandService.execute({
      command: 'BN_MEANS_CREATE_ASSESSMENT',
      payload,
    });
    setPending(false);
    if (result.status === 'FAILED') {
      setError(result);
      return;
    }
    setError(null);
    setOpen(false);
    if (result.assessmentId) onCreated(result.assessmentId);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" /> New assessment
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create means-test assessment</DialogTitle>
          <DialogDescription>
            A person or claim, programme, reason, effective date and currency are required.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{humaniseMeansCode(error.errorCode)}</AlertTitle>
            <AlertDescription>{error.errorDetail}</AlertDescription>
          </Alert>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="person_id" label="Person ID" value={form.person_id} onChange={set('person_id')} />
          <Field id="claim_id" label="Claim ID" value={form.claim_id} onChange={set('claim_id')} />
          <Field id="benefit_programme" label="Benefit programme" value={form.benefit_programme} onChange={set('benefit_programme')} />
          <Field id="assessment_reason" label="Assessment reason" value={form.assessment_reason} onChange={set('assessment_reason')} />
          <Field id="effective_from" label="Effective from" type="date" value={form.effective_from} onChange={set('effective_from')} />
          <Field id="currency_code" label="Currency" value={form.currency_code} onChange={set('currency_code')} />
          <Field id="policy_version_id" label="Policy version" value={form.policy_version_id} onChange={set('policy_version_id')} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={pending}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const Field: React.FC<{
  id: string; label: string; value: string; type?: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}> = ({ id, label, value, type = 'text', onChange }) => (
  <div className="space-y-1">
    <Label htmlFor={id}>{label}</Label>
    <Input id={id} type={type} value={value} onChange={onChange} />
  </div>
);

export default function BnMeansTestsPage() {
  return (
    <BnModuleRouteGate moduleCode="bn_means_tests" requiredAction="view">
      {(ctx: BnModuleAccessContext) => <MeansTestsLanding ctx={ctx} />}
    </BnModuleRouteGate>
  );
}
