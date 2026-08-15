/**
 * Medical Expenses Panel — capture reimbursement expense lines for a claim.
 *
 * Only rendered for claims whose active calculation rule is a REIMBURSEMENT
 * type. The captured lines are the authoritative input for the calculation
 * engine's reimbursement branch.
 */
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Plus, Receipt, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { fetchClaimExpenses, upsertClaimExpense, fetchProcedures } from '@/services/bn/medicalService';
import { BnEmptyState } from '@/components/bn/shared/BnEmptyState';

const db = supabase as any;

const JURISDICTIONS = ['LOCAL_ST_KITTS', 'NEVIS', 'CARIBBEAN', 'INTERNATIONAL'];

interface Props {
  claimId: string;
  userCode: string;
}

export const MedicalExpensesPanel: React.FC<Props> = ({ claimId, userCode }) => {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    procedureId: '',
    jurisdiction: 'LOCAL_ST_KITTS',
    claimed: '',
    approved: '',
    provider: '',
    serviceDate: '',
  });

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ['bn', 'claim-medical-expenses', claimId],
    queryFn: () => fetchClaimExpenses(claimId) as Promise<any[]>,
  });

  const { data: procedures = [] } = useQuery({
    queryKey: ['bn', 'medical-procedures'],
    queryFn: () => fetchProcedures() as Promise<any[]>,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['bn', 'claim-medical-expenses', claimId] });
  };

  const addMutation = useMutation({
    mutationFn: async () => {
      const claimed = Number(form.claimed);
      if (!Number.isFinite(claimed) || claimed <= 0) throw new Error('Enter a valid claimed amount.');
      const approvedRaw = form.approved.trim();
      const approved = approvedRaw === '' ? claimed : Number(approvedRaw);
      if (!Number.isFinite(approved) || approved < 0) throw new Error('Enter a valid approved amount.');
      return upsertClaimExpense({
        claim_id: claimId,
        procedure_id: form.procedureId || null,
        jurisdiction_level: form.jurisdiction,
        claimed_amount: claimed,
        approved_amount: approved,
        currency_code: 'XCD',
        provider_name: form.provider || null,
        service_date: form.serviceDate || null,
        status: 'CAPTURED',
        created_by: userCode,
      } as any);
    },
    onSuccess: () => {
      toast.success('Expense line captured — re-run the calculation to apply it.');
      setForm({ procedureId: '', jurisdiction: 'LOCAL_ST_KITTS', claimed: '', approved: '', provider: '', serviceDate: '' });
      setAdding(false);
      invalidate();
    },
    onError: (e: any) => toast.error('Could not save expense', { description: e?.message }),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from('bn_medical_claim_expense').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success('Expense line removed'); invalidate(); },
    onError: (e: any) => toast.error('Could not remove expense', { description: e?.message }),
  });

  const total = expenses.reduce(
    (sum: number, e: any) => sum + Number(e.approved_amount ?? e.claimed_amount ?? 0),
    0,
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Medical Expenses
            <Badge variant="outline" className="text-xs font-mono">
              {expenses.length} line(s) · ${total.toFixed(2)}
            </Badge>
          </CardTitle>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setAdding(v => !v)}>
            <Plus className="h-3.5 w-3.5" /> Add expense
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {adding && (
          <div className="grid gap-3 md:grid-cols-3 rounded-md border p-3">
            <div className="md:col-span-2">
              <Label className="text-xs">Procedure (optional)</Label>
              <Select value={form.procedureId} onValueChange={v => setForm(f => ({ ...f, procedureId: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select procedure…" /></SelectTrigger>
                <SelectContent>
                  {procedures.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.procedure_code} — {p.procedure_name ?? ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Jurisdiction</Label>
              <Select value={form.jurisdiction} onValueChange={v => setForm(f => ({ ...f, jurisdiction: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {JURISDICTIONS.map(j => <SelectItem key={j} value={j}>{j.replace(/_/g, ' ')}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Claimed amount</Label>
              <Input className="mt-1" inputMode="decimal" value={form.claimed}
                onChange={e => setForm(f => ({ ...f, claimed: e.target.value }))} placeholder="0.00" />
            </div>
            <div>
              <Label className="text-xs">Approved amount</Label>
              <Input className="mt-1" inputMode="decimal" value={form.approved}
                onChange={e => setForm(f => ({ ...f, approved: e.target.value }))} placeholder="defaults to claimed" />
            </div>
            <div>
              <Label className="text-xs">Service date</Label>
              <Input className="mt-1" type="date" value={form.serviceDate}
                onChange={e => setForm(f => ({ ...f, serviceDate: e.target.value }))} />
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs">Provider</Label>
              <Input className="mt-1" value={form.provider}
                onChange={e => setForm(f => ({ ...f, provider: e.target.value }))} placeholder="Facility / practitioner" />
            </div>
            <div className="flex items-end gap-2">
              <Button size="sm" onClick={() => addMutation.mutate()} disabled={addMutation.isPending}>Save line</Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading expense lines…</p>
        ) : expenses.length === 0 ? (
          <BnEmptyState
            type="empty"
            title="No expense lines captured"
            description="This is a medical expense (reimbursement) claim. Capture each receipt line here, then run the calculation to produce the payable amount."
          />
        ) : (
          <div className="rounded border divide-y">
            {expenses.map((e: any) => (
              <div key={e.id} className="px-3 py-2 text-xs grid grid-cols-12 items-center gap-2">
                <span className="col-span-3 font-mono">{e.jurisdiction_level ?? '—'}</span>
                <span className="col-span-4">{e.provider_name ?? 'Unspecified provider'}</span>
                <span className="col-span-2 text-right font-mono">${Number(e.claimed_amount ?? 0).toFixed(2)}</span>
                <span className="col-span-2 text-right font-mono font-semibold">
                  ${Number(e.approved_amount ?? e.claimed_amount ?? 0).toFixed(2)}
                </span>
                <span className="col-span-1 text-right">
                  <Button size="icon" variant="ghost" className="h-6 w-6"
                    onClick={() => removeMutation.mutate(e.id)} title="Remove line">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
