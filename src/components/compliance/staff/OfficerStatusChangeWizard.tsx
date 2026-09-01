import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, AlertTriangle, CheckCircle2, ArrowRight, Shield } from "lucide-react";
import { toast } from "sonner";
import { useUserCode } from "@/hooks/useUserCode";

type OfficerStatus = "ACTIVE" | "ON_LEAVE" | "TRANSFERRED" | "SUSPENDED" | "RESIGNED" | "INACTIVE";

const STATUS_OPTIONS: { value: OfficerStatus; label: string; color: string }[] = [
  { value: "ACTIVE", label: "Active", color: "bg-primary/10 text-primary" },
  { value: "ON_LEAVE", label: "On Leave", color: "bg-accent/30 text-accent-foreground" },
  { value: "TRANSFERRED", label: "Transferred", color: "bg-secondary/10 text-secondary" },
  { value: "SUSPENDED", label: "Suspended", color: "bg-destructive/10 text-destructive" },
  { value: "RESIGNED", label: "Resigned", color: "bg-destructive/10 text-destructive" },
  { value: "INACTIVE", label: "Inactive", color: "bg-muted text-muted-foreground" },
];

const REQUIRES_FULL_REASSIGNMENT: OfficerStatus[] = ["RESIGNED", "TRANSFERRED", "SUSPENDED", "INACTIVE"];
const OPTIONAL_REASSIGNMENT: OfficerStatus[] = ["ON_LEAVE"];

interface Officer {
  id: string;
  inspector_code: string | null;
  display_name: string;
  status: OfficerStatus;
  primary_zone_id: string | null;
}

interface ViolationImpact {
  id: string;
  violation_number: string;
  status: string;
  priority: string;
  employer_name: string | null;
  reassign_target: "queue" | "officer";
  target_officer_id?: string;
}

interface ZoneOption { id: string; zone_name: string; }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  officer: Officer;
  officers: Officer[];
  zones: ZoneOption[];
  onComplete: () => void;
}

export function OfficerStatusChangeWizard({ open, onOpenChange, officer, officers, zones, onComplete }: Props) {
  const { userCode } = useUserCode();
  const [step, setStep] = useState(1);
  const [newStatus, setNewStatus] = useState<OfficerStatus>("ACTIVE");
  const [reason, setReason] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().split("T")[0]);
  const [effectiveTo, setEffectiveTo] = useState("");
  const [targetZoneId, setTargetZoneId] = useState("");
  const [violations, setViolations] = useState<ViolationImpact[]>([]);
  const [queueMemberCount, setQueueMemberCount] = useState(0);
  const [superviseeCount, setSuperviseeCount] = useState(0);
  const [loadingImpact, setLoadingImpact] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [bulkAction, setBulkAction] = useState<"queue" | "officer">("queue");
  const [bulkOfficerId, setBulkOfficerId] = useState("");

  const requiresReassignment = REQUIRES_FULL_REASSIGNMENT.includes(newStatus);
  const optionalReassignment = OPTIONAL_REASSIGNMENT.includes(newStatus);
  const needsReassignment = requiresReassignment || (optionalReassignment && violations.length > 0);

  const totalSteps = needsReassignment ? 4 : 3;
  const availableStatuses = STATUS_OPTIONS.filter(s => s.value !== officer.status);
  const eligibleReplacements = officers.filter(o => o.id !== officer.id && o.status === "ACTIVE");

  useEffect(() => {
    if (open) {
      setStep(1);
      setNewStatus("ACTIVE");
      setReason("");
      setEffectiveFrom(new Date().toISOString().split("T")[0]);
      setEffectiveTo("");
      setTargetZoneId("");
      setViolations([]);
      setBulkAction("queue");
      setBulkOfficerId("");
    }
  }, [open]);

  const fetchImpact = useCallback(async () => {
    setLoadingImpact(true);
    // Fetch open violations assigned to this officer
    const { data: assignments } = await supabase
      .from("ce_violation_assignments")
      .select("violation_id")
      .eq("assigned_to_inspector_id", officer.id)
      .eq("is_current", true);

    const violationIds = (assignments || []).map(a => a.violation_id);

    if (violationIds.length > 0) {
      const { data: viols } = await supabase
        .from("ce_violations")
        .select("id, violation_number, status, priority, employer_name")
        .in("id", violationIds)
        .in("status", ["OPEN", "IN_PROGRESS", "UNDER_REVIEW", "ESCALATED"]);

      setViolations((viols || []).map(v => ({
        ...v,
        reassign_target: v.status === "ESCALATED" ? "officer" as const : "queue" as const,
      })));
    } else {
      setViolations([]);
    }

    // Queue memberships
    const { count: qCount } = await supabase
      .from("ce_queue_members")
      .select("id", { count: "exact", head: true })
      .eq("inspector_id", officer.id)
      .eq("is_active", true);
    setQueueMemberCount(qCount || 0);

    // Supervisees
    const { count: sCount } = await supabase
      .from("ce_inspectors")
      .select("id", { count: "exact", head: true })
      .eq("supervisor_id", officer.id)
      .eq("status", "ACTIVE");
    setSuperviseeCount(sCount || 0);

    setLoadingImpact(false);
  }, [officer.id]);

  const goToStep2 = () => {
    if (newStatus === officer.status) {
      toast.error("Please select a different status");
      return;
    }
    if (newStatus === "TRANSFERRED" && !targetZoneId) {
      toast.error("Please select a target zone for transfer");
      return;
    }
    fetchImpact();
    setStep(2);
  };

  const goToStep3 = () => {
    if (requiresReassignment && violations.length > 0) {
      // Check legal/escalated violations have officer assignment
      const unassignedLegal = violations.filter(
        v => v.status === "ESCALATED" && v.reassign_target === "queue"
      );
      if (unassignedLegal.length > 0) {
        toast.error("Escalated/legal violations must be assigned to a specific officer, not returned to queue");
        return;
      }
      setStep(3);
    } else if (optionalReassignment) {
      setStep(needsReassignment ? 3 : step + 1);
    } else {
      setStep(needsReassignment ? 3 : totalSteps);
    }
  };

  const applyBulkAction = () => {
    setViolations(prev => prev.map(v => {
      // Legal must stay officer-assigned
      if (v.status === "ESCALATED" && bulkAction === "queue") return v;
      return {
        ...v,
        reassign_target: bulkAction,
        target_officer_id: bulkAction === "officer" ? bulkOfficerId : undefined,
      };
    }));
  };

  const updateViolationTarget = (violationId: string, target: "queue" | "officer", officerId?: string) => {
    setViolations(prev => prev.map(v =>
      v.id === violationId ? { ...v, reassign_target: target, target_officer_id: officerId } : v
    ));
  };

  const executeChange = async () => {
    if (!reason.trim()) {
      toast.error("Please provide a reason for the status change");
      return;
    }

    setExecuting(true);
    try {
      // 1. Update officer status
      const updatePayload: Record<string, any> = {
        status: newStatus,
        status_effective_from: effectiveFrom,
        status_effective_to: effectiveTo || null,
        status_changed_by: userCode || "SYSTEM",
        status_change_reason: reason,
      };

      if (newStatus === "TRANSFERRED") {
        updatePayload.transferred_from_zone_id = officer.primary_zone_id;
        updatePayload.transferred_to_zone_id = targetZoneId;
        updatePayload.primary_zone_id = targetZoneId;
      }

      const { error: updateErr } = await supabase
        .from("ce_inspectors")
        .update(updatePayload)
        .eq("id", officer.id);

      if (updateErr) throw updateErr;

      // 2. Deactivate queue memberships for terminal statuses
      if (REQUIRES_FULL_REASSIGNMENT.includes(newStatus)) {
        await supabase
          .from("ce_queue_members")
          .update({ is_active: false, effective_to: effectiveFrom })
          .eq("inspector_id", officer.id)
          .eq("is_active", true);
      }

      // 3. Reassign violations through the governed server-side commands
      //    (Checkpoint F-S1). Direct writes to ce_violation_assignments are
      //    revoked for browser clients; the database enforces capability,
      //    supersession, history and audit atomically.
      const reassignReason =
        newStatus === "RESIGNED" ? "RESIGNATION"
        : newStatus === "TRANSFERRED" ? "TRANSFER"
        : newStatus === "SUSPENDED" ? "SUSPENSION"
        : newStatus === "ON_LEAVE" ? "LEAVE"
        : "MANUAL";
      const notes = `Reassigned due to officer ${newStatus.toLowerCase()}: ${reason}`;

      let reassignedCount = 0;
      for (const v of violations) {
        if (v.reassign_target === "officer" && v.target_officer_id) {
          const { error } = await (supabase.rpc as any)("ce_violation_reassign_v1", {
            p_violation_id: v.id,
            p_target_inspector_id: v.target_officer_id,
            p_reason: reassignReason,
            p_notes: notes,
          });
          if (error) throw error;
        } else {
          const { error } = await (supabase.rpc as any)("ce_violation_return_to_queue_v1", {
            p_violation_id: v.id,
            p_reason: reassignReason,
            p_notes: notes,
          });
          if (error) throw error;
        }
        reassignedCount++;
      }


      toast.success(`Officer status changed to ${newStatus}. ${reassignedCount} violation(s) reassigned.`);
      onComplete();
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Failed: " + (err?.message || "Unknown error"));
    } finally {
      setExecuting(false);
    }
  };

  const priorityColor = (p: string) => {
    if (p === "Critical") return "bg-destructive/10 text-destructive";
    if (p === "High") return "bg-destructive/10 text-destructive";
    if (p === "Medium") return "bg-accent/30 text-accent-foreground";
    return "bg-primary/10 text-primary";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Change Officer Status — {officer.display_name}
          </DialogTitle>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            Step {step} of {totalSteps}
            <div className="flex gap-1 ml-2">
              {Array.from({ length: totalSteps }).map((_, i) => (
                <div key={i} className={`h-1.5 w-8 rounded-full ${i < step ? "bg-primary" : "bg-muted"}`} />
              ))}
            </div>
          </div>
        </DialogHeader>

        {/* Step 1: Select Status */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <span>Current Status:</span>
              <Badge className={STATUS_OPTIONS.find(s => s.value === officer.status)?.color}>
                {STATUS_OPTIONS.find(s => s.value === officer.status)?.label}
              </Badge>
            </div>

            <div>
              <Label>New Status *</Label>
              <Select value={newStatus} onValueChange={v => setNewStatus(v as OfficerStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {availableStatuses.map(s => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {newStatus === "TRANSFERRED" && (
              <div>
                <Label>Transfer to Zone *</Label>
                <Select value={targetZoneId} onValueChange={setTargetZoneId}>
                  <SelectTrigger><SelectValue placeholder="Select target zone" /></SelectTrigger>
                  <SelectContent>
                    {zones.filter(z => z.id !== officer.primary_zone_id).map(z => (
                      <SelectItem key={z.id} value={z.id}>{z.zone_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Effective From *</Label>
                <Input type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} />
              </div>
              {(newStatus === "ON_LEAVE" || newStatus === "SUSPENDED") && (
                <div>
                  <Label>Expected Return Date</Label>
                  <Input type="date" value={effectiveTo} onChange={e => setEffectiveTo(e.target.value)} />
                </div>
              )}
            </div>

            <div>
              <Label>Reason *</Label>
              <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Provide reason for status change..." rows={3} />
            </div>
          </div>
        )}

        {/* Step 2: Impact Assessment */}
        {step === 2 && (
          <div className="space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" /> Impact Assessment
            </h3>

            {loadingImpact ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <Card>
                    <CardContent className="pt-4 text-center">
                      <div className="text-2xl font-bold">{violations.length}</div>
                      <div className="text-xs text-muted-foreground">Open Violations</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4 text-center">
                      <div className="text-2xl font-bold">{queueMemberCount}</div>
                      <div className="text-xs text-muted-foreground">Queue Memberships</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4 text-center">
                      <div className="text-2xl font-bold">{superviseeCount}</div>
                      <div className="text-xs text-muted-foreground">Direct Reports</div>
                    </CardContent>
                  </Card>
                </div>

                {violations.length > 0 && (
                  <Card>
                    <CardHeader className="py-3"><CardTitle className="text-sm">Priority Breakdown</CardTitle></CardHeader>
                    <CardContent className="flex gap-2 flex-wrap">
                      {["Critical", "High", "Medium", "Low"].map(p => {
                        const count = violations.filter(v => v.priority === p).length;
                        return count > 0 ? (
                          <Badge key={p} className={priorityColor(p)}>{p}: {count}</Badge>
                        ) : null;
                      })}
                    </CardContent>
                  </Card>
                )}

                {superviseeCount > 0 && (
                  <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 rounded-md border border-amber-200 dark:border-amber-800 text-sm">
                    <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                    <span>This officer has {superviseeCount} direct report(s). You may need to reassign their supervisor after this change.</span>
                  </div>
                )}

                {violations.length === 0 && !requiresReassignment && (
                  <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950/20 rounded-md border border-green-200 dark:border-green-800 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                    <span>No open violations assigned. Status change can proceed directly.</span>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Step 3: Reassignment Plan (only if needed) */}
        {step === 3 && needsReassignment && (
          <div className="space-y-4">
            <h3 className="font-semibold">Reassignment Plan</h3>

            {violations.length > 0 && (
              <>
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm">Bulk Action</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <RadioGroup value={bulkAction} onValueChange={v => setBulkAction(v as "queue" | "officer")} className="flex gap-4">
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="queue" id="ba-queue" />
                        <Label htmlFor="ba-queue">Return all to queue</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="officer" id="ba-officer" />
                        <Label htmlFor="ba-officer">Assign all to replacement</Label>
                      </div>
                    </RadioGroup>
                    {bulkAction === "officer" && (
                      <Select value={bulkOfficerId} onValueChange={setBulkOfficerId}>
                        <SelectTrigger><SelectValue placeholder="Select replacement officer" /></SelectTrigger>
                        <SelectContent>
                          {eligibleReplacements.map(o => (
                            <SelectItem key={o.id} value={o.id}>{o.display_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <Button variant="secondary" size="sm" onClick={applyBulkAction} disabled={bulkAction === "officer" && !bulkOfficerId}>
                      Apply to All Non-Legal
                    </Button>
                  </CardContent>
                </Card>

                <Separator />

                <div className="text-sm font-medium">Per-Violation Overrides</div>
                <div className="max-h-48 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Violation</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Priority</TableHead>
                        <TableHead>Target</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {violations.map(v => (
                        <TableRow key={v.id}>
                          <TableCell className="font-mono text-xs">{v.violation_number}</TableCell>
                          <TableCell><Badge variant="outline" className="text-xs">{v.status}</Badge></TableCell>
                          <TableCell><Badge className={`text-xs ${priorityColor(v.priority)}`}>{v.priority}</Badge></TableCell>
                          <TableCell>
                            <Select
                              value={v.reassign_target === "officer" ? (v.target_officer_id || "officer") : "queue"}
                              onValueChange={val => {
                                if (val === "queue") {
                                  updateViolationTarget(v.id, "queue");
                                } else {
                                  updateViolationTarget(v.id, "officer", val);
                                }
                              }}
                            >
                              <SelectTrigger className="h-8 text-xs w-44"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {v.status !== "ESCALATED" && (
                                  <SelectItem value="queue">Return to Queue</SelectItem>
                                )}
                                {eligibleReplacements.map(o => (
                                  <SelectItem key={o.id} value={o.id}>{o.display_name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </div>
        )}

        {/* Final Step: Confirm */}
        {step === totalSteps && (
          <div className="space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" /> Confirm Changes
            </h3>

            <Card>
              <CardContent className="pt-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Officer</span>
                  <span className="font-medium">{officer.display_name}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Status Change</span>
                  <div className="flex items-center gap-2">
                    <Badge className={STATUS_OPTIONS.find(s => s.value === officer.status)?.color}>
                      {officer.status}
                    </Badge>
                    <ArrowRight className="h-3 w-3" />
                    <Badge className={STATUS_OPTIONS.find(s => s.value === newStatus)?.color}>
                      {newStatus}
                    </Badge>
                  </div>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Effective From</span>
                  <span>{effectiveFrom}</span>
                </div>
                {effectiveTo && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Expected Return</span>
                    <span>{effectiveTo}</span>
                  </div>
                )}
                {newStatus === "TRANSFERRED" && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Transfer To</span>
                    <span>{zones.find(z => z.id === targetZoneId)?.zone_name}</span>
                  </div>
                )}
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Violations Reassigned</span>
                  <span className="font-medium">{violations.length}</span>
                </div>
                {REQUIRES_FULL_REASSIGNMENT.includes(newStatus) && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Queue Memberships Deactivated</span>
                    <span className="font-medium">{queueMemberCount}</span>
                  </div>
                )}
                <Separator />
                <div>
                  <span className="text-muted-foreground">Reason</span>
                  <p className="mt-1">{reason}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step > 1 && (
            <Button variant="outline" onClick={() => setStep(s => s - 1)} disabled={executing}>Back</Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={executing}>Cancel</Button>

          {step === 1 && (
            <Button onClick={goToStep2}>Next: Impact Assessment</Button>
          )}
          {step === 2 && (
            <Button onClick={() => {
              if (needsReassignment && violations.length > 0) {
                setStep(3);
              } else {
                setStep(totalSteps);
              }
            }}>
              {needsReassignment && violations.length > 0 ? "Next: Reassignment Plan" : "Next: Confirm"}
            </Button>
          )}
          {step === 3 && step < totalSteps && (
            <Button onClick={() => setStep(totalSteps)}>Next: Confirm</Button>
          )}
          {step === totalSteps && (
            <Button onClick={executeChange} disabled={executing} className="gap-2">
              {executing && <Loader2 className="h-4 w-4 animate-spin" />}
              Execute Status Change
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
