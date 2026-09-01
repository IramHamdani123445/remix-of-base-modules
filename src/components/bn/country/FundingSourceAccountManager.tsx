/**
 * Funding Source Account Manager.
 * Owns EFT bank-file mechanics per funding bank/account for a country.
 * Source-account is the source of truth — country payment row keeps only
 * national method capability.
 */
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Banknote, Plus, Pencil, Trash2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  listSourceAccounts, upsertSourceAccount, deleteSourceAccount,
  type PaymentSourceAccount, type SourceFormatStatus,
} from '@/services/bn/payment/paymentSourceAccountService';
import { EFT_FORMAT_PRESETS, getPreset } from '@/lib/bn/eftFormatPresets';
import { getCurrentUserCode } from '@/hooks/useUserCode';
import { requireUserCode } from '@/lib/bn/requireUserCode';
import { BnBusyButton } from '@/components/bn/shared';

const STATUS_VARIANT: Record<SourceFormatStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  PENDING_BANK_SPECIFICATION: 'destructive',
  DRAFT: 'secondary',
  READY: 'default',
  RETIRED: 'outline',
};

interface Props { countryCode: string; }

const emptyAcct = (countryCode: string): Partial<PaymentSourceAccount> => ({
  country_code: countryCode,
  source_account_code: '',
  source_account_name: '',
  payment_method: 'EFT',
  bank_code: '',
  bank_account_number: '',
  bank_account_name: '',
  currency_code: 'XCD',
  bank_file_format: '',
  header_record_format: '',
  detail_record_format: '',
  trailer_record_format: '',
  file_naming_convention: '',
  file_date_format: 'YYYYMMDD',
  account_number_rule: '',
  routing_number_rule: '',
  is_default: false,
  is_active: true,
  notes: '',
});

const FundingSourceAccountManager: React.FC<Props> = ({ countryCode }) => {
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<Partial<PaymentSourceAccount>>(emptyAcct(countryCode));

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['bn', 'payment-source-accounts', countryCode],
    queryFn: () => listSourceAccounts(countryCode),
    enabled: !!countryCode,
  });

  const saveMut = useMutation({
    mutationFn: async (payload: Partial<PaymentSourceAccount>) => {
      const userCode = requireUserCode(await getCurrentUserCode(), 'save funding source account');
      return upsertSourceAccount(payload as any, userCode);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bn', 'payment-source-accounts', countryCode] });
      setEditOpen(false);
      toast.success('Funding source account saved');
    },
    onError: (e: any) => toast.error(e?.message ?? 'Save failed'),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => deleteSourceAccount(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bn', 'payment-source-accounts', countryCode] });
      toast.success('Funding source account removed');
    },
    onError: (e: any) => toast.error(e?.message ?? 'Delete failed'),
  });

  const startEdit = (r?: PaymentSourceAccount) => {
    setForm(r ? { ...r } : emptyAcct(countryCode));
    setEditOpen(true);
  };

  const applyPreset = (key: string) => {
    const p = getPreset(key);
    if (!p) return;
    setForm((f) => ({
      ...f,
      bank_file_format: p.bank_file_format,
      file_naming_convention: p.file_naming_convention,
      file_date_format: p.file_date_format,
      header_record_format: p.header_record_format,
      detail_record_format: p.detail_record_format,
      trailer_record_format: p.trailer_record_format,
      account_number_rule: p.account_number_rule ?? f.account_number_rule ?? '',
      routing_number_rule: p.routing_number_rule ?? f.routing_number_rule ?? '',
    }));
  };

  const eftRows = rows.filter((r) => r.payment_method === 'EFT');
  const pendingCount = eftRows.filter((r) => r.format_status === 'PENDING_BANK_SPECIFICATION').length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Banknote className="h-4 w-4" /> Funding Source Accounts
          </CardTitle>
          <CardDescription className="text-xs mt-1">
            EFT bank-file format lives here, per funding bank/account — not on the country method row.
            EFT batch generation reads format from the active source account.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => startEdit()}><Plus className="h-4 w-4 mr-1" /> New Source Account</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {pendingCount > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{pendingCount} EFT source account{pendingCount > 1 ? 's' : ''} pending bank specification</AlertTitle>
            <AlertDescription className="text-xs">
              EFT batch generation will block until bank account details and file format templates are supplied.
            </AlertDescription>
          </Alert>
        )}
        {isLoading ? (
          <div className="text-sm text-muted-foreground py-4">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 italic">
            No funding source accounts configured. Add one for each bank/account that funds payments.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Bank / Account</TableHead>
                <TableHead>File Format</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.source_account_code}</TableCell>
                  <TableCell>
                    {r.source_account_name}
                    {r.is_default && <Badge variant="outline" className="ml-2 text-[10px]">DEFAULT</Badge>}
                  </TableCell>
                  <TableCell><Badge variant="secondary">{r.payment_method}</Badge></TableCell>
                  <TableCell className="text-xs">
                    {r.bank_code || '—'} {r.bank_account_number ? `· ${r.bank_account_number}` : ''}
                  </TableCell>
                  <TableCell className="text-xs">{r.bank_file_format || <span className="italic text-muted-foreground">—</span>}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[r.format_status]} className="gap-1">
                      {r.format_status === 'READY' && <CheckCircle2 className="h-3 w-3" />}
                      {r.format_status === 'PENDING_BANK_SPECIFICATION' && <AlertTriangle className="h-3 w-3" />}
                      {r.format_status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => startEdit(r)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => { if (confirm(`Delete source account ${r.source_account_code}?`)) delMut.mutate(r.id); }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Edit' : 'New'} Funding Source Account</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Source Account Code *</Label>
                <Input value={form.source_account_code ?? ''}
                  onChange={(e) => setForm({ ...form, source_account_code: e.target.value })}
                  placeholder="SKN-EFT-PRIMARY" />
              </div>
              <div>
                <Label>Source Account Name *</Label>
                <Input value={form.source_account_name ?? ''}
                  onChange={(e) => setForm({ ...form, source_account_name: e.target.value })} />
              </div>
              <div>
                <Label>Payment Method *</Label>
                <Select value={form.payment_method ?? 'EFT'} onValueChange={(v) => setForm({ ...form, payment_method: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EFT">EFT</SelectItem>
                    <SelectItem value="WIRE">Wire Transfer</SelectItem>
                    <SelectItem value="CHEQUE">Cheque (funding account)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Currency</Label>
                <Input value={form.currency_code ?? ''} onChange={(e) => setForm({ ...form, currency_code: e.target.value })} />
              </div>
              <div>
                <Label>Bank Code</Label>
                <Input value={form.bank_code ?? ''} onChange={(e) => setForm({ ...form, bank_code: e.target.value })} />
              </div>
              <div>
                <Label>Bank Account Number</Label>
                <Input value={form.bank_account_number ?? ''} onChange={(e) => setForm({ ...form, bank_account_number: e.target.value })} />
              </div>
              <div className="col-span-2">
                <Label>Bank Account Name</Label>
                <Input value={form.bank_account_name ?? ''} onChange={(e) => setForm({ ...form, bank_account_name: e.target.value })} />
              </div>
            </div>

            {form.payment_method === 'EFT' && (
              <div className="space-y-3 border-t pt-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">EFT File Format</Label>
                  <Select onValueChange={applyPreset}>
                    <SelectTrigger className="w-64"><SelectValue placeholder="Apply preset…" /></SelectTrigger>
                    <SelectContent>
                      {EFT_FORMAT_PRESETS.map((p) => (
                        <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Bank File Format</Label>
                    <Input value={form.bank_file_format ?? ''} onChange={(e) => setForm({ ...form, bank_file_format: e.target.value })} placeholder="CSV / NACHA / SWIFT" />
                  </div>
                  <div>
                    <Label>File Naming Convention</Label>
                    <Input value={form.file_naming_convention ?? ''} onChange={(e) => setForm({ ...form, file_naming_convention: e.target.value })} />
                  </div>
                  <div>
                    <Label>File Date Format</Label>
                    <Input value={form.file_date_format ?? ''} onChange={(e) => setForm({ ...form, file_date_format: e.target.value })} />
                  </div>
                  <div>
                    <Label>Account Number Rule</Label>
                    <Input value={form.account_number_rule ?? ''} onChange={(e) => setForm({ ...form, account_number_rule: e.target.value })} />
                  </div>
                  <div className="col-span-2">
                    <Label>Routing Number Rule</Label>
                    <Input value={form.routing_number_rule ?? ''} onChange={(e) => setForm({ ...form, routing_number_rule: e.target.value })} />
                  </div>
                </div>
                <div>
                  <Label>Header Record Format</Label>
                  <Textarea rows={2} value={form.header_record_format ?? ''} onChange={(e) => setForm({ ...form, header_record_format: e.target.value })} />
                </div>
                <div>
                  <Label>Detail Record Format</Label>
                  <Textarea rows={2} value={form.detail_record_format ?? ''} onChange={(e) => setForm({ ...form, detail_record_format: e.target.value })} />
                </div>
                <div>
                  <Label>Trailer Record Format</Label>
                  <Textarea rows={2} value={form.trailer_record_format ?? ''} onChange={(e) => setForm({ ...form, trailer_record_format: e.target.value })} />
                </div>
              </div>
            )}

            <div className="flex items-center gap-6 border-t pt-3">
              <div className="flex items-center gap-2">
                <Switch checked={!!form.is_default} onCheckedChange={(v) => setForm({ ...form, is_default: v })} />
                <Label>Default for method</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.is_active !== false} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
                <Label>Active</Label>
              </div>
            </div>

            <div>
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <BnBusyButton loading={saveMut.isPending}
              disabled={!form.source_account_code || !form.source_account_name || saveMut.isPending}
              onClick={() => saveMut.mutate(form)}
            >>Save</BnBusyButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default FundingSourceAccountManager;
