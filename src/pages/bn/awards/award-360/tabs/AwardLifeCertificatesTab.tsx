/**
 * BN-AWARD360-B1 — Life Certificates tab.
 * Read-only workspace with compliance resolver, summary, filters, drawer.
 * Does NOT import unsafe verify/reminder helpers from legacy servicing modules.
 */
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AwardStatusBadge, dt, KV } from '../components';
import { Award360DataTable, type Award360Column } from '../components/Award360DataTable';
import { Award360FilterBar } from '../components/Award360FilterBar';
import { Award360MetricCards } from '../components/Award360MetricCards';
import { Award360Pagination } from '../components/Award360Pagination';
import { Award360PermissionState } from '../components/Award360PermissionState';
import { Award360PartialWarning } from '../components/Award360PartialWarning';
import { Award360DetailDrawer } from '../components/Award360DetailDrawer';
import { useAwardLifeCertificatesPaged, useAwardLifeCertReminders } from '../useAward360Queries';
import type { AwardLifeCertificateItem } from '../viewModels';

const STATUSES = ['ALL', 'PENDING', 'RECEIVED', 'VERIFIED', 'REJECTED', 'EXEMPT'];
const METHODS = ['ALL', 'IN_PERSON', 'POSTAL', 'DIGITAL', 'PROVIDER'];

interface Props {
  awardId: string;
  award: { status?: string | null; awardType?: string | null } | null;
  canView: boolean;
}

export const AwardLifeCertificatesTab: React.FC<Props> = ({ awardId, award, canView }) => {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [method, setMethod] = useState('ALL');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [receivedUnverifiedOnly, setReceivedUnverifiedOnly] = useState(false);
  const [dueFrom, setDueFrom] = useState<string | undefined>();
  const [dueTo, setDueTo] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortBy, setSortBy] = useState('dueDate');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [selected, setSelected] = useState<AwardLifeCertificateItem | null>(null);

  const query = useMemo(
    () => ({
      awardId,
      search: search || undefined,
      statuses: status !== 'ALL' ? [status] : undefined,
      verificationMethod: method !== 'ALL' ? method : undefined,
      overdueOnly, receivedUnverifiedOnly,
      dueFrom, dueTo,
      page, pageSize, sortBy, sortDirection,
    }),
    [awardId, search, status, method, overdueOnly, receivedUnverifiedOnly, dueFrom, dueTo, page, pageSize, sortBy, sortDirection],
  );

  const q = useAwardLifeCertificatesPaged(query, award, canView);
  const reminders = useAwardLifeCertReminders(awardId, canView);

  if (!canView) return <Award360PermissionState moduleLabel="Life certificates" permissionKey="bn_life_certificates.view" />;

  const s = q.data?.summary;
  const c = s?.compliance;
  const complianceTone: 'ok' | 'warn' | 'breach' | 'muted' =
    !c ? 'muted'
    : c.state === 'COMPLIANT' ? 'ok'
    : c.state === 'OVERDUE' ? 'breach'
    : c.state === 'DUE_SOON' || c.state === 'RECEIVED_PENDING_VERIFICATION' ? 'warn'
    : c.state === 'NOT_REQUIRED' || c.state === 'EXEMPT' ? 'muted'
    : 'warn';

  const metrics = s ? [
    { key: 'comp', label: 'Compliance', value: c?.state ?? '—', tone: complianceTone, hint: c?.explanation },
    { key: 'total', label: 'Cycles', value: s.totalCycles },
    { key: 'ver', label: 'Verified', value: s.verifiedCycles, tone: 'ok' as const },
    { key: 'pend', label: 'Pending', value: s.pendingCycles },
    { key: 'ru', label: 'Received/unverified', value: s.receivedUnverified, tone: s.receivedUnverified > 0 ? ('warn' as const) : undefined },
    { key: 'over', label: 'Overdue', value: s.overdueCycles, tone: s.overdueCycles > 0 ? ('breach' as const) : undefined },
    { key: 'lp', label: 'Latest period', value: s.latestRequiredPeriod ?? '—' },
    { key: 'lvp', label: 'Latest verified', value: s.latestVerifiedPeriod ?? '—' },
    { key: 'nxt', label: 'Next due', value: dt(s.nextDueDate) },
    { key: 'dtd', label: 'Days to due', value: s.daysUntilDue ?? '—' },
    { key: 'do', label: 'Days overdue', value: s.daysOverdue ?? '—', tone: (s.daysOverdue ?? 0) > 0 ? ('breach' as const) : undefined },
    { key: 'rem', label: 'Reminders', value: s.reminderCount ?? '—' },
    { key: 'pi', label: 'Payment impact', value: c?.paymentImpact ?? '—', tone: c?.paymentImpact === 'PAYMENT_HELD' ? ('breach' as const) : c?.paymentImpact === 'POTENTIAL_HOLD' ? ('warn' as const) : undefined },
  ] : [];

  const columns: Award360Column<AwardLifeCertificateItem>[] = [
    { key: 'requiredPeriod', label: 'Period', sortAccessor: (r) => r.requiredPeriod },
    { key: 'dueDate', label: 'Due', render: (r) => dt(r.dueDate), sortAccessor: (r) => r.dueDate },
    { key: 'submittedDate', label: 'Submitted', render: (r) => dt(r.submittedDate), sortAccessor: (r) => r.submittedDate },
    { key: 'verifiedDate', label: 'Verified', render: (r) => dt(r.verifiedDate), sortAccessor: (r) => r.verifiedDate },
    { key: 'status', label: 'Status', render: (r) => <AwardStatusBadge status={r.status} tone={r.daysOverdue > 0 ? 'breach' : undefined} />, sortAccessor: (r) => r.status },
    { key: 'verificationMethod', label: 'Method' },
    { key: 'daysOverdue', label: 'Overdue', align: 'right', render: (r) => r.daysOverdue > 0 ? `${r.daysOverdue}d` : '—', sortAccessor: (r) => r.daysOverdue },
    { key: 'remarks', label: 'Remarks', render: (r) => r.remarks ? <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">NOTE</span> : '—' },
  ];

  const reset = () => {
    setSearch(''); setStatus('ALL'); setMethod('ALL'); setOverdueOnly(false);
    setReceivedUnverifiedOnly(false); setDueFrom(undefined); setDueTo(undefined); setPage(1);
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Life certificates</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <Award360MetricCards metrics={metrics as any} />
        {q.data?.warnings?.length ? <Award360PartialWarning warnings={q.data.warnings} /> : null}
        <Award360FilterBar
          search={search}
          onSearch={(v) => { setSearch(v); setPage(1); }}
          searchPlaceholder="Period, document reference or remarks"
          filters={[
            { kind: 'select', key: 'st', label: 'Status', value: status, onChange: (v) => { setStatus(v); setPage(1); }, options: STATUSES.map((v) => ({ value: v, label: v })) },
            { kind: 'select', key: 'mt', label: 'Method', value: method, onChange: (v) => { setMethod(v); setPage(1); }, options: METHODS.map((v) => ({ value: v, label: v })) },
            { kind: 'date', key: 'df', label: 'Due from', value: dueFrom, onChange: (v) => { setDueFrom(v); setPage(1); } },
            { kind: 'date', key: 'dt', label: 'Due to', value: dueTo, onChange: (v) => { setDueTo(v); setPage(1); } },
            { kind: 'toggle', key: 'od', label: 'Overdue only', value: overdueOnly, onChange: (v) => { setOverdueOnly(v); setPage(1); } },
            { kind: 'toggle', key: 'ru', label: 'Received/unverified', value: receivedUnverifiedOnly, onChange: (v) => { setReceivedUnverifiedOnly(v); setPage(1); } },
          ]}
          onReset={reset}
        />
        <Award360DataTable
          rows={q.data?.rows ?? []}
          columns={columns}
          isLoading={q.isLoading}
          error={q.error}
          onRetry={() => q.refetch()}
          emptyTitle="No life certificate records match the current filters"
          getRowKey={(r) => r.id}
          onRowClick={(r) => setSelected(r)}
          sortBy={sortBy}
          sortDirection={sortDirection}
          onSortChange={(k, d) => { setSortBy(k); setSortDirection(d); }}
        />
        {q.data ? (
          <Award360Pagination page={page} pageSize={pageSize} total={q.data.total} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to={`/bn/life-certificates?awardId=${awardId}`}>Open Life Certificate Centre</Link>
          </Button>
          <Button size="sm" variant="outline" disabled title="Record-receipt command not enabled">Record receipt</Button>
          <Button size="sm" variant="outline" disabled title="Verify command not enabled">Verify</Button>
          <Button size="sm" variant="outline" disabled title="Reject command not enabled">Reject</Button>
          <Button size="sm" variant="outline" disabled title="Waive/exempt command not enabled">Waive</Button>
          <Button size="sm" variant="outline" disabled title="Reminders dispatched via Communication Hub — direct trigger not enabled">Send reminder</Button>
        </div>

        <Award360DetailDrawer
          open={!!selected}
          onOpenChange={(v) => { if (!v) setSelected(null); }}
          title={`Cycle ${selected?.requiredPeriod ?? ''}`}
          subtitle={selected?.dueDate ? `Due ${dt(selected.dueDate)}` : undefined}
          status={selected?.status ?? null}
          statusTone={(selected?.daysOverdue ?? 0) > 0 ? 'breach' : undefined}
          sections={selected ? [
            { key: 'rec', label: 'Certificate record', content: (
              <div>
                <KV label="Period" value={selected.requiredPeriod} />
                <KV label="Due" value={dt(selected.dueDate)} />
                <KV label="Submitted" value={dt(selected.submittedDate)} />
                <KV label="Verified" value={dt(selected.verifiedDate)} />
                <KV label="Method" value={selected.verificationMethod} />
                <KV label="Status" value={selected.status} />
                <KV label="Overdue" value={selected.daysOverdue > 0 ? `${selected.daysOverdue} days` : '—'} />
                <KV label="Remarks" value={selected.remarks} />
              </div>
            )},
            { key: 'rem', label: 'Reminder history (Communication Hub)', content: reminders.data?.items.length ? (
              <ul className="space-y-1 text-xs">
                {reminders.data.items.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <span>{r.eventCode ?? '—'} · {r.channel ?? '—'}</span>
                    <span className="text-muted-foreground">{dt(r.createdAt)} · {r.status ?? '—'}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-xs text-muted-foreground">No reminder communications found for this award.</div>
            )},
            { key: 'pi', label: 'Payment impact', content: c ? (
              <div>
                <KV label="State" value={c.paymentImpact} />
                <KV label="Explanation" value={c.explanation} />
              </div>
            ) : null },
          ] : []}
          actions={
            <>
              <Button asChild size="sm" variant="outline">
                <Link to={`/bn/life-certificates?awardId=${awardId}`}>Open Life Certificate Centre</Link>
              </Button>
              <Button size="sm" variant="outline" disabled title="Verify command not enabled">Verify</Button>
              <Button size="sm" variant="outline" disabled title="Reminder command not enabled">Send reminder</Button>
            </>
          }
        />
      </CardContent>
    </Card>
  );
};

export default AwardLifeCertificatesTab;
