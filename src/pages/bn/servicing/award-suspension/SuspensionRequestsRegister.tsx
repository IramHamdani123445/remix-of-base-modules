import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, Loader2, Eye, FileText } from 'lucide-react';
import type { SuspensionRequestListItem } from '@/services/bn/awardSuspensionViewService';
import { SuspensionStatusBadge } from './SuspensionStatusBadge';
import { formatDate, formatDateTime, slaTone } from './suspensionViewModels';

interface Props {
  rows: SuspensionRequestListItem[];
  loading: boolean;
  onView: (requestId: string) => void;
  statusFilter?: string;
  onStatusFilterChange?: (v: string) => void;
  title?: string;
  emptyLabel?: string;
}

const STATUS_VALUES = [
  'PROPOSED',
  'PENDING_APPROVAL',
  'PENDING_LEVEL_1',
  'PENDING_LEVEL_2',
  'PENDING_LEVEL_N',
  'APPROVED',
  'APPLIED',
  'REJECTED',
  'WITHDRAWN',
  'CANCELLED',
] as const;

export function SuspensionRequestsRegister({
  rows,
  loading,
  onView,
  statusFilter = 'all',
  onStatusFilterChange,
  title,
  emptyLabel = 'No suspension requests match the current filters.',
}: Props) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      // BN-SUSP-REG — the register lists suspension cases only. Linked
      // reinstatement cases are reached from the suspension they belong to.
      if (r.caseKind === 'REINSTATEMENT') return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        r.requestId.toLowerCase().includes(q) ||
        (r.awardNumber ?? '').toLowerCase().includes(q) ||
        r.claimantName.toLowerCase().includes(q) ||
        (r.reasonCode ?? '').toLowerCase().includes(q)
      );
    });
  }, [rows, search, statusFilter]);

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        {title && <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
              aria-hidden
            />
            <Input
              placeholder="Search request, award, claimant, reason…"
              className="pl-9 h-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search requests"
            />
          </div>
          <Select
            value={statusFilter}
            onValueChange={(v) => onStatusFilterChange?.(v)}
          >
            <SelectTrigger className="h-9 w-[200px]" aria-label="Status filter">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUS_VALUES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-md border overflow-hidden">
          <div className="max-h-[560px] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead>Request</TableHead>
                  <TableHead>Award #</TableHead>
                  <TableHead>Claimant</TableHead>
                  <TableHead>Benefit</TableHead>
                  <TableHead>Requested effective</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Workbasket</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Proposed</TableHead>
                  <TableHead>Age (d)</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={13} className="py-10 text-center">
                      <Loader2 className="h-4 w-4 animate-spin inline mr-2" aria-hidden />
                      Loading requests…
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={13} className="py-10 text-center text-muted-foreground">
                      <FileText className="h-6 w-6 mx-auto mb-2 opacity-60" aria-hidden />
                      {emptyLabel}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((r) => {
                    const tone = slaTone(r.ageDays);
                    return (
                      <TableRow key={r.requestId} className="hover:bg-muted/40">
                        <TableCell className="font-mono text-[11px]">
                          {r.requestId.slice(0, 8)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {r.awardNumber ?? r.awardId.slice(0, 8)}
                        </TableCell>
                        <TableCell className="font-medium">{r.claimantName}</TableCell>
                        <TableCell>{r.benefitCode ?? '—'}</TableCell>
                        <TableCell className="text-xs">
                          {formatDate(r.requestedEffectiveDate)}
                        </TableCell>
                        <TableCell className="text-xs">{r.reasonCode ?? '—'}</TableCell>
                        <TableCell>
                          <SuspensionStatusBadge status={r.status} />
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.currentApprovalLevel != null
                            ? `L${r.currentApprovalLevel}${
                                r.totalApprovalLevels ? ` / ${r.totalApprovalLevels}` : ''
                              }`
                            : '—'}
                        </TableCell>
                        <TableCell className="text-xs">{r.assignedWorkbasketCode ?? '—'}</TableCell>
                        <TableCell className="text-xs">
                          {r.directTaskOwner ?? r.assignedRole ?? '—'}
                        </TableCell>
                        <TableCell className="text-xs">{formatDateTime(r.proposedAt)}</TableCell>
                        <TableCell>
                          <span
                            className={
                              tone === 'breach'
                                ? 'text-destructive font-semibold'
                                : tone === 'warn'
                                  ? 'text-amber-700 dark:text-amber-300 font-medium'
                                  : 'text-muted-foreground'
                            }
                          >
                            {r.ageDays}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" onClick={() => onView(r.requestId)}>
                            <Eye className="h-3.5 w-3.5 mr-1" aria-hidden />
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
