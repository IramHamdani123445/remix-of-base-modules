/**
 * BN Means-Test Assessments — operational (dark-launched) workspace.
 *
 * Replaces the read-only pilot notice with the MT4 intake surface:
 * work queue + filters + create dialog + assessment workspace. Every
 * mutation goes through `meansCommandService`; every read through
 * `meansQueryService`. While `actions_enabled = false` the canonical
 * available-actions query reports `ACTIONS_DISABLED` and the UI disables
 * controls with that reason shown.
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

const STATUS_FILTERS = [
  'DRAFT', 'INFORMATION_PENDING', 'SUBMITTED', 'VERIFICATION_PENDING', 'CALCULATED',
  'APPROVAL_PENDING', 'APPROVED', 'ACTIVE', 'REASSESSMENT_DUE', 'REJECTED', 'CLOSED',
];

const MeansTestsWorkspace: React.FC<{ ctx: BnModuleAccessContext }> = ({ ctx }) => {
  const queryClient = useQueryClient();
  const [selected, setSelected] = React.useState<string | null>(null);
  const [filters, setFilters] = React.useState<BnMeansWorkQueueFilters>({});
  const [search, setSearch] = React.useState('');

  const queue = useQuery({
    queryKey: ['bn-means-queue', filters, search],
    queryFn: () => meansQueryService.workQueue({ ...filters, search: search || undefined }),
  });

  if (selected) {
    return (
      <div className="p-6">
        <BnMeansAssessmentWorkspace assessmentId={selected} onBack={() => setSelected(null)} />
      </div>
    );
  }

  const rows = (queue.data?.data ?? []) as readonly BnMeansWorkQueueRow[];

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <ClipboardList className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">Means-Tested Benefits</h1>
            <p className="text-sm text-muted-foreground">
              Assessment intake, household and financial facts, evidence, verification and
              deterministic calculation.
            </p>
          </div>
          {!ctx.actionsEnabled && <Badge variant="secondary">Internal pilot — actions disabled</Badge>}
        </div>
        <CreateAssessmentDialog
          disabled={!ctx.actionsEnabled}
          onCreated={(assessmentId) => {
            queryClient.invalidateQueries({ queryKey: ['bn-means-queue'] });
            setSelected(assessmentId);
          }}
        />
      </header>

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
                <option key={s} value={s}>{s}</option>
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
          <CardTitle>Work queue</CardTitle>
          <CardDescription>
            {queue.data?.status === 'OK' ? `${queue.data.totalCount ?? rows.length} assessment(s)` : 'Loading…'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {queue.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : queue.data && queue.data.status === 'DENIED' ? (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Access denied</AlertTitle>
              <AlertDescription>You do not hold read permission for Means-Test assessments.</AlertDescription>
            </Alert>
          ) : queue.data && queue.data.status !== 'OK' ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>The work queue could not be loaded</AlertTitle>
              <AlertDescription>{queue.data.detail ?? queue.data.code ?? 'Unknown error'}</AlertDescription>
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
                    <TableCell>{row.benefit_programme}</TableCell>
                    <TableCell>{row.assessment_reason}</TableCell>
                    <TableCell><Badge variant="outline">{row.status}</Badge></TableCell>
                    <TableCell>{row.effective_from}</TableCell>
                    <TableCell>{row.open_information_requests > 0 ? `${row.open_information_requests} open` : '—'}</TableCell>
                    <TableCell>{row.evidence_count}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setSelected(row.assessment_id)}>
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

const CreateAssessmentDialog: React.FC<{
  disabled: boolean;
  onCreated: (assessmentId: string) => void;
}> = ({ disabled, onCreated }) => {
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
        <Button disabled={disabled}>
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
            <AlertTitle>{error.errorCode}</AlertTitle>
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
      {(ctx: BnModuleAccessContext) => <MeansTestsWorkspace ctx={ctx} />}
    </BnModuleRouteGate>
  );
}
