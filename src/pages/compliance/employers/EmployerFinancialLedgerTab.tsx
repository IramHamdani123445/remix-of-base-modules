import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, Search, ShieldCheck, ShieldAlert, ArrowLeftRight } from 'lucide-react';
import {
  useEmployerLedgerPage,
  useEmployerLedgerSummary,
  useLedgerEntryDetail,
  useEmployerLedgerReconciliation,
} from '@/hooks/useEmployerLedgerPassbook';
import type { LedgerPageRow } from '@/services/compliance/employerLedgerService';

const PAGE_SIZE = 25;

const FUND_TYPES = ['SS', 'LEVY', 'EI'];
const ENTRY_TYPES = [
  'C3_DUES_POSTED', 'PAYMENT_RECEIVED', 'PENALTY_ASSESSED', 'INTEREST_ACCRUED',
  'WAIVER_APPLIED', 'ADJUSTMENT', 'REVERSAL', 'WRITE_OFF', 'ARRANGEMENT_CREDIT',
  'REFUND', 'OPENING_BALANCE', 'TRANSFER_IN',
];

const money = (n: number | null | undefined) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'XCD', minimumFractionDigits: 2 })
    .format(Number(n ?? 0));

const dateOnly = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : '—');

const entryTone = (type: string) => {
  if (['C3_DUES_POSTED', 'PENALTY_ASSESSED', 'INTEREST_ACCRUED', 'OPENING_BALANCE'].includes(type)) return 'destructive' as const;
  if (['PAYMENT_RECEIVED', 'WAIVER_APPLIED', 'ARRANGEMENT_CREDIT', 'WRITE_OFF'].includes(type)) return 'default' as const;
  if (type === 'REVERSAL') return 'secondary' as const;
  return 'outline' as const;
};

interface Props {
  employerId: string;
}

export default function EmployerFinancialLedgerTab({ employerId }: Props) {
  const [fund, setFund] = useState('all');
  const [entryType, setEntryType] = useState('all');
  const [direction, setDirection] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [reference, setReference] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(0);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  const filters = useMemo(() => ({
    employerId,
    fundType: fund,
    entryType,
    direction: direction as 'DEBIT' | 'CREDIT' | 'all',
    fromDate: fromDate || null,
    toDate: toDate || null,
    reference: searchTerm || null,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  }), [employerId, fund, entryType, direction, fromDate, toDate, searchTerm, page]);

  const { data, isLoading } = useEmployerLedgerPage(filters as any);
  const { data: summary } = useEmployerLedgerSummary({
    employerId, fromDate: fromDate || null, toDate: toDate || null, fundType: fund,
  });
  const { data: reconciliation } = useEmployerLedgerReconciliation(employerId);
  const { data: detail, isLoading: detailLoading } = useLedgerEntryDetail(selectedEntryId);

  const rows: LedgerPageRow[] = data?.rows ?? [];
  const totalCount = data?.totalCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const applySearch = () => { setSearchTerm(reference); setPage(0); };
  const resetFilters = () => {
    setFund('all'); setEntryType('all'); setDirection('all');
    setFromDate(''); setToDate(''); setReference(''); setSearchTerm(''); setPage(0);
  };

  return (
    <div className="space-y-4">
      {/* Position summary */}
      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        {[
          { label: 'Opening', value: money(summary?.opening_balance) },
          { label: 'Debits', value: money(summary?.total_debits) },
          { label: 'Credits', value: money(summary?.total_credits) },
          { label: 'Closing', value: money(summary?.closing_balance) },
          { label: 'Unallocated Credit', value: money(summary?.unallocated_credit) },
          { label: 'Under Arrangement', value: money(summary?.amount_under_arrangement) },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="p-3 text-center">
              <div className="text-[11px] text-muted-foreground mb-1">{kpi.label}</div>
              <div className="text-sm font-bold">{kpi.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Fund position + reconciliation */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-3">
          <CardTitle className="text-sm">Position by Fund</CardTitle>
          {reconciliation && (
            <Badge variant={reconciliation.reconciled ? 'default' : 'destructive'} className="gap-1">
              {reconciliation.reconciled
                ? <><ShieldCheck className="h-3.5 w-3.5" />Reconciled</>
                : <><ShieldAlert className="h-3.5 w-3.5" />Variance detected</>}
            </Badge>
          )}
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {(summary?.by_fund ?? []).map((f) => (
            <div key={f.fund} className="rounded-md border p-3 text-sm">
              <div className="flex justify-between font-medium"><span>{f.fund}</span><span>{money(f.balance)}</span></div>
              <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                <span>Dr {money(f.debits)}</span><span>Cr {money(f.credits)}</span>
              </div>
            </div>
          ))}
          {(summary?.by_fund ?? []).length === 0 && (
            <div className="text-sm text-muted-foreground">No ledger activity recorded.</div>
          )}
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-3 lg:grid-cols-6">
          <div className="space-y-1">
            <Label className="text-xs">Fund</Label>
            <Select value={fund} onValueChange={(v) => { setFund(v); setPage(0); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All funds</SelectItem>
                {FUND_TYPES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Entry type</Label>
            <Select value={entryType} onValueChange={(v) => { setEntryType(v); setPage(0); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {ENTRY_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Direction</Label>
            <Select value={direction} onValueChange={(v) => { setDirection(v); setPage(0); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Debits & credits</SelectItem>
                <SelectItem value="DEBIT">Debits only</SelectItem>
                <SelectItem value="CREDIT">Credits only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">From date</Label>
            <Input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(0); }} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To date</Label>
            <Input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(0); }} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Reference</Label>
            <div className="flex gap-1">
              <Input
                value={reference}
                placeholder="Receipt / description"
                onChange={(e) => setReference(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') applySearch(); }}
              />
              <Button size="icon" variant="outline" onClick={applySearch} aria-label="Search ledger">
                <Search className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="md:col-span-3 lg:col-span-6">
            <Button size="sm" variant="ghost" onClick={resetFilters}>Reset filters</Button>
          </div>
        </CardContent>
      </Card>

      {/* Passbook */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">Passbook — {totalCount} entries</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />Loading ledger…
            </div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No ledger entries match the current filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Fund</TableHead>
                    <TableHead>Entry</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow
                      key={r.entry_id}
                      className="cursor-pointer"
                      onClick={() => setSelectedEntryId(r.entry_id)}
                    >
                      <TableCell className="whitespace-nowrap text-xs">
                        {dateOnly(r.effective_date ?? r.posted_at)}
                      </TableCell>
                      <TableCell className="text-xs font-mono">{r.period || '—'}</TableCell>
                      <TableCell className="text-xs">{r.fund_type}</TableCell>
                      <TableCell>
                        <Badge variant={entryTone(r.entry_type)} className="text-[10px]">
                          {r.entry_type.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[260px] truncate text-xs">{r.description || '—'}</TableCell>
                      <TableCell className="text-right text-xs">{r.debit_amount ? money(r.debit_amount) : '—'}</TableCell>
                      <TableCell className="text-right text-xs">{r.credit_amount ? money(r.credit_amount) : '—'}</TableCell>
                      <TableCell className="text-right text-xs font-medium">{money(r.running_balance_fund)}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === 'REVERSED' ? 'destructive' : 'outline'} className="text-[10px]">
                          {r.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Page {page + 1} of {pageCount}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button size="sm" variant="outline" disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Drill-down */}
      <Dialog open={!!selectedEntryId} onOpenChange={(open) => !open && setSelectedEntryId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Ledger entry</DialogTitle>
            <DialogDescription>Immutable record — corrections are made through reversal entries.</DialogDescription>
          </DialogHeader>
          {detailLoading || !detail ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />Loading…
            </div>
          ) : (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-2">
                {[
                  ['Entry type', String(detail.entry?.entry_type ?? '—').replace(/_/g, ' ')],
                  ['Fund', detail.entry?.fund_type ?? '—'],
                  ['Period', detail.entry?.period ?? '—'],
                  ['Effective date', dateOnly(detail.entry?.effective_date ?? detail.entry?.posted_at)],
                  ['Debit', money(detail.entry?.debit_amount)],
                  ['Credit', money(detail.entry?.credit_amount)],
                  ['Status', detail.entry?.status ?? '—'],
                  ['Posted by', detail.entry?.posted_by ?? '—'],
                  ['Source', detail.entry?.source_system ?? detail.entry?.reference_type ?? '—'],
                  ['Reference', detail.entry?.payment_reference ?? detail.entry?.source_pk ?? detail.entry?.reference_id ?? '—'],
                ].map(([label, value]) => (
                  <div key={String(label)} className="flex justify-between border-b py-1">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium text-right">{String(value)}</span>
                  </div>
                ))}
              </div>

              <div className="text-xs text-muted-foreground">{detail.entry?.description}</div>

              {(detail.original_entry || detail.reversal_entry) && (
                <div className="rounded-md border p-3">
                  <div className="mb-2 flex items-center gap-1 text-xs font-medium">
                    <ArrowLeftRight className="h-3.5 w-3.5" />Reversal linkage
                  </div>
                  {detail.original_entry && (
                    <button
                      className="block text-xs text-primary underline"
                      onClick={() => setSelectedEntryId(detail.original_entry!.id)}
                    >
                      Reverses original entry ({money(detail.original_entry.debit_amount)} Dr / {money(detail.original_entry.credit_amount)} Cr)
                    </button>
                  )}
                  {detail.reversal_entry && (
                    <button
                      className="block text-xs text-primary underline"
                      onClick={() => setSelectedEntryId(detail.reversal_entry!.id)}
                    >
                      Reversed by entry posted {dateOnly(detail.reversal_entry.posted_at)}
                    </button>
                  )}
                  {detail.entry?.reversal_reason && (
                    <div className="mt-1 text-xs text-muted-foreground">Reason: {detail.entry.reversal_reason}</div>
                  )}
                </div>
              )}

              {detail.allocations.length > 0 && (
                <div className="rounded-md border p-3">
                  <div className="mb-2 text-xs font-medium">Allocations ({detail.allocations.length})</div>
                  {detail.allocations.map((a) => (
                    <div key={a.id} className="flex justify-between text-xs">
                      <span>{a.target_type} {a.target_period ?? ''}</span>
                      <span>{money(a.allocated_amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
