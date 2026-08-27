/**
 * Payment Allocation — allocate an external payment against an employer's
 * active arrangement installments in a configurable priority order.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/shared/PageHeader';
import { PermissionWrapper } from '@/components/ui/permission-wrapper';
import { PermissionButton } from '@/components/ui/permission-button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DollarSign, Loader2, ArrowDown, ArrowUp } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { allocatePayment, DEFAULT_ALLOCATION_ORDER, type AllocationTarget } from '@/services/arrangementWorkflowService';
import { useUserCode } from '@/hooks/useUserCode';
import { isComplianceFeatureEnabled } from '@/lib/compliance/featureToggles';
import { fetchAllocationTrail } from '@/services/compliance/arrangementRegisterService';
import { formatXCD } from '@/components/compliance/arrangements/arrangementFormat';
import { formatDateForDisplay } from '@/lib/format-config';

const MODULE = 'manage_compliance';

export default function PaymentAllocationPage() {
  const enabled = isComplianceFeatureEnabled('arrangements.paymentAllocation');
  const qc = useQueryClient();
  const { userCode } = useUserCode();
  const [employerId, setEmployerId] = useState('');
  const [sourcePaymentId, setSourcePaymentId] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [order, setOrder] = useState<AllocationTarget[]>(DEFAULT_ALLOCATION_ORDER);

  const { data: recent = [], isLoading } = useQuery({
    queryKey: ['ce_payment_allocations_recent', employerId],
    queryFn: async () => {
      let q = supabase.from('ce_payment_allocations').select('*').order('allocated_at', { ascending: false }).limit(100);
      if (employerId) q = q.eq('employer_id', employerId);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  // Canonical allocation trail (payment -> installment -> covered liability).
  const { data: trail = [] } = useQuery({
    queryKey: ['ce_v_arrangement_allocation_trail_all'],
    queryFn: () => fetchAllocationTrail(),
  });
  const scopedTrail = employerId
    ? trail.filter((t) => t.employer_id === employerId)
    : trail;

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...order];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setOrder(next);
  };

  const allocMut = useMutation({
    mutationFn: () => allocatePayment({
      sourcePaymentId: Number(sourcePaymentId),
      employerId, totalAmount: Number(amount),
      order, notes, userCode: userCode || 'system',
    }),
    onSuccess: ({ allocations, remaining }) => {
      toast.success(`Allocated ${allocations.length} entries. Remaining: ${remaining.toFixed(2)}`);
      qc.invalidateQueries({ queryKey: ['ce_payment_allocations_recent'] });
      qc.invalidateQueries({ queryKey: ['ce_installments_due'] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <PermissionWrapper moduleName={MODULE}>
      <div className="container mx-auto p-6 space-y-4">
        <PageHeader title="Payment Allocation" subtitle="Allocate received payments to arrangement installments in a configurable order." />
        {!enabled ? (
          <Card><CardContent className="py-10 text-center text-muted-foreground">Disabled in feature toggles.</CardContent></Card>
        ) : (
          <>
            <Card>
              <CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div>
                    <Label>Employer ID *</Label>
                    <Input value={employerId} onChange={e => setEmployerId(e.target.value)} />
                  </div>
                  <div>
                    <Label>Source Payment ID (cn_payment.payment_id) *</Label>
                    <Input value={sourcePaymentId} onChange={e => setSourcePaymentId(e.target.value)} placeholder="numeric" />
                  </div>
                  <div>
                    <Label>Amount *</Label>
                    <Input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
                  </div>
                  <div>
                    <Label>Notes</Label>
                    <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
                  </div>
                  <PermissionButton moduleName={MODULE} actionName="create" onClick={() => allocMut.mutate()}
                    disabled={!employerId || !sourcePaymentId || !amount || allocMut.isPending}>
                    Allocate Payment
                  </PermissionButton>
                </div>
                <div>
                  <Label>Allocation Priority</Label>
                  <ul className="mt-1 border rounded-md divide-y">
                    {order.map((t, i) => (
                      <li key={t} className="flex items-center justify-between px-3 py-2 text-sm">
                        <span className="font-medium">{i + 1}. {t.replace('_', ' ')}</span>
                        <div className="flex gap-1">
                          <button className="p-1 hover:bg-accent rounded" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="h-3.5 w-3.5" /></button>
                          <button className="p-1 hover:bg-accent rounded" onClick={() => move(i, 1)} disabled={i === order.length - 1}><ArrowDown className="h-3.5 w-3.5" /></button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground mt-2">Order: principal, penalty, interest, legal fee, oldest balance — reorder as needed for this allocation.</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="p-12 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Employer</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Target</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Mode</TableHead>
                        <TableHead>By</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recent.length === 0 && (
                        <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No allocations recorded.</TableCell></TableRow>
                      )}
                      {recent.map((a: any) => (
                        <TableRow key={a.id}>
                          <TableCell className="text-xs">{new Date(a.allocated_at).toLocaleString('en-GB')}</TableCell>
                          <TableCell>{a.employer_id}</TableCell>
                          <TableCell className="text-xs">{a.source_table} #{a.source_payment_id}</TableCell>
                          <TableCell><Badge variant="outline">{a.target_type}</Badge></TableCell>
                          <TableCell className="text-right">{Number(a.allocated_amount).toLocaleString('en-US', { style: 'currency', currency: 'XCD' })}</TableCell>
                          <TableCell className="text-xs">{a.allocation_mode}</TableCell>
                          <TableCell className="text-xs">{a.allocated_by}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-0">
                <div className="px-4 py-3 border-b text-sm font-semibold">
                  Canonical allocation trail ({scopedTrail.length})
                </div>
                {scopedTrail.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    No canonical allocations recorded yet. Entries appear once a ledger payment is
                    reconciled to an arrangement installment.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Payment date</TableHead>
                        <TableHead>Employer</TableHead>
                        <TableHead>Arrangement</TableHead>
                        <TableHead className="text-center">Installment</TableHead>
                        <TableHead>Covered liability</TableHead>
                        <TableHead className="text-right">Allocated</TableHead>
                        <TableHead>State</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {scopedTrail.slice(0, 200).map((t) => (
                        <TableRow key={t.allocation_id}>
                          <TableCell className="text-xs whitespace-nowrap">
                            {t.payment_date ? formatDateForDisplay(t.payment_date) : '—'}
                          </TableCell>
                          <TableCell className="text-xs">{t.employer_name || t.employer_id}</TableCell>
                          <TableCell className="text-xs font-medium">{t.arrangement_number}</TableCell>
                          <TableCell className="text-center text-xs">{t.installment_number ?? '—'}</TableCell>
                          <TableCell className="text-xs">
                            {t.is_unattributed ? 'Not attributable' : (t.liability_type || '—')}
                            {t.source_reference_no && (
                              <span className="block font-mono text-muted-foreground">{t.source_reference_no}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-xs font-medium">{formatXCD(t.allocation_amount)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">
                              {t.is_reversed ? 'Reversed' : t.is_unattributed ? 'Unattributed' : 'Allocated'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </PermissionWrapper>
  );
}
