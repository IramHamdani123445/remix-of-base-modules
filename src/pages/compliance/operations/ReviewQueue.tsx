import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Eye, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

interface QueueOption { id: string; queue_name: string; queue_type: string; }
interface InspectorOption { id: string; display_name: string; }

const STATUS_OPTIONS = ["UNDER_REVIEW", "OPEN", "IN_PROGRESS", "ESCALATED"] as const;
type StatusFilter = typeof STATUS_OPTIONS[number] | "ALL_REVIEW";

export default function ReviewQueue() {
  const [violations, setViolations] = useState<any[]>([]);
  const [queues, setQueues] = useState<QueueOption[]>([]);
  const [inspectors, setInspectors] = useState<InspectorOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [selectedViolation, setSelectedViolation] = useState<any>(null);
  const [reassignTarget, setReassignTarget] = useState({ type: "queue", queue_id: "", inspector_id: "" });
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL_REVIEW");
  const [queueScope, setQueueScope] = useState<"REV" | "ALL">("REV");
  const navigate = useNavigate();

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { data: allQData, error: qErr } = await supabase
      .from("ce_assignment_queues")
      .select("id, queue_name, queue_type")
      .eq("is_active", true)
      .order("queue_name");
    if (qErr) toast.error("Failed to load queues: " + qErr.message);
    const allQueues = allQData || [];
    setQueues(allQueues);
    const revQueueIds = allQueues.filter(q => q.queue_type === "REV").map(q => q.id);

    const [{ data: inspData }, { data: profiles }] = await Promise.all([
      supabase.from("ce_inspectors").select("id, inspector_code, legacy_inspector_code, profile_id").eq("is_active", true),
      supabase.from("profiles").select("id, full_name"),
    ]);
    const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p.full_name]));
    const inspOptions: InspectorOption[] = (inspData || []).map(i => ({
      id: i.id,
      display_name: (i.profile_id ? profileMap[i.profile_id] : null) || i.inspector_code || i.legacy_inspector_code || i.id.slice(0, 8),
    }));
    setInspectors(inspOptions);

    let q = supabase
      .from("ce_violations")
      .select("id, violation_number, employer_id, employer_name, status, priority, created_at, assigned_queue_id, assigned_to_user_id, zone_id")
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(200);

    if (statusFilter === "ALL_REVIEW") {
      q = q.in("status", ["UNDER_REVIEW", "OPEN", "IN_PROGRESS", "ESCALATED"]);
    } else {
      q = q.eq("status", statusFilter);
    }

    if (queueScope === "REV") {
      if (revQueueIds.length === 0) { setViolations([]); setLoading(false); return; }
      q = q.in("assigned_queue_id", revQueueIds);
    }

    const { data, error } = await q;
    if (error) {
      toast.error("Failed to load review queue: " + error.message);
      setViolations([]); setLoading(false); return;
    }

    const qMap = Object.fromEntries(allQueues.map(qq => [qq.id, qq.queue_name]));
    const iMap = Object.fromEntries(inspOptions.map(i => [i.id, i.display_name]));

    setViolations((data || []).map((v: any) => ({
      ...v,
      queue_name: v.assigned_queue_id ? (qMap[v.assigned_queue_id] || "—") : "Unassigned",
      assigned_officer_name: v.assigned_to_user_id ? iMap[v.assigned_to_user_id] || v.assigned_to_user_id.slice(0, 8) : "—",
    })));
    setLoading(false);
  }, [statusFilter, queueScope]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {};
    violations.forEach(v => { c[v.status] = (c[v.status] || 0) + 1; });
    return c;
  }, [violations]);

  const openReassign = (v: any) => {
    setSelectedViolation(v);
    setReassignTarget({ type: "queue", queue_id: v.assigned_queue_id || "", inspector_id: "" });
    setReassignOpen(true);
  };

  const handleReassign = async () => {
    if (!selectedViolation) return;
    setSaving(true);

    // Governed server-side commands (Checkpoint F-S1): the database verifies the
    // caller's compliance capability, supersedes the prior assignment and writes
    // the violation header, history and audit atomically.
    let error: any = null;
    if (reassignTarget.type === "queue" && reassignTarget.queue_id) {
      ({ error } = await (supabase.rpc as any)("ce_violation_return_to_queue_v1", {
        p_violation_id: selectedViolation.id,
        p_reason: "MANUAL",
        p_notes: "Review queue reassignment",
        p_queue_id: reassignTarget.queue_id,
      }));
    } else if (reassignTarget.type === "officer" && reassignTarget.inspector_id) {
      ({ error } = await (supabase.rpc as any)("ce_violation_reassign_v1", {
        p_violation_id: selectedViolation.id,
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
    setSaving(false); setReassignOpen(false); fetchData();
  };


  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="t-page-title">Review Queue</h1>
        <p className="t-page-subtitle">Violations under review or pending triage</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
          <CardTitle className="text-lg flex items-center gap-2">
            <Eye className="h-5 w-5" /> Review Items ({violations.length})
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            {STATUS_OPTIONS.map(s => (
              <Badge key={s} variant={statusFilter === s ? "default" : "outline"} className="cursor-pointer"
                onClick={() => setStatusFilter(s)}>
                {s} {statusCounts[s] ? `(${statusCounts[s]})` : ""}
              </Badge>
            ))}
            <Badge variant={statusFilter === "ALL_REVIEW" ? "default" : "outline"} className="cursor-pointer"
              onClick={() => setStatusFilter("ALL_REVIEW")}>All</Badge>
            <Select value={queueScope} onValueChange={(v: any) => setQueueScope(v)}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="REV">Review queues only</SelectItem>
                <SelectItem value="ALL">All queues</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : violations.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No violations match the selected filters</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Violation #</TableHead>
                  <TableHead>Employer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Queue</TableHead>
                  <TableHead>Officer</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {violations.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-mono text-sm">{v.violation_number}</TableCell>
                    <TableCell>{v.employer_name || v.employer_id || "—"}</TableCell>
                    <TableCell><Badge variant="secondary">{v.status}</Badge></TableCell>
                    <TableCell><Badge variant={v.priority === "CRITICAL" ? "destructive" : "secondary"}>{v.priority || "—"}</Badge></TableCell>
                    <TableCell>{v.queue_name}</TableCell>
                    <TableCell>{v.assigned_officer_name}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button variant="ghost" size="sm" onClick={() => navigate(`/compliance/violations/${v.id}`)} className="gap-1"><Eye className="h-3 w-3" /> View</Button>
                      <Button variant="outline" size="sm" onClick={() => openReassign(v)} className="gap-1"><ArrowRight className="h-3 w-3" /> Reassign</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={reassignOpen} onOpenChange={setReassignOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reassign Violation {selectedViolation?.violation_number}</DialogTitle></DialogHeader>
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
                    {queues.map(q => <SelectItem key={q.id} value={q.id}>{q.queue_name} ({q.queue_type})</SelectItem>)}
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
            <Button onClick={handleReassign} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Reassign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
