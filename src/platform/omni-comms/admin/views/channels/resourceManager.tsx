/**
 * Omni-Comms UI Phase 2 (UX2) — shared channel resource-manager primitives.
 *
 * ONE presentation vocabulary for every channel resource (providers, provider
 * accounts, identities, endpoints, bindings, policies):
 *   - search + status filtering,
 *   - responsive table / card presentation,
 *   - accessible lifecycle action menus and confirmation dialogs,
 *   - retirement-reason collection (replaces every window.prompt),
 *   - a details drawer with SAFE lifecycle facts only.
 *
 * Boundaries (permanent, and specifically re-affirmed for UX2):
 *   - No provider SDK import, no send, no dispatch, no migration, no new RPC.
 *   - `public.core_audit_log` is NEVER queried from the browser. This module
 *     contains no audit-history fetch of any kind and never renders
 *     before_value, after_value, actor email or secret references.
 *   - Only lifecycle facts already returned by the existing tenant-scoped
 *     summary RPCs are displayed, and they are never described as a complete
 *     activity history.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { MoreHorizontal, Search, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { OmniCommsRpcError } from '@/platform/omni-comms/application/omniCommsRpcErrors';

/* ─── Error presentation ─────────────────────────────────────────── */

/**
 * Turn a controlled Omni-Comms RPC failure into an operator-safe sentence.
 * OC403 (permission denied) and OC413 (concurrent update) get explicit,
 * actionable copy. No unauthorised data is ever surfaced while doing so.
 */
export function describeOmniCommsError(err: unknown, fallback: string): string {
  if (err instanceof OmniCommsRpcError) {
    if (err.code === 'OC403') {
      return 'You do not have permission to perform this action. Ask an administrator for the Configure Omnichannel Communications capability.';
    }
    if (err.code === 'OC401') {
      return 'Your session is no longer authenticated. Sign in again and retry.';
    }
    if (err.code === 'OC413') {
      return 'This record changed since it was loaded. Refresh and reapply your change.';
    }
    if (err.code === 'OC412') {
      return `This lifecycle action is not allowed in the record's current state.`;
    }
    return `${err.code} — ${err.detail ?? fallback}`;
  }
  return err instanceof Error ? err.message : fallback;
}

/** True when the failure is an authorisation failure (OC401/OC403). */
export function isPermissionDenied(err: unknown): boolean {
  return err instanceof OmniCommsRpcError && (err.code === 'OC403' || err.code === 'OC401');
}

export const PERMISSION_DENIED_MESSAGE =
  'You do not have permission to view or change this configuration. Nothing is displayed while access is denied.';

export const PermissionDeniedState: React.FC<{ testId?: string }> = ({ testId }) => (
  <Card data-testid={testId ?? 'omni-comms-permission-denied'}>
    <CardContent className="flex items-start gap-3 py-6">
      <ShieldAlert className="mt-0.5 h-4 w-4 text-muted-foreground" />
      <div>
        <p className="text-sm font-medium">Permission denied</p>
        <p className="text-sm text-muted-foreground">{PERMISSION_DENIED_MESSAGE}</p>
      </div>
    </CardContent>
  </Card>
);

/* ─── Search + status filtering ──────────────────────────────────── */

export const RESOURCE_STATUS_FILTERS = ['all', 'draft', 'active', 'disabled', 'retired'] as const;
export type ResourceStatusFilter = (typeof RESOURCE_STATUS_FILTERS)[number];

export interface ResourceFilterState {
  query: string;
  status: ResourceStatusFilter;
}

export const EMPTY_RESOURCE_FILTER: ResourceFilterState = { query: '', status: 'all' };

/** Pure, case-insensitive filter over caller-selected searchable fields. */
export function filterResourceRows<T>(
  rows: readonly T[],
  filter: ResourceFilterState,
  searchable: (row: T) => readonly (string | null | undefined)[],
  statusOf: (row: T) => string,
): T[] {
  const q = filter.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter.status !== 'all' && statusOf(row) !== filter.status) return false;
    if (!q) return true;
    return searchable(row).some((v) => (v ?? '').toLowerCase().includes(q));
  });
}

export const ResourceSearchToolbar: React.FC<{
  filter: ResourceFilterState;
  onChange: (next: ResourceFilterState) => void;
  placeholder?: string;
  total: number;
  shown: number;
  testId?: string;
}> = ({ filter, onChange, placeholder, total, shown, testId }) => (
  <div
    className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
    data-testid={testId ?? 'omni-comms-resource-toolbar'}
  >
    <div className="relative w-full sm:max-w-xs">
      <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        className="pl-8"
        aria-label="Search records"
        placeholder={placeholder ?? 'Search…'}
        value={filter.query}
        onChange={(e) => onChange({ ...filter, query: e.target.value })}
      />
    </div>
    <div className="flex items-center gap-2">
      <Label htmlFor="omni-comms-status-filter" className="text-xs text-muted-foreground">
        Status
      </Label>
      <select
        id="omni-comms-status-filter"
        aria-label="Filter by status"
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        value={filter.status}
        onChange={(e) => onChange({ ...filter, status: e.target.value as ResourceStatusFilter })}
      >
        {RESOURCE_STATUS_FILTERS.map((s) => (
          <option key={s} value={s}>
            {s === 'all' ? 'All statuses' : s}
          </option>
        ))}
      </select>
      <span className="text-xs text-muted-foreground">
        {shown} of {total}
      </span>
    </div>
  </div>
);

/* ─── Responsive presentation ────────────────────────────────────── */

/** Table on wide viewports, cards on narrow viewports. */
export const ResourceResponsiveList: React.FC<{
  table: React.ReactNode;
  cards: React.ReactNode;
}> = ({ table, cards }) => (
  <>
    <div className="hidden md:block">{table}</div>
    <div className="space-y-3 md:hidden" data-testid="omni-comms-resource-cards">{cards}</div>
  </>
);

export const ResourceRecordCard: React.FC<{
  title: string;
  subtitle?: string;
  status?: string;
  badges?: React.ReactNode;
  fields?: readonly { label: string; value: string }[];
  actions?: React.ReactNode;
  onOpen?: () => void;
  testId?: string;
}> = ({ title, subtitle, status, badges, fields, actions, onOpen, testId }) => (
  <Card data-testid={testId}>
    <CardContent className="space-y-2 py-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{title}</p>
          {subtitle ? (
            <p className="truncate font-mono text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status ? <Badge variant="outline">{status}</Badge> : null}
          {actions}
        </div>
      </div>
      {badges}
      {fields && fields.length > 0 ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          {fields.map((f) => (
            <React.Fragment key={f.label}>
              <dt className="text-muted-foreground">{f.label}</dt>
              <dd className="break-all">{f.value}</dd>
            </React.Fragment>
          ))}
        </dl>
      ) : null}
      {onOpen ? (
        <Button size="sm" variant="outline" onClick={onOpen}>
          View details
        </Button>
      ) : null}
    </CardContent>
  </Card>
);

/* ─── Lifecycle actions ──────────────────────────────────────────── */

export type LifecycleActionKey = 'activate' | 'reactivate' | 'disable' | 'retire' | 'verify';

export interface LifecycleActionDescriptor {
  /** Backend-supported operation. `reactivate` maps to `activate`. */
  key: LifecycleActionKey;
  label: string;
  disabled?: boolean;
  disabledReason?: string;
  destructive?: boolean;
}

/** The lifecycle operation the backend actually receives. */
export function backendLifecycleAction(
  key: LifecycleActionKey,
): 'activate' | 'disable' | 'retire' | 'verify' {
  return key === 'reactivate' ? 'activate' : key;
}

export function lifecycleRequiresReason(key: LifecycleActionKey): boolean {
  return key === 'retire';
}

export const ResourceActionMenu: React.FC<{
  actions: readonly LifecycleActionDescriptor[];
  onSelect: (action: LifecycleActionDescriptor) => void;
  onEdit?: () => void;
  onViewDetails?: () => void;
  disabled?: boolean;
  label?: string;
  testId?: string;
}> = ({ actions, onSelect, onEdit, onViewDetails, disabled, label, testId }) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled}
        aria-label={label ?? 'Record actions'}
        data-testid={testId}
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-56">
      <DropdownMenuLabel>Actions</DropdownMenuLabel>
      {onViewDetails ? (
        <DropdownMenuItem onSelect={() => onViewDetails()}>View details</DropdownMenuItem>
      ) : null}
      {onEdit ? <DropdownMenuItem onSelect={() => onEdit()}>Edit draft</DropdownMenuItem> : null}
      {actions.length > 0 ? <DropdownMenuSeparator /> : null}
      {actions.map((a) => (
        <DropdownMenuItem
          key={a.key}
          disabled={a.disabled}
          onSelect={() => onSelect(a)}
          className={a.destructive ? 'text-destructive' : undefined}
        >
          <span className="flex flex-col">
            <span>{a.label}</span>
            {a.disabled && a.disabledReason ? (
              <span className="text-xs text-muted-foreground">{a.disabledReason}</span>
            ) : null}
          </span>
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
);

export interface LifecycleDialogController {
  pending: LifecycleActionDescriptor | null;
  reason: string;
  busy: boolean;
  setReason: (v: string) => void;
  request: (action: LifecycleActionDescriptor) => void;
  cancel: () => void;
  confirm: () => void;
}

/**
 * Accessible replacement for `window.prompt`. Collects a retirement reason
 * where the backend requires one and never mutates without confirmation.
 */
export function useLifecycleDialog(
  run: (action: LifecycleActionKey, reason: string | null) => Promise<void>,
): LifecycleDialogController {
  const [pending, setPending] = useState<LifecycleActionDescriptor | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const request = useCallback((action: LifecycleActionDescriptor) => {
    setReason('');
    setPending(action);
  }, []);

  const cancel = useCallback(() => {
    if (busy) return;
    setPending(null);
    setReason('');
  }, [busy]);

  const confirm = useCallback(() => {
    if (!pending) return;
    const needsReason = lifecycleRequiresReason(pending.key);
    const trimmed = reason.trim();
    if (needsReason && !trimmed) return;
    setBusy(true);
    void run(pending.key, needsReason ? trimmed : null)
      .finally(() => {
        setBusy(false);
        setPending(null);
        setReason('');
      });
  }, [pending, reason, run]);

  return { pending, reason, busy, setReason, request, cancel, confirm };
}

export const LifecycleActionDialog: React.FC<{
  controller: LifecycleDialogController;
  resourceLabel: string;
  recordLabel: string;
}> = ({ controller, resourceLabel, recordLabel }) => {
  const { pending, reason, busy, setReason, cancel, confirm } = controller;
  const needsReason = pending ? lifecycleRequiresReason(pending.key) : false;
  return (
    <Dialog open={pending !== null} onOpenChange={(open) => { if (!open) cancel(); }}>
      <DialogContent data-testid="omni-comms-lifecycle-dialog">
        <DialogHeader>
          <DialogTitle>
            {pending?.label ?? 'Confirm'} {resourceLabel}
          </DialogTitle>
          <DialogDescription>
            {recordLabel}
            {needsReason
              ? ' — a retirement reason is recorded with this change and cannot be removed.'
              : ' — confirm this lifecycle change.'}
          </DialogDescription>
        </DialogHeader>
        {needsReason ? (
          <div className="space-y-2">
            <Label htmlFor="omni-comms-retirement-reason">Retirement reason (required)</Label>
            <Textarea
              id="omni-comms-retirement-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this record being retired?"
            />
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={cancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={confirm}
            disabled={busy || (needsReason && reason.trim().length === 0)}
            data-testid="omni-comms-lifecycle-confirm"
          >
            {pending?.label ?? 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/* ─── Details drawer + SAFE lifecycle facts ──────────────────────── */

export interface SafeLifecycleFact {
  label: string;
  value: string | null | undefined;
}

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return 'Not recorded';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'Not recorded' : d.toLocaleString();
}

/**
 * The mandated UX2 history contract.
 *
 * There is no tenant-scoped, field-whitelisted Omni-Comms audit-history read
 * projection yet, and `public.core_audit_log` must NOT be read by the browser.
 * We therefore state the limitation plainly instead of fabricating a timeline.
 */
export const HISTORY_UNAVAILABLE_MESSAGE =
  'History is not available through a tenant-scoped safe projection.';

export const HISTORY_UNAVAILABLE_DETAIL =
  'The values below come from this record’s own configuration summary. They are not a complete activity history, and no actor, before-value or after-value detail is available here.';

export const ResourceActivityHistorySection: React.FC<{
  facts?: readonly SafeLifecycleFact[];
  testId?: string;
}> = ({ facts, testId }) => (
  <section
    className="space-y-2 rounded-md border p-3"
    data-testid={testId ?? 'omni-comms-activity-history'}
    aria-label="Activity and history"
  >
    <h4 className="text-sm font-medium">Activity and history</h4>
    <p className="text-sm text-muted-foreground" data-testid="omni-comms-history-unavailable">
      {HISTORY_UNAVAILABLE_MESSAGE}
    </p>
    {facts && facts.length > 0 ? (
      <>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          {facts.map((f) => (
            <React.Fragment key={f.label}>
              <dt className="text-muted-foreground">{f.label}</dt>
              <dd className="break-all">{f.value && f.value.length > 0 ? f.value : 'Not recorded'}</dd>
            </React.Fragment>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">{HISTORY_UNAVAILABLE_DETAIL}</p>
      </>
    ) : null}
  </section>
);

export const ResourceDetailsDrawer: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  facts?: readonly SafeLifecycleFact[];
  children?: React.ReactNode;
  testId?: string;
}> = ({ open, onOpenChange, title, description, facts, children, testId }) => (
  <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent
      side="right"
      className="w-full overflow-y-auto sm:max-w-lg"
      data-testid={testId ?? 'omni-comms-resource-drawer'}
    >
      <SheetHeader>
        <SheetTitle>{title}</SheetTitle>
        {description ? <SheetDescription>{description}</SheetDescription> : null}
      </SheetHeader>
      <div className="mt-4 space-y-4">
        {children}
        <ResourceActivityHistorySection facts={facts} />
      </div>
    </SheetContent>
  </Sheet>
);

/** Convenience: build the SAFE fact list from a summary row. */
export function safeLifecycleFacts(row: {
  created_at?: string | null;
  updated_at?: string | null;
  activated_at?: string | null;
  disabled_at?: string | null;
  retired_at?: string | null;
  retirement_reason?: string | null;
  verification_status?: string | null;
  verification_checked_at?: string | null;
}): SafeLifecycleFact[] {
  const facts: SafeLifecycleFact[] = [];
  const add = (label: string, value: string | null | undefined) => {
    if (value !== undefined) facts.push({ label, value: formatTimestamp(value) });
  };
  add('Created', row.created_at);
  add('Last updated', row.updated_at);
  add('Activated', row.activated_at);
  add('Disabled', row.disabled_at);
  add('Retired', row.retired_at);
  if (row.verification_status !== undefined) {
    facts.push({ label: 'Verification status', value: row.verification_status ?? 'unverified' });
  }
  if (row.verification_checked_at !== undefined) {
    facts.push({ label: 'Verification checked', value: formatTimestamp(row.verification_checked_at) });
  }
  if (row.retirement_reason !== undefined) {
    facts.push({ label: 'Retirement reason', value: row.retirement_reason ?? 'Not recorded' });
  }
  return facts;
}

/** Detail rows in the drawer body. */
export const DrawerFacts: React.FC<{ facts: readonly SafeLifecycleFact[] }> = ({ facts }) => (
  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
    {facts.map((f) => (
      <React.Fragment key={f.label}>
        <dt className="text-muted-foreground">{f.label}</dt>
        <dd className="break-all">{f.value && f.value.length > 0 ? f.value : '—'}</dd>
      </React.Fragment>
    ))}
  </dl>
);

/** Memo-friendly hook for a filtered view. */
export function useResourceFilter<T>(
  rows: readonly T[],
  searchable: (row: T) => readonly (string | null | undefined)[],
  statusOf: (row: T) => string,
): {
  filter: ResourceFilterState;
  setFilter: (next: ResourceFilterState) => void;
  filtered: T[];
} {
  const [filter, setFilter] = useState<ResourceFilterState>(EMPTY_RESOURCE_FILTER);
  const filtered = useMemo(
    () => filterResourceRows(rows, filter, searchable, statusOf),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, filter],
  );
  return { filter, setFilter, filtered };
}
