import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import {
  Loader2, Users, RefreshCw, Plus, Pencil, Power, Search, X,
  ArrowUpDown, ArrowUp, ArrowDown, Inbox,
} from "lucide-react";
import { toast } from "sonner";
import { useComplianceWorkQueue } from "@/hooks/compliance/useComplianceWorkQueue";
import { WorkQueueToolbar, WorkQueuePagination } from "@/components/compliance/workbench/WorkQueueToolbar";

interface QueueRow {
  id: string;
  queue_code: string;
  queue_name: string;
  queue_type: string;
  zone_id: string;
  is_default: boolean;
  priority: number | null;
  is_active: boolean;
  zone_name?: string;
  member_count?: number;
}

interface ZoneOption { id: string; zone_code: string; zone_name: string; }

const QUEUE_TYPES = [
  { value: "OPS", label: "Operational", color: "bg-blue-100 text-blue-800" },
  { value: "REV", label: "Review", color: "bg-amber-100 text-amber-800" },
  { value: "LEG", label: "Legal", color: "bg-red-100 text-red-800" },
  { value: "FLB", label: "Fallback", color: "bg-gray-100 text-gray-800" },
];

type DefSortKey = "queue_code" | "queue_name" | "queue_type" | "zone_name" | "member_count" | "priority" | "is_active";

const ANY = "__ANY__";

export default function AssignmentQueues() {
  const [queues, setQueues] = useState<QueueRow[]>([]);
  const [zones, setZones] = useState<ZoneOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<QueueRow | null>(null);
  const [form, setForm] = useState({ queue_code: "", queue_name: "", queue_type: "OPS", zone_id: "", is_default: false, priority: 10, is_active: true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Enterprise filters for the queue-definition table
  const [defSearch, setDefSearch] = useState("");
  const [defType, setDefType] = useState<string>(ANY);
  const [defZone, setDefZone] = useState<string>(ANY);
  const [defStatus, setDefStatus] = useState<string>(ANY);
  const [defSort, setDefSort] = useState<DefSortKey>("queue_type");
  const [defDir, setDefDir] = useState<"asc" | "desc">("asc");

  const fetchQueues = useCallback(async () => {
    setLoading(true);
    const [{ data }, { data: zoneData }] = await Promise.all([
      supabase.from("ce_assignment_queues").select("*").order("queue_type").order("queue_name"),
      supabase.from("ce_zones").select("id, zone_code, zone_name").eq("is_active", true).order("zone_code"),
    ]);
    setZones(zoneData || []);

    const zoneMap = Object.fromEntries((zoneData || []).map(z => [z.id, z.zone_name]));

    const { data: members } = await supabase.from("ce_queue_members").select("queue_id");
    const countMap: Record<string, number> = {};
    (members || []).forEach((m: any) => { countMap[m.queue_id] = (countMap[m.queue_id] || 0) + 1; });

    setQueues((data || []).map((q: any) => ({
      ...q,
      zone_name: zoneMap[q.zone_id] || "—",
      member_count: countMap[q.id] || 0,
    })));
    setLoading(false);
  }, []);

  useEffect(() => { fetchQueues(); }, [fetchQueues]);

  const typeColor = (t: string) => QUEUE_TYPES.find(qt => qt.value === t)?.color || "bg-muted text-muted-foreground";

  const visibleQueues = useMemo(() => {
    const term = defSearch.trim().toLowerCase();
    let rows = queues.filter((q) => {
      if (term && !(`${q.queue_code} ${q.queue_name} ${q.zone_name ?? ""}`.toLowerCase().includes(term))) return false;
      if (defType !== ANY && q.queue_type !== defType) return false;
      if (defZone !== ANY && q.zone_id !== defZone) return false;
      if (defStatus === "active" && !q.is_active) return false;
      if (defStatus === "inactive" && q.is_active) return false;
      return true;
    });
    const mul = defDir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const av = a[defSort] as any;
      const bv = b[defSort] as any;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * mul;
      return String(av).localeCompare(String(bv)) * mul;
    });
    return rows;
  }, [queues, defSearch, defType, defZone, defStatus, defSort, defDir]);

  const defFilterCount = (defSearch.trim() ? 1 : 0) + (defType !== ANY ? 1 : 0) + (defZone !== ANY ? 1 : 0) + (defStatus !== ANY ? 1 : 0);

  const toggleDefSort = (key: DefSortKey) => {
    if (defSort === key) setDefDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setDefSort(key); setDefDir("asc"); }
  };

  const sortIcon = (key: DefSortKey) => {
    if (defSort !== key) return <ArrowUpDown className="ml-1 inline h-3 w-3 text-muted-foreground" />;
    return defDir === "asc"
      ? <ArrowUp className="ml-1 inline h-3 w-3" />
      : <ArrowDown className="ml-1 inline h-3 w-3" />;
  };

  const openCreate = () => { setEditing(null); setForm({ queue_code: "", queue_name: "", queue_type: "OPS", zone_id: "", is_default: false, priority: 10, is_active: true }); setErrors({}); setDialogOpen(true); };
  const openEdit = (q: QueueRow) => { setEditing(q); setForm({ queue_code: q.queue_code, queue_name: q.queue_name, queue_type: q.queue_type, zone_id: q.zone_id, is_default: q.is_default, priority: q.priority || 10, is_active: q.is_active }); setErrors({}); setDialogOpen(true); };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.queue_code?.trim()) e.queue_code = "Queue code is required";
    if (!form.queue_name?.trim()) e.queue_name = "Queue name is required";
    if (!form.zone_id) e.zone_id = "Zone is required";
    if (!form.queue_type) e.queue_type = "Queue type is required";
    const dup = queues.find(q => q.queue_code.toUpperCase() === form.queue_code.trim().toUpperCase() && q.id !== editing?.id);
    if (dup) e.queue_code = "Queue code already exists";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    const payload = {
      queue_code: form.queue_code.trim().toUpperCase(),
      queue_name: form.queue_name.trim(),
      queue_type: form.queue_type,
      zone_id: form.zone_id,
      is_default: form.is_default,
      priority: form.priority,
      is_active: form.is_active,
    };
    if (editing) {
      const { error } = await supabase.from("ce_assignment_queues").update(payload).eq("id", editing.id);
      if (error) { toast.error("Update failed: " + error.message); setSaving(false); return; }
      toast.success("Queue updated");
    } else {
      const { error } = await supabase.from("ce_assignment_queues").insert(payload);
      if (error) { toast.error("Create failed: " + error.message); setSaving(false); return; }
      toast.success("Queue created");
    }
    setSaving(false); setDialogOpen(false); fetchQueues();
  };

  const toggleActive = async (q: QueueRow) => {
    if (q.is_active && q.member_count! > 0) {
      toast.error(`Cannot deactivate: ${q.member_count} members are enrolled in this queue`);
      return;
    }
    const { error } = await supabase.from("ce_assignment_queues").update({ is_active: !q.is_active }).eq("id", q.id);
    if (error) { toast.error("Failed: " + error.message); return; }
    toast.success(q.is_active ? "Queue deactivated" : "Queue activated");
    fetchQueues();
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Assignment Queues</h1>
          <p className="text-muted-foreground">Manage operational, review, legal, and fallback queues across zones</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchQueues}><RefreshCw className="h-4 w-4 mr-2" /> Refresh</Button>
          <Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" /> New Queue</Button>
        </div>
      </div>

      <AssignableWorkPanel />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className="h-5 w-5" /> All Queues ({visibleQueues.length}
            {defFilterCount > 0 && visibleQueues.length !== queues.length ? ` of ${queues.length}` : ""})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1 max-w-sm">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={defSearch}
                onChange={(e) => setDefSearch(e.target.value)}
                placeholder="Search code, name or zone"
                className="pl-8"
              />
              {defSearch && (
                <button
                  type="button"
                  aria-label="Clear search"
                  className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
                  onClick={() => setDefSearch("")}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <Select value={defType} onValueChange={setDefType}>
              <SelectTrigger className="w-[150px]"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All types</SelectItem>
                {QUEUE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.value} – {t.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={defZone} onValueChange={setDefZone}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Zone" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All zones</SelectItem>
                {zones.map((z) => <SelectItem key={z.id} value={z.id}>{z.zone_code} – {z.zone_name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={defStatus} onValueChange={setDefStatus}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
            {defFilterCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setDefSearch(""); setDefType(ANY); setDefZone(ANY); setDefStatus(ANY); }}
              >
                Reset filters
              </Button>
            )}
          </div>

          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : visibleQueues.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
              <Inbox className="h-8 w-8" />
              <p className="text-sm">No queues match the current filters.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="cursor-pointer select-none" onClick={() => toggleDefSort("queue_code")}>Code{sortIcon("queue_code")}</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => toggleDefSort("queue_name")}>Queue Name{sortIcon("queue_name")}</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => toggleDefSort("queue_type")}>Type{sortIcon("queue_type")}</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => toggleDefSort("zone_name")}>Zone{sortIcon("zone_name")}</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => toggleDefSort("member_count")}>Members{sortIcon("member_count")}</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => toggleDefSort("priority")}>Priority{sortIcon("priority")}</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => toggleDefSort("is_active")}>Status{sortIcon("is_active")}</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleQueues.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell className="font-mono text-sm">{q.queue_code}</TableCell>
                    <TableCell className="font-medium">{q.queue_name}</TableCell>
                    <TableCell><Badge className={typeColor(q.queue_type)} variant="secondary">{q.queue_type}</Badge></TableCell>
                    <TableCell>{q.zone_name}</TableCell>
                    <TableCell>{q.member_count}</TableCell>
                    <TableCell>{q.priority ?? "—"}</TableCell>
                    <TableCell><Badge variant={q.is_active ? "default" : "secondary"}>{q.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(q)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => toggleActive(q)}><Power className={`h-4 w-4 ${q.is_active ? "text-destructive" : "text-green-600"}`} /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Queue" : "New Assignment Queue"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Queue Code *</Label>
              <Input value={form.queue_code} onChange={e => { setForm(f => ({ ...f, queue_code: e.target.value })); setErrors(er => ({ ...er, queue_code: "" })); }} maxLength={20} className={errors.queue_code ? "border-destructive" : ""} />
              {errors.queue_code && <p className="text-xs text-destructive mt-1">{errors.queue_code}</p>}
            </div>
            <div>
              <Label>Queue Name *</Label>
              <Input value={form.queue_name} onChange={e => { setForm(f => ({ ...f, queue_name: e.target.value })); setErrors(er => ({ ...er, queue_name: "" })); }} maxLength={100} className={errors.queue_name ? "border-destructive" : ""} />
              {errors.queue_name && <p className="text-xs text-destructive mt-1">{errors.queue_name}</p>}
            </div>
            <div>
              <Label>Queue Type *</Label>
              <Select value={form.queue_type} onValueChange={v => setForm(f => ({ ...f, queue_type: v }))}>
                <SelectTrigger className={errors.queue_type ? "border-destructive" : ""}><SelectValue /></SelectTrigger>
                <SelectContent>{QUEUE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.value} – {t.label}</SelectItem>)}</SelectContent>
              </Select>
              {errors.queue_type && <p className="text-xs text-destructive mt-1">{errors.queue_type}</p>}
            </div>
            <div>
              <Label>Zone *</Label>
              <Select value={form.zone_id} onValueChange={v => { setForm(f => ({ ...f, zone_id: v })); setErrors(er => ({ ...er, zone_id: "" })); }}>
                <SelectTrigger className={errors.zone_id ? "border-destructive" : ""}><SelectValue placeholder="Select zone" /></SelectTrigger>
                <SelectContent>{zones.map(z => <SelectItem key={z.id} value={z.id}>{z.zone_code} – {z.zone_name}</SelectItem>)}</SelectContent>
              </Select>
              {errors.zone_id && <p className="text-xs text-destructive mt-1">{errors.zone_id}</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Priority</Label>
                <Input type="number" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: parseInt(e.target.value) || 10 }))} min={1} max={999} />
              </div>
              <div className="flex items-end gap-4 pb-1">
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={form.is_default} onChange={e => setForm(f => ({ ...f, is_default: e.target.checked }))} id="q-default" />
                  <Label htmlFor="q-default">Default</Label>
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} id="q-active" />
                  <Label htmlFor="q-active">Active</Label>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{editing ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Enterprise assignable-work panel: the same server-side filtered, sorted and
 * paginated work queue used on Review Queue and Reassignment, scoped to
 * assignment mode (violations, cases, inspections and follow-up actions).
 */
function AssignableWorkPanel() {
  const wq = useComplianceWorkQueue("assignment");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Assignable Work</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <WorkQueueToolbar
          filters={wq.filters}
          options={wq.options}
          sort={wq.sort}
          dir={wq.dir}
          activeFilterCount={wq.activeFilterCount}
          total={wq.total}
          grandTotal={wq.grandTotal}
          scope={wq.scope}
          onPatch={wq.patchFilters}
          onReset={wq.resetFilters}
          onSort={(s) => wq.changeSort(s)}
          onToggleDir={wq.toggleDir}
        />

        {wq.error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            Work queue unavailable — {wq.error.message}
          </div>
        ) : wq.isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : wq.rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
            <Inbox className="h-8 w-8" />
            <p className="text-sm">No work items match the current filters.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Employer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Queue</TableHead>
                <TableHead>Due</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {wq.rows.map((r) => (
                <TableRow key={`${r.work_type}-${r.record_id}`}>
                  <TableCell>
                    <Link to={r.route} className="font-mono text-sm text-primary hover:underline">
                      {r.record_ref ?? r.record_id.slice(0, 8)}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{r.work_type}{r.item_type ? ` · ${r.item_type}` : ""}</TableCell>
                  <TableCell className="max-w-[220px] truncate text-sm">{r.employer_name ?? "—"}</TableCell>
                  <TableCell><Badge variant="outline">{r.status ?? "—"}</Badge></TableCell>
                  <TableCell>
                    <Badge variant={r.priority === "CRITICAL" || r.priority === "HIGH" ? "destructive" : "secondary"}>
                      {r.priority ?? "—"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{r.owner_name ?? <span className="text-muted-foreground">Unassigned</span>}</TableCell>
                  <TableCell className="text-sm">{r.queue_name ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    {r.due_date ?? "—"}
                    {r.overdue && <Badge variant="destructive" className="ml-1 text-[10px]">Overdue</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <WorkQueuePagination
          page={wq.page}
          totalPages={wq.totalPages}
          pageSize={wq.pageSize}
          total={wq.total}
          onPage={wq.setPage}
          onPageSize={(n) => { wq.setPageSize(n); wq.setPage(1); }}
          isFetching={wq.isFetching}
        />
      </CardContent>
    </Card>
  );
}
