/**
 * Compliance — Enterprise Inspection Evidence Register
 * `/compliance/inspections/evidence`
 *
 * Master register of evidence captured during compliance field inspections,
 * providing the traceability chain Employer → Inspection → Evidence → Finding
 * → Violation. Search, filters, sorting, paging, KPIs and capabilities are
 * resolved server-side by `ce_evidence_register_v1`; files are reached only
 * through short-lived signed URLs against the private `ce-field-evidence`
 * bucket; every governed action writes an audit entry.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PermissionWrapper } from '@/components/ui/permission-wrapper';
import {
  FolderOpen, AlertCircle, MoreHorizontal, Plus, Pencil, Eye, Download, Ban, Filter,
  ArrowUpDown, RefreshCw, FileWarning, Loader2, Link2,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { isComplianceFeatureEnabled } from '@/lib/compliance/featureToggles';
import { useDebounce } from '@/hooks/useDebounce';
import { useEvidenceRegister, type EvidenceRow } from '@/hooks/compliance/useEvidenceRegister';
import {
  downloadEvidenceFile, evidenceTypeLabel, formatFileSize, resolveEvidenceUrl,
  evidenceAccessMessage,
} from '@/lib/compliance/evidenceFileAccess';
import { EvidenceUploadDialog } from './EvidenceUploadDialog';
import { EvidenceEditDialog, type EditableEvidence } from './EvidenceEditDialog';
import { EvidencePreviewDialog } from './EvidencePreviewDialog';

const PERMISSION = 'manage_compliance';

const EVIDENCE_TYPES = ['DOCUMENT', 'PHOTO', 'PAYROLL', 'SIGNED_SHEET', 'NOTE', 'AUDIO', 'OTHER'];
const QUICK_FILTERS = [
  { code: 'ALL', label: 'All Evidence' },
  { code: 'PHOTOS', label: 'Photos' },
  { code: 'DOCUMENTS', label: 'Documents' },
  { code: 'PAYROLL', label: 'Payroll' },
  { code: 'NO_FINDING', label: 'No Finding' },
  { code: 'MISSING', label: 'Missing File' },
  { code: 'MINE', label: 'My Uploads' },
];
const SORTS = [
  { code: 'captured_at', label: 'Captured Date' },
  { code: 'employer', label: 'Employer' },
  { code: 'inspection', label: 'Inspection' },
  { code: 'type', label: 'Evidence Type' },
  { code: 'file_name', label: 'File Name' },
  { code: 'captured_by', label: 'Captured By' },
  { code: 'file_size', label: 'File Size' },
];

export default function InspectionEvidencePage() {
  if (!isComplianceFeatureEnabled('inspections.evidence') || !isComplianceFeatureEnabled('inspections')) {
    return (
      <div className="container mx-auto p-6">
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <AlertCircle className="mx-auto h-8 w-8 mb-2" />
          Inspection Evidence is disabled.
        </CardContent></Card>
      </div>
    );
  }
  return (
    <PermissionWrapper moduleName={PERMISSION}>
      <Inner />
    </PermissionWrapper>
  );
}

function statusBadge(row: EvidenceRow) {
  if (row.status === 'WITHDRAWN') return <Badge variant="destructive">Withdrawn</Badge>;
  if (row.status === 'SUPERSEDED') return <Badge variant="secondary">Superseded</Badge>;
  if (row.file_state === 'MISSING') return <Badge className="bg-orange-500/15 text-orange-700 hover:bg-orange-500/20">Missing File</Badge>;
  if (row.file_state === 'NO_FILE') return <Badge variant="outline">Note only</Badge>;
  return <Badge className="bg-green-500/15 text-green-700 hover:bg-green-500/20">Active</Badge>;
}

function Inner() {
  const reg = useEvidenceRegister();
  const [searchInput, setSearchInput] = useState(reg.filters.search ?? '');
  const debounced = useDebounce(searchInput, 350);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EditableEvidence | null>(null);
  const [previewRow, setPreviewRow] = useState<EvidenceRow | null>(null);
  const [withdrawTarget, setWithdrawTarget] = useState<EvidenceRow | null>(null);
  const [withdrawReason, setWithdrawReason] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Push the debounced search into URL state.
  useMemo(() => {
    if ((reg.filters.search ?? '') !== debounced) reg.patch({ q: debounced || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const caps = reg.capabilities;
  const kpis = reg.kpis;
  const totalPages = Math.max(1, Math.ceil(reg.total / reg.pageSize));
  const from = reg.total === 0 ? 0 : (reg.page - 1) * reg.pageSize + 1;
  const to = Math.min(reg.page * reg.pageSize, reg.total);

  const openFile = async (row: EvidenceRow) => {
    setBusyId(row.id);
    const res = await resolveEvidenceUrl(row, 'VIEW');
    setBusyId(null);
    if (res.ok) window.open(res.url, '_blank', 'noopener,noreferrer');
    else toast.error(evidenceAccessMessage(res));
  };

  const download = async (row: EvidenceRow) => {
    setBusyId(row.id);
    const res = await downloadEvidenceFile(row);
    setBusyId(null);
    if (!res.ok) toast.error(evidenceAccessMessage(res));
  };

  return (
    <div className="container mx-auto p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <FolderOpen className="h-6 w-6" /> Inspection Evidence Register
          </h1>
          <p className="text-muted-foreground text-sm">
            Evidence captured during compliance inspections — traceable from employer and inspection
            through to finding and violation.
          </p>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button onClick={() => setUploadOpen(true)} disabled={!caps?.can_attach}>
                  <Plus className="h-4 w-4 mr-2" /> Attach Evidence
                </Button>
              </span>
            </TooltipTrigger>
            {!caps?.can_attach && <TooltipContent>You do not have permission to attach evidence.</TooltipContent>}
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Total Evidence', value: kpis?.total },
          { label: 'Captured This Month', value: kpis?.this_month },
          { label: 'Linked to Findings', value: kpis?.linked_findings },
          { label: 'Missing Files', value: kpis?.missing_files },
          { label: 'Superseded / Withdrawn', value: kpis?.superseded },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="py-3">
              <div className="text-xs text-muted-foreground">{k.label}</div>
              <div className="text-xl font-semibold">{k.value ?? '—'}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick filters + search + advanced */}
      <div className="flex flex-wrap items-center gap-2">
        {QUICK_FILTERS.map((qf) => (
          <Button
            key={qf.code}
            size="sm"
            variant={(reg.filters.quick ?? 'ALL') === qf.code ? 'default' : 'outline'}
            onClick={() => reg.patch({ quick: qf.code === 'ALL' ? undefined : qf.code })}
          >
            {qf.label}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[280px]">
          <Label className="text-xs">Search</Label>
          <Input
            placeholder="Search file, employer, inspection, finding or user..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>

        <div className="w-44">
          <Label className="text-xs">Sort By</Label>
          <Select value={reg.sort} onValueChange={(v) => reg.patch({ sort: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={() => reg.patch({ dir: reg.dir === 'asc' ? 'desc' : 'asc' }, false)}>
          <ArrowUpDown className="h-4 w-4 mr-2" />{reg.dir === 'asc' ? 'Ascending' : 'Descending'}
        </Button>

        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline"><Filter className="h-4 w-4 mr-2" /> Filters</Button>
          </SheetTrigger>
          <SheetContent className="overflow-y-auto">
            <SheetHeader><SheetTitle>Advanced Filters</SheetTitle></SheetHeader>
            <div className="space-y-4 mt-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Evidence Type</Label>
                <Select value={reg.filters.types?.[0] ?? 'ALL'} onValueChange={(v) => reg.patch({ types: v === 'ALL' ? undefined : [v] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Types</SelectItem>
                    {EVIDENCE_TYPES.map((t) => <SelectItem key={t} value={t}>{evidenceTypeLabel(t)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Employer</Label>
                <Select value={reg.filters.employer ?? 'ALL'} onValueChange={(v) => reg.patch({ employer: v === 'ALL' ? undefined : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="ALL">All Employers</SelectItem>
                    {(reg.facets?.employers ?? []).map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.name} ({e.id})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Inspection</Label>
                <Select value={reg.filters.inspection_id ?? 'ALL'} onValueChange={(v) => reg.patch({ inspection: v === 'ALL' ? undefined : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="ALL">All Inspections</SelectItem>
                    {(reg.facets?.inspections ?? []).map((i) => (
                      <SelectItem key={i.id} value={i.id}>{i.number} — {i.employer}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Linked Finding</Label>
                <Select value={reg.filters.finding ?? 'ALL'} onValueChange={(v) => reg.patch({ finding: v === 'ALL' ? undefined : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Any</SelectItem>
                    <SelectItem value="HAS">Has Finding</SelectItem>
                    <SelectItem value="NONE">No Finding</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Captured By</Label>
                <Select value={reg.filters.captured_by ?? 'ALL'} onValueChange={(v) => reg.patch({ by: v === 'ALL' ? undefined : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="ALL">Anyone</SelectItem>
                    {(reg.facets?.captured_by ?? []).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">File Status</Label>
                <Select value={reg.filters.file_states?.[0] ?? 'ALL'} onValueChange={(v) => reg.patch({ file_states: v === 'ALL' ? undefined : [v] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Any</SelectItem>
                    <SelectItem value="AVAILABLE">Available</SelectItem>
                    <SelectItem value="MISSING">Missing</SelectItem>
                    <SelectItem value="NO_FILE">Note only</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Lifecycle Status</Label>
                <Select value={reg.filters.statuses?.[0] ?? 'ALL'} onValueChange={(v) => reg.patch({ statuses: v === 'ALL' ? undefined : [v] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Any</SelectItem>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="SUPERSEDED">Superseded</SelectItem>
                    <SelectItem value="WITHDRAWN">Withdrawn</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Captured From</Label>
                  <Input type="date" value={reg.filters.date_from ?? ''} onChange={(e) => reg.patch({ from: e.target.value || undefined })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Captured To</Label>
                  <Input type="date" value={reg.filters.date_to ?? ''} onChange={(e) => reg.patch({ to: e.target.value || undefined })} />
                </div>
              </div>

              <Button variant="outline" className="w-full" onClick={reg.clearFilters}>Clear Filters</Button>
            </div>
          </SheetContent>
        </Sheet>

        <Button variant="ghost" size="icon" onClick={() => reg.refetch()} title="Refresh">
          <RefreshCw className={`h-4 w-4 ${reg.isFetching ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base">Evidence Records</CardTitle>
              <CardDescription>
                {reg.total > 0
                  ? `Showing ${from}–${to} of ${reg.total} evidence records`
                  : 'No evidence records'}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs">Rows</Label>
              <Select value={String(reg.pageSize)} onValueChange={(v) => reg.patch({ size: v })}>
                <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[25, 50, 100, 200].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {reg.error ? (
            <div className="py-10 text-center space-y-3">
              <AlertCircle className="h-8 w-8 mx-auto text-destructive" />
              <p className="text-sm font-medium">Unable to load evidence</p>
              <p className="text-xs text-muted-foreground">{reg.error.message}</p>
              <Button size="sm" variant="outline" onClick={() => reg.refetch()}>Retry</Button>
            </div>
          ) : reg.isLoading ? (
            <div className="py-10 text-center text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mx-auto" />
            </div>
          ) : reg.rows.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <FileWarning className="h-8 w-8 mx-auto text-muted-foreground" />
              {reg.hasActiveFilters ? (
                <>
                  <p className="text-sm">No evidence matches the selected filters.</p>
                  <Button size="sm" variant="outline" onClick={reg.clearFilters}>Clear Filters</Button>
                </>
              ) : (
                <>
                  <p className="text-sm">No inspection evidence found</p>
                  <p className="text-xs text-muted-foreground">Evidence attached to inspections will appear here.</p>
                </>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Captured</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Inspection</TableHead>
                  <TableHead>Employer</TableHead>
                  <TableHead>Finding</TableHead>
                  <TableHead>Violation</TableHead>
                  <TableHead>Captured By</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reg.rows.map((r) => {
                  const accessible = r.file_state === 'AVAILABLE';
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {r.captured_at ? format(new Date(r.captured_at), 'dd MMM yyyy HH:mm') : '—'}
                      </TableCell>
                      <TableCell><Badge variant="outline">{evidenceTypeLabel(r.evidence_type)}</Badge></TableCell>
                      <TableCell className="max-w-[220px]">
                        {accessible ? (
                          <button
                            className="truncate font-medium text-primary hover:underline text-left w-full"
                            onClick={() => setPreviewRow(r)}
                            title="Preview evidence"
                          >
                            {r.file_name}
                          </button>
                        ) : (
                          <div className="truncate font-medium text-muted-foreground">{r.file_name}</div>
                        )}
                        {r.description && (
                          <div className="text-xs text-muted-foreground truncate">{r.description}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{formatFileSize(r.file_size)}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.inspection_id ? (
                          <Link className="text-primary hover:underline" to={`/compliance/field/inspections?inspection=${r.inspection_id}`}>
                            {r.inspection_number ?? r.inspection_id.slice(0, 8)}
                          </Link>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-xs max-w-[160px]">
                        {r.employer_id ? (
                          <Link className="text-primary hover:underline truncate block" to={`/compliance/field/employer-360/${r.employer_id}`}>
                            {r.employer_name ?? r.employer_id}
                          </Link>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-xs max-w-[160px]">
                        {r.finding_id ? (
                          <Link className="text-primary hover:underline truncate block" to={`/compliance/field/findings?finding_id=${r.finding_id}`}>
                            <Link2 className="h-3 w-3 inline mr-1" />
                            {r.finding_title ?? 'Finding'}
                            {r.finding_severity && <span className="text-muted-foreground"> · {r.finding_severity}</span>}
                          </Link>
                        ) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.violation_id ? (
                          <Link className="text-primary hover:underline" to={`/compliance/enforcement/violations/${r.violation_id}`}>
                            {r.violation_number ?? 'Violation'}
                          </Link>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-xs">{r.captured_by ?? '—'}</TableCell>
                      <TableCell>{statusBadge(r)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {busyId === r.id && <Loader2 className="h-4 w-4 animate-spin" />}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="ghost"><MoreHorizontal className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem disabled={!accessible} onClick={() => setPreviewRow(r)}>
                                <Eye className="h-4 w-4 mr-2" /> {accessible ? 'Open / Preview' : 'File unavailable'}
                              </DropdownMenuItem>
                              <DropdownMenuItem disabled={!accessible} onClick={() => openFile(r)}>
                                <Eye className="h-4 w-4 mr-2" /> Open in new tab
                              </DropdownMenuItem>
                              <DropdownMenuItem disabled={!accessible} onClick={() => download(r)}>
                                <Download className="h-4 w-4 mr-2" /> Download
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                disabled={!caps?.can_edit || r.status !== 'ACTIVE'}
                                onClick={() => setEditTarget({
                                  id: r.id,
                                  inspection_id: r.inspection_id,
                                  evidence_type: r.evidence_type,
                                  description: r.description,
                                  finding_id: r.finding_id,
                                  file_name: r.file_name,
                                  version_no: r.version_no,
                                  downstream_locked: r.downstream_locked,
                                  captured_by: r.captured_by,
                                  captured_at: r.captured_at,
                                })}
                              >
                                <Pencil className="h-4 w-4 mr-2" /> Edit / Replace
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive"
                                disabled={!caps?.can_withdraw || r.status === 'WITHDRAWN'}
                                onClick={() => { setWithdrawTarget(r); setWithdrawReason(''); }}
                              >
                                <Ban className="h-4 w-4 mr-2" /> Withdraw Evidence
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {reg.total > 0 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-xs text-muted-foreground">Page {reg.page} of {totalPages}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={reg.page <= 1}
                  onClick={() => reg.patch({ page: String(reg.page - 1) }, false)}>Previous</Button>
                <Button size="sm" variant="outline" disabled={reg.page >= totalPages}
                  onClick={() => reg.patch({ page: String(reg.page + 1) }, false)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <EvidenceUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} onCreated={reg.invalidate} />
      <EvidenceEditDialog
        open={!!editTarget}
        onOpenChange={(o) => { if (!o) setEditTarget(null); }}
        evidence={editTarget}
        canEdit={!!caps?.can_edit}
        canReplace={!!caps?.can_replace}
        onSaved={reg.invalidate}
      />
      <EvidencePreviewDialog row={previewRow} open={!!previewRow} onOpenChange={(o) => { if (!o) setPreviewRow(null); }} />

      <AlertDialog open={!!withdrawTarget} onOpenChange={(o) => { if (!o) setWithdrawTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Withdraw this evidence?</AlertDialogTitle>
            <AlertDialogDescription>
              Evidence is never hard-deleted: the record, file and audit trail are retained and the item
              is marked <strong>Withdrawn</strong> so historical traceability to findings, violations and
              reports is preserved. A reason is required.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={withdrawReason}
            onChange={(e) => setWithdrawReason(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Reason for withdrawal"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reg.withdraw.isPending}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={!withdrawReason.trim() || reg.withdraw.isPending}
              onClick={() => {
                if (!withdrawTarget) return;
                reg.withdraw.mutate(
                  { id: withdrawTarget.id, reason: withdrawReason.trim() },
                  {
                    onSuccess: () => { toast.success('Evidence withdrawn'); setWithdrawTarget(null); },
                    onError: (e: any) => toast.error(e?.message ?? 'Failed to withdraw evidence'),
                  },
                );
              }}
            >
              {reg.withdraw.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Withdraw
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
