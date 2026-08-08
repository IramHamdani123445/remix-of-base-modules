/**
 * BN Uprating — Policy catalogue workspace (Epic 0).
 *
 * Register, version governance and approval queue for uprating policies.
 * Every action shown here comes from `bn_uprating_policy_actions_v1`; the
 * screen never decides the lifecycle locally and never mutates data directly.
 */
import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { ArrowLeft, CheckCircle2, Loader2, Plus, ShieldAlert } from 'lucide-react';
import type { BnModuleAccessContext } from '@/components/bn/access/BnModuleRouteGate';
import { BnUpratingVersionEditorDialog } from './BnUpratingVersionEditorDialog';
import {
  executeUpratingPolicyCommand,
  fetchUpratingApprovalQueue,
  fetchUpratingPolicyDetail,
  fetchUpratingPolicyList,
  fetchUpratingReferenceData,
  fetchUpratingVersionActions,
  newUpratingUuid,
} from '@/services/bn/uprating/upratingPolicyService';
import type {
  BnUpratingPolicyAction,
  BnUpratingPolicyVersion,
} from '@/types/bn/uprating/upratingPolicy';
import { BN_UPRATING_POLICY_TYPES } from '@/types/bn/uprating/upratingPolicyTypes';

const statusVariant = (status: string): 'default' | 'secondary' | 'outline' | 'destructive' => {
  if (status === 'ACTIVE') return 'default';
  if (status === 'REVIEW' || status === 'APPROVED') return 'secondary';
  if (status === 'RETIRED') return 'destructive';
  return 'outline';
};

interface DecisionState {
  open: boolean;
  version: BnUpratingPolicyVersion | null;
  mode: 'APPROVE' | 'RETURN_TO_DRAFT' | 'REJECT' | 'RETIRE';
}

export const BnUpratingPolicyWorkspace: React.FC<{ ctx: BnModuleAccessContext }> = ({ ctx }) => {
  const qc = useQueryClient();
  const [selectedPolicyId, setSelectedPolicyId] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editor, setEditor] = React.useState<{ open: boolean; version: BnUpratingPolicyVersion | null }>({
    open: false,
    version: null,
  });
  const [decision, setDecision] = React.useState<DecisionState>({ open: false, version: null, mode: 'APPROVE' });

  const referenceQuery = useQuery({
    queryKey: ['bn-uprating-reference'],
    queryFn: fetchUpratingReferenceData,
  });
  const reference = referenceQuery.data?.data ?? null;

  const listQuery = useQuery({
    queryKey: ['bn-uprating-policies', search],
    queryFn: () => fetchUpratingPolicyList(search ? { search } : {}),
  });

  const detailQuery = useQuery({
    queryKey: ['bn-uprating-policy', selectedPolicyId],
    queryFn: () => fetchUpratingPolicyDetail(selectedPolicyId as string),
    enabled: !!selectedPolicyId,
  });

  const queueQuery = useQuery({
    queryKey: ['bn-uprating-approval-queue'],
    queryFn: () => fetchUpratingApprovalQueue(),
  });

  const detail = detailQuery.data?.data ?? null;
  const latestVersion = detail?.versions?.[0] ?? null;

  const actionsQuery = useQuery({
    queryKey: ['bn-uprating-actions', latestVersion?.policy_version_id, latestVersion?.row_version],
    queryFn: () => fetchUpratingVersionActions(latestVersion?.policy_version_id as string),
    enabled: !!latestVersion?.policy_version_id,
  });
  const actions: readonly BnUpratingPolicyAction[] = actionsQuery.data?.data?.actions ?? [];
  const can = (a: BnUpratingPolicyAction) => actions.includes(a);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['bn-uprating-policies'] });
    qc.invalidateQueries({ queryKey: ['bn-uprating-policy'] });
    qc.invalidateQueries({ queryKey: ['bn-uprating-actions'] });
    qc.invalidateQueries({ queryKey: ['bn-uprating-approval-queue'] });
  };

  const command = useMutation({
    mutationFn: executeUpratingPolicyCommand,
    onSuccess: (result) => {
      if (result.status === 'ERROR') {
        toast.error(result.message ?? 'The action could not be completed.');
        return;
      }
      toast.success(result.message ?? 'Action completed.');
      invalidate();
    },
    onError: () => toast.error('The action could not be completed.'),
  });

  // ---------- create policy ----------
  const [policyForm, setPolicyForm] = React.useState({
    policy_code: '',
    policy_name: '',
    description: '',
    policy_type: 'PERCENTAGE',
    country_code: 'KN',
  });

  const submitPolicy = async () => {
    const result = await command.mutateAsync({
      command: 'BN_UPRATING_CREATE_POLICY',
      payload: { ...policyForm },
      idempotencyKey: newUpratingUuid(),
    });
    if (result.status !== 'ERROR') {
      setCreateOpen(false);
      setSelectedPolicyId((result.data?.policy_id as string) ?? null);
      setPolicyForm({ policy_code: '', policy_name: '', description: '', policy_type: 'PERCENTAGE', country_code: 'KN' });
    }
  };

  // ---------- decision ----------
  const [decisionForm, setDecisionForm] = React.useState({ reason_code: '', justification: '' });
  React.useEffect(() => {
    if (decision.open) setDecisionForm({ reason_code: '', justification: '' });
  }, [decision.open]);

  const decisionReasons =
    decision.mode === 'APPROVE'
      ? reference?.reference?.APPROVAL_REASON ?? []
      : decision.mode === 'RETIRE'
        ? reference?.reference?.RETIREMENT_REASON ?? []
        : reference?.reference?.RETURN_REASON ?? [];

  const submitDecision = async () => {
    if (!decision.version) return;
    const isRetire = decision.mode === 'RETIRE';
    const result = await command.mutateAsync({
      command: isRetire ? 'BN_UPRATING_RETIRE_POLICY_VERSION' : 'BN_UPRATING_APPROVE_POLICY',
      policyVersionId: decision.version.policy_version_id,
      expectedRowVersion: decision.version.row_version,
      payload: isRetire
        ? { reason_code: decisionForm.reason_code, justification: decisionForm.justification }
        : {
            decision: decision.mode,
            reason_code: decisionForm.reason_code,
            justification: decisionForm.justification,
          },
      idempotencyKey: newUpratingUuid(),
    });
    if (result.status !== 'ERROR') setDecision({ open: false, version: null, mode: 'APPROVE' });
  };

  const openDecision = (version: BnUpratingPolicyVersion, mode: DecisionState['mode']) =>
    setDecision({ open: true, version, mode });

  // ---------- render ----------
  if (selectedPolicyId && detail) {
    const policy = detail.policy;
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => setSelectedPolicyId(null)}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to policy register
        </Button>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-3">
              <CardTitle>{policy.policy_name}</CardTitle>
              <Badge variant="outline">{policy.policy_code}</Badge>
              <Badge variant="secondary">{policy.policy_type.replace(/_/g, ' ')}</Badge>
            </div>
            <CardDescription>{policy.description ?? 'No description recorded.'}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {can('create_version') && (
              <Button size="sm" onClick={() => setEditor({ open: true, version: null })}>
                <Plus className="mr-1 h-4 w-4" /> New version
              </Button>
            )}
            {latestVersion && can('edit_draft') && (
              <Button size="sm" variant="outline" onClick={() => setEditor({ open: true, version: latestVersion })}>
                Edit draft
              </Button>
            )}
            {latestVersion && can('validate') && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  command.mutate({
                    command: 'BN_UPRATING_VALIDATE_POLICY',
                    policyVersionId: latestVersion.policy_version_id,
                    expectedRowVersion: latestVersion.row_version,
                    idempotencyKey: newUpratingUuid(),
                  })
                }
              >
                Validate
              </Button>
            )}
            {latestVersion && can('submit_for_approval') && (
              <Button
                size="sm"
                onClick={() =>
                  command.mutate({
                    command: 'BN_UPRATING_SUBMIT_POLICY_FOR_APPROVAL',
                    policyVersionId: latestVersion.policy_version_id,
                    expectedRowVersion: latestVersion.row_version,
                    idempotencyKey: newUpratingUuid(),
                  })
                }
              >
                Submit for approval
              </Button>
            )}
            {latestVersion && can('approve') && (
              <>
                <Button size="sm" onClick={() => openDecision(latestVersion, 'APPROVE')}>Approve</Button>
                <Button size="sm" variant="outline" onClick={() => openDecision(latestVersion, 'RETURN_TO_DRAFT')}>
                  Return to draft
                </Button>
                <Button size="sm" variant="destructive" onClick={() => openDecision(latestVersion, 'REJECT')}>
                  Reject
                </Button>
              </>
            )}
            {latestVersion && can('activate') && (
              <Button
                size="sm"
                onClick={() =>
                  command.mutate({
                    command: 'BN_UPRATING_ACTIVATE_POLICY_VERSION',
                    policyVersionId: latestVersion.policy_version_id,
                    expectedRowVersion: latestVersion.row_version,
                    idempotencyKey: newUpratingUuid(),
                  })
                }
              >
                Activate
              </Button>
            )}
            {latestVersion && can('retire') && (
              <Button size="sm" variant="outline" onClick={() => openDecision(latestVersion, 'RETIRE')}>
                Retire version
              </Button>
            )}
            {actions.length === 0 && (
              <p className="text-sm text-muted-foreground">No actions are available to you at this stage.</p>
            )}
          </CardContent>
        </Card>

        {latestVersion && latestVersion.validation_status !== 'NOT_VALIDATED' && (
          <Alert variant={latestVersion.validation_status === 'VALID' ? 'default' : 'destructive'}>
            {latestVersion.validation_status === 'VALID' ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <ShieldAlert className="h-4 w-4" />
            )}
            <AlertTitle>
              {latestVersion.validation_status === 'VALID' ? 'Validation passed' : 'Validation issues'}
            </AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-5">
                {(latestVersion.validation_errors ?? []).map((e, i) => (
                  <li key={`e-${i}`}>{e.message}</li>
                ))}
                {(latestVersion.validation_warnings ?? []).map((w, i) => (
                  <li key={`w-${i}`}>{w.message}</li>
                ))}
                {latestVersion.validation_status === 'VALID' &&
                  (latestVersion.validation_warnings ?? []).length === 0 && <li>No issues found.</li>}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader><CardTitle>Version history</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Effective</TableHead>
                  <TableHead>Validation</TableHead>
                  <TableHead>Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.versions.map((v) => (
                  <TableRow key={v.policy_version_id}>
                    <TableCell>{v.version_reference} (v{v.version_no})</TableCell>
                    <TableCell><Badge variant={statusVariant(v.status)}>{v.status}</Badge></TableCell>
                    <TableCell>{v.effective_from ?? '—'} → {v.effective_to ?? 'open'}</TableCell>
                    <TableCell>{v.validation_status}</TableCell>
                    <TableCell>
                      {v.approval_decision
                        ? `${v.approval_decision} by ${v.approved_by_name ?? 'reviewer'}`
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))}
                {detail.versions.length === 0 && (
                  <TableRow><TableCell colSpan={5}>No versions yet.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Governance timeline</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {detail.events.map((e) => (
              <div key={e.event_id} className="text-sm">
                <span className="font-medium">{e.event_label}</span>
                <span className="text-muted-foreground">
                  {' '}— {e.actor_name ?? 'System'} · {new Date(e.occurred_at).toLocaleString()}
                </span>
                {e.detail && <p className="text-muted-foreground">{e.detail}</p>}
              </div>
            ))}
            {detail.events.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}
          </CardContent>
        </Card>

        <BnUpratingVersionEditorDialog
          open={editor.open}
          onOpenChange={(o) => setEditor((s) => ({ ...s, open: o }))}
          policyType={policy.policy_type}
          reference={reference}
          version={editor.version}
          submitting={command.isPending}
          onSubmit={async (payload) => {
            const result = await command.mutateAsync(
              editor.version
                ? {
                    command: 'BN_UPRATING_UPDATE_POLICY_VERSION',
                    policyVersionId: editor.version.policy_version_id,
                    expectedRowVersion: editor.version.row_version,
                    payload,
                    idempotencyKey: newUpratingUuid(),
                  }
                : {
                    command: 'BN_UPRATING_CREATE_POLICY_VERSION',
                    policyId: policy.policy_id,
                    payload,
                    idempotencyKey: newUpratingUuid(),
                  },
            );
            if (result.status !== 'ERROR') setEditor({ open: false, version: null });
          }}
        />

        <Dialog open={decision.open} onOpenChange={(o) => setDecision((s) => ({ ...s, open: o }))}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {decision.mode === 'APPROVE'
                  ? 'Approve policy version'
                  : decision.mode === 'RETURN_TO_DRAFT'
                    ? 'Return version to draft'
                    : decision.mode === 'REJECT'
                      ? 'Reject policy version'
                      : 'Retire policy version'}
              </DialogTitle>
              <DialogDescription>
                A reason and justification are recorded permanently against this decision.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Reason</Label>
                <Select
                  value={decisionForm.reason_code}
                  onValueChange={(v) => setDecisionForm((f) => ({ ...f, reason_code: v }))}
                >
                  <SelectTrigger><SelectValue placeholder="Select a reason" /></SelectTrigger>
                  <SelectContent>
                    {decisionReasons.map((r) => (
                      <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="justification">Justification</Label>
                <Textarea
                  id="justification"
                  value={decisionForm.justification}
                  onChange={(e) => setDecisionForm((f) => ({ ...f, justification: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDecision((s) => ({ ...s, open: false }))}>
                Cancel
              </Button>
              <Button
                onClick={submitDecision}
                disabled={!decisionForm.reason_code || !decisionForm.justification.trim() || command.isPending}
              >
                Record decision
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <Tabs defaultValue="register" className="space-y-6">
      <TabsList>
        <TabsTrigger value="register">Policy register</TabsTrigger>
        <TabsTrigger value="approvals">Approval queue</TabsTrigger>
      </TabsList>

      <TabsContent value="register" className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            className="max-w-xs"
            placeholder="Search by code or name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search uprating policies"
          />
          {ctx.hasWrite && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> New policy
            </Button>
          )}
        </div>

        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Policy</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Active version</TableHead>
                  <TableHead>In progress</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQuery.isLoading && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </TableCell>
                  </TableRow>
                )}
                {(listQuery.data?.data?.rows ?? []).map((row) => (
                  <TableRow
                    key={row.policy_id}
                    className="cursor-pointer"
                    onClick={() => setSelectedPolicyId(row.policy_id)}
                  >
                    <TableCell>{row.policy_code}</TableCell>
                    <TableCell>{row.policy_name}</TableCell>
                    <TableCell>{row.policy_type.replace(/_/g, ' ')}</TableCell>
                    <TableCell>
                      {row.active_version
                        ? `${row.active_version.version_reference} (from ${row.active_version.effective_from ?? '—'})`
                        : 'None active'}
                    </TableCell>
                    <TableCell>{row.open_version_count > 0 ? 'Yes' : 'No'}</TableCell>
                  </TableRow>
                ))}
                {!listQuery.isLoading && (listQuery.data?.data?.rows ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5}>No uprating policies have been created yet.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="approvals">
        <Card>
          <CardHeader>
            <CardTitle>Awaiting independent approval</CardTitle>
            <CardDescription>
              A version can only be decided by someone other than its author and submitter.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Policy</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Decision available</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(queueQuery.data?.data?.rows ?? []).map((row) => (
                  <TableRow
                    key={row.policy_version_id}
                    className="cursor-pointer"
                    onClick={() => setSelectedPolicyId(row.policy_id)}
                  >
                    <TableCell>{row.policy_code} — {row.policy_name}</TableCell>
                    <TableCell>{row.version_reference}</TableCell>
                    <TableCell>
                      {row.submitted_by_name ?? '—'}
                      {row.submitted_at ? ` · ${new Date(row.submitted_at).toLocaleDateString()}` : ''}
                    </TableCell>
                    <TableCell>{row.can_decide ? 'Yes' : 'Not independent'}</TableCell>
                  </TableRow>
                ))}
                {(queueQuery.data?.data?.rows ?? []).length === 0 && (
                  <TableRow><TableCell colSpan={4}>Nothing is awaiting approval.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New uprating policy</DialogTitle>
            <DialogDescription>
              The policy is the catalogue entry. Its rules live in governed, approved versions.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="policy_code">Policy code</Label>
              <Input
                id="policy_code"
                value={policyForm.policy_code}
                onChange={(e) => setPolicyForm((f) => ({ ...f, policy_code: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="policy_name">Policy name</Label>
              <Input
                id="policy_name"
                value={policyForm.policy_name}
                onChange={(e) => setPolicyForm((f) => ({ ...f, policy_name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Policy type</Label>
              <Select
                value={policyForm.policy_type}
                onValueChange={(v) => setPolicyForm((f) => ({ ...f, policy_type: v }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BN_UPRATING_POLICY_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={policyForm.description}
                onChange={(e) => setPolicyForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={submitPolicy}
              disabled={!policyForm.policy_code.trim() || !policyForm.policy_name.trim() || command.isPending}
            >
              Create policy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Separator className="hidden" />
    </Tabs>
  );
};

export default BnUpratingPolicyWorkspace;
