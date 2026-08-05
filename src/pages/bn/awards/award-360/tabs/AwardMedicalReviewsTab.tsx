/**
 * BN-AWARD360-B4A — Medical Reviews operational read-only workspace.
 * Canonical bn_medical_review_schedule mapping, summary metrics, filters,
 * pagination, detail drawer. Sensitive-medical gating masks provider/outcome
 * /remarks when the sensitive view capability is denied. No mutations.
 */
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { AwardStatusBadge, dt, KV } from '../components';
import { Award360DataTable, type Award360Column } from '../components/Award360DataTable';
import { Award360FilterBar } from '../components/Award360FilterBar';
import { Award360MetricCards } from '../components/Award360MetricCards';
import { Award360Pagination } from '../components/Award360Pagination';
import { Award360PermissionState } from '../components/Award360PermissionState';
import { Award360PartialWarning } from '../components/Award360PartialWarning';
import { Award360DetailDrawer } from '../components/Award360DetailDrawer';
import { Award360ActionButton } from '../components/Award360ActionButton';
import { useAwardMedicalReviewsPaged, useAwardMedicalReviewDetail } from '../useAward360Queries';
import { useAward360UrlState, boolParser, boolSerializer } from '../useAward360UrlState';
import type { AwardMedicalReviewItem } from '../viewModels';
import type { AwardActionAvailability } from '@/services/bn/awards/awardActionAvailability';

const STATUSES = ['ALL', 'SCHEDULED', 'PENDING', 'COMPLETED', 'AWAITING_SCHEDULING', 'REFERRED_MEDICAL_BOARD', 'CANCELLED'];
const REVIEW_TYPES = ['ALL', 'INITIAL', 'PERIODIC', 'FOLLOW_UP', 'BOARD', 'AD_HOC'];

export interface MedicalReviewActionSet {
  openWorkspace: AwardActionAvailability;
  schedule: AwardActionAvailability;
  recordOutcome: AwardActionAvailability;
  referBoard: AwardActionAvailability;
}

interface Props {
  awardId: string;
  canView: boolean;
  canViewSensitive: boolean;
  actions: MedicalReviewActionSet;
}

interface TabState extends Record<string, unknown> {
  search: string;
  status: string;
  reviewType: string;
  scheduledFrom: string;
  scheduledTo: string;
  completedFrom: string;
  completedTo: string;
  overdueOnly: boolean;
  page: number;
  pageSize: number;
  sortBy: string;
  sortDir: string;
  selectedId: string;
}

const DEFAULTS: TabState = {
  search: '',
  status: 'ALL',
  reviewType: 'ALL',
  scheduledFrom: '',
  scheduledTo: '',
  completedFrom: '',
  completedTo: '',
  overdueOnly: false,
  page: 1,
  pageSize: 25,
  sortBy: 'scheduledDate',
  sortDir: 'desc',
  selectedId: '',
};

const mask = (v: string | null, allowed: boolean): string | null =>
  allowed ? v : v == null ? null : '••• restricted';

export const AwardMedicalReviewsTab: React.FC<Props> = ({ awardId, canView, canViewSensitive, actions }) => {
  const [state, setState] = useAward360UrlState<TabState>({
    prefix: 'medical',
    defaults: DEFAULTS,
    parsers: {
      page: (v) => Number(v) || 1,
      pageSize: (v) => Number(v) || 25,
      overdueOnly: boolParser,
    },
    serializers: { overdueOnly: boolSerializer },
  });
  const [localSearch, setLocalSearch] = useState(state.search);

  const query = useMemo(
    () => ({
      awardId,
      search: state.search || undefined,
      statuses: state.status !== 'ALL' ? [state.status] : undefined,
      reviewTypes: state.reviewType !== 'ALL' ? [state.reviewType] : undefined,
      scheduledFrom: state.scheduledFrom || undefined,
      scheduledTo: state.scheduledTo || undefined,
      completedFrom: state.completedFrom || undefined,
      completedTo: state.completedTo || undefined,
      overdueOnly: state.overdueOnly,
      page: state.page,
      pageSize: state.pageSize,
      sortBy: state.sortBy,
      sortDirection: state.sortDir as 'asc' | 'desc',
    }),
    [awardId, state],
  );

  const q = useAwardMedicalReviewsPaged(query, { canViewSensitive }, canView);
  const detailQ = useAwardMedicalReviewDetail(state.selectedId || null, { canViewSensitive }, canView);

  if (!canView)
    return <Award360PermissionState moduleLabel="Medical reviews" permissionKey="bn_medical_reviews.view" />;

  const s = q.data?.summary;
  const metrics = s
    ? [
        { key: 'total', label: 'Total', value: s.totalRows },
        { key: 'sched', label: 'Scheduled', value: s.scheduled },
        { key: 'over', label: 'Overdue', value: s.overdue, tone: s.overdue > 0 ? ('breach' as const) : undefined },
        { key: 'comp', label: 'Completed', value: s.completed, tone: 'ok' as const },
        { key: 'brd', label: 'Referred to Board', value: s.referredMedicalBoard },
        { key: 'awt', label: 'Awaiting scheduling', value: s.awaitingScheduling, tone: s.awaitingScheduling > 0 ? ('warn' as const) : undefined },
        { key: 'can', label: 'Cancelled', value: s.cancelled },
      ]
    : [];

  const columns: Award360Column<AwardMedicalReviewItem>[] = [
    {
      key: 'reviewType',
      label: 'Type',
      sortAccessor: (r) => r.reviewType,
      render: (r) => r.reviewType ?? '—',
    },
    {
      key: 'scheduledDate',
      label: 'Scheduled',
      sortAccessor: (r) => r.scheduledDate,
      render: (r) => (
        <span className={r.isOverdue ? 'font-medium text-red-600' : undefined}>
          {dt(r.scheduledDate)}
          {r.isOverdue ? <span className="ml-1 text-[10px] uppercase">overdue</span> : null}
        </span>
      ),
    },
    { key: 'provider', label: 'Provider', render: (r) => mask(r.provider, canViewSensitive) ?? '—' },
    {
      key: 'status',
      label: 'Status',
      sortAccessor: (r) => r.status,
      render: (r) => <AwardStatusBadge status={r.status} tone={r.isOverdue ? 'warn' : 'default'} />,
    },
    { key: 'completedDate', label: 'Completed', sortAccessor: (r) => r.completedDate, render: (r) => dt(r.completedDate) },
    {
      key: 'outcome',
      label: 'Outcome',
      render: (r) => mask(r.outcome, canViewSensitive) ?? '—',
    },
    { key: 'nextReviewDate', label: 'Next review', render: (r) => dt(r.nextReviewDate) },
  ];

  const reset = () => {
    setState({
      search: '',
      status: 'ALL',
      reviewType: 'ALL',
      scheduledFrom: '',
      scheduledTo: '',
      completedFrom: '',
      completedTo: '',
      overdueOnly: false,
      page: 1,
    });
    setLocalSearch('');
  };

  const selected = detailQ.data?.row ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Medical reviews</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Award360MetricCards metrics={metrics as any} />
        {!canViewSensitive ? (
          <div className="rounded-md border border-yellow-500/60 bg-yellow-500/10 p-2 text-xs text-muted-foreground">
            Sensitive medical fields (provider, outcome, remarks) are masked based on your effective permissions.
          </div>
        ) : null}
        {q.data?.warnings?.length ? <Award360PartialWarning warnings={q.data.warnings} /> : null}
        <Award360FilterBar
          search={localSearch}
          onSearch={(v) => {
            setLocalSearch(v);
            setState({ search: v, page: 1 });
          }}
          searchPlaceholder="Review type, provider or status"
          filters={[
            {
              kind: 'select',
              key: 'st',
              label: 'Status',
              value: state.status,
              onChange: (v) => setState({ status: v, page: 1 }),
              options: STATUSES.map((v) => ({ value: v, label: v })),
            },
            {
              kind: 'select',
              key: 'ty',
              label: 'Type',
              value: state.reviewType,
              onChange: (v) => setState({ reviewType: v, page: 1 }),
              options: REVIEW_TYPES.map((v) => ({ value: v, label: v })),
            },
            { kind: 'date', key: 'sf', label: 'Scheduled from', value: state.scheduledFrom || undefined, onChange: (v) => setState({ scheduledFrom: v ?? '', page: 1 }) },
            { kind: 'date', key: 'sto', label: 'Scheduled to', value: state.scheduledTo || undefined, onChange: (v) => setState({ scheduledTo: v ?? '', page: 1 }) },
            { kind: 'date', key: 'cf', label: 'Completed from', value: state.completedFrom || undefined, onChange: (v) => setState({ completedFrom: v ?? '', page: 1 }) },
            { kind: 'date', key: 'ct', label: 'Completed to', value: state.completedTo || undefined, onChange: (v) => setState({ completedTo: v ?? '', page: 1 }) },
            { kind: 'toggle', key: 'od', label: 'Overdue only', value: state.overdueOnly, onChange: (v) => setState({ overdueOnly: v, page: 1 }) },
          ]}
          onReset={reset}
        />
        <Award360DataTable
          rows={q.data?.rows ?? []}
          columns={columns}
          isLoading={q.isLoading}
          error={q.error}
          onRetry={() => q.refetch()}
          emptyTitle="No medical reviews match the current filters"
          getRowKey={(r) => r.id}
          onRowClick={(r) => setState({ selectedId: r.id })}
          sortBy={state.sortBy}
          sortDirection={state.sortDir as 'asc' | 'desc'}
          onSortChange={(k, d) => setState({ sortBy: k, sortDir: d })}
        />
        {q.data ? (
          <Award360Pagination
            page={state.page}
            pageSize={state.pageSize}
            total={q.data.total}
            onPage={(p) => setState({ page: p })}
            onPageSize={(sz) => setState({ pageSize: sz, page: 1 })}
          />
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Award360ActionButton availability={actions.openWorkspace} label="Open Medical Review Scheduler" />
          <Award360ActionButton availability={actions.schedule} label="Schedule Review" />
          <Award360ActionButton availability={actions.recordOutcome} label="Record Outcome" />
          <Award360ActionButton availability={actions.referBoard} label="Refer to Medical Board" />
          {/* BN-MR-UI: deep link into the canonical Medical Review Centre, scoped
              to this award. Navigation only — no capability is granted here. */}
          <Link to={`/bn/medical-reviews?awardId=${encodeURIComponent(awardId)}`}>
            <Button variant="outline" size="sm" data-testid="award360-open-medical-review-centre">
              Open Medical Review Centre
              <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>


        <Award360DetailDrawer
          open={!!state.selectedId}
          onOpenChange={(v) => {
            if (!v) setState({ selectedId: '' });
          }}
          title={selected?.reviewType ?? 'Medical review'}
          subtitle={selected?.scheduledDate ? `Scheduled ${dt(selected.scheduledDate)}` : undefined}
          status={selected?.status ?? null}
          statusTone={selected?.isOverdue ? 'warn' : 'default'}
          sections={
            selected
              ? [
                  {
                    key: 'sched',
                    label: 'Scheduling',
                    content: (
                      <div>
                        <KV label="Review type" value={selected.reviewType} />
                        <KV label="Scheduled" value={dt(selected.scheduledDate)} />
                        <KV label="Overdue" value={selected.isOverdue ? 'Yes' : 'No'} />
                        <KV label="Next review" value={dt(selected.nextReviewDate)} />
                        <KV label="Status" value={selected.status} />
                      </div>
                    ),
                  },
                  {
                    key: 'clin',
                    label: 'Clinical',
                    content: (
                      <div>
                        <KV label="Provider" value={mask(selected.provider, canViewSensitive)} />
                        <KV label="Completed" value={dt(selected.completedDate)} />
                        <KV label="Outcome" value={mask(selected.outcome, canViewSensitive)} />
                        <KV label="Remarks" value={mask(selected.remarks, canViewSensitive)} />
                        {!canViewSensitive ? (
                          <div className="mt-2 text-xs text-muted-foreground">
                            Sensitive medical fields are hidden. Use the Medical Review Scheduler with the appropriate permission to view them.
                          </div>
                        ) : null}
                      </div>
                    ),
                  },
                  {
                    key: 'audit',
                    label: 'Audit',
                    content: (
                      <div>
                        <KV label="Entered by" value={selected.enteredBy} />
                        <KV label="Entered at" value={dt(selected.enteredAt)} />
                        <KV label="Modified by" value={selected.modifiedBy} />
                        <KV label="Modified at" value={dt(selected.modifiedAt)} />
                      </div>
                    ),
                  },
                  ...(detailQ.data?.warnings?.length
                    ? [{ key: 'warn', label: 'Warnings', content: <Award360PartialWarning warnings={detailQ.data.warnings} /> }]
                    : []),
                ]
              : []
          }
          actions={
            <>
              <Award360ActionButton availability={actions.openWorkspace} label="Open in Scheduler" />
              <Award360ActionButton availability={actions.schedule} label="Schedule" />
              <Award360ActionButton availability={actions.recordOutcome} label="Record Outcome" />
              <Award360ActionButton availability={actions.referBoard} label="Refer to Board" />
            </>
          }
        />
      </CardContent>
    </Card>
  );
};

export default AwardMedicalReviewsTab;
