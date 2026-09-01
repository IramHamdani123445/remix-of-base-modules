/**
 * Cheque Stock Admin
 * Register cheque book ranges per bank account.
 */
import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { listChequeStock, registerChequeStock } from '@/services/bn/payment/chequeStockService';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { toast } from 'sonner';
import { BnBusyButton } from '@/components/bn/shared';

const ChequeStockPage: React.FC = () => {
  const qc = useQueryClient();
  const { user } = useSupabaseAuth();
  const userCode = (user as any)?.user_metadata?.user_code || (user as any)?.email || 'SYSTEM';
  const { data = [], isLoading } = useQuery({
    queryKey: ['bn-cheque-stock'], queryFn: () => listChequeStock(),
  });
  const [form, setForm] = useState({
    bank_account_ref: '', bank_code: '', series_prefix: '',
    range_start: '', range_end: '', notes: '',
  });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!form.bank_account_ref || !form.range_start || !form.range_end) {
      toast.error('Bank account ref + range start/end are required'); return;
    }
    setBusy(true);
    try {
      await registerChequeStock({
        bank_account_ref: form.bank_account_ref,
        bank_code: form.bank_code || undefined,
        series_prefix: form.series_prefix || undefined,
        range_start: Number(form.range_start),
        range_end: Number(form.range_end),
        notes: form.notes || undefined,
        registered_by: userCode,
      });
      toast.success('Cheque stock registered');
      setForm({ bank_account_ref: '', bank_code: '', series_prefix: '', range_start: '', range_end: '', notes: '' });
      qc.invalidateQueries({ queryKey: ['bn-cheque-stock'] });
    } catch (e: any) {
      toast.error(e?.message || 'Failed to register');
    } finally { setBusy(false); }
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="t-page-title">Cheque Stock</h1>
        <p className="t-page-subtitle mt-1">Register cheque book ranges per bank account.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Register Cheque Range</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div><Label className="text-xs">Bank Account Ref *</Label>
            <Input value={form.bank_account_ref} onChange={(e) => setForm({ ...form, bank_account_ref: e.target.value })} /></div>
          <div><Label className="text-xs">Bank Code</Label>
            <Input value={form.bank_code} onChange={(e) => setForm({ ...form, bank_code: e.target.value })} /></div>
          <div><Label className="text-xs">Series Prefix</Label>
            <Input value={form.series_prefix} onChange={(e) => setForm({ ...form, series_prefix: e.target.value })} placeholder="e.g. CHQ-" /></div>
          <div><Label className="text-xs">Range Start *</Label>
            <Input type="number" value={form.range_start} onChange={(e) => setForm({ ...form, range_start: e.target.value })} /></div>
          <div><Label className="text-xs">Range End *</Label>
            <Input type="number" value={form.range_end} onChange={(e) => setForm({ ...form, range_end: e.target.value })} /></div>
          <div className="col-span-2 md:col-span-3"><Label className="text-xs">Notes</Label>
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          <div className="col-span-2 md:col-span-3">
            <BnBusyButton loading={busy} onClick={submit} disabled={busy}>Register</BnBusyButton>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Registered Stocks</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bank Account</TableHead>
                  <TableHead>Bank Code</TableHead>
                  <TableHead>Series</TableHead>
                  <TableHead className="text-right">Range</TableHead>
                  <TableHead className="text-right">Next</TableHead>
                  <TableHead className="text-right">Used</TableHead>
                  <TableHead className="text-right">Cancelled</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-xs font-mono">{s.bank_account_ref}</TableCell>
                    <TableCell className="text-xs">{s.bank_code || '—'}</TableCell>
                    <TableCell className="text-xs">{s.series_prefix || '—'}</TableCell>
                    <TableCell className="text-xs text-right">{s.range_start}–{s.range_end}</TableCell>
                    <TableCell className="text-xs text-right">{s.next_number}</TableCell>
                    <TableCell className="text-xs text-right">{s.used_count}</TableCell>
                    <TableCell className="text-xs text-right">{s.cancelled_count}</TableCell>
                    <TableCell className="text-xs">{s.status}</TableCell>
                  </TableRow>
                ))}
                {data.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-6">
                    No cheque stock registered yet.
                  </TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ChequeStockPage;
