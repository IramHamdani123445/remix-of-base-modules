/**
 * Enhanced Benefit Work Queue — Operational dashboard with stats + filters
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, ClipboardList, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useBnClaims } from '@/hooks/bn/useBnClaim';
import { BN_CLAIM_STATUS_LABELS } from '@/types/bn';
import type { BnClaim } from '@/types/bn';
import { formatDateForDisplay } from '@/lib/format-config';
import { PermissionWrapper } from '@/components/ui/permission-wrapper';
import { BnStatusBadge, BnStatCard } from '@/components/bn/shared';
import { BNDataGrid, type BNColumnDef } from '@/components/bn/grid';

export default function ClaimWorklist() {
  const navigate = useNavigate();
  const { data: claims = [], isLoading, refetch } = useBnClaims();

  const stats = useMemo(() => {
    const all = claims as BnClaim[];
    return {
      total: all.length,
      pending: all.filter(c => ['SUBMITTED', 'INTAKE_REVIEW', 'ELIGIBILITY_CHECK', 'EVIDENCE_REVIEW', 'CALCULATION', 'DECISION'].includes(c.status)).length,
      urgent: all.filter(c => c.priority === 'URGENT' || c.priority === 'HIGH').length,
      approved: all.filter(c => c.status === 'APPROVED').length,
    };
  }, [claims]);

  const columns: BNColumnDef<BnClaim>[] = [
    { accessorKey: 'claim_number', header: 'Claim #', meta: { label: 'Claim #', pinLeft: true, width: 140 },
      cell: ({ getValue }) => <span className="font-mono text-sm font-medium">{String(getValue() ?? '—')}</span> },
    { accessorKey: 'ssn', header: 'SSN', meta: { label: 'SSN', width: 110 },
      cell: ({ getValue }) => <span className="font-mono text-sm">{String(getValue() ?? '')}</span> },
    { id: 'benefit', header: 'Benefit', meta: { label: 'Benefit', width: 200 },
      accessorFn: (c: any) => c.bn_product?.benefit_name ?? '—' },
    { accessorKey: 'claim_date', header: 'Filed', meta: { label: 'Filed', width: 120 },
      cell: ({ getValue }) => formatDateForDisplay(String(getValue() ?? '')) },
    { accessorKey: 'priority', header: 'Priority', meta: { label: 'Priority', width: 110 },
      cell: ({ getValue }) => <BnStatusBadge status={String(getValue() ?? '')} size="sm" dot /> },
    { accessorKey: 'status', header: 'Status', meta: { label: 'Status', width: 160 },
      cell: ({ getValue }) => {
        const s = String(getValue() ?? '');
        return <BnStatusBadge status={s} label={BN_CLAIM_STATUS_LABELS[s as keyof typeof BN_CLAIM_STATUS_LABELS] || s} size="sm" />;
      } },
    { accessorKey: 'assigned_to', header: 'Assigned', meta: { label: 'Assigned', width: 140 },
      cell: ({ getValue }) => <span className="text-sm text-muted-foreground">{String(getValue() ?? '—')}</span> },
  ];

  return (
    <PermissionWrapper moduleName="bn_claim_worklist">
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="t-page-title">Benefit Work Queue</h1>
            <p className="t-page-subtitle mt-1">Process and manage benefit claims across all products</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <BnStatCard title="Total Claims" value={stats.total} icon={ClipboardList} />
          <BnStatCard title="In Progress" value={stats.pending} icon={Clock} subtitle="Awaiting processing" />
          <BnStatCard title="High Priority" value={stats.urgent} icon={AlertTriangle} />
          <BnStatCard title="Approved" value={stats.approved} icon={CheckCircle2} />
        </div>

        <BNDataGrid
          id="bn.claim-worklist"
          data={claims as BnClaim[]}
          isLoading={isLoading}
          columns={columns}
          searchPlaceholder="Search claim # or SSN..."
          onCreate={() => navigate('/bn/intake/register')}
          onRefresh={() => refetch()}
          onRowClick={(c) => navigate(`/bn/claims/${c.id}`)}
          defaultSort={[{ id: 'claim_date', desc: true }]}
          exportFilename="bn_claims"
          emptyMessage="No claims yet"
          rowActions={[
            { key: 'view', label: 'Open', icon: <Eye className="h-3.5 w-3.5" />, onClick: (c) => navigate(`/bn/claims/${c.id}`) },
          ]}
        />
      </div>
    </PermissionWrapper>
  );
}
