/**
 * Benefits Module Diagnostics
 *
 * Lists EVERY bn_* table in the public schema (live from the database via
 * the bn_list_tables() RPC) with its row count, last created_at, and the
 * /bn/* screens that consume it. Tables without a known screen consumer
 * are flagged "Orphan" so we can either wire them up or retire them.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { AlertTriangle, RefreshCw, Database, CheckCircle2, HelpCircle, Eye, Code2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import TablePreviewDialog from '@/components/bn/admin/TablePreviewDialog';

const db = supabase as any;

/** Known screen → table mapping (audited from src/pages/bn/* + hooks/services). */
const SCREEN_TABLE_MAP: Record<string, string[]> = {
  bn_claim: ['/bn/claims', '/bn/queue', '/bn/workbench', '/bn/claim/:id'],
  bn_claim_application: ['/bn/intake/register', '/bn/claims'],
  bn_claim_participant: ['/bn/claim/:id (participants)'],
  bn_claim_detail: ['/bn/claim/:id (detail)'],
  bn_claim_document: ['/bn/claim/:id (documents)'],
  bn_claim_evidence: ['/bn/claim/:id (evidence)'],
  bn_claim_event: ['/bn/claim/:id (timeline)'],
  bn_claim_note: ['/bn/claim/:id (notes)'],
  bn_claim_eligibility: ['/bn/claims (eligibility)'],
  bn_claim_calculation: ['/bn/claims (determination)'],
  bn_claim_decision: ['/bn/approval', '/bn/claims'],
  bn_claim_queue_assignment: ['/bn/queue'],
  bn_claim_intake_validation: ['/bn/intake/register'],
  bn_claim_person_snapshot: ['/bn/claim/:id (snapshot)'],
  bn_claim_employer_snapshot: ['/bn/claim/:id (snapshot)'],
  bn_claim_contribution_snapshot: ['/bn/claim/:id (contribution)'],
  bn_claim_field_ownership: ['/bn/claim/:id (field locks)'],
  bn_award: ['/bn/awards', '/bn/entitlements'],
  bn_award_beneficiary: ['/bn/awards/survivors'],
  bn_award_rate_history: ['/bn/awards (rate history)'],
  bn_award_status_event: ['/bn/awards (status)'],
  bn_award_suspension_event: ['/bn/award-suspension'],
  bn_entitlement: ['/bn/entitlements'],
  bn_payment_schedule: ['/bn/schedules'],
  bn_payment_instruction: ['/bn/payables', '/bn/payment-history'],
  bn_payment_batch: ['/bn/batches'],
  bn_batch_item: ['/bn/batches'],
  bn_payment_exception: ['/bn/issue', '/bn/post-issue'],
  bn_payment_reconciliation: ['/bn/payment-history'],
  bn_payment_profile: ['/bn/payment-profiles'],
  bn_payment_method: ['/bn/config/payment-masters'],
  bn_payment_source_account: ['/bn/admin (sources)'],
  bn_bank_master: ['/bn/config/payment-masters'],
  bn_bank_branch: ['/bn/config/payment-masters'],
  bn_cheque_stock: ['/bn/cheque-stock'],
  bn_cheque_register: ['/bn/cheque-stock'],
  bn_eft_file: ['/bn/payables'],
  bn_eft_format: ['/bn/config/payment-masters'],
  bn_eft_format_field: ['/bn/config/payment-masters'],
  bn_overpayment: ['/bn/overpayments'],
  bn_legal_referral: ['/bn/overpayments (referrals)'],
  bn_life_certificate: ['/bn/life-certificates'],
  bn_medical_facility: ['/bn/config/medical'],
  bn_medical_procedure: ['/bn/config/medical'],
  bn_medical_review_schedule: ['/bn/medical-reviews'],
  bn_medical_recommendation: ['/bn/medical-reviews'],
  bn_medical_claim_expense: ['/bn/claims (medical)'],
  bn_medical_reimbursement_limit: ['/bn/config/medical'],
  bn_post_issue_task: ['/bn/post-issue'],
  bn_external_task: ['/bn/workbench (external tasks)'],
  bn_workbasket: ['/bn/queue', '/bn/workbench'],
  bn_communication_log: ['/bn/claim/:id (communications)'],
  bn_letter: ['/bn/claim/:id (letters)'],
  bn_issue_record: ['/bn/issue'],
  bn_override_request: ['/bn/approval (overrides)'],
  bn_calc_run: ['/bn/engine'],
  bn_calc_trace: ['/bn/engine (trace)'],
  bn_sim_run: ['/bn/simulation'],
  bn_eligibility_rule: ['/bn/config/rules'],
  bn_calculation_rule: ['/bn/config/rules'],
  bn_formula_template: ['/bn/config/formulas'],
  bn_formula_version: ['/bn/config/formulas'],
  bn_rate_table: ['/bn/config/rates'],
  bn_rate_table_row: ['/bn/config/rates'],
  bn_product: ['/bn/config/products'],
  bn_product_version: ['/bn/config/products'],
  bn_product_parameter: ['/bn/config/products'],
  bn_country: ['/bn/config/country'],
  bn_doc_requirement: ['/bn/config/documents'],
  bn_reason_code: ['/bn/config/reason-codes'],
};

interface ApiRow {
  table_name: string;
  object_type: 'table' | 'view';
  row_count: number;
  has_created_at: boolean;
  last_created_at: string | null;
}

export default function BenefitsDiagnostics() {
  const [rows, setRows] = useState<ApiRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [showOnly, setShowOnly] = useState<'all' | 'orphan' | 'empty' | 'populated'>('all');
  const [previewTable, setPreviewTable] = useState<string | null>(null);

  const loadAll = async () => {
    setLoading(true);
    try {
      const { data, error } = await db.rpc('bn_list_tables');
      if (error) throw error;
      setRows((data ?? []) as ApiRow[]);
    } catch (e: any) {
      toast.error('Failed to load diagnostics', { description: e?.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const enriched = useMemo(() => {
    return rows.map((r) => {
      const screens = SCREEN_TABLE_MAP[r.table_name] ?? [];
      return { ...r, screens, isOrphan: screens.length === 0 };
    });
  }, [rows]);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return enriched.filter((r) => {
      if (f && !r.table_name.toLowerCase().includes(f) && !r.screens.some((s) => s.toLowerCase().includes(f))) {
        return false;
      }
      if (showOnly === 'orphan' && !r.isOrphan) return false;
      if (showOnly === 'empty' && (r.row_count ?? 0) !== 0) return false;
      if (showOnly === 'populated' && (r.row_count ?? 0) <= 0) return false;
      return true;
    });
  }, [enriched, filter, showOnly]);

  const totals = useMemo(() => {
    const tables = enriched.length;
    const baseTables = enriched.filter((r) => r.object_type === 'table').length;
    const views = enriched.filter((r) => r.object_type === 'view').length;
    const totalRows = enriched.reduce((a, r) => a + Math.max(0, r.row_count ?? 0), 0);
    const empty = enriched.filter((r) => (r.row_count ?? 0) === 0).length;
    const populated = tables - empty;
    const orphan = enriched.filter((r) => r.isOrphan).length;
    const errors = enriched.filter((r) => (r.row_count ?? 0) < 0).length;
    return { tables, baseTables, views, totalRows, empty, populated, orphan, errors };
  }, [enriched]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Database className="h-6 w-6" /> Benefits Module Diagnostics
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live enumeration of <strong>every</strong> <code>bn_*</code> table in the database via{' '}
            <code>bn_list_tables()</code>. No hardcoded list — what you see here is exactly what
            exists in <code>public</code>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadAll} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">bn_ objects</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">
            {totals.tables}
            <div className="text-[11px] font-normal text-muted-foreground mt-1">
              {totals.baseTables} tables · {totals.views} views
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Populated</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold text-emerald-600">{totals.populated}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Empty</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold text-amber-600">{totals.empty}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Orphan (no screen)</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold text-sky-700">{totals.orphan}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Total rows</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{totals.totalRows.toLocaleString()}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <CardTitle className="text-base">All bn_* tables ({filtered.length} shown)</CardTitle>
            <div className="flex items-center gap-2">
              {(['all', 'populated', 'empty', 'orphan'] as const).map((k) => (
                <Button
                  key={k}
                  size="sm"
                  variant={showOnly === k ? 'default' : 'outline'}
                  onClick={() => setShowOnly(k)}
                  className="capitalize"
                >
                  {k}
                </Button>
              ))}
              <Input
                placeholder="Filter…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="max-w-xs"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Table</TableHead>
                <TableHead className="w-20">Type</TableHead>
                <TableHead className="w-24 text-right">Rows</TableHead>
                <TableHead className="w-44">Last created</TableHead>
                <TableHead>Screens</TableHead>
                <TableHead className="w-32">Status</TableHead>
                <TableHead className="w-20 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => {
                const count = r.row_count ?? 0;
                const errored = count < 0;
                const empty = count === 0;
                return (
                  <TableRow key={r.table_name}>
                    <TableCell className="font-mono text-xs">{r.table_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] ${r.object_type === 'view' ? 'text-purple-700 border-purple-300' : 'text-slate-700 border-slate-300'}`}>
                        {r.object_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {errored ? '—' : count.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.last_created_at
                        ? new Date(r.last_created_at).toLocaleString()
                        : r.has_created_at ? '—' : <span className="italic">n/a</span>}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.screens.length === 0 ? (
                        <Badge variant="outline" className="gap-1 text-sky-700 border-sky-300">
                          <HelpCircle className="h-3 w-3" /> no screen consumer
                        </Badge>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {r.screens.map((s) => (
                            <Badge key={s} variant="outline" className="font-mono text-[10px]">{s}</Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {errored ? (
                        <Badge variant="destructive" className="gap-1">
                          <AlertTriangle className="h-3 w-3" /> Error
                        </Badge>
                      ) : empty ? (
                        <Badge variant="outline" className="gap-1 text-amber-700 border-amber-300">
                          <AlertTriangle className="h-3 w-3" /> Empty
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-emerald-700 border-emerald-300">
                          <CheckCircle2 className="h-3 w-3" /> OK
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2"
                        disabled={errored}
                        onClick={() => setPreviewTable(r.table_name)}
                      >
                        <Eye className="h-3.5 w-3.5 mr-1" /> View
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground mt-4">
            <strong>Orphan</strong> = table exists in the database but no <code>/bn/*</code> screen
            currently reads from it. <strong>Empty</strong> = zero rows. The Benefits module ships
            with <em>no</em> client-side mock arrays; every list reads live from these tables.
          </p>
        </CardContent>
      </Card>

      <TablePreviewDialog tableName={previewTable} onClose={() => setPreviewTable(null)} />
    </div>
  );
}
