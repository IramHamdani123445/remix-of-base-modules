import { useState, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import {
  ArrowLeft, Download, Printer, CalendarIcon, Loader2, FileText,
  TrendingUp, TrendingDown, AlertTriangle, DollarSign,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import {
  useEmployerStatement, useEmployerArrears, type LedgerEntry,
} from '@/hooks/useComplianceLedger';
import { fetchEmployerMaster } from '@/services/employer360Service';
import { fetchEmployerPaymentHistory } from '@/services/employer360ExtendedService';
import { useQuery } from '@tanstack/react-query';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const formatCurrency = (amt: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'XCD', minimumFractionDigits: 2 }).format(amt);

const formatDateStr = (val: string | null) => {
  if (!val) return '—';
  try { return new Date(val).toLocaleDateString('en-GB'); } catch { return val; }
};

const entryTypeLabel = (t: string) => t.replace(/_/g, ' ');

export default function EmployerStatementDetail() {
  const { employerId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const printRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'detailed' | 'summary'>('detailed');
  const [fundFilter, setFundFilter] = useState('all');
  const [fromPeriod, setFromPeriod] = useState('');
  // Honour ?as_of=YYYY-MM-DD from the Statement Register so a back-dated
  // register view opens the matching back-dated full statement.
  const [toPeriod, setToPeriod] = useState(() => {
    const asOf = searchParams.get('as_of');
    return asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf.slice(0, 7) : '';
  });
  const [typeFilter, setTypeFilter] = useState('all');


  const { data: master } = useQuery({
    queryKey: ['stmt_master', employerId],
    queryFn: () => fetchEmployerMaster(employerId!),
    enabled: !!employerId,
  });

  const { data: rawEntries = [], isLoading } = useEmployerStatement(
    employerId,
    fromPeriod || undefined,
    toPeriod || undefined,
    fundFilter !== 'all' ? fundFilter : undefined,
  );

  const { data: arrears = [] } = useEmployerArrears(employerId);

  // Fallback source: cashier receipts + posted ledger credits (Employer 360 parity).
  // When the formal ledger has not been materialised for this employer, synthesise
  // ledger-shaped rows from cashier receipts and outstanding arrears so the Full
  // Statement still reflects real financial activity captured elsewhere.
  const { data: paymentHistory = [] } = useQuery({
    queryKey: ['stmt_payment_history', employerId],
    queryFn: () => fetchEmployerPaymentHistory(employerId!),
    enabled: !!employerId && rawEntries.length === 0,
  });

  const entries: LedgerEntry[] = (() => {
    if (rawEntries.length > 0) return rawEntries;
    if (!employerId) return [];

    const synth: LedgerEntry[] = [];
    // Arrears become opening debit rows per fund
    (arrears as any[])
      .filter((a) => (a.net_balance || 0) > 0)
      .forEach((a, idx) => {
        synth.push({
          entry_id: `AR-${a.fund_type}-${idx}`,
          posted_at: new Date(0).toISOString(),
          period: '—',
          fund_type: a.fund_type,
          entry_type: 'OPENING_ARREARS',
          description: `Outstanding balance brought forward (${a.period_count ?? 0} periods)`,
          debit_amount: Number(a.net_balance) || 0,
          credit_amount: 0,
          running_balance: 0,
          status: 'POSTED',
          reference_type: null,
          reference_id: null,
          reversal_of_id: null,
          reversal_reason: null,
          posted_by: 'system',
        });
      });

    // Cashier receipts become credit rows
    (paymentHistory as any[])
      .filter((p) => (p.credit_amount || 0) > 0)
      .forEach((p) => {
        synth.push({
          entry_id: p.id,
          posted_at: p.posted_at,
          period: p.period ? String(p.period).slice(0, 10) : '—',
          fund_type: p.fund_type || '—',
          entry_type: `PAYMENT_RECEIVED`,
          description: p.description || `Payment · ${p.source}`,
          debit_amount: 0,
          credit_amount: Number(p.credit_amount) || 0,
          running_balance: 0,
          status: p.status || 'POSTED',
          reference_type: p.source,
          reference_id: p.reference ?? null,
          reversal_of_id: null,
          reversal_reason: null,
          posted_by: 'system',
        });
      });

    // Sort chronologically and compute running balance
    synth.sort((a, b) => new Date(a.posted_at).getTime() - new Date(b.posted_at).getTime());
    let bal = 0;
    for (const e of synth) {
      bal += (e.debit_amount || 0) - (e.credit_amount || 0);
      e.running_balance = bal;
    }
    return synth;
  })();

  // Apply type filter
  const filtered = entries.filter((e) => {
    if (typeFilter === 'debits') return e.debit_amount > 0;
    if (typeFilter === 'credits') return e.credit_amount > 0;
    if (typeFilter === 'penalties') return ['PENALTY_ASSESSED', 'INTEREST_ACCRUED'].includes(e.entry_type);
    if (typeFilter === 'payments') return e.entry_type === 'PAYMENT_RECEIVED';
    return true;
  });

  // Compute summary from detailed data
  const totalDebits = filtered.reduce((s, e) => s + e.debit_amount, 0);
  const totalCredits = filtered.reduce((s, e) => s + e.credit_amount, 0);
  const closingBalance = filtered.length > 0 ? filtered[filtered.length - 1].running_balance : 0;
  const openingBalance = filtered.length > 0 ? filtered[0].running_balance - filtered[0].debit_amount + filtered[0].credit_amount : 0;

  // Summary aggregation by type
  const summaryByType = filtered.reduce<Record<string, { debits: number; credits: number; count: number }>>((acc, e) => {
    if (!acc[e.entry_type]) acc[e.entry_type] = { debits: 0, credits: 0, count: 0 };
    acc[e.entry_type].debits += e.debit_amount;
    acc[e.entry_type].credits += e.credit_amount;
    acc[e.entry_type].count++;
    return acc;
  }, {});

  // Summary by fund
  const summaryByFund = filtered.reduce<Record<string, { debits: number; credits: number }>>((acc, e) => {
    if (!acc[e.fund_type]) acc[e.fund_type] = { debits: 0, credits: 0 };
    acc[e.fund_type].debits += e.debit_amount;
    acc[e.fund_type].credits += e.credit_amount;
    return acc;
  }, {});

  const handlePrint = () => window.print();

  const handlePDF = () => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const now = new Date().toLocaleString('en-GB');
    const empName = master?.employer_name || employerId || '';

    // Header
    doc.setFontSize(16);
    doc.text('Employer Statement', 14, 15);
    doc.setFontSize(10);
    doc.text(`Employer: ${empName} (${employerId})`, 14, 22);
    doc.text(`Generated: ${now}`, 14, 27);
    doc.text(`Mode: ${mode === 'summary' ? 'Summary' : 'Detailed'}`, 14, 32);
    if (fromPeriod || toPeriod) doc.text(`Period: ${fromPeriod || 'Start'} to ${toPeriod || 'Current'}`, 14, 37);

    if (mode === 'detailed') {
      const tableData = filtered.map(e => [
        formatDateStr(e.posted_at),
        e.period,
        e.fund_type,
        entryTypeLabel(e.entry_type),
        e.description?.substring(0, 40) || '',
        e.debit_amount > 0 ? formatCurrency(e.debit_amount) : '',
        e.credit_amount > 0 ? formatCurrency(e.credit_amount) : '',
        formatCurrency(e.running_balance),
      ]);

      // Opening balance row
      tableData.unshift(['', '', '', 'OPENING BALANCE', '', '', '', formatCurrency(openingBalance)]);

      autoTable(doc, {
        startY: fromPeriod || toPeriod ? 42 : 37,
        head: [['Date', 'Period', 'Fund', 'Type', 'Description', 'Debit (XCD)', 'Credit (XCD)', 'Balance (XCD)']],
        body: tableData,
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: [41, 98, 255], textColor: 255 },
        columnStyles: {
          5: { halign: 'right' },
          6: { halign: 'right' },
          7: { halign: 'right', fontStyle: 'bold' },
        },
        didDrawPage: (data) => {
          const pageCount = (doc as any).internal.getNumberOfPages();
          doc.setFontSize(8);
          doc.text(`Page ${data.pageNumber} of ${pageCount}`, doc.internal.pageSize.width - 30, doc.internal.pageSize.height - 8);
          doc.text(`${empName} — Employer Statement`, 14, doc.internal.pageSize.height - 8);
        },
      });

      // Totals row
      const finalY = (doc as any).lastAutoTable.finalY + 5;
      doc.setFontSize(9);
      doc.setFont(undefined as any, 'bold');
      doc.text(`Total Debits: ${formatCurrency(totalDebits)}`, 14, finalY);
      doc.text(`Total Credits: ${formatCurrency(totalCredits)}`, 100, finalY);
      doc.text(`Closing Balance: ${formatCurrency(closingBalance)}`, 190, finalY);
    } else {
      // Summary mode
      const summaryData = Object.entries(summaryByType).map(([type, v]) => [
        entryTypeLabel(type),
        String(v.count),
        v.debits > 0 ? formatCurrency(v.debits) : '',
        v.credits > 0 ? formatCurrency(v.credits) : '',
      ]);

      autoTable(doc, {
        startY: fromPeriod || toPeriod ? 42 : 37,
        head: [['Transaction Type', 'Count', 'Total Debits', 'Total Credits']],
        body: summaryData,
        foot: [['TOTALS', String(filtered.length), formatCurrency(totalDebits), formatCurrency(totalCredits)]],
        styles: { fontSize: 9 },
        headStyles: { fillColor: [41, 98, 255], textColor: 255 },
      });

      const fy1 = (doc as any).lastAutoTable.finalY + 10;
      // Fund breakdown
      const fundData = Object.entries(summaryByFund).map(([fund, v]) => [
        fund, formatCurrency(v.debits), formatCurrency(v.credits), formatCurrency(v.debits - v.credits),
      ]);

      autoTable(doc, {
        startY: fy1,
        head: [['Fund', 'Debits', 'Credits', 'Balance']],
        body: fundData,
        styles: { fontSize: 9 },
        headStyles: { fillColor: [41, 98, 255], textColor: 255 },
      });

      const fy2 = (doc as any).lastAutoTable.finalY + 10;
      doc.setFontSize(12);
      doc.setFont(undefined as any, 'bold');
      doc.text(`Opening Balance: ${formatCurrency(openingBalance)}`, 14, fy2);
      doc.text(`Closing Balance: ${formatCurrency(closingBalance)}`, 14, fy2 + 7);
    }

    doc.save(`statement_${employerId}_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="container mx-auto p-6 space-y-6" ref={printRef}>
      <PageHeader
        title="Employer Statement"
        subtitle={master ? `${master.employer_name} (${employerId})` : employerId || ''}
        breadcrumbs={[
          { label: 'Compliance', href: '/compliance' },
          { label: 'Employer 360°', href: `/compliance/field/employer-360/${employerId}` },
          { label: 'Statement' },
        ]}
        actions={
          <div className="flex gap-2 print:hidden">
            <Button variant="outline" onClick={handlePrint}><Printer className="h-4 w-4 mr-1" />Print</Button>
            <Button onClick={handlePDF}><Download className="h-4 w-4 mr-1" />Download PDF</Button>
          </div>
        }
      />

      {/* Filters */}
      <Card className="print:hidden">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[140px]">
              <label className="text-sm font-medium mb-1 block">Mode</label>
              <Select value={mode} onValueChange={(v: 'detailed' | 'summary') => setMode(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="detailed">Detailed Ledger</SelectItem>
                  <SelectItem value="summary">Summary</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[120px]">
              <label className="text-sm font-medium mb-1 block">Fund</label>
              <Select value={fundFilter} onValueChange={setFundFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Funds</SelectItem>
                  <SelectItem value="SS">SS</SelectItem>
                  <SelectItem value="LEVY">LEVY</SelectItem>
                  <SelectItem value="EI">EI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[120px]">
              <label className="text-sm font-medium mb-1 block">Type</label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="debits">Debits Only</SelectItem>
                  <SelectItem value="credits">Credits Only</SelectItem>
                  <SelectItem value="penalties">Penalties Only</SelectItem>
                  <SelectItem value="payments">Payments Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[120px]">
              <label className="text-sm font-medium mb-1 block">From Period</label>
              <Input placeholder="YYYYMM" value={fromPeriod} onChange={e => setFromPeriod(e.target.value)} className="w-28" />
            </div>
            <div className="min-w-[120px]">
              <label className="text-sm font-medium mb-1 block">To Period</label>
              <Input placeholder="YYYYMM" value={toPeriod} onChange={e => setToPeriod(e.target.value)} className="w-28" />
            </div>
            <Button variant="outline" onClick={() => { setFundFilter('all'); setTypeFilter('all'); setFromPeriod(''); setToPeriod(''); setMode('detailed'); }}>
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Statement Header */}
      <Card>
        <CardHeader className="border-b bg-muted/30">
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="text-xl mb-2">{master?.employer_name || employerId}</CardTitle>
              <div className="space-y-0.5 text-sm text-muted-foreground">
                <p><span className="font-semibold">Employer ID:</span> {employerId}</p>
                <p><span className="font-semibold">Office:</span> {master?.office_code || '—'}</p>
                <p><span className="font-semibold">Generated:</span> {new Date().toLocaleDateString('en-GB')}</p>
              </div>
            </div>
            <div className="text-right">
              <Badge variant={closingBalance > 0 ? 'destructive' : 'default'} className="text-sm px-3 py-1">
                {closingBalance > 0 ? 'OUTSTANDING' : closingBalance < 0 ? 'CREDIT' : 'CLEAR'}
              </Badge>
              <div className="mt-3">
                <p className="text-xs text-muted-foreground">Closing Balance</p>
                <p className={`text-2xl font-bold ${closingBalance > 0 ? 'text-destructive' : closingBalance < 0 ? 'text-green-600' : 'text-foreground'}`}>
                  {formatCurrency(closingBalance)}
                </p>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
            <div><p className="text-xs text-muted-foreground">Opening Balance</p><p className="text-lg font-semibold">{formatCurrency(openingBalance)}</p></div>
            <div><p className="text-xs text-muted-foreground">Total Debits</p><p className="text-lg font-semibold text-destructive">{formatCurrency(totalDebits)}</p></div>
            <div><p className="text-xs text-muted-foreground">Total Credits</p><p className="text-lg font-semibold text-green-600">{formatCurrency(totalCredits)}</p></div>
            <div><p className="text-xs text-muted-foreground">Penalties</p><p className="text-lg font-semibold text-orange-600">
              {formatCurrency(filtered.filter(e => ['PENALTY_ASSESSED', 'INTEREST_ACCRUED'].includes(e.entry_type)).reduce((s, e) => s + e.debit_amount, 0))}
            </p></div>
            <div><p className="text-xs text-muted-foreground">Closing Balance</p><p className="text-lg font-bold">{formatCurrency(closingBalance)}</p></div>
          </div>
        </CardContent>
      </Card>

      {/* Content based on mode */}
      {mode === 'detailed' ? (
        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><FileText className="h-4 w-4" />Detailed Ledger ({filtered.length} entries)</CardTitle></CardHeader>
          <CardContent>
            {filtered.length === 0 ? <div className="text-center py-8 text-muted-foreground">No transactions found for the selected criteria</div> : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-[90px]">Date</TableHead>
                    <TableHead className="w-[80px]">Period</TableHead>
                    <TableHead className="w-[60px]">Fund</TableHead>
                    <TableHead className="w-[140px]">Type</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right w-[110px]">Debit (XCD)</TableHead>
                    <TableHead className="text-right w-[110px]">Credit (XCD)</TableHead>
                    <TableHead className="text-right w-[120px]">Balance (XCD)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* Opening Balance Row */}
                  <TableRow className="bg-muted/20 font-semibold border-b-2">
                    <TableCell className="text-sm">—</TableCell>
                    <TableCell className="text-sm">—</TableCell>
                    <TableCell className="text-sm">—</TableCell>
                    <TableCell className="text-sm">OPENING BALANCE</TableCell>
                    <TableCell className="text-sm">Balance brought forward</TableCell>
                    <TableCell className="text-right">—</TableCell>
                    <TableCell className="text-right">—</TableCell>
                    <TableCell className="text-right font-mono font-bold">{formatCurrency(openingBalance)}</TableCell>
                  </TableRow>
                  {filtered.map((e) => (
                    <TableRow key={e.entry_id} className={e.status === 'REVERSED' ? 'opacity-50 line-through' : 'hover:bg-muted/30'}>
                      <TableCell className="text-xs">{formatDateStr(e.posted_at)}</TableCell>
                      <TableCell className="font-mono text-xs">{e.period}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{e.fund_type}</Badge></TableCell>
                      <TableCell className="text-xs">{entryTypeLabel(e.entry_type)}</TableCell>
                      <TableCell className="text-xs max-w-[200px] truncate">{e.description}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-destructive">{e.debit_amount > 0 ? formatCurrency(e.debit_amount) : '—'}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-green-600">{e.credit_amount > 0 ? formatCurrency(e.credit_amount) : '—'}</TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold">{formatCurrency(e.running_balance)}</TableCell>
                    </TableRow>
                  ))}
                  {/* Closing Total Row */}
                  <TableRow className="bg-muted font-bold border-t-2">
                    <TableCell colSpan={5} className="text-right">TOTALS</TableCell>
                    <TableCell className="text-right font-mono text-destructive">{formatCurrency(totalDebits)}</TableCell>
                    <TableCell className="text-right font-mono text-green-600">{formatCurrency(totalCredits)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(closingBalance)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : (
        /* Summary Mode */
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Summary by Transaction Type</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Transaction Type</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="text-right">Total Debits</TableHead>
                    <TableHead className="text-right">Total Credits</TableHead>
                    <TableHead className="text-right">Net Impact</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(summaryByType).map(([type, v]) => (
                    <TableRow key={type}>
                      <TableCell className="font-medium">{entryTypeLabel(type)}</TableCell>
                      <TableCell className="text-right">{v.count}</TableCell>
                      <TableCell className="text-right font-mono text-destructive">{v.debits > 0 ? formatCurrency(v.debits) : '—'}</TableCell>
                      <TableCell className="text-right font-mono text-green-600">{v.credits > 0 ? formatCurrency(v.credits) : '—'}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">{formatCurrency(v.debits - v.credits)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold bg-muted">
                    <TableCell>TOTAL</TableCell>
                    <TableCell className="text-right">{filtered.length}</TableCell>
                    <TableCell className="text-right font-mono text-destructive">{formatCurrency(totalDebits)}</TableCell>
                    <TableCell className="text-right font-mono text-green-600">{formatCurrency(totalCredits)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(totalDebits - totalCredits)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Summary by Fund</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fund</TableHead>
                    <TableHead className="text-right">Total Debits</TableHead>
                    <TableHead className="text-right">Total Credits</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(summaryByFund).map(([fund, v]) => (
                    <TableRow key={fund}>
                      <TableCell><Badge variant="outline">{fund}</Badge></TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(v.debits)}</TableCell>
                      <TableCell className="text-right font-mono text-green-600">{formatCurrency(v.credits)}</TableCell>
                      <TableCell className="text-right font-mono font-bold">{formatCurrency(v.debits - v.credits)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold bg-muted">
                    <TableCell>TOTAL</TableCell>
                    <TableCell className="text-right font-mono text-destructive">{formatCurrency(totalDebits)}</TableCell>
                    <TableCell className="text-right font-mono text-green-600">{formatCurrency(totalCredits)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(closingBalance)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Arrears Breakdown */}
          {arrears.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Current Arrears Breakdown</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fund</TableHead>
                      <TableHead className="text-right">Principal</TableHead>
                      <TableHead className="text-right">Penalties</TableHead>
                      <TableHead className="text-right">Interest</TableHead>
                      <TableHead className="text-right">Payments</TableHead>
                      <TableHead className="text-right">Waivers</TableHead>
                      <TableHead className="text-right font-bold">Net Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {arrears.map(a => (
                      <TableRow key={a.fund_type}>
                        <TableCell><Badge variant="outline">{a.fund_type}</Badge></TableCell>
                        <TableCell className="text-right font-mono">{formatCurrency(a.principal_due)}</TableCell>
                        <TableCell className="text-right font-mono text-orange-600">{formatCurrency(a.penalties)}</TableCell>
                        <TableCell className="text-right font-mono">{formatCurrency(a.interest)}</TableCell>
                        <TableCell className="text-right font-mono text-green-600">{formatCurrency(a.payments)}</TableCell>
                        <TableCell className="text-right font-mono">{formatCurrency(a.waivers)}</TableCell>
                        <TableCell className="text-right font-mono font-bold text-destructive">{formatCurrency(a.net_balance)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Print Footer */}
      <div className="hidden print:block text-xs text-muted-foreground text-center mt-8 border-t pt-2">
        Generated on {new Date().toLocaleString('en-GB')} | Employer Statement — {master?.employer_name || employerId} | Confidential
      </div>
    </div>
  );
}
