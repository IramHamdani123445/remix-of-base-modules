/**
 * Person 360 — Disbursements Tab
 * 
 * Source: cl_cheques (outbound benefit payments), reached through
 * cl_head.insured_ssn — cl_cheques itself is keyed by claim_number and has no
 * ssn column. There is no fallback: a failed read is reported, not answered
 * with bn_payment_instruction rows, which are payables and not disbursements.
 * 
 * IMPORTANT: This tab ONLY shows outbound benefit payments.
 * cn_payment/cn_receipt are NEVER used here — those are for incoming collections.
 * 
 * Status distinction (Issued Payment): ISSUED / CANCELLED / VOID / REISSUED / STALE / HELD
 * Read-only display. Post-issue actions are in the Payment Issue module.
 * Role visibility: Claims Officer, Payments Officer, Supervisor, Admin, Auditor
 */
import React, { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search } from 'lucide-react';
import { formatDateForDisplay } from '@/lib/format-config';
import type { Person360Disbursement } from '@/services/bn/person360Service';

import { formatNumber } from '@/lib/culture/culture';
const paymentStatusColor: Record<string, string> = {
  ISSUED: 'bg-emerald-500/15 text-emerald-700',
  CANCELLED: 'bg-destructive/15 text-destructive',
  VOID: 'bg-destructive/15 text-destructive',
  REISSUED: 'bg-blue-500/15 text-blue-700',
  STALE: 'bg-amber-500/15 text-amber-700',
  HELD: 'bg-amber-500/15 text-amber-700',
};

interface DisbursementsTabProps {
  disbursements: Person360Disbursement[];
  isLoading?: boolean;
}

export const DisbursementsTab: React.FC<DisbursementsTabProps> = ({ disbursements, isLoading }) => {
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    let result = disbursements;
    if (statusFilter !== 'ALL') result = result.filter(d => d.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(d =>
        d.cheque_no.toLowerCase().includes(q) ||
        d.claim_no.toLowerCase().includes(q)
      );
    }
    return result;
  }, [disbursements, statusFilter, search]);

  const totalAmount = filtered.reduce((sum, d) => sum + d.amount, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-end">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by cheque # or claim #..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All</SelectItem>
            {['ISSUED', 'CANCELLED', 'VOID', 'REISSUED', 'STALE', 'HELD'].map(s => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="text-sm font-medium text-muted-foreground whitespace-nowrap">
          Total: <span className="text-foreground font-bold">${formatNumber(totalAmount, 2)}</span>
        </div>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Cheque/Ref #</TableHead>
              <TableHead>Claim #</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Currency</TableHead>
              <TableHead>Payment Date</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>Batch</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No disbursements found</TableCell></TableRow>
            ) : filtered.map(d => (
              <TableRow key={d.cheque_no}>
                <TableCell className="font-mono font-medium">{d.cheque_no}</TableCell>
                <TableCell className="font-mono">{d.claim_no}</TableCell>
                <TableCell className="font-mono font-medium">${d.amount.toFixed(2)}</TableCell>
                <TableCell>{d.currency}</TableCell>
                <TableCell>{formatDateForDisplay(d.payment_date)}</TableCell>
                <TableCell>{d.payment_method}</TableCell>
                <TableCell>
                  {d.period_from && d.period_to
                    ? `${formatDateForDisplay(d.period_from)} – ${formatDateForDisplay(d.period_to)}`
                    : '—'}
                </TableCell>
                <TableCell>{d.batch_no || '—'}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={paymentStatusColor[d.status] || ''}>
                    {d.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">{filtered.length} disbursements shown • Source: cl_cheques (benefit payments only)</p>
    </div>
  );
};
