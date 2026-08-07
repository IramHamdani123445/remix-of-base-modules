/**
 * MEANS-TEST — Policy Configuration workspace.
 *
 * The governed administrative surface for Means-Test policy: which
 * programme is configured, which version is in force, what still blocks a
 * version from being activated, and the controlled lifecycle
 * (draft → validate → activate → supersede/retire).
 *
 * Every decision belongs to the backend. This screen renders the backend's
 * validation report; it never decides activation itself.
 */
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, Plus, ShieldAlert, Sliders } from 'lucide-react';
import { meansPolicyAdminService } from '@/services/bn/meansTests/meansPolicyAdminService';
import {
  BN_MEANS_POLICY_ERROR_TEXT,
  BN_MEANS_POLICY_FINDING_TEXT,
  type BnMeansPolicyCommand,
  type BnMeansPolicyFinding,
  type BnMeansPolicyVersionDetail,
} from '@/types/bn/meansTests/meansPolicyAdmin';
import { BnMeansPolicyVersionDialog } from '@/components/bn/meansTests/configuration/BnMeansPolicyVersionDialog';
import { humaniseMeansCode } from '@/types/bn/meansTests/meansFieldContract';

function findingText(f: BnMeansPolicyFinding): string {
  return BN_MEANS_POLICY_FINDING_TEXT[f.code] ?? f.message ?? humaniseMeansCode(f.code);
}

const StatusBadge: React.FC<{ status: string | null; inForce?: boolean }> = ({ status, inForce }) => {
  if (inForce) return <Badge variant="default">In force</Badge>;
  if (!status) return <Badge variant="secondary">No version</Badge>;
  return (
    <Badge variant={status === 'ACTIVE' ? 'default' : status === 'DRAFT' ? 'outline' : 'secondary'}>
      {humaniseMeansCode(status)}
    </Badge>
  );
};

export interface BnMeansPolicyConfigurationProps {
  /** Whether the module is in a mutation-enabled state (dark-launch gate). */
  actionsEnabled: boolean;
  /** Whether the actor holds the Means-Test configuration permission. */
  canConfigure: boolean;
}

export const BnMeansPolicyConfiguration: React.FC<BnMeansPolicyConfigurationProps> = ({
  actionsEnabled, canConfigure,
}) => {
  const [selected, setSelected] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');
  const [programme, setProgramme] = React.useState('');

  const list = useQuery({
    queryKey: ['bn-means-policy-list', search, programme],
    queryFn: () => meansPolicyAdminService.list({
      search: search || undefined,
      benefit_programme: programme || undefined,
    }),
  });

  if (selected) {
    return <PolicyDetail policyId={selected} onBack={() => setSelected(null)}
      actionsEnabled={actionsEnabled} canConfigure={canConfigure} />;
  }

  if (list.isLoading) return <Skeleton className="h-64" data-testid="means-policy-loading" />;

  if (list.data?.status === 'DENIED') {
    return (
      <Alert variant="destructive" data-testid="means-policy-denied">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Access denied</AlertTitle>
        <AlertDescription>You do not hold permission to view Means-Test configuration.</AlertDescription>
      </Alert>
    );
  }
  if (list.data?.status !== 'OK' || !list.data.data) {
    return (
      <Alert variant="destructive" data-testid="means-policy-unavailable">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Configuration unavailable</AlertTitle>
        <AlertDescription>{list.data?.message ?? 'The configuration register could not be read.'}</AlertDescription>
      </Alert>
    );
  }

  const data = list.data.data;
  const mayEdit = canConfigure && data.can_configure && actionsEnabled;

  return (
    <div className="space-y-6" data-testid="means-policy-configuration">
      {!actionsEnabled && (
        <Alert data-testid="means-policy-readonly">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Read-only</AlertTitle>
          <AlertDescription>
            Means-Test actions are disabled in this environment, so configuration can be reviewed but not changed.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        <SummaryCard label="Programmes configured" value={data.summary.programmes} />
        <SummaryCard label="Policies" value={data.summary.policies} />
        <SummaryCard label="In force today" value={data.summary.in_force} />
        <SummaryCard label="Awaiting an active version" value={data.summary.requires_configuration} />
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sliders className="h-4 w-4" aria-hidden="true" /> Means-Test policies
            </CardTitle>
            <CardDescription>
              The thresholds, rules and evidence requirements applied when means are calculated.
            </CardDescription>
          </div>
          {mayEdit && <NewPolicyButton programmes={data.programme_catalogue} onCreated={setSelected} />}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="mp-search">Search</Label>
              <Input id="mp-search" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Policy name, code or programme" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mp-programme">Benefit programme</Label>
              <select id="mp-programme" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={programme} onChange={(e) => setProgramme(e.target.value)}>
                <option value="">All programmes</option>
                {data.programme_catalogue.map((p) => (
                  <option key={p.code} value={p.code}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>

          {data.rows.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
              data-testid="means-policy-empty">
              No Means-Test policy is configured. Assessments cannot be started until a policy version is
              active for the benefit programme.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Programme</TableHead>
                  <TableHead>Policy</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>In force</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Assessments</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((row) => (
                  <TableRow key={`${row.policy_id}-${row.policy_version_id ?? 'none'}`}
                    data-testid={`means-policy-row-${row.policy_code}`}>
                    <TableCell>{row.programme_label}</TableCell>
                    <TableCell>
                      <div className="font-medium">{row.policy_name}</div>
                      <div className="text-xs text-muted-foreground">{row.policy_code}</div>
                    </TableCell>
                    <TableCell>{row.version_label ?? '—'}</TableCell>
                    <TableCell className="text-sm">
                      {row.effective_from ?? '—'} → {row.effective_to ?? 'open'}
                    </TableCell>
                    <TableCell><StatusBadge status={row.version_status} inForce={row.is_in_force} /></TableCell>
                    <TableCell className="text-right">{row.assessment_count}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setSelected(row.policy_id)}>Open</Button>
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

const SummaryCard: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <Card>
    <CardContent className="p-4">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </CardContent>
  </Card>
);

const NewPolicyButton: React.FC<{
  programmes: readonly { code: string; label: string }[];
  onCreated: (policyId: string) => void;
}> = ({ programmes, onCreated }) => {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [code, setCode] = React.useState('');
  const [name, setName] = React.useState('');
  const [prog, setProg] = React.useState('');
  const [authority, setAuthority] = React.useState('');
  const [error, setError] = React.useState<{ code: string; detail: string } | null>(null);

  const create = useMutation({
    mutationFn: () => meansPolicyAdminService.execute({
      command: 'CREATE_POLICY',
      payload: {
        policy_code: code, policy_name: name,
        benefit_programme: prog, authority_reference: authority,
      },
    }),
    onSuccess: (result) => {
      if (result.status === 'FAILED') {
        setError({ code: result.errorCode ?? 'UNKNOWN', detail: result.errorDetail ?? '' });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['bn-means-policy-list'] });
      setOpen(false);
      const id = result.data?.policy_id as string | undefined;
      if (id) onCreated(id);
    },
  });

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} data-testid="means-policy-new">
        <Plus className="mr-2 h-4 w-4" /> New policy
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="means-policy-new-dialog">
          <DialogHeader>
            <DialogTitle>New Means-Test policy</DialogTitle>
            <DialogDescription>
              A policy holds the versions that apply to one benefit programme over time.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{BN_MEANS_POLICY_ERROR_TEXT[error.code] ?? BN_MEANS_POLICY_ERROR_TEXT.UNKNOWN}</AlertTitle>
              <AlertDescription>{error.detail}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="mpn-programme">Benefit programme</Label>
              <select id="mpn-programme" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={prog} onChange={(e) => setProg(e.target.value)}>
                <option value="">Select a programme</option>
                {programmes.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="mpn-code">Policy code</Label>
              <Input id="mpn-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="MT-SKN-NCP" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mpn-name">Policy name</Label>
              <Input id="mpn-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mpn-authority">Authority reference</Label>
              <Input id="mpn-authority" value={authority} onChange={(e) => setAuthority(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending || !code || !name || !prog}>
              {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create policy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

const PolicyDetail: React.FC<{
  policyId: string;
  onBack: () => void;
  actionsEnabled: boolean;
  canConfigure: boolean;
}> = ({ policyId, onBack, actionsEnabled, canConfigure }) => {
  const queryClient = useQueryClient();
  const [editVersion, setEditVersion] = React.useState<BnMeansPolicyVersionDetail | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [copyFrom, setCopyFrom] = React.useState<string | null>(null);
  const [commandError, setCommandError] = React.useState<{ code: string; detail: string } | null>(null);

  const detail = useQuery({
    queryKey: ['bn-means-policy-detail', policyId],
    queryFn: () => meansPolicyAdminService.detail(policyId),
  });

  const run = useMutation({
    mutationFn: (input: { command: BnMeansPolicyCommand; version?: BnMeansPolicyVersionDetail; payload?: Record<string, unknown> }) =>
      meansPolicyAdminService.execute({
        command: input.command,
        policyId,
        policyVersionId: input.version?.policy_version_id ?? null,
        expectedRowVersion: input.version?.row_version ?? null,
        payload: input.payload ?? {},
      }),
    onSuccess: (result) => {
      if (result.status === 'FAILED') {
        setCommandError({ code: result.errorCode ?? 'UNKNOWN', detail: result.errorDetail ?? '' });
        return;
      }
      setCommandError(null);
      queryClient.invalidateQueries({ queryKey: ['bn-means-policy-detail', policyId] });
      queryClient.invalidateQueries({ queryKey: ['bn-means-policy-list'] });
    },
  });

  if (detail.isLoading) return <Skeleton className="h-64" />;
  if (detail.data?.status !== 'OK' || !detail.data.data) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Policy unavailable</AlertTitle>
          <AlertDescription>{detail.data?.message ?? 'This policy could not be read.'}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const { policy, versions, can_configure } = detail.data.data;
  const mayEdit = canConfigure && can_configure && actionsEnabled;

  return (
    <div className="space-y-5" data-testid="means-policy-detail">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-1">
            <ArrowLeft className="mr-2 h-4 w-4" /> All policies
          </Button>
          <h3 className="text-lg font-semibold">{policy.policy_name}</h3>
          <p className="text-sm text-muted-foreground">
            {policy.programme_label} · {policy.policy_code} · {humaniseMeansCode(policy.status)}
          </p>
          {policy.authority_reference && (
            <p className="text-xs text-muted-foreground">Authority: {policy.authority_reference}</p>
          )}
        </div>
        {mayEdit && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => { setEditVersion(null); setCopyFrom(versions[0]?.policy_version_id ?? null); setDialogOpen(true); }}
              data-testid="means-policy-new-version">
              <Plus className="mr-2 h-4 w-4" /> New version
            </Button>
            {policy.status !== 'RETIRED' && (
              <Button size="sm" variant="outline"
                onClick={() => run.mutate({ command: 'RETIRE_POLICY' })}>Retire policy</Button>
            )}
          </div>
        )}
      </div>

      {commandError && (
        <Alert variant="destructive" data-testid="means-policy-command-error">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{BN_MEANS_POLICY_ERROR_TEXT[commandError.code] ?? BN_MEANS_POLICY_ERROR_TEXT.UNKNOWN}</AlertTitle>
          <AlertDescription>{commandError.detail}</AlertDescription>
        </Alert>
      )}

      {versions.length === 0 && (
        <Alert data-testid="means-policy-no-versions">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>No versions yet</AlertTitle>
          <AlertDescription>
            Create a version and activate it before officers can start assessments for this programme.
          </AlertDescription>
        </Alert>
      )}

      {versions.map((version) => (
        <VersionCard
          key={version.policy_version_id}
          version={version}
          mayEdit={mayEdit}
          onEdit={() => { setEditVersion(version); setCopyFrom(null); setDialogOpen(true); }}
          onCommand={(command, payload) => run.mutate({ command, version, payload })}
          pending={run.isPending}
        />
      ))}

      <BnMeansPolicyVersionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        policyId={policyId}
        version={editVersion}
        copyFromVersionId={copyFrom}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['bn-means-policy-detail', policyId] });
          queryClient.invalidateQueries({ queryKey: ['bn-means-policy-list'] });
        }}
      />
    </div>
  );
};

const VersionCard: React.FC<{
  version: BnMeansPolicyVersionDetail;
  mayEdit: boolean;
  pending: boolean;
  onEdit: () => void;
  onCommand: (command: BnMeansPolicyCommand, payload?: Record<string, unknown>) => void;
}> = ({ version, mayEdit, pending, onEdit, onCommand }) => {
  const report = version.validation_report as { blockers?: BnMeansPolicyFinding[]; warnings?: BnMeansPolicyFinding[] };
  const blockers = report?.blockers ?? [];
  const warnings = report?.warnings ?? [];
  const t = version.threshold_parameters as Record<string, unknown>;

  return (
    <Card data-testid={`means-policy-version-${version.version_label}`}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            Version {version.version_label}
            <StatusBadge status={version.status} />
            {version.validation_state === 'READY' && (
              <Badge variant="outline" className="gap-1">
                <CheckCircle2 className="h-3 w-3" /> Validated
              </Badge>
            )}
            {version.validation_state === 'BLOCKED' && <Badge variant="destructive">Blocked</Badge>}
          </CardTitle>
          <CardDescription>
            In force {version.effective_from ?? '—'} → {version.effective_to ?? 'open'} ·{' '}
            {version.assessment_count} assessment(s) use this version
          </CardDescription>
        </div>
        {mayEdit && (
          <div className="flex flex-wrap gap-2">
            {version.status === 'DRAFT' && (
              <>
                <Button size="sm" variant="outline" onClick={onEdit}>Edit draft</Button>
                <Button size="sm" variant="outline" disabled={pending}
                  onClick={() => onCommand('VALIDATE_VERSION')}
                  data-testid="means-policy-validate">Validate</Button>
                <Button size="sm" disabled={pending}
                  onClick={() => onCommand('ACTIVATE_VERSION')}
                  data-testid="means-policy-activate">Activate</Button>
              </>
            )}
            {version.status === 'ACTIVE' && (
              <Button size="sm" variant="outline" disabled={pending}
                onClick={() => onCommand('RETIRE_VERSION')}>Retire version</Button>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid gap-2 rounded-md border p-3 text-sm sm:grid-cols-3">
          <Detail label="Currency" value={version.currency_code} />
          <Detail label="Rounding" value={`${humaniseMeansCode(version.rounding_method)} · ${version.rounding_scale} dp`} />
          <Detail label="Threshold basis" value={humaniseMeansCode(String(t.threshold_basis ?? 'ANNUAL'))} />
          <Detail label="Income threshold" value={String(t.income_threshold ?? t.base_threshold_annual ?? '—')} />
          <Detail label="Per additional member" value={String(t.per_member_increment ?? t.per_additional_member_annual ?? '—')} />
          <Detail label="Income disregard" value={String(t.disregard ?? t.income_disregard_annual ?? '—')} />
          <Detail label="Asset threshold" value={String(t.asset_threshold ?? t.asset_threshold_amount ?? '—')} />
          <Detail label="Validity" value={version.validity_months ? `${version.validity_months} months` : '—'} />
          <Detail label="Reassessment" value={version.reassessment_months ? `${version.reassessment_months} months` : '—'} />
        </dl>

        <div>
          <p className="text-xs font-medium text-muted-foreground">Required evidence</p>
          {version.required_evidence.length === 0 ? (
            <p className="text-sm text-muted-foreground">None configured.</p>
          ) : (
            <ul className="list-disc pl-5 text-sm">
              {version.required_evidence.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
        </div>

        {version.categories.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground">Categories</p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {version.categories.map((c) => (
                <Badge key={c.category_id} variant="secondary">
                  {humaniseMeansCode(c.category_kind)}: {c.category_name}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {blockers.length > 0 && (
          <Alert variant="destructive" data-testid="means-policy-blockers">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>This version cannot be activated yet</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-5">{blockers.map((b, i) => <li key={`${b.code}-${i}`}>{findingText(b)}</li>)}</ul>
            </AlertDescription>
          </Alert>
        )}
        {warnings.length > 0 && (
          <Alert data-testid="means-policy-warnings">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Please note</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-5">{warnings.map((w, i) => <li key={`${w.code}-${i}`}>{findingText(w)}</li>)}</ul>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
};

const Detail: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="font-medium">{value}</dd>
  </div>
);

export default BnMeansPolicyConfiguration;
