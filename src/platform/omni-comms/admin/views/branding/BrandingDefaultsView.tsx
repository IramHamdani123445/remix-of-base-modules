/**
 * Omni-Comms — Branding & Layouts › Defaults & Overrides.
 *
 * One surface that answers: "for this module / department / event, which
 * layout and which shared assets actually apply, and where did each of them
 * come from?"
 *
 * Presentation (layout + assets) is configured here. CONTENT lives in
 * Templates. This screen never edits message wording.
 */
import React from 'react';
import { useOmniCommsRpcClient } from '../../hooks/useOmniCommsRpcClient';
import { useOmniCommsTenant } from '@/platform/omni-comms/context/OmniCommsTenantContext';
import { listActiveDepartmentsForOrganization } from '@/platform/organization/organizationService';
import * as sharedSvc from '@/platform/omni-comms/application/sharedAssetsService';
import * as svc from '@/platform/omni-comms/application/presentationInheritanceService';
import * as ecSvc from '@/platform/omni-comms/application/eventCatalogueService';
import type { EventDefinitionListItem } from '@/platform/omni-comms/application/eventCatalogueTypes';
import type { OutputChannel } from '@/platform/omni-comms/application/sharedAssetsTypes';
import type {
  ResolvedPresentation,
  ScopedAssignmentRow,
} from '@/platform/omni-comms/application/presentationInheritanceTypes';
import { scopeLabel, type PresentationSource } from '@/platform/omni-comms/domain/presentationScope';
import { OmniCommsRpcError } from '@/platform/omni-comms/application/omniCommsRpcErrors';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

const NONE = '__none__';

const CHANNELS: OutputChannel[] = ['email', 'print', 'sms', 'whatsapp', 'in_app', 'push'];

function friendly(e: unknown): string {
  if (e instanceof OmniCommsRpcError) return `${e.code} ${e.detail ?? ''}`.trim();
  return (e as Error)?.message ?? 'Unexpected error';
}

function SourceBadge({ source }: { source: PresentationSource | null | undefined }) {
  if (!source) return <Badge variant="secondary">—</Badge>;
  const variant =
    source === 'unresolved'
      ? 'destructive'
      : source === 'organization'
        ? 'outline'
        : source === 'pinned'
          ? 'secondary'
          : 'default';
  return <Badge variant={variant as never}>{scopeLabel(source)}</Badge>;
}

export const BrandingDefaultsView: React.FC = () => {
  const client = useOmniCommsRpcClient();
  const { organizationId: tenantOrganizationId } = useOmniCommsTenant();
  const organizationId = tenantOrganizationId ?? '';

  const [channel, setChannel] = React.useState<OutputChannel>('email');
  const [moduleCode, setModuleCode] = React.useState<string>(NONE);
  const [departmentId, setDepartmentId] = React.useState<string>(NONE);
  const [eventCode, setEventCode] = React.useState<string>(NONE);

  const [departments, setDepartments] = React.useState<Array<{ id: string; name: string }>>([]);
  const [events, setEvents] = React.useState<EventDefinitionListItem[]>([]);
  const [layouts, setLayouts] = React.useState<
    Array<{ id: string; code: string | null; name: string }>
  >([]);
  const [assignments, setAssignments] = React.useState<ScopedAssignmentRow[]>([]);
  const [resolved, setResolved] = React.useState<ResolvedPresentation | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const scope = React.useMemo(
    () => ({
      moduleCode: moduleCode === NONE ? null : moduleCode,
      departmentId: departmentId === NONE ? null : departmentId,
      eventCode: eventCode === NONE ? null : eventCode,
    }),
    [moduleCode, departmentId, eventCode],
  );

  const modules = React.useMemo(
    () => Array.from(new Set(events.map((e) => e.module_code))).sort(),
    [events],
  );
  const scopedEvents = React.useMemo(
    () => events.filter((e) => !scope.moduleCode || e.module_code === scope.moduleCode),
    [events, scope.moduleCode],
  );

  React.useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    (async () => {
      try {
        const [deps, evs, lays] = await Promise.all([
          listActiveDepartmentsForOrganization(organizationId),
          ecSvc.listAllEventDefinitionsForPicker(client, { status: 'active', maxItems: 1000 }),
          sharedSvc.listActiveLayouts(client, {}),
        ]);
        if (cancelled) return;
        setDepartments((deps ?? []).map((d: never) => d as { id: string; name: string }));
        setEvents(evs ?? []);
        setLayouts(lays ?? []);
      } catch (e) {
        if (!cancelled) setError(friendly(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, organizationId]);

  const reload = React.useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const [rows, res] = await Promise.all([
        svc.listScopedAssignments(client, { organizationId, outputChannel: channel }),
        svc.resolvePresentationForContext(client, {
          organizationId,
          outputChannel: channel,
          ...scope,
        }),
      ]);
      setAssignments(rows ?? []);
      setResolved(res ?? null);
    } catch (e) {
      setError(friendly(e));
    } finally {
      setLoading(false);
    }
  }, [client, organizationId, channel, scope]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  // Event scope requires a module — keep the selectors honest.
  React.useEffect(() => {
    if (moduleCode === NONE && eventCode !== NONE) setEventCode(NONE);
  }, [moduleCode, eventCode]);

  const scopeSummary = React.useMemo(() => {
    const parts: string[] = ['Organisation'];
    if (scope.moduleCode) parts.push(scope.moduleCode);
    if (scope.departmentId) {
      parts.push(departments.find((d) => d.id === scope.departmentId)?.name ?? 'Department');
    }
    if (scope.eventCode) parts.push(scope.eventCode);
    return parts.join(' › ');
  }, [scope, departments]);

  const applyLayout = async (layoutId: string) => {
    if (!organizationId) return;
    setBusy(true);
    try {
      await svc.setLayoutForScope(client, {
        organizationId,
        outputChannel: channel,
        layoutId,
        ...scope,
      });
      toast.success(`Layout set for ${scopeSummary}.`);
      await reload();
    } catch (e) {
      toast.error(friendly(e));
    } finally {
      setBusy(false);
    }
  };

  const resetLayout = async () => {
    if (!organizationId) return;
    setBusy(true);
    try {
      await svc.resetOverride(client, {
        organizationId,
        outputChannel: channel,
        assignmentKind: 'layout_default',
        ...scope,
      });
      toast.success('Override removed — the value inherits again.');
      await reload();
    } catch (e) {
      toast.error(friendly(e));
    } finally {
      setBusy(false);
    }
  };

  const resetSlot = async (slotCode: string) => {
    if (!organizationId) return;
    setBusy(true);
    try {
      await svc.resetOverride(client, {
        organizationId,
        outputChannel: channel,
        assignmentKind: 'asset_slot',
        slotCode,
        ...scope,
      });
      toast.success(`${slotCode} inherits again.`);
      await reload();
    } catch (e) {
      toast.error(friendly(e));
    } finally {
      setBusy(false);
    }
  };

  const hasOverrideAtScope = React.useMemo(
    () =>
      assignments.some(
        (a) =>
          a.assignment_kind === 'layout_default' &&
          (a.module_code ?? null) === scope.moduleCode &&
          (a.department_id ?? null) === scope.departmentId &&
          (a.event_code ?? null) === scope.eventCode,
      ),
    [assignments, scope],
  );

  const isRootScope = !scope.moduleCode && !scope.departmentId && !scope.eventCode;

  if (!organizationId) {
    return (
      <Alert>
        <AlertTitle>No organisation selected</AlertTitle>
        <AlertDescription>
          Choose an organisation scope before configuring branding defaults.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Scope</CardTitle>
          <CardDescription>
            Configuration inherits from the organisation downwards. A more specific scope wins,
            property by property: an event override may change the layout while the logo still
            comes from the organisation.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div className="space-y-2">
            <Label>Channel</Label>
            <Select value={channel} onValueChange={(v) => setChannel(v as OutputChannel)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CHANNELS.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Module</Label>
            <Select value={moduleCode} onValueChange={setModuleCode}>
              <SelectTrigger><SelectValue placeholder="All modules" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Organisation-wide</SelectItem>
                {modules.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Department</Label>
            <Select value={departmentId} onValueChange={setDepartmentId}>
              <SelectTrigger><SelectValue placeholder="All departments" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>All departments</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Event</Label>
            <Select
              value={eventCode}
              onValueChange={setEventCode}
              disabled={moduleCode === NONE}
            >
              <SelectTrigger>
                <SelectValue placeholder={moduleCode === NONE ? 'Select a module first' : 'All events'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>All events</SelectItem>
                {scopedEvents.map((e) => (
                  <SelectItem key={e.id} value={e.code}>{e.code}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not resolve presentation</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Effective layout</CardTitle>
            <CardDescription>{scopeSummary}</CardDescription>
          </div>
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <SourceBadge source={resolved?.layout_inheritance_source} />
            <span className="text-sm text-muted-foreground">
              {layouts.find((l) => l.id === resolved?.layout_id)?.name ??
                resolved?.layout_id ??
                'No layout resolved for this scope.'}
            </span>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2 min-w-[280px]">
              <Label>Set the layout for this scope</Label>
              <Select
                value={resolved?.layout_id ?? ''}
                onValueChange={(v) => void applyLayout(v)}
                disabled={busy}
              >
                <SelectTrigger><SelectValue placeholder="Choose a layout" /></SelectTrigger>
                <SelectContent>
                  {layouts.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              onClick={() => void resetLayout()}
              disabled={busy || isRootScope || !hasOverrideAtScope}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset to inherited
            </Button>
          </div>
          {isRootScope && (
            <p className="text-xs text-muted-foreground">
              This is the organisation default — the root value every other scope inherits from.
              It cannot be reset, only changed.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resolved assets</CardTitle>
          <CardDescription>
            Each slot is resolved independently, so different properties can legitimately come
            from different scopes.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Slot</TableHead>
                <TableHead>Asset</TableHead>
                <TableHead>Inherited from</TableHead>
                <TableHead className="w-[160px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(resolved?.resolved_assets ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    No slots resolved for this scope yet.
                  </TableCell>
                </TableRow>
              ) : (
                (resolved?.resolved_assets ?? []).map((a) => (
                  <TableRow key={a.slot}>
                    <TableCell className="font-medium">{a.slot}</TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">
                      {a.asset_id ?? '—'}
                    </TableCell>
                    <TableCell>
                      <SourceBadge source={a.source_scope ?? a.inheritance_source} />
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy || isRootScope}
                        onClick={() => void resetSlot(a.slot)}
                      >
                        <RotateCcw className="h-3.5 w-3.5 mr-2" />
                        Reset
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configured overrides</CardTitle>
          <CardDescription>
            Every assignment for the {channel} channel, most specific first.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Scope</TableHead>
                <TableHead>Module</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Property</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    Only organisation defaults are configured for this channel.
                  </TableCell>
                </TableRow>
              ) : (
                [...assignments]
                  .sort((a, b) => (b.scope_rank ?? 0) - (a.scope_rank ?? 0))
                  .map((a) => (
                    <TableRow key={a.id}>
                      <TableCell><SourceBadge source={a.scope_level} /></TableCell>
                      <TableCell>{a.module_code ?? '—'}</TableCell>
                      <TableCell>
                        {departments.find((d) => d.id === a.department_id)?.name ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs font-mono">{a.event_code ?? '—'}</TableCell>
                      <TableCell>
                        {a.assignment_kind === 'layout_default' ? 'Layout' : a.slot_code}
                      </TableCell>
                    </TableRow>
                  ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default BrandingDefaultsView;
