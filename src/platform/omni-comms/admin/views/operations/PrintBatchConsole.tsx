/**
 * Omni-Comms — Print / Correspondence batch console (Phase 3B).
 *
 * A batch is an operational grouping of letters that already exist as Print
 * Items. It never creates a communication, never re-renders an artefact and
 * never means dispatched or delivered. Completing a batch only records that
 * the physical printing work assigned to it has been reconciled.
 */
import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, RefreshCw, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

import { useOmniCommsTenant } from "@/platform/omni-comms/context/OmniCommsTenantContext";
import { useOmniCommsRpcClient } from "@/platform/omni-comms/admin/hooks/useOmniCommsRpcClient";
import {
  deferPrintBatchItem,
  getPrintBatchDetail,
  listPrintBatches,
  performPrintBatchAction,
} from "@/platform/omni-comms/application/printBatchService";
import {
  availablePrintBatchActions,
  OMNI_COMMS_BATCH_ACCOUNTING_LABELS,
  OMNI_COMMS_PRINT_BATCH_ACTION_LABELS,
  OMNI_COMMS_PRINT_BATCH_REASON_REQUIRED,
  OMNI_COMMS_PRINT_BATCH_STATUS_LABELS,
  OMNI_COMMS_PRINT_BATCH_STATUSES,
  type OmniCommsBatchAccountingState,
  type OmniCommsPrintBatchAction,
  type OmniCommsPrintBatchStatus,
  type PrintBatchRow,
} from "@/platform/omni-comms/application/printBatchTypes";
import PrintEquipmentSelect from "./PrintEquipmentSelect";

const STATUS_TONE: Record<OmniCommsPrintBatchStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  ready: "bg-primary/10 text-primary",
  locked: "bg-primary/20 text-primary",
  in_production: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  reconciling: "bg-amber-500/10 text-amber-700 dark:text-amber-500",
  completed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  cancelled: "bg-destructive/10 text-destructive",
};

const ACCOUNTING_TONE: Partial<Record<OmniCommsBatchAccountingState, string>> = {
  printed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  reprinted_successfully: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  failed: "bg-destructive/10 text-destructive",
  spoiled: "bg-destructive/10 text-destructive",
  held: "bg-amber-500/10 text-amber-700 dark:text-amber-500",
  reprint_required: "bg-amber-500/10 text-amber-700 dark:text-amber-500",
  deferred: "bg-muted text-muted-foreground",
  removed_before_lock: "bg-muted text-muted-foreground",
};

interface PendingBatchAction {
  batch: PrintBatchRow;
  action: OmniCommsPrintBatchAction;
}

const PrintBatchConsole: React.FC = () => {
  const { organizationId } = useOmniCommsTenant();
  const client = useOmniCommsRpcClient();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<OmniCommsPrintBatchStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingBatchAction | null>(null);
  const [reason, setReason] = useState("");
  const [equipment, setEquipment] = useState("");
  const [override, setOverride] = useState(false);
  const [defer, setDefer] = useState<{ printItemId: string; letter: string } | null>(null);
  const [deferReason, setDeferReason] = useState("");

  const batches = useQuery({
    queryKey: ["omni-comms", "print-batches", organizationId, statusFilter, search],
    enabled: Boolean(organizationId),
    queryFn: () =>
      listPrintBatches(client, {
        organizationId: organizationId as string,
        statuses: statusFilter === "all" ? null : [statusFilter],
        search: search.trim() || null,
        limit: 100,
      }),
  });

  const detail = useQuery({
    queryKey: ["omni-comms", "print-batch", detailId],
    enabled: Boolean(detailId),
    queryFn: () => getPrintBatchDetail(client, detailId as string),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["omni-comms", "print-batches"] });
    void queryClient.invalidateQueries({ queryKey: ["omni-comms", "print-batch"] });
    void queryClient.invalidateQueries({ queryKey: ["omni-comms", "print-queue"] });
    void queryClient.invalidateQueries({ queryKey: ["omni-comms", "print-item"] });
  };

  const act = useMutation({
    mutationFn: (input: PendingBatchAction) =>
      performPrintBatchAction(client, {
        id: input.batch.id,
        action: input.action,
        expectedVersion: input.batch.version,
        reason: reason.trim() || null,
        equipmentReference: equipment.trim() || null,
        override,
      }),
    onSuccess: (result) => {
      toast.success(
        `${result.batch_reference} is now “${OMNI_COMMS_PRINT_BATCH_STATUS_LABELS[result.status]}”.`,
      );
      setPending(null);
      setReason("");
      setEquipment("");
      setOverride(false);
      invalidate();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Batch action failed."),
  });

  const deferItem = useMutation({
    mutationFn: () =>
      deferPrintBatchItem(client, {
        batchId: detailId as string,
        printItemId: defer?.printItemId as string,
        reason: deferReason.trim(),
      }),
    onSuccess: () => {
      toast.success("Letter deferred out of this batch and held for a later run.");
      setDefer(null);
      setDeferReason("");
      invalidate();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Defer failed."),
  });

  const rows = batches.data?.batches ?? [];
  const detailBatch = detail.data;

  const reasonMissing =
    pending != null &&
    (OMNI_COMMS_PRINT_BATCH_REASON_REQUIRED.includes(pending.action) ||
      (pending.action === "complete" && override)) &&
    reason.trim().length === 0;

  const completeBlocked = useMemo(() => {
    if (!pending || pending.action !== "complete") return false;
    return pending.batch.reconciliation?.reconciled !== true;
  }, [pending]);

  return (
    <div className="space-y-4" data-testid="omni-comms-print-batches">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <Layers className="mt-1 h-5 w-5 text-primary" aria-hidden="true" />
              <div>
                <CardTitle className="text-base">Print batches</CardTitle>
                <CardDescription>
                  Controlled production runs over existing letters. Completing a
                  batch reconciles the printing work only — it never means
                  dispatched or delivered.
                </CardDescription>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void batches.refetch()}
              disabled={batches.isFetching}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${batches.isFetching ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-56">
              <Label htmlFor="batch-search">Search</Label>
              <Input
                id="batch-search"
                value={search}
                placeholder="Batch reference"
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-1">
              <Button
                size="sm"
                variant={statusFilter === "all" ? "default" : "outline"}
                onClick={() => setStatusFilter("all")}
              >
                All
              </Button>
              {OMNI_COMMS_PRINT_BATCH_STATUSES.map((status) => (
                <Button
                  key={status}
                  size="sm"
                  variant={statusFilter === status ? "default" : "outline"}
                  onClick={() => setStatusFilter(status)}
                >
                  {OMNI_COMMS_PRINT_BATCH_STATUS_LABELS[status]}
                </Button>
              ))}
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Batch</TableHead>
                <TableHead>Account / profile</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Pages</TableHead>
                <TableHead className="text-right">Printed</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead className="text-right">Spoiled</TableHead>
                <TableHead className="text-right">Held</TableHead>
                <TableHead className="text-right">Reprint</TableHead>
                <TableHead>Reconciled</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Age (h)</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={13} className="text-sm text-muted-foreground">
                    {batches.isLoading
                      ? "Loading batches…"
                      : "No print batches yet. Select queued letters in the queue below to create one."}
                  </TableCell>
                </TableRow>
              )}
              {rows.map((row) => {
                const r = row.reconciliation;
                return (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => setDetailId(row.id)}
                  >
                    <TableCell className="font-mono text-xs">{row.batch_reference}</TableCell>
                    <TableCell className="text-xs">
                      <div>{row.production_account_name ?? "—"}</div>
                      <div className="text-muted-foreground">
                        {String(row.profile_snapshot?.paper_size ?? "A4")} ·{" "}
                        {String(row.profile_snapshot?.sides ?? "simplex")} ·{" "}
                        {String(row.profile_snapshot?.colour_mode ?? "black_white")}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-xs">{r?.expected_items ?? 0}</TableCell>
                    <TableCell className="text-right text-xs">{r?.expected_pages ?? 0}</TableCell>
                    <TableCell className="text-right text-xs">{r?.printed_satisfied ?? 0}</TableCell>
                    <TableCell className="text-right text-xs">{r?.failed ?? 0}</TableCell>
                    <TableCell className="text-right text-xs">{r?.spoiled ?? 0}</TableCell>
                    <TableCell className="text-right text-xs">{r?.held ?? 0}</TableCell>
                    <TableCell className="text-right text-xs">{r?.reprint_required ?? 0}</TableCell>
                    <TableCell className="text-xs">
                      {r?.reconciled ? "Yes" : "No"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_TONE[row.status]}>
                        {OMNI_COMMS_PRINT_BATCH_STATUS_LABELS[row.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs">{row.age_hours ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        {availablePrintBatchActions(row.status).map((action) => (
                          <Button
                            key={action}
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPending({ batch: row, action });
                              setReason("");
                              setEquipment("");
                              setOverride(false);
                            }}
                          >
                            {OMNI_COMMS_PRINT_BATCH_ACTION_LABELS[action]}
                          </Button>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Batch action confirmation */}
      <Dialog open={pending != null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending ? OMNI_COMMS_PRINT_BATCH_ACTION_LABELS[pending.action] : ""}
            </DialogTitle>
            <DialogDescription>
              {pending?.batch.batch_reference} · currently{" "}
              {pending
                ? OMNI_COMMS_PRINT_BATCH_STATUS_LABELS[pending.batch.status].toLowerCase()
                : ""}
              . This records physical production only; postal dispatch and
              delivery are unaffected.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {pending?.action === "start_production" && (
              <PrintEquipmentSelect
                id="batch-equipment"
                value={equipment}
                onChange={setEquipment}
              />
            )}

            {completeBlocked && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
                <div className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-500">
                  <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                  Not every letter is accounted for
                </div>
                <p className="mt-1 text-muted-foreground">
                  Resolve, reprint or deliberately defer the outstanding letters,
                  or record a governed override with evidence.
                </p>
                <label className="mt-2 flex items-center gap-2">
                  <Checkbox
                    checked={override}
                    onCheckedChange={(v) => setOverride(v === true)}
                  />
                  <span>Record a governed reconciliation override</span>
                </label>
              </div>
            )}

            <div>
              <Label htmlFor="batch-reason">
                Reason
                {pending &&
                (OMNI_COMMS_PRINT_BATCH_REASON_REQUIRED.includes(pending.action) ||
                  (pending.action === "complete" && override))
                  ? " (required)"
                  : " (optional)"}
              </Label>
              <Textarea
                id="batch-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              disabled={reasonMissing || act.isPending || (completeBlocked && !override)}
              onClick={() => pending && act.mutate(pending)}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch detail */}
      <Dialog open={detailId != null} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>
              {detailBatch?.batch.batch_reference ?? "Print batch"}
            </DialogTitle>
            <DialogDescription>
              Reconciliation is derived from batch membership, current letter
              state and immutable print attempts.
            </DialogDescription>
          </DialogHeader>

          {detailBatch && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                {[
                  ["Expected items", detailBatch.reconciliation.expected_items],
                  ["Expected pages", detailBatch.reconciliation.expected_pages],
                  ["Printed satisfied", detailBatch.reconciliation.printed_satisfied],
                  ["Failed", detailBatch.reconciliation.failed],
                  ["Spoiled", detailBatch.reconciliation.spoiled],
                  ["Held", detailBatch.reconciliation.held],
                  ["Reprint required", detailBatch.reconciliation.reprint_required],
                  ["Deferred", detailBatch.reconciliation.deferred],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-md border p-2">
                    <div className="text-muted-foreground">{label}</div>
                    <div className="text-base font-semibold">{String(value)}</div>
                  </div>
                ))}
              </div>

              <div className="text-xs text-muted-foreground">
                Reconciled: {detailBatch.reconciliation.reconciled ? "YES" : "NO"}
                {detailBatch.batch.reconciliation_override_reason
                  ? ` · override recorded: ${detailBatch.batch.reconciliation_override_reason}`
                  : ""}
              </div>

              <div className="max-h-[45vh] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Letter</TableHead>
                      <TableHead>Recipient</TableHead>
                      <TableHead>Letter state</TableHead>
                      <TableHead>Accounted as</TableHead>
                      <TableHead className="text-right">Attempts</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detailBatch.items.map((it) => (
                      <TableRow key={it.batch_item_id}>
                        <TableCell className="font-mono text-xs">
                          {it.letter_reference}
                        </TableCell>
                        <TableCell className="text-xs">{it.recipient_display ?? "—"}</TableCell>
                        <TableCell className="text-xs">{it.physical_status}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={ACCOUNTING_TONE[it.accounting_state] ?? ""}
                          >
                            {OMNI_COMMS_BATCH_ACCOUNTING_LABELS[it.accounting_state]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          {it.batch_attempts}
                          {it.spoiled_or_failed_in_batch > 0
                            ? ` (${it.spoiled_or_failed_in_batch} spoiled/failed)`
                            : ""}
                        </TableCell>
                        <TableCell className="text-right">
                          {it.membership_status === "active" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setDefer({
                                  printItemId: it.print_item_id,
                                  letter: it.letter_reference,
                                })
                              }
                            >
                              Defer
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Governed defer */}
      <Dialog open={defer != null} onOpenChange={(open) => !open && setDefer(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Defer {defer?.letter} out of this batch</DialogTitle>
            <DialogDescription>
              The letter is held and stays available for a later batch. Its
              history in this batch remains visible.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="defer-reason">Reason (required)</Label>
            <Textarea
              id="defer-reason"
              rows={3}
              value={deferReason}
              onChange={(e) => setDeferReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDefer(null)}>
              Cancel
            </Button>
            <Button
              disabled={deferReason.trim().length === 0 || deferItem.isPending}
              onClick={() => deferItem.mutate()}
            >
              Defer letter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PrintBatchConsole;
