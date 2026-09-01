import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Eye, ArrowRight, AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  useComplianceWorkQueue,
  type WorkQueueRow,
} from "@/hooks/compliance/useComplianceWorkQueue";
import { WorkQueuePagination, WorkQueueToolbar } from "@/components/compliance/workbench/WorkQueueToolbar";

interface InspectorOption { id: string; display_name: string; }

export default function ReviewQueue() {
  const navigate = useNavigate();
  const q = useComplianceWorkQueue("review", 25);

  const [reassignOpen, setReassignOpen] = useState(false);
  const [selected, setSelected] = useState<WorkQueueRow | null>(null);
  const [reassignTarget, setReassignTarget] = useState({ type: "queue", queue_id: "", inspector_id: "" });
  const [saving, setSaving] = useState(false);

  const { data: inspectors = [] } = useQuery({
    queryKey: ["ce-review-inspectors"],
    queryFn: async (): Promise<InspectorOption[]> => {
      const [{ data: insp }, { data: profiles }] = await Promise.all([
        supabase.from("ce_inspectors").select("id, inspector_code, legacy_inspector_code, profile_id").eq("is_active", true),
        supabase.from("profiles").select("id, full_name"),
      ]);
      const profileMap = Object.fromEntries((profiles || []).map((p: any) => [p.id, p.full_name]));
      return (insp || []).map((i: any) => ({
        id: i.id,
        display_name: (i.profile_id ? profileMap[i.profile_id] : null) || i.inspector_code || i.legacy_inspector_code || i.id.slice(0, 8),
      }));
    },
    staleTime: 300_000,
  });

  const openReassign = (row: WorkQueueRow) => {
    setSelected(row);
    setReassignTarget({ type: "queue", queue_id: "", inspector_id: "" });
    setReassignOpen(true);
  };

  const handleReassign = async () => {
    if (!selected) return;
    setSaving(true);

    // Governed server-side commands (Checkpoint F-S1): the database verifies the
    // caller's compliance capability, supersedes the prior assignment and writes
    // the violation header, history and audit atomically.
    let error: any = null;
    if (reassignTarget.type === "queue" && reassignTarget.queue_id) {
      ({ error } = await (supabase.rpc as any)("ce_violation_return_to_queue_v1", {
        p_violation_id: selected.record_id,
        p_reason: "MANUAL",
        p_notes: "Review queue reassignment",
        p_queue_id: reassignTarget.queue_id,
      }));
    } else if (reassignTarget.type === "officer" && reassignTarget.inspector_id) {
      ({ error } = await (supabase.rpc as any)("ce_violation_reassign_v1", {
        p_violation_id: selected.record_id,
        p_target_inspector_id: reassignTarget.inspector_id,
        p_reason: "MANUAL",
        p_notes: "Review queue reassignment",
      }));
    } else {
      toast.error("Select a target");
      setSaving(false);
      return;
    }

    if (error) { toast.error("Failed: " + error.message); setSaving(false); return; }

    toast.success("Violation reassigned");
    setSaving(false);
    setReassignOpen(false);
    q.refetch();
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="t-page-title">Review Queue</h1>
        <p className="t-page-subtitle">
          Work awaiting a review decision — searched, filtered and sorted across the whole authorised queue,
          not just the visible page.
        </p>
      </div>

      <WorkQueueToolbar
        filters={q.filters}
        options={q.options}
        sort={q.sort}
        dir={q.dir}
        activeFilterCount={q.activeFilterCount}
        total={q.total}
        grandTotal={q.grandTotal}
        scope={q.scope}
        showAssignmentChips
        onPatch={q.patchFilters}
        onReset={q.resetFilters}
        onSort={q.changeSort}
        onToggleDir={q.toggleDir}
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
          <CardTitle className="text-lg flex items-center gap-2">
            <Eye className="h-5 w-5" /> Review Items ({q.total.toLocaleString()})
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            Waiting-time breach threshold: {q.slaHours}h
          </span>
        </CardHeader>
        <CardContent>
          {q.error ? (
            <p className="py-8 text-center text-sm text-destructive">
              Review queue unavailable — {q.error.message}
            </p>
          ) : q.isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : q.rows.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No work matches the selected filters</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead>Work type</TableHead>
                    <TableHead>Employer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Waiting</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {q.rows.map((r) => (
                    <TableRow key={`${r.work_type}-${r.record_id}`}>
                      <TableCell className="font-mono text-sm">{r.record_ref || "—"}</TableCell>
                      <TableCell>
                        <div className="text-sm">{r.work_type}</div>
                        <div className="text-xs text-muted-foreground">{r.item_type}</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{r.employer_name || "—"}</div>
                        <div className="text-xs text-muted-foreground">{r.employer_id}</div>
                      </TableCell>
                      <TableCell><Badge variant="secondary">{r.status}</Badge></TableCell>
                      <TableCell>
                        <Badge variant={r.priority_rank === 1 ? "destructive" : r.priority_rank === 2 ? "default" : "secondary"}>
                          {r.priority || "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className={r.waiting_breach ? "text-destructive font-medium" : ""}>
                        {r.waiting_hours != null ? `${Math.round(r.waiting_hours)}h` : "—"}
                        {r.waiting_breach && <AlertTriangle className="ml-1 inline h-3 w-3" />}
                      </TableCell>
                      <TableCell className={r.overdue ? "text-destructive font-medium" : ""}>
                        {r.due_date || "—"}
                      </TableCell>
                      <TableCell>{r.owner_name || (r.unassigned ? "Unassigned" : "—")}</TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button variant="ghost" size="sm" onClick={() => navigate(r.route)} className="gap-1">
                          <Eye className="h-3 w-3" /> View
                        </Button>
                        {r.reassignable && (
                          <Button variant="outline" size="sm" onClick={() => openReassign(r)} className="gap-1">
                            <ArrowRight className="h-3 w-3" /> Reassign
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <WorkQueuePagination
                page={q.page}
                totalPages={q.totalPages}
                pageSize={q.pageSize}
                total={q.total}
                onPage={q.setPage}
                onPageSize={q.setPageSize}
                isFetching={q.isFetching}
              />
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={reassignOpen} onOpenChange={setReassignOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reassign {selected?.record_ref}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Reassign To</Label>
              <Select value={reassignTarget.type} onValueChange={v => setReassignTarget(t => ({ ...t, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="queue">Another Queue</SelectItem>
                  <SelectItem value="officer">Specific Officer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {reassignTarget.type === "queue" && (
              <div>
                <Label>Target Queue</Label>
                <Select value={reassignTarget.queue_id} onValueChange={v => setReassignTarget(t => ({ ...t, queue_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select queue" /></SelectTrigger>
                  <SelectContent>
                    {q.options.queues.map(qq => (
                      <SelectItem key={qq.id} value={qq.id}>{qq.name} ({qq.type})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {reassignTarget.type === "officer" && (
              <div>
                <Label>Target Officer</Label>
                <Select value={reassignTarget.inspector_id} onValueChange={v => setReassignTarget(t => ({ ...t, inspector_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select officer" /></SelectTrigger>
                  <SelectContent>
                    {inspectors.map(i => <SelectItem key={i.id} value={i.id}>{i.display_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReassignOpen(false)}>Cancel</Button>
            <Button onClick={handleReassign} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Reassign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
