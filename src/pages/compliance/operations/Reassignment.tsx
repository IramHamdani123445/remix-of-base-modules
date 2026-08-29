import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ArrowRightLeft, UserPlus, AlertTriangle, Inbox } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlockingMutation } from "@/hooks/useBlockingMutation";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { useHasCapability } from "@/hooks/useHasCapability";
import { COMPLIANCE_CAPABILITIES } from "@/lib/compliance/capabilities";

const ACTIVE_STATUSES = ["OPEN", "UNDER_REVIEW", "ESCALATED"] as const;
const BULK_HARD_CAP = 500;

type ReassignReason = "RESIGNATION" | "TRANSFER" | "SUSPENSION" | "LEAVE" | "PROMOTION" | "MANUAL";

interface InspectorRow {
  inspector_id: string | null;     // ce_inspectors.id (null for legacy holders)
  assignment_key: string;          // value stored in ce_violations.assigned_to_user_id
  display_name: string;
  role: string;
  queue_count: number;
  violation_count: number;
  max_caseload: number | null;
  is_legacy: boolean;              // true when no matching active inspector
}

export default function Reassignment() {
  const qc = useQueryClient();
  const { user } = useSupabaseAuth() as any;
  const canManage = useHasCapability(COMPLIANCE_CAPABILITIES.VIOLATIONS_MANAGE);

  const [reassignFrom, setReassignFrom] = useState<InspectorRow | null>(null);
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);

  // ---- Data loading -----------------------------------------------------
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["compliance-reassign-workload"],
    queryFn: async () => {
      const [
        { data: inspData },
        { data: profiles },
        { data: members },
        { data: violAssigned },
        { data: violUnassigned },
      ] = await Promise.all([
        supabase
          .from("ce_inspectors")
          .select("id, inspector_code, legacy_inspector_code, profile_id, max_caseload, status, is_active"),
        supabase.from("profiles").select("id, full_name"),
        supabase.from("ce_queue_members").select("inspector_id, role").eq("is_active", true),
        supabase
          .from("ce_violations")
          .select("assigned_to_user_id, assigned_to_name")
          .in("status", ACTIVE_STATUSES as unknown as string[])
          .not("assigned_to_user_id", "is", null),
        supabase
          .from("ce_violations")
          .select("id", { count: "exact", head: true })
          .in("status", ACTIVE_STATUSES as unknown as string[])
          .is("assigned_to_user_id", null),
      ]);

      const profileMap = Object.fromEntries((profiles || []).map((p: any) => [p.id, p.full_name]));

      // Map inspector_id -> {assignment_key, label, max_caseload, profile_id}
      const inspectors = (inspData || []).map((i: any) => {
        const profileName = i.profile_id ? profileMap[i.profile_id] : null;
        const label = profileName || i.inspector_code || i.legacy_inspector_code || i.id.slice(0, 8);
        const assignment_key = i.profile_id || i.id; // what ce_violations.assigned_to_user_id will reference
        return {
          inspector_id: i.id as string,
          assignment_key: String(assignment_key),
          display_name: String(label),
          max_caseload: i.max_caseload as number | null,
          is_active: !!i.is_active && i.status === "ACTIVE",
        };
      });

      // Role per inspector (most recent membership)
      const memberRole = new Map<string, string>();
      const queueCount = new Map<string, number>();
      (members || []).forEach((m: any) => {
        const c = queueCount.get(m.inspector_id) || 0;
        queueCount.set(m.inspector_id, c + 1);
        if (!memberRole.has(m.inspector_id)) memberRole.set(m.inspector_id, m.role || "MEMBER");
      });

      // Count active violations per assignment_key
      const violCount = new Map<string, number>();
      const legacyLabel = new Map<string, string>();
      (violAssigned || []).forEach((v: any) => {
        const k = String(v.assigned_to_user_id);
        violCount.set(k, (violCount.get(k) || 0) + 1);
        if (v.assigned_to_name && !legacyLabel.has(k)) legacyLabel.set(k, v.assigned_to_name);
      });

      // Build officer rows from active inspectors
      const rows: InspectorRow[] = inspectors
        .filter((i) => i.is_active)
        .map((i) => ({
          inspector_id: i.inspector_id,
          assignment_key: i.assignment_key,
          display_name: i.display_name,
          role: memberRole.get(i.inspector_id) || "—",
          queue_count: queueCount.get(i.inspector_id) || 0,
          violation_count: violCount.get(i.assignment_key) || 0,
          max_caseload: i.max_caseload,
          is_legacy: false,
        }));

      // Legacy holders: any assignment_key in violations not matched to an active inspector key
      const mappedKeys = new Set(rows.map((r) => r.assignment_key));
      const legacyRows: InspectorRow[] = [];
      violCount.forEach((count, key) => {
        if (!mappedKeys.has(key)) {
          legacyRows.push({
            inspector_id: null,
            assignment_key: key,
            display_name: legacyLabel.get(key) || `Legacy: ${key.slice(0, 12)}…`,
            role: "LEGACY",
            queue_count: 0,
            violation_count: count,
            max_caseload: null,
            is_legacy: true,
          });
        }
      });

      rows.sort((a, b) => b.violation_count - a.violation_count);
      legacyRows.sort((a, b) => b.violation_count - a.violation_count);

      const allInspectorOptions = inspectors
        .filter((i) => i.is_active)
        .map((i) => ({
          assignment_key: i.assignment_key,
          inspector_id: i.inspector_id,
          label: i.display_name,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));

      return {
        rows,
        legacyRows,
        unassignedCount: (violUnassigned as any)?.count ?? 0,
        inspectorOptions: allInspectorOptions,
      };
    },
  });

  const rows = data?.rows || [];
  const legacyRows = data?.legacyRows || [];
  const inspectorOptions = data?.inspectorOptions || [];
  const unassignedCount = data?.unassignedCount || 0;

  const getLoadBadge = (w: InspectorRow) => {
    if (w.max_caseload && w.max_caseload > 0) {
      const pct = (w.violation_count / w.max_caseload) * 100;
      if (pct > 80) return <Badge variant="destructive">High ({Math.round(pct)}%)</Badge>;
      if (pct > 50) return <Badge variant="default">Medium ({Math.round(pct)}%)</Badge>;
      return <Badge variant="secondary">Low ({Math.round(pct)}%)</Badge>;
    }
    if (w.violation_count === 0) return <Badge variant="outline">Idle</Badge>;
    if (w.violation_count > 400) return <Badge variant="destructive">High</Badge>;
    if (w.violation_count > 200) return <Badge variant="default">Medium</Badge>;
    return <Badge variant="secondary">Low</Badge>;
  };

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["compliance-reassign-workload"] });
    qc.invalidateQueries({ queryKey: ["ce_violations"] });
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reassign / Workload</h1>
          <p className="text-muted-foreground">
            View officer workload and assign or reassign active violations.
          </p>
        </div>
        {!canManage && (
          <Badge variant="outline" className="self-start">
            Read-only — contact a Compliance Admin to reassign
          </Badge>
        )}
      </div>

      {/* Unassigned card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Inbox className="h-5 w-5" /> Unassigned Active Violations
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="text-sm">
            <span className="text-3xl font-bold">{unassignedCount.toLocaleString()}</span>
            <span className="ml-2 text-muted-foreground">
              active violations with no assigned officer
            </span>
          </div>
          <Button
            onClick={() => setBulkAssignOpen(true)}
            disabled={!canManage || unassignedCount === 0}
            className="gap-2"
          >
            <UserPlus className="h-4 w-4" /> Bulk Assign
          </Button>
        </CardContent>
      </Card>

      {/* Officer workload */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5" /> Officer Workload ({rows.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No active officers found</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Officer</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Queues</TableHead>
                  <TableHead>Active Violations</TableHead>
                  <TableHead>Max Caseload</TableHead>
                  <TableHead>Load</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((w) => (
                  <TableRow key={w.assignment_key}>
                    <TableCell className="font-medium">{w.display_name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{w.role}</Badge>
                    </TableCell>
                    <TableCell>{w.queue_count}</TableCell>
                    <TableCell>{w.violation_count}</TableCell>
                    <TableCell>{w.max_caseload ?? "—"}</TableCell>
                    <TableCell>{getLoadBadge(w)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setReassignFrom(w)}
                        disabled={!canManage || w.violation_count === 0}
                        className="gap-1"
                      >
                        <ArrowRightLeft className="h-3 w-3" /> Reassign
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Legacy / unmapped holders */}
      {legacyRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Legacy / Unmapped Assignees ({legacyRows.length})
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Violations still assigned to identifiers that no longer map to an active inspector
              (e.g. retired accounts, seed data). Reassign to drain them.
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Holder</TableHead>
                  <TableHead>Active Violations</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {legacyRows.map((w) => (
                  <TableRow key={w.assignment_key}>
                    <TableCell className="font-medium">{w.display_name}</TableCell>
                    <TableCell>{w.violation_count}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setReassignFrom(w)}
                        disabled={!canManage}
                        className="gap-1"
                      >
                        <ArrowRightLeft className="h-3 w-3" /> Reassign
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <ReassignDialog
        open={!!reassignFrom}
        from={reassignFrom}
        inspectorOptions={inspectorOptions}
        currentRows={rows}
        user={user}
        onClose={() => setReassignFrom(null)}
        onDone={() => {
          setReassignFrom(null);
          refresh();
        }}
      />

      <BulkAssignDialog
        open={bulkAssignOpen}
        inspectorOptions={inspectorOptions}
        currentRows={rows}
        unassignedCount={unassignedCount}
        user={user}
        onClose={() => setBulkAssignOpen(false)}
        onDone={() => {
          setBulkAssignOpen(false);
          refresh();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reassign dialog
// ---------------------------------------------------------------------------

interface InspectorOption {
  assignment_key: string;
  inspector_id: string;
  label: string;
}

function ReassignDialog({
  open, from, inspectorOptions, currentRows, user, onClose, onDone,
}: {
  open: boolean;
  from: InspectorRow | null;
  inspectorOptions: InspectorOption[];
  currentRows: InspectorRow[];
  user: any;
  onClose: () => void;
  onDone: () => void;
}) {
  const [targetKey, setTargetKey] = useState("");
  const [count, setCount] = useState(0);
  const [reason, setReason] = useState<ReassignReason>("MANUAL");
  const [notes, setNotes] = useState("");

  // Reset when opening
  useMemo(() => {
    if (open) {
      setTargetKey("");
      setCount(0);
      setReason("MANUAL");
      setNotes("");
    }
  }, [open]);

  const target = inspectorOptions.find((o) => o.assignment_key === targetKey);
  const targetRow = target
    ? currentRows.find((r) => r.assignment_key === target.assignment_key)
    : null;

  const moveCount = count > 0 ? Math.min(count, from?.violation_count || 0) : from?.violation_count || 0;
  const projectedTotal = (targetRow?.violation_count || 0) + moveCount;
  const overCapacity =
    targetRow?.max_caseload != null && projectedTotal > (targetRow.max_caseload || 0);

  const mutation = useBlockingMutation(
    {
      mutationFn: async () => {
        if (!from) throw new Error("No source");
        if (!targetKey) throw new Error("Select a target officer");
        if (!notes.trim()) throw new Error("Notes are required");
        if (!target) throw new Error("Invalid target");

        // Governed server-side command (Checkpoint F-S1). The database verifies the
        // caller's compliance.violations.manage capability, validates the target
        // officer, supersedes the prior assignments and writes history + audit
        // atomically. Browser clients can no longer write assignment rows directly.
        const { data, error } = await (supabase.rpc as any)("ce_violation_bulk_reassign_v1", {
          p_from_assignment_key: from.assignment_key,
          p_target_inspector_id: target.inspector_id,
          p_reason: reason,
          p_notes: notes,
          p_limit: count > 0 ? count : 0,
        });
        if (error) throw error;
        const moved = Number(data ?? 0);
        if (moved === 0) throw new Error("No active violations to move");
        return moved;
      },

      onSuccess: (n) => {
        toast.success(`${n} violation${n === 1 ? "" : "s"} reassigned`);
        onDone();
      },
      onError: (e: any) => toast.error(e.message || "Reassignment failed"),
    },
    "Reassigning violations…",
  );

  if (!from) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Reassign from {from.display_name}</DialogTitle>
          <DialogDescription>
            {from.violation_count} active violations currently assigned.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Target Officer *</Label>
            <Select value={targetKey} onValueChange={setTargetKey}>
              <SelectTrigger><SelectValue placeholder="Select officer" /></SelectTrigger>
              <SelectContent>
                {inspectorOptions
                  .filter((o) => o.assignment_key !== from.assignment_key)
                  .map((o) => (
                    <SelectItem key={o.assignment_key} value={o.assignment_key}>
                      {o.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {targetRow && (
              <p className="text-xs text-muted-foreground mt-1">
                Target currently holds {targetRow.violation_count}
                {targetRow.max_caseload ? ` / ${targetRow.max_caseload} max` : ""}.
                {moveCount > 0 && <> Will go to <strong>{projectedTotal}</strong>.</>}
              </p>
            )}
            {overCapacity && (
              <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Exceeds target's max caseload
              </p>
            )}
          </div>

          <div>
            <Label>Number of violations to reassign (0 = all)</Label>
            <Input
              type="number"
              value={count}
              onChange={(e) => setCount(parseInt(e.target.value) || 0)}
              min={0}
              max={from.violation_count}
            />
          </div>

          <div>
            <Label>Reason *</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as ReassignReason)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MANUAL">Manual rebalance</SelectItem>
                <SelectItem value="TRANSFER">Transfer</SelectItem>
                <SelectItem value="LEAVE">Leave</SelectItem>
                <SelectItem value="SUSPENSION">Suspension</SelectItem>
                <SelectItem value="PROMOTION">Promotion</SelectItem>
                <SelectItem value="RESIGNATION">Resignation</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Notes *</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Why is this being reassigned?"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !targetKey || !notes.trim()}
          >
            {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Reassign {moveCount || ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Bulk assign (unassigned) dialog
// ---------------------------------------------------------------------------

function BulkAssignDialog({
  open, inspectorOptions, currentRows, unassignedCount, user, onClose, onDone,
}: {
  open: boolean;
  inspectorOptions: InspectorOption[];
  currentRows: InspectorRow[];
  unassignedCount: number;
  user: any;
  onClose: () => void;
  onDone: () => void;
}) {
  const [targetKey, setTargetKey] = useState("");
  const [count, setCount] = useState(Math.min(50, unassignedCount));
  const [notes, setNotes] = useState("");

  useMemo(() => {
    if (open) {
      setTargetKey("");
      setCount(Math.min(50, unassignedCount));
      setNotes("");
    }
  }, [open, unassignedCount]);

  const target = inspectorOptions.find((o) => o.assignment_key === targetKey);
  const targetRow = target
    ? currentRows.find((r) => r.assignment_key === target.assignment_key)
    : null;
  const effectiveCount = Math.min(count, BULK_HARD_CAP, unassignedCount);
  const projectedTotal = (targetRow?.violation_count || 0) + effectiveCount;
  const overCapacity =
    targetRow?.max_caseload != null && projectedTotal > (targetRow.max_caseload || 0);

  const mutation = useBlockingMutation(
    {
      mutationFn: async () => {
        if (!targetKey || !target) throw new Error("Select a target officer");
        if (!notes.trim()) throw new Error("Notes are required");
        if (effectiveCount <= 0) throw new Error("Nothing to assign");

        // Governed server-side command (Checkpoint F-S1).
        const { data, error } = await (supabase.rpc as any)(
          "ce_violation_bulk_assign_unassigned_v1",
          {
            p_target_inspector_id: target.inspector_id,
            p_notes: notes,
            p_limit: effectiveCount,
          },
        );
        if (error) throw error;
        const assigned = Number(data ?? 0);
        if (assigned === 0) throw new Error("No unassigned violations found");
        return assigned;
      },

      onSuccess: (n) => {
        toast.success(`${n} violation${n === 1 ? "" : "s"} assigned`);
        onDone();
      },
      onError: (e: any) => toast.error(e.message || "Bulk assign failed"),
    },
    "Assigning violations…",
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Bulk Assign Unassigned Violations</DialogTitle>
          <DialogDescription>
            {unassignedCount.toLocaleString()} active violations have no officer.
            You can assign up to {BULK_HARD_CAP.toLocaleString()} at a time.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Target Officer *</Label>
            <Select value={targetKey} onValueChange={setTargetKey}>
              <SelectTrigger><SelectValue placeholder="Select officer" /></SelectTrigger>
              <SelectContent>
                {inspectorOptions.map((o) => (
                  <SelectItem key={o.assignment_key} value={o.assignment_key}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {targetRow && (
              <p className="text-xs text-muted-foreground mt-1">
                Currently holds {targetRow.violation_count}
                {targetRow.max_caseload ? ` / ${targetRow.max_caseload} max` : ""} → will go to{" "}
                <strong>{projectedTotal}</strong>.
              </p>
            )}
            {overCapacity && (
              <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Exceeds target's max caseload
              </p>
            )}
          </div>

          <div>
            <Label>Number to assign (max {Math.min(BULK_HARD_CAP, unassignedCount)})</Label>
            <Input
              type="number"
              value={count}
              onChange={(e) => setCount(parseInt(e.target.value) || 0)}
              min={1}
              max={Math.min(BULK_HARD_CAP, unassignedCount)}
            />
          </div>

          <div>
            <Label>Notes *</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason for assigning these violations…"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !targetKey || !notes.trim() || effectiveCount <= 0}
          >
            {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Assign {effectiveCount}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
