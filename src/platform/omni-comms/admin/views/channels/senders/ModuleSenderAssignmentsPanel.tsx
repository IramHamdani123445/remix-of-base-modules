/**
 * Omni-Comms — Module → Sender Profile assignments (Delivery Setup).
 *
 * Operator surface answering "which sender profile does each business module
 * use?". Configuration governance only.
 *
 * Boundaries (permanent): no provider SDK, no send behaviour, no route
 * mutation. Changing a module default NEVER rewrites existing event routes;
 * the screen reports impact instead.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, RefreshCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import type { OmniCommsRpcClient } from '@/platform/omni-comms/application/omniCommsRpcErrors';
import {
  bootstrapModuleSenderProfiles,
  deleteModuleSenderProfile,
  setModuleSenderProfileLifecycle,
  upsertModuleSenderProfileDraft,
  getModuleSenderProfileSummary,
} from '@/platform/omni-comms/application/moduleSenderProfileService';
import {
  assignmentLabel,
  moduleCoverageStatus,
  moduleDefaultAssignment,
  moduleProfileReadiness,
  selectableSendersForModule,
  senderOptionLabel,
  type ModuleSenderAssignment,
  type ModuleSenderBootstrapResult,
  type ModuleSenderCoverageRow,
  type ModuleSenderProfileSummary,
} from '@/platform/omni-comms/application/moduleSenderProfileTypes';
import { toastError } from '../channelFormPrimitives';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  CONFIGURED: 'default',
  'DEFAULT NOT ACTIVE': 'secondary',
  'NO DEFAULT SENDER': 'outline',
  'MODULE INACTIVE': 'outline',
};

type Pending =
  | { kind: 'disable' | 'retire'; row: ModuleSenderAssignment }
  | { kind: 'delete'; row: ModuleSenderAssignment }
  | null;

export const ModuleSenderAssignmentsPanel: React.FC<{
  client: OmniCommsRpcClient;
  orgId: string;
  channel?: string;
}> = ({ client, orgId, channel = 'email' }) => {
  const [summary, setSummary] = useState<ModuleSenderProfileSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<ModuleSenderCoverageRow | null>(null);
  const [assignFor, setAssignFor] = useState<ModuleSenderCoverageRow | null>(null);
  const [senderId, setSenderId] = useState('');
  const [makeDefault, setMakeDefault] = useState(true);
  const [pending, setPending] = useState<Pending>(null);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<ModuleSenderBootstrapResult | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      setSummary(await getModuleSenderProfileSummary(client, orgId, channel));
    } catch (e) {
      toastError(e, 'Unable to load module sender assignments');
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [client, orgId, channel]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => summary?.modules ?? [], [summary]);
  const configured = rows.filter((r) => moduleCoverageStatus(r) === 'CONFIGURED').length;
  const canManage = summary?.can_manage ?? false;

  const currentDetail = useMemo(
    () => (detail ? rows.find((r) => r.module_code === detail.module_code) ?? detail : null),
    [detail, rows],
  );

  const assign = async () => {
    if (!assignFor || !senderId) return;
    setBusy(true);
    try {
      const id = await upsertModuleSenderProfileDraft(client, {
        organizationId: orgId,
        callerModuleCode: assignFor.module_code,
        channel,
        senderIdentityId: senderId,
        isDefault: makeDefault,
      });
      const fresh = await getModuleSenderProfileSummary(client, orgId, channel);
      const created = fresh.modules
        .flatMap((m) => m.assignments)
        .find((a) => a.id === id);
      if (created) {
        await setModuleSenderProfileLifecycle(client, {
          id,
          expectedUpdatedAt: created.updated_at,
          action: 'activate',
        });
      }
      toast.success('Sender assigned to module');
      setAssignFor(null);
      setSenderId('');
      await load();
    } catch (e) {
      toastError(e, 'Unable to assign sender');
    } finally {
      setBusy(false);
    }
  };

  const runLifecycle = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === 'delete') {
        await deleteModuleSenderProfile(client, pending.row.id, pending.row.updated_at);
        toast.success('Draft assignment deleted');
      } else {
        await setModuleSenderProfileLifecycle(client, {
          id: pending.row.id,
          expectedUpdatedAt: pending.row.updated_at,
          action: pending.kind,
          reason,
        });
        toast.success(pending.kind === 'disable' ? 'Assignment disabled' : 'Assignment retired');
      }
      setPending(null);
      setReason('');
      await load();
    } catch (e) {
      toastError(e, 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const runBootstrap = async (apply: boolean) => {
    setBusy(true);
    try {
      const res = await bootstrapModuleSenderProfiles(client, orgId, apply, channel);
      setPreview(res);
      if (apply) {
        toast.success(`Bootstrap applied — ${res.created} created, ${res.existing} unchanged`);
        await load();
      }
    } catch (e) {
      toastError(e, 'Bootstrap failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-testid="oc-module-sender-assignments">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Module assignments</CardTitle>
          <CardDescription>
            Which sender address each business module uses by default. Assignments govern
            configuration and route authorisation only — existing event routes keep the sender
            they already have.
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCcw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void runBootstrap(false)}
            data-testid="oc-msp-bootstrap-preview"
          >
            Preview bootstrap
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {configured} of {rows.length} registered modules have an active default sender.
        </p>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading module assignments…
          </div>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Module</TableHead>
                  <TableHead>Default sender</TableHead>
                  <TableHead>Allowed</TableHead>
                  <TableHead>Routes</TableHead>
                  <TableHead>Overrides</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const def = moduleDefaultAssignment(r);
                  const status = moduleCoverageStatus(r);
                  return (
                    <TableRow key={r.module_code} data-testid={`oc-msp-row-${r.module_code}`}>
                      <TableCell className="font-medium">{r.module_code}</TableCell>
                      <TableCell>
                        {def ? (
                          <div>
                            <div>{assignmentLabel(def)}</div>
                            <div className="text-xs text-muted-foreground">
                              {def.from_address ?? '—'}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">Not assigned</span>
                        )}
                      </TableCell>
                      <TableCell>{r.assignments.filter((a) => a.status === 'active').length}</TableCell>
                      <TableCell>{r.routes_total}</TableCell>
                      <TableCell>{r.routes_with_override}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[status] ?? 'outline'}>{status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => setDetail(r)}>
                          Manage
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {preview && (
          <div className="rounded-md border p-3 space-y-2" data-testid="oc-msp-bootstrap-preview-result">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                Bootstrap {preview.applied ? 'result' : 'preview'} — {preview.created} created,{' '}
                {preview.existing} existing, {preview.blocked} blocked,{' '}
                {preview.not_required ?? 0} not required
              </p>
              {!preview.applied && canManage && (
                <Button size="sm" disabled={busy} onClick={() => void runBootstrap(true)}>
                  Apply missing
                </Button>
              )}
            </div>
            <ul className="text-xs text-muted-foreground space-y-1">
              {preview.plan.map((p) => (
                <li key={`${p.caller_module_code}-${p.profile_role}-${p.sender_code ?? 'none'}`}>
                  {p.caller_module_code} · {p.profile_role}
                  {p.is_default ? ' (default)' : ''} → {p.sender_code ?? 'no business sender'}:{' '}
                  {p.status}
                  {p.detail ? ` (${p.detail})` : ''}
                </li>
              ))}
            </ul>

          </div>
        )}
      </CardContent>

      {/* Module detail */}
      <Dialog open={!!currentDetail} onOpenChange={(o) => { if (!o) setDetail(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{currentDetail?.module_code}</DialogTitle>
            <DialogDescription>
              Sender profiles authorised for this module on the {channel} channel.
            </DialogDescription>
          </DialogHeader>
          {currentDetail && (
            <div className="space-y-4">
              <div className="text-sm">
                <span className="font-medium">Readiness: </span>
                {moduleProfileReadiness(currentDetail).label}
                {moduleProfileReadiness(currentDetail).blocker && (
                  <span className="text-muted-foreground">
                    {' '}
                    — {moduleProfileReadiness(currentDetail).blocker}
                  </span>
                )}
              </div>
              <div className="rounded-md border divide-y">
                {currentDetail.assignments.length === 0 && (
                  <p className="p-3 text-sm text-muted-foreground">No sender assigned yet.</p>
                )}
                {currentDetail.assignments.map((a) => (
                  <div key={a.id} className="p-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium">
                        {assignmentLabel(a)} {a.is_default && <Badge className="ml-1">Default</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {a.from_address ?? '—'} · {a.domain_name ?? 'no domain'} ·{' '}
                        {a.provider_account_name ?? 'no provider account'} · {a.status}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {a.status === 'draft' && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canManage || busy}
                          onClick={() =>
                            void setModuleSenderProfileLifecycle(client, {
                              id: a.id,
                              expectedUpdatedAt: a.updated_at,
                              action: 'activate',
                            })
                              .then(() => load())
                              .catch((e) => toastError(e, 'Unable to activate'))
                          }
                        >
                          Activate
                        </Button>
                      )}
                      {a.status === 'active' && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canManage}
                          onClick={() => setPending({ kind: 'disable', row: a })}
                        >
                          Disable
                        </Button>
                      )}
                      {a.status !== 'retired' && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canManage}
                          onClick={() => setPending({ kind: 'retire', row: a })}
                        >
                          Retire
                        </Button>
                      )}
                      {a.status === 'draft' && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canManage}
                          onClick={() => setPending({ kind: 'delete', row: a })}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-xs text-muted-foreground">
                {currentDetail.routes_total} route(s) for this module — {currentDetail.routes_using_default}{' '}
                use the module default, {currentDetail.routes_with_override} differ. Changing the default
                does not rewrite them.
              </div>
              <Button
                size="sm"
                disabled={!canManage}
                onClick={() => {
                  setAssignFor(currentDetail);
                  setSenderId('');
                  setMakeDefault(!moduleDefaultAssignment(currentDetail));
                }}
                data-testid="oc-msp-assign"
              >
                <Plus className="h-4 w-4 mr-1" />
                Assign sender
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Assign sender */}
      <Dialog open={!!assignFor} onOpenChange={(o) => { if (!o) setAssignFor(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign sender — {assignFor?.module_code}</DialogTitle>
            <DialogDescription>
              Only genuine sender addresses of this organisation and channel can be assigned.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Sender address</Label>
              <Select value={senderId} onValueChange={setSenderId}>
                <SelectTrigger data-testid="oc-msp-sender-select">
                  <SelectValue placeholder="Select a sender" />
                </SelectTrigger>
                <SelectContent>
                  {summary && assignFor
                    ? selectableSendersForModule(summary, assignFor).map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {senderOptionLabel(s)}
                        </SelectItem>
                      ))
                    : null}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="msp-default"
                checked={makeDefault}
                onCheckedChange={(v) => setMakeDefault(v === true)}
              />
              <Label htmlFor="msp-default">Use as the module default sender</Label>
            </div>
            {assignFor && moduleDefaultAssignment(assignFor) && makeDefault && (
              <p className="text-xs text-muted-foreground">
                Current default: {assignmentLabel(moduleDefaultAssignment(assignFor)!)}.{' '}
                {assignFor.routes_using_default} existing route(s) use it and will not be changed.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignFor(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void assign()} disabled={busy || !senderId}>
              {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lifecycle confirmation */}
      <Dialog open={!!pending} onOpenChange={(o) => { if (!o) { setPending(null); setReason(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending?.kind === 'delete' ? 'Delete draft assignment' : `Confirm ${pending?.kind}`}
            </DialogTitle>
            <DialogDescription>
              {pending?.kind === 'delete'
                ? 'Permanent deletion is only allowed for unused draft assignments.'
                : 'Existing event routes are not modified by this action.'}
            </DialogDescription>
          </DialogHeader>
          {pending && pending.kind !== 'delete' && (
            <div className="space-y-1">
              <Label htmlFor="msp-reason">Reason</Label>
              <Input
                id="msp-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this changing?"
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={() => void runLifecycle()}
              disabled={busy || (pending?.kind !== 'delete' && !reason.trim())}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};
