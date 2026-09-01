import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  MapPin, Clock, CheckCircle2, AlertTriangle, Filter, Eye, Upload, LogIn, LogOut,
  Loader2, Building2, Download, RotateCcw, ArrowUpDown, Camera, ClipboardList, Navigation,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SearchBar } from "@/components/common/SearchBar";
import { useToast } from "@/hooks/use-toast";
import { exportToExcel } from "@/utils/exportUtils";
import {
  useFieldOperations, useFieldVisitDetail, QUICK_VIEWS, EXECUTION_STATUS_OPTIONS,
  FIELD_SORTS, DATE_PRESETS, EVIDENCE_TYPES, PAGE_SIZE_OPTIONS,
  type FieldVisitRow,
} from "@/hooks/compliance/useFieldOperations";

const STATUS_STYLES: Record<string, string> = {
  PLANNED: "bg-muted text-muted-foreground",
  PENDING: "bg-muted text-muted-foreground",
  IN_PROGRESS: "bg-warning/15 text-warning border-warning/40",
  COMPLETED: "bg-success/15 text-success border-success/40",
  NOT_DONE: "bg-destructive/15 text-destructive border-destructive/40",
  RESCHEDULED: "bg-info/15 text-info border-info/40",
};

function fmtDate(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function fmtTime(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function fmtDuration(minutes?: number | null) {
  if (minutes === null || minutes === undefined) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function FieldOperations() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const ops = useFieldOperations();

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [checkInRow, setCheckInRow] = useState<FieldVisitRow | null>(null);
  const [checkOutRow, setCheckOutRow] = useState<FieldVisitRow | null>(null);
  const [evidenceRow, setEvidenceRow] = useState<FieldVisitRow | null>(null);
  const [checkInNotes, setCheckInNotes] = useState("");
  const [outcomeNotes, setOutcomeNotes] = useState("");
  const [visitFindings, setVisitFindings] = useState("");
  const [evidenceType, setEvidenceType] = useState("PHOTO");
  const [evidenceDescription, setEvidenceDescription] = useState("");
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [exporting, setExporting] = useState(false);

  const detail = useFieldVisitDetail(detailId);
  const { kpis, rows, total, page, pageSize } = ops;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const searchValue = ops.filters.search ?? "";
  const quick = ops.filters.quick ?? "ALL";

  const kpiCards = useMemo(
    () => [
      { label: "Active check-ins", value: kpis.active_visits, icon: Navigation, quick: "ACTIVE" },
      { label: "Scheduled today", value: kpis.scheduled_today, icon: Clock, quick: "TODAY" },
      { label: "Planned", value: kpis.planned, icon: ClipboardList, quick: "PLANNED" },
      { label: "Completed", value: kpis.completed, icon: CheckCircle2, quick: "COMPLETED" },
      { label: "Overdue", value: kpis.overdue, icon: AlertTriangle, quick: "OVERDUE" },
      { label: "No evidence", value: kpis.no_evidence, icon: Camera, quick: "NO_EVIDENCE" },
    ],
    [kpis],
  );

  const handleCheckIn = async () => {
    if (!checkInRow) return;
    try {
      await ops.checkIn.mutateAsync({ itemId: checkInRow.id, notes: checkInNotes || undefined });
      toast({ title: "Checked in", description: `Visit to ${checkInRow.employer_name} started. Time and GPS recorded.` });
      setCheckInRow(null);
      setCheckInNotes("");
    } catch (e) {
      toast({ title: "Check-in failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const handleCheckOut = async () => {
    if (!checkOutRow) return;
    if (!outcomeNotes.trim()) {
      toast({ title: "Outcome required", description: "Record the visit outcome before checking out.", variant: "destructive" });
      return;
    }
    try {
      await ops.checkOut.mutateAsync({
        itemId: checkOutRow.id,
        outcomeNotes: outcomeNotes.trim(),
        findings: visitFindings || undefined,
      });
      toast({ title: "Checked out", description: "Visit completed and permanently recorded." });
      setCheckOutRow(null);
      setOutcomeNotes("");
      setVisitFindings("");
    } catch (e) {
      toast({ title: "Check-out failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const handleEvidenceUpload = async () => {
    if (!evidenceRow) return;
    if (evidenceFiles.length === 0) {
      toast({ title: "Select a file", description: "Choose at least one evidence file.", variant: "destructive" });
      return;
    }
    try {
      const res = await ops.addEvidence.mutateAsync({
        itemId: evidenceRow.id,
        files: evidenceFiles,
        evidenceType,
        description: evidenceDescription || undefined,
      });
      toast({ title: "Evidence recorded", description: `${res.stored} file(s) stored against this visit.` });
      setEvidenceRow(null);
      setEvidenceFiles([]);
      setEvidenceDescription("");
    } catch (e) {
      toast({ title: "Upload failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const all = await ops.fetchAllForExport();
      const columns = [
        { header: "Scheduled date", key: "scheduled_date", width: 16 },
        { header: "Employer", key: "employer_name", width: 32 },
        { header: "Employer no.", key: "employer_id", width: 14 },
        { header: "Territory", key: "territory", width: 14 },
        { header: "Visit type", key: "visit_type", width: 16 },
        { header: "Status", key: "execution_status", width: 14 },
        { header: "Inspector", key: "inspector_name", width: 24 },
        { header: "Inspector code", key: "inspector_code", width: 14 },
        { header: "Plan", key: "plan_number", width: 20 },
        { header: "Check-in", key: "check_in_time", width: 22 },
        { header: "Check-out", key: "check_out_time", width: 22 },
        { header: "Duration (min)", key: "duration_minutes", width: 14 },
        { header: "Evidence", key: "evidence_count", width: 10 },
        { header: "Findings", key: "findings_count", width: 10 },
        { header: "Inspection", key: "inspection_number", width: 18 },
        { header: "Overdue", key: "overdue", width: 10 },
        { header: "Purpose", key: "purpose", width: 40 },
      ];
      await exportToExcel(
        all.map((r) => ({
          scheduled_date: r.scheduled_date ?? "",
          employer_name: r.employer_name ?? "",
          employer_id: r.employer_id ?? "",
          territory: r.territory ?? "",
          visit_type: r.visit_type ?? "",
          execution_status: r.execution_status,
          inspector_name: r.inspector_name ?? "",
          inspector_code: r.inspector_code ?? "",
          plan_number: r.plan_number ?? "",
          check_in_time: r.check_in_time ?? "",
          check_out_time: r.check_out_time ?? "",
          duration_minutes: r.duration_minutes ?? "",
          evidence_count: r.evidence_count,
          findings_count: r.findings_count,
          inspection_number: r.inspection_number ?? "",
          overdue: r.is_overdue ? "Yes" : "No",
          purpose: r.purpose ?? "",
        })),
        columns,
        "field-operations",
        "Field Operations",
      );
      toast({ title: "Export ready", description: `${all.length} field visits exported.` });
    } catch (e) {
      toast({ title: "Export failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  if (ops.error) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <AlertTriangle className="h-8 w-8 mx-auto text-destructive" />
            <p className="font-medium text-foreground">Field operations unavailable</p>
            <p className="text-sm text-muted-foreground">{ops.error.message}</p>
            <Button variant="outline" onClick={() => ops.refetch()}>Retry</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Field Execution Workspace</h1>
          <p className="text-muted-foreground">
            Planned and executed field visits, check-in lifecycle, evidence and findings
            {ops.scope ? ` • scope: ${ops.scope === "ALL" ? "All inspectors" : "My visits"}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {ops.isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <Button variant="outline" onClick={handleExport} disabled={exporting || total === 0}>
            {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            Export
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpiCards.map((k) => {
          const Icon = k.icon;
          const active = quick === k.quick;
          return (
            <button key={k.label} type="button" onClick={() => ops.patchFilters({ quick: active ? "ALL" : k.quick })} className="text-left">
              <Card className={active ? "border-primary ring-1 ring-primary/40" : "hover:border-primary/50 transition-colors"}>
                <CardContent className="pt-5 pb-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-2xl font-bold text-foreground">{k.value ?? 0}</span>
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <p className="text-xs text-muted-foreground">{k.label}</p>
                </CardContent>
              </Card>
            </button>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">
              Field visits <span className="text-muted-foreground font-normal">({total.toLocaleString()})</span>
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={ops.sort} onValueChange={(v) => ops.toggleSort(v)}>
                <SelectTrigger className="w-[190px]"><ArrowUpDown className="h-3.5 w-3.5 mr-2" /><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FIELD_SORTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => ops.toggleSort(ops.sort)}>
                {ops.dir === "asc" ? "Ascending" : "Descending"}
              </Button>
              <Button variant="outline" size="sm" className="gap-2" onClick={() => setFiltersOpen(true)}>
                <Filter className="h-4 w-4" />Filters
                {ops.activeFilterCount > 0 && <Badge variant="secondary">{ops.activeFilterCount}</Badge>}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="min-w-[280px] flex-1">
              <SearchBar
                value={searchValue}
                onChange={(v) => ops.patchFilters({ search: v })}
                placeholder="Search employer, employer no., inspector name or code, plan, territory, inspection…"
              />
            </div>
            <Select value={quick} onValueChange={(v) => ops.patchFilters({ quick: v })}>
              <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {QUICK_VIEWS.map((q) => <SelectItem key={q.value} value={q.value}>{q.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={ops.datePreset} onValueChange={ops.setDatePreset}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DATE_PRESETS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                <SelectItem value="CUSTOM">Custom range</SelectItem>
              </SelectContent>
            </Select>
            {ops.activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" onClick={ops.resetFilters}><RotateCcw className="h-4 w-4 mr-2" />Reset</Button>
            )}
          </div>

          {ops.isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : rows.length === 0 ? (
            <div className="text-center py-12 space-y-2">
              <ClipboardList className="h-8 w-8 mx-auto text-muted-foreground" />
              <p className="font-medium text-foreground">No field visits match this view</p>
              <p className="text-sm text-muted-foreground">
                Field visits originate from approved weekly plans. Adjust your search or filters, or plan visits in the Weekly Plan Builder.
              </p>
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="cursor-pointer" onClick={() => ops.toggleSort("schedule")}>Scheduled</TableHead>
                    <TableHead className="cursor-pointer" onClick={() => ops.toggleSort("employer")}>Employer</TableHead>
                    <TableHead className="cursor-pointer" onClick={() => ops.toggleSort("inspector")}>Inspector</TableHead>
                    <TableHead className="cursor-pointer" onClick={() => ops.toggleSort("status")}>Status</TableHead>
                    <TableHead className="cursor-pointer" onClick={() => ops.toggleSort("checkin")}>Check-in / out</TableHead>
                    <TableHead className="cursor-pointer text-right" onClick={() => ops.toggleSort("evidence")}>Evidence</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const isActive = !!r.check_in_time && !r.check_out_time;
                    return (
                      <TableRow key={r.id} className={isActive ? "bg-warning/5" : undefined}>
                        <TableCell className="align-top">
                          <div className="font-medium text-foreground">{fmtDate(r.scheduled_date)}</div>
                          <div className="text-xs text-muted-foreground">
                            {r.scheduled_start_time ? r.scheduled_start_time.slice(0, 5) : "—"} • {r.plan_number ?? "—"}
                          </div>
                          {r.is_overdue && <Badge variant="destructive" className="mt-1 text-[10px]">Overdue</Badge>}
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="font-medium text-foreground">{r.employer_name ?? "—"}</div>
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <MapPin className="h-3 w-3" />{r.employer_id ?? "—"} • {r.territory ?? "No territory"}
                          </div>
                          <div className="text-xs text-muted-foreground">{r.visit_type ?? "VISIT"}{r.is_mandatory ? " • Mandatory" : ""}</div>
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="text-sm text-foreground">{r.inspector_name ?? "Unassigned"}</div>
                          <div className="text-xs text-muted-foreground">{r.inspector_code ?? "—"}</div>
                        </TableCell>
                        <TableCell className="align-top">
                          <Badge variant="outline" className={STATUS_STYLES[r.execution_status] ?? ""}>
                            {r.execution_status.replace(/_/g, " ")}
                          </Badge>
                          {isActive && <div className="text-xs text-warning mt-1">In progress • {fmtDuration(r.duration_minutes)}</div>}
                        </TableCell>
                        <TableCell className="align-top text-xs text-muted-foreground">
                          <div>In: {fmtTime(r.check_in_time)}</div>
                          <div>Out: {fmtTime(r.check_out_time)}</div>
                        </TableCell>
                        <TableCell className="align-top text-right">
                          <div className="text-sm font-medium text-foreground">{r.evidence_count}</div>
                          <div className="text-xs text-muted-foreground">{r.findings_count} finding(s)</div>
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="flex flex-wrap gap-1 justify-end">
                            <Button size="sm" variant="ghost" aria-label="View visit record" onClick={() => setDetailId(r.id)}><Eye className="h-4 w-4" /></Button>
                            {r.employer_id && (
                              <Button size="sm" variant="ghost" aria-label="Open visit workspace" onClick={() => navigate(`/compliance/field/visit/${r.employer_id}`)}>
                                <Building2 className="h-4 w-4" />
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" aria-label="Record evidence" onClick={() => { setEvidenceRow(r); setEvidenceFiles([]); }}>
                              <Upload className="h-4 w-4" />
                            </Button>
                            {isActive ? (
                              <Button size="sm" variant="destructive" onClick={() => { setCheckOutRow(r); setOutcomeNotes(""); setVisitFindings(""); }}>
                                <LogOut className="h-4 w-4 mr-1" />Check out
                              </Button>
                            ) : r.execution_status === "COMPLETED" ? (
                              <Badge variant="outline" className="text-[10px]">Closed</Badge>
                            ) : (
                              <Button size="sm" onClick={() => { setCheckInRow(r); setCheckInNotes(""); }}>
                                <LogIn className="h-4 w-4 mr-1" />Check in
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Rows per page</span>
              <Select value={String(pageSize)} onValueChange={(v) => ops.setPageSize(Number(v))}>
                <SelectTrigger className="w-[90px] h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => ops.setPage(page - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => ops.setPage(page + 1)}>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader><SheetTitle>Field operations filters</SheetTitle></SheetHeader>
          <div className="space-y-6 py-6">
            <div className="space-y-2">
              <Label>Execution status</Label>
              <div className="grid grid-cols-2 gap-2">
                {EXECUTION_STATUS_OPTIONS.map((s) => (
                  <label key={s.value} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={(ops.filters.statuses ?? []).includes(s.value)}
                      onCheckedChange={() => ops.toggleInList("statuses", s.value)}
                    />
                    {s.label}
                  </label>
                ))}
              </div>
            </div>

            {ops.facets.visit_types.length > 0 && (
              <div className="space-y-2">
                <Label>Visit type</Label>
                <div className="grid grid-cols-2 gap-2">
                  {ops.facets.visit_types.map((t) => (
                    <label key={t} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={(ops.filters.visit_types ?? []).includes(t)}
                        onCheckedChange={() => ops.toggleInList("visit_types", t)}
                      />
                      {t}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {ops.facets.territories.length > 0 && (
              <div className="space-y-2">
                <Label>Territory</Label>
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                  {ops.facets.territories.map((t) => (
                    <label key={t} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={(ops.filters.territories ?? []).includes(t)}
                        onCheckedChange={() => ops.toggleInList("territories", t)}
                      />
                      {t}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Inspector</Label>
              <Select
                value={ops.filters.inspector ?? "ALL"}
                onValueChange={(v) => ops.patchFilters({ inspector: v === "ALL" ? undefined : v })}
              >
                <SelectTrigger><SelectValue placeholder="All inspectors" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All inspectors</SelectItem>
                  {ops.facets.inspectors.filter((i) => i.id).map((i) => (
                    <SelectItem key={i.id as string} value={i.id as string}>{i.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Employer</Label>
              <Select
                value={ops.filters.employer ?? "ALL"}
                onValueChange={(v) => ops.patchFilters({ employer: v === "ALL" ? undefined : v })}
              >
                <SelectTrigger><SelectValue placeholder="All employers" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="ALL">All employers</SelectItem>
                  {ops.facets.employers.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.name ?? e.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>From</Label>
                <Input
                  type="date"
                  value={ops.filters.date_from ?? ""}
                  onChange={(e) => { ops.setDatePreset("CUSTOM"); ops.patchFilters({ date_from: e.target.value }); }}
                />
              </div>
              <div className="space-y-2">
                <Label>To</Label>
                <Input
                  type="date"
                  value={ops.filters.date_to ?? ""}
                  onChange={(e) => { ops.setDatePreset("CUSTOM"); ops.patchFilters({ date_to: e.target.value }); }}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={!!ops.filters.mine_only}
                onCheckedChange={(c) => ops.patchFilters({ mine_only: !!c })}
              />
              Only my visits
            </label>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={ops.resetFilters}>Reset</Button>
              <Button className="flex-1" onClick={() => setFiltersOpen(false)}>Apply</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Detail */}
      <Dialog open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Field visit record</DialogTitle>
            <DialogDescription>Execution lifecycle, evidence, findings and audit trail</DialogDescription>
          </DialogHeader>
          {detail.isLoading ? (
            <div className="py-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : detail.data ? (
            <div className="space-y-5 py-2">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><Label className="text-muted-foreground">Employer</Label><p className="font-medium">{String((detail.data.item as any)?.employer_name ?? "—")}</p></div>
                <div><Label className="text-muted-foreground">Plan</Label><p className="font-medium">{String((detail.data.plan as any)?.plan_number ?? "—")}</p></div>
                <div><Label className="text-muted-foreground">Scheduled</Label><p className="font-medium">{fmtDate((detail.data.item as any)?.scheduled_date)}</p></div>
                <div><Label className="text-muted-foreground">Status</Label><p className="font-medium">{String((detail.data.item as any)?.execution_status ?? "—")}</p></div>
                <div><Label className="text-muted-foreground">Check-in</Label><p className="font-medium">{fmtTime((detail.data.item as any)?.check_in_time)}</p></div>
                <div><Label className="text-muted-foreground">Check-out</Label><p className="font-medium">{fmtTime((detail.data.item as any)?.check_out_time)}</p></div>
                <div className="col-span-2"><Label className="text-muted-foreground">Purpose</Label><p>{String((detail.data.item as any)?.purpose ?? "—")}</p></div>
                <div className="col-span-2"><Label className="text-muted-foreground">Outcome</Label><p>{String((detail.data.item as any)?.outcome_notes ?? "Not recorded")}</p></div>
              </div>

              <Separator />
              <div>
                <h4 className="font-medium mb-2 text-sm">Evidence ({detail.data.evidence.length})</h4>
                {detail.data.evidence.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No evidence recorded for this visit.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {detail.data.evidence.map((e) => (
                      <li key={e.id} className="flex justify-between border rounded px-3 py-2">
                        <span>{e.file_name} <span className="text-muted-foreground">• {e.evidence_type}</span></span>
                        <span className="text-muted-foreground text-xs">{fmtTime(e.captured_at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <Separator />
              <div>
                <h4 className="font-medium mb-2 text-sm">Audit trail</h4>
                {detail.data.audit.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No recorded actions.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {detail.data.audit.map((a, idx) => (
                      <li key={idx} className="flex justify-between border rounded px-3 py-2">
                        <span>{a.action.replace(/_/g, " ")} <span className="text-muted-foreground">by {a.performed_by}</span></span>
                        <span className="text-muted-foreground text-xs">{fmtTime(a.performed_at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
          <DialogFooter><Button variant="outline" onClick={() => setDetailId(null)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Check in */}
      <Dialog open={!!checkInRow} onOpenChange={(o) => !o && setCheckInRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Check in to visit</DialogTitle>
            <DialogDescription>Start the field visit; time and GPS position are permanently recorded</DialogDescription>
          </DialogHeader>
          {checkInRow && (
            <div className="space-y-4 py-2">
              <div className="p-4 bg-muted rounded-lg space-y-1 text-sm">
                <p className="font-medium">{checkInRow.employer_name}</p>
                <p className="text-muted-foreground">Plan: {checkInRow.plan_number ?? "—"}</p>
                <p className="text-muted-foreground">Scheduled: {fmtDate(checkInRow.scheduled_date)}</p>
              </div>
              <div className="flex items-center gap-2 p-3 bg-info/10 rounded text-sm text-info">
                <MapPin className="h-4 w-4" />GPS position is captured on confirmation where the device allows it.
              </div>
              <div className="space-y-2">
                <Label htmlFor="checkin-notes">Initial notes (optional)</Label>
                <Textarea id="checkin-notes" rows={3} value={checkInNotes} onChange={(e) => setCheckInNotes(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCheckInRow(null)}>Cancel</Button>
            <Button onClick={handleCheckIn} disabled={ops.checkIn.isPending}>
              {ops.checkIn.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <LogIn className="h-4 w-4 mr-2" />}
              Confirm check-in
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Check out */}
      <Dialog open={!!checkOutRow} onOpenChange={(o) => !o && setCheckOutRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Check out of visit</DialogTitle>
            <DialogDescription>Close the visit with a recorded outcome</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="outcome">Visit outcome <span className="text-destructive">*</span></Label>
              <Textarea id="outcome" rows={3} value={outcomeNotes} onChange={(e) => setOutcomeNotes(e.target.value)} placeholder="What was carried out and concluded during this visit?" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="visit-findings">Findings summary (optional)</Label>
              <Textarea id="visit-findings" rows={3} value={visitFindings} onChange={(e) => setVisitFindings(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCheckOutRow(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleCheckOut} disabled={ops.checkOut.isPending}>
              {ops.checkOut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <LogOut className="h-4 w-4 mr-2" />}
              Confirm check-out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Evidence */}
      <Dialog open={!!evidenceRow} onOpenChange={(o) => !o && setEvidenceRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record evidence</DialogTitle>
            <DialogDescription>Files are stored in the secured field evidence area and linked to this visit</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Evidence type</Label>
              <Select value={evidenceType} onValueChange={setEvidenceType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EVIDENCE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="evidence-file">Select files</Label>
              <Input
                id="evidence-file"
                type="file"
                multiple
                onChange={(e) => setEvidenceFiles(Array.from(e.target.files ?? []))}
              />
              {evidenceFiles.length > 0 && (
                <p className="text-xs text-muted-foreground">{evidenceFiles.length} file(s) selected</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="evidence-description">Description</Label>
              <Textarea id="evidence-description" rows={3} value={evidenceDescription} onChange={(e) => setEvidenceDescription(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEvidenceRow(null)}>Cancel</Button>
            <Button onClick={handleEvidenceUpload} disabled={ops.addEvidence.isPending}>
              {ops.addEvidence.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
