/**
 * Installments Due — installments coming due or overdue across active arrangements.
 * Officer can record a payment from this list (PermissionButton manage_compliance/edit).
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Calendar, Loader2, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { recordInstallmentPayment } from '@/services/arrangementWorkflowService';
import { useUserCode } from '@/hooks/useUserCode';
import { isComplianceFeatureEnabled } from '@/lib/compliance/featureToggles';

const MODULE = 'manage_compliance';

export default function InstallmentsDuePage() {
  const enabled = isComplianceFeatureEnabled('arrangements.installmentsDue');
  const qc = useQueryClient();
  const { userCode } = useUserCode();
  const [payDialog, setPayDialog] = useState<any>(null);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['ce_installments_due_operational'],
    enabled,
    queryFn: () => fetchInstallmentsDue(30),
  });


  const payMut = useMutation({
    mutationFn: () => recordInstallmentPayment({
      installmentId: payDialog.id,
      amount: Number(amount),
      paymentReference: reference,
      userCode: userCode || 'system',
    }),
    onSuccess: () => {
      toast.success('Payment recorded');
      qc.invalidateQueries({ queryKey: ['ce_installments_due'] });
      setPayDialog(null); setAmount(''); setReference('');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <PermissionWrapper moduleName={MODULE}>
      <div className="container mx-auto p-6 space-y-4">
        <PageHeader title="Installments Due" subtitle="Installments coming due in the next 30 days or overdue." />
        {!enabled ? (
          <Card><CardContent className="py-10 text-center text-muted-foreground">Disabled in feature toggles.</CardContent></Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-12 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Due</TableHead>
                      <TableHead>Arrangement</TableHead>
                      <TableHead>Employer</TableHead>
                      <TableHead>#</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.length === 0 && (
                      <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No installments due in horizon.</TableCell></TableRow>
                    )}
                    {rows.map((r) => (
                      <TableRow key={r.installment_id} className={r.effective_status === 'OVERDUE' ? 'bg-destructive/5' : ''}>
                        <TableCell className="text-xs whitespace-nowrap">
                          {r.due_date ? formatDateForDisplay(r.due_date) : '—'}
                          {r.days_overdue > 0 && (
                            <span className="block text-destructive">{r.days_overdue}d overdue</span>
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{r.arrangement_number}</TableCell>
                        <TableCell>{r.employer_name || r.employer_id}</TableCell>
                        <TableCell>{r.installment_number}</TableCell>
                        <TableCell className="text-right">{formatXCD(r.scheduled_amount)}</TableCell>
                        <TableCell className="text-right">{formatXCD(r.paid_amount)}</TableCell>
                        <TableCell><InstallmentStatusBadge status={r.effective_status} /></TableCell>
                        <TableCell>
                          <PermissionButton moduleName={MODULE} actionName="edit" size="sm" variant="outline"
                            onClick={() => {
                              setPayDialog(r);
                              setAmount(String(Number(r.outstanding_amount ?? 0)));
                            }}>
                            <Receipt className="h-4 w-4 mr-1" /> Record
                          </PermissionButton>
                        </TableCell>
                      </TableRow>
                    ))}

                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}

        <Dialog open={!!payDialog} onOpenChange={(o) => !o && setPayDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Record Installment Payment</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {payDialog?.ce_payment_arrangements?.arrangement_number} — Installment #{payDialog?.installment_number}
              </p>
              <div>
                <Label>Amount *</Label>
                <Input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
              </div>
              <div>
                <Label>Reference</Label>
                <Input value={reference} onChange={e => setReference(e.target.value)} placeholder="Receipt or bank reference" />
              </div>
            </div>
            <DialogFooter>
              <PermissionButton moduleName={MODULE} actionName="edit" disabled={!amount || payMut.isPending} onClick={() => payMut.mutate()}>
                Save
              </PermissionButton>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </PermissionWrapper>
  );
}
