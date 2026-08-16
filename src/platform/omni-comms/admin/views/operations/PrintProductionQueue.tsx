/**
 * Omni-Comms — Print / Correspondence physical production queue (Phase 3A).
 *
 * Truthful operational queue over `omni_comms_print_item`. Everything the
 * screen shows or does comes from bounded Omni-Comms RPCs; the browser never
 * writes to the print tables directly.
 */
import React, { useMemo, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ExternalLink, Eye, Layers, Printer, RefreshCw } from "lucide-react";

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
  getPrintItemDetail,
  listPrintQueue,
  performPrintItemAction,
} from "@/platform/omni-comms/application/printProductionService";
import {
  availablePrintActions,
  OMNI_COMMS_PRINT_ACTION_LABELS,
  OMNI_COMMS_PRINT_REASON_REQUIRED,
  OMNI_COMMS_PRINT_STATUSES,
  OMNI_COMMS_PRINT_STATUS_LABELS,
  type OmniCommsPrintAction,
  type OmniCommsPrintStatus,
  type PrintQueueRow,
} from "@/platform/omni-comms/application/printProductionTypes";
import {
  createPrintBatch,
  previewPrintBatch,
} from "@/platform/omni-comms/application/printBatchService";
import PrintBatchConsole from "./PrintBatchConsole";
import PrintReadinessPanel, {
  PRINT_READINESS_QUERY_KEY,
} from "./PrintReadinessPanel";
import { useOmniCommsPrintDocumentInvoker } from "@/platform/omni-comms/admin/hooks/useOmniCommsPrintDocument";
import {
  requestPrintDocument,
  PrintDocumentError,
  type PrintDocumentAccess,
  type PrintDocumentMode,
} from "@/platform/omni-comms/application/printDocumentService";
import { describePrintError } from "@/platform/omni-comms/application/printReadinessTypes";

/** Statuses from which an operator may open the letter for physical printing. */
const OPENABLE_FOR_PRINT: readonly OmniCommsPrintStatus[] = [
  "artefact_produced",
  "queued_for_print",
  "printing",
  "print_failed",
];



const STATUS_TONE: Record<OmniCommsPrintStatus, string> = {
  artefact_produced: "bg-muted text-muted-foreground",
  queued_for_print: "bg-primary/10 text-primary",
  printing: "bg-primary/20 text-primary",
  printed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  print_failed: "bg-destructive/10 text-destructive",
  spoiled: "bg-destructive/10 text-destructive",
  held: "bg-amber-500/10 text-amber-700 dark:text-amber-500",
};

interface PendingAction {
  row: PrintQueueRow;
  action: OmniCommsPrintAction;
}

const PrintProductionQueueInner: React.FC = () => {
  const { organizationId, departmentId } = useOmniCommsTenant();
  const client = useOmniCommsRpcClient();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<OmniCommsPrintStatus | "all">("all");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState("");
  const [equipment, setEquipment] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchNotes, setBatchNotes] = useState("");

  // Open & Print — secure access to the official print PDF.
  const printDocuments = useOmniCommsPrintDocumentInvoker();
  const [openRow, setOpenRow] = useState<PrintQueueRow | null>(null);
  const [access, setAccess] = useState<PrintDocumentAccess | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);




  const queueKey = [
    "omni-comms",
    "print-queue",
    organizationId,
    departmentId,
    statusFilter,
    search,
  ];

  const queue = useQuery({
    queryKey: queueKey,
    enabled: Boolean(organizationId),
    queryFn: () =>
      listPrintQueue(client, {
        organizationId: organizationId as string,
        departmentId: departmentId ?? null,
        statuses: statusFilter === "all" ? null : [statusFilter],
        search: search.trim() || null,
        limit: 100,
      }),
  });

  const detail = useQuery({
    queryKey: ["omni-comms", "print-item", detailId],
    enabled: Boolean(detailId),
    queryFn: () => getPrintItemDetail(client, detailId as string),
  });

  const act = useMutation({
    mutationFn: (input: PendingAction) =>
      performPrintItemAction(client, {
        id: input.row.id,
        action: input.action,
        expectedVersion: input.row.version,
        reason: reason.trim() || null,
        equipmentReference: equipment.trim() || null,
      }),
    onSuccess: (result) => {
      toast.success(
        `Print item is now “${OMNI_COMMS_PRINT_STATUS_LABELS[result.physical_status]}”.`,
      );
      setPending(null);
      setReason("");
      setEquipment("");
      void queryClient.invalidateQueries({ queryKey: ["omni-comms", "print-queue"] });
      void queryClient.invalidateQueries({ queryKey: ["omni-comms", "print-item"] });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Print action failed.";
      toast.error(message);
    },
  });

  /**
   * Opens the official Print PDF. `print` mode also moves the letter into
   * physical printing and opens a governed attempt server-side; `preview`
   * changes nothing.
   */
  const openDocument = useMutation({
    mutationFn: (input: { row: PrintQueueRow; mode: PrintDocumentMode }) =>
      requestPrintDocument(printDocuments, {
        printItemId: input.row.id,
        mode: input.mode,
        expectedVersion: input.mode === "print" ? input.row.version : null,
      }),
    onMutate: (input) => {
      setOpenRow(input.row);
      setAccess(null);
      setAccessError(null);
    },
    onSuccess: (result) => {
      setAccess(result);
      void queryClient.invalidateQueries({ queryKey: ["omni-comms", "print-queue"] });
      void queryClient.invalidateQueries({ queryKey: ["omni-comms", "print-item"] });
      void queryClient.invalidateQueries({ queryKey: PRINT_READINESS_QUERY_KEY });
    },
    onError: (error: unknown) => {
      const code =
        error instanceof PrintDocumentError ? error.errorCode : "print_access_failed";
      const guidance = describePrintError(code);
      setAccessError(`${guidance.title} ${guidance.action}`);
    },
  });

  /** Records the physical outcome for the letter currently open for printing. */
  const recordOutcome = useMutation({
    mutationFn: (input: { row: PrintQueueRow; action: OmniCommsPrintAction }) =>
      performPrintItemAction(client, {
        id: input.row.id,
        action: input.action,
        expectedVersion: null,
        reason:
          input.action === "confirm_printed"
            ? "Printed at the workstation."
            : reason.trim() || "Recorded from the Open & Print workflow.",
        equipmentReference: equipment.trim() || null,
      }),
    onSuccess: (result) => {
      toast.success(
        `Print item is now “${OMNI_COMMS_PRINT_STATUS_LABELS[result.physical_status]}”.`,
      );
      setOpenRow(null);
      setAccess(null);
      setReason("");
      setEquipment("");
      void queryClient.invalidateQueries({ queryKey: ["omni-comms", "print-queue"] });
      void queryClient.invalidateQueries({ queryKey: ["omni-comms", "print-item"] });
    },
    onError: (error: unknown) =>
      toast.error(
        error instanceof Error ? error.message : "Could not record the print outcome.",
      ),
  });



  const rows = queue.data?.items ?? [];
  const fullDetail = queue.data?.full_detail_permitted ?? false;

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((r) => map.set(r.physical_status, (map.get(r.physical_status) ?? 0) + 1));
    return map;
  }, [rows]);

  const reasonRequired =
    pending != null &&
    OMNI_COMMS_PRINT_REASON_REQUIRED.includes(pending.action) &&
    reason.trim().length === 0;

  const batchable = useMemo(
    () => rows.filter((r) => r.physical_status === "queued_for_print"),
    [rows],
  );
  const toggleSelected = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const preview = useQuery({
    queryKey: ["omni-comms", "print-batch-preview", organizationId, selected],
    enabled: batchOpen && selected.length > 0 && Boolean(organizationId),
    queryFn: () => previewPrintBatch(client, organizationId as string, selected),
  });

  const createBatch = useMutation({
    mutationFn: () =>
      createPrintBatch(client, {
        organizationId: organizationId as string,
        printItemIds: selected,
        departmentId: departmentId ?? null,
        notes: batchNotes.trim() || null,
      }),
    onSuccess: (result) => {
      toast.success(
        `Batch ${result.batch_reference} created with ${result.item_count} letter(s).`,
      );
      setBatchOpen(false);
      setBatchNotes("");
      setSelected([]);
      void queryClient.invalidateQueries({ queryKey: ["omni-comms", "print-batches"] });
      void queryClient.invalidateQueries({ queryKey: ["omni-comms", "print-queue"] });
    },
    onError: (error: unknown) =>
      toast.error(
        error instanceof Error ? error.message : "Could not create the print batch.",
      ),
  });



  return (
    <div className="space-y-6" data-testid="omni-comms-print-queue">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Printer className="mt-1 h-6 w-6 text-primary" aria-hidden="true" />
          <div>
            <h1 className="text-2xl font-semibold">Print production queue</h1>
            <p className="text-sm text-muted-foreground">
              Physical fulfilment of correspondence artefacts. Producing the
              artefact is not printing — every physical step below is recorded
              as an attempt.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={selected.length === 0}
            onClick={() => setBatchOpen(true)}
          >
            <Layers className="mr-2 h-4 w-4" aria-hidden="true" />
            Create print batch{selected.length > 0 ? ` (${selected.length})` : ""}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void queue.refetch()}
            disabled={queue.isFetching}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${queue.isFetching ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            Refresh
          </Button>
        </div>
      </header>

      <PrintBatchConsole />



      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Queue</CardTitle>
          <CardDescription>
            {queue.data ? `${queue.data.total} item(s)` : "Loading…"}
            {!fullDetail && " · recipient details are masked for your permission level"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-64">
              <Label htmlFor="print-search">Search</Label>
              <Input
                id="print-search"
                value={search}
                placeholder="Letter reference or recipient reference"
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
              {OMNI_COMMS_PRINT_STATUSES.map((status) => (
                <Button
                  key={status}
                  size="sm"
                  variant={statusFilter === status ? "default" : "outline"}
                  onClick={() => setStatusFilter(status)}
                >
                  {OMNI_COMMS_PRINT_STATUS_LABELS[status]}
                  {counts.get(status) ? ` (${counts.get(status)})` : ""}
                </Button>
              ))}
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all queued letters"
                    checked={
                      batchable.length > 0 && selected.length === batchable.length
                    }
                    onCheckedChange={(v) =>
                      setSelected(v === true ? batchable.map((r) => r.id) : [])
                    }
                  />
                </TableHead>
                <TableHead>Letter</TableHead>
                <TableHead>Module / event</TableHead>
                <TableHead>Recipient</TableHead>
                <TableHead>Profile</TableHead>
                <TableHead>Pages</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-sm text-muted-foreground">
                    {queue.isLoading
                      ? "Loading print items…"
                      : "No correspondence artefacts are awaiting physical production."}
                  </TableCell>
                </TableRow>
              )}
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => setDetailId(row.id)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      aria-label={`Select ${row.letter_reference}`}
                      disabled={row.physical_status !== "queued_for_print"}
                      checked={selected.includes(row.id)}
                      onCheckedChange={() => toggleSelected(row.id)}
                    />
                  </TableCell>

                  <TableCell className="font-mono text-xs">{row.letter_reference}</TableCell>
                  <TableCell className="text-xs">
                    {row.module_code ?? "—"} / {row.event_code ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    <div>{row.recipient_display ?? "—"}</div>
                    <div className="text-muted-foreground">{row.postal_summary ?? "—"}</div>
                  </TableCell>
                  <TableCell className="text-xs">
                    {row.production_profile?.paper_size ?? "—"} ·{" "}
                    {row.production_profile?.sides ?? "—"} ·{" "}
                    {row.production_profile?.colour_mode ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs">{row.page_count ?? "—"}</TableCell>
                  <TableCell className="text-xs">{row.attempt_count}</TableCell>
                  <TableCell>
                    <Badge className={STATUS_TONE[row.physical_status]} variant="outline">
                      {OMNI_COMMS_PRINT_STATUS_LABELS[row.physical_status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      {availablePrintActions(row.physical_status).map((action) => (
                        <Button
                          key={action}
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setReason("");
                            setEquipment("");
                            setPending({ row, action });
                          }}
                        >
                          {OMNI_COMMS_PRINT_ACTION_LABELS[action]}
                        </Button>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={pending != null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending ? OMNI_COMMS_PRINT_ACTION_LABELS[pending.action] : ""}
            </DialogTitle>
            <DialogDescription>
              {pending?.row.letter_reference} — this records a physical production
              event and cannot be edited afterwards.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {pending?.action === "start_printing" && (
              <div>
                <Label htmlFor="print-equipment">Equipment reference (optional)</Label>
                <Input
                  id="print-equipment"
                  value={equipment}
                  onChange={(e) => setEquipment(e.target.value)}
                  placeholder="e.g. HQ-PRN-02"
                />
              </div>
            )}
            <div>
              <Label htmlFor="print-reason">
                Reason
                {pending && OMNI_COMMS_PRINT_REASON_REQUIRED.includes(pending.action)
                  ? " (required)"
                  : " (optional)"}
              </Label>
              <Textarea
                id="print-reason"
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
              disabled={reasonRequired || act.isPending}
              onClick={() => pending && act.mutate(pending)}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={detailId != null} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Print item</DialogTitle>
            <DialogDescription>
              Artefact evidence and physical evidence are recorded separately.
            </DialogDescription>
          </DialogHeader>
          {detail.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {detail.data && (
            <div className="space-y-4 text-sm">
              <section className="space-y-1">
                <h3 className="font-medium">Artefact</h3>
                <p className="text-muted-foreground">
                  Checksum {detail.data.artefact.checksum_sha256 ?? "—"} ·{" "}
                  {detail.data.artefact.page_count ?? "—"} page(s) ·{" "}
                  {detail.data.artefact.byte_size ?? "—"} bytes
                </p>
                <p className="text-muted-foreground">
                  Storage {detail.data.artefact.bucket ?? "—"}
                  {detail.data.artefact.path ? ` / ${detail.data.artefact.path}` : ""}
                </p>
              </section>
              <section className="space-y-1">
                <h3 className="font-medium">Recipient</h3>
                <p className="text-muted-foreground">
                  {detail.data.recipient.display ?? "—"} ·{" "}
                  {detail.data.recipient.postal_summary ?? "—"}
                </p>
              </section>
              <section className="space-y-1">
                <h3 className="font-medium">Physical attempts</h3>
                {detail.data.attempts.length === 0 && (
                  <p className="text-muted-foreground">No physical attempt yet.</p>
                )}
                {detail.data.attempts.map((attempt) => (
                  <p key={attempt.attempt_number} className="text-muted-foreground">
                    #{attempt.attempt_number} · {attempt.outcome} ·{" "}
                    {attempt.equipment_reference ?? "no equipment"} ·{" "}
                    {attempt.failure_reason ?? "—"}
                  </p>
                ))}
              </section>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Create a governed production batch from the selected letters. */}
      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create print batch</DialogTitle>
            <DialogDescription>
              A batch groups existing letters for one production run. No new
              communication or artefact is created, and nothing is dispatched.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            {preview.isLoading && (
              <p className="text-muted-foreground">Checking compatibility…</p>
            )}
            {preview.data && (
              <>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-md border p-2">
                    <div className="text-muted-foreground">Letters</div>
                    <div className="text-base font-semibold">
                      {preview.data.selected_count}
                    </div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-muted-foreground">Pages</div>
                    <div className="text-base font-semibold">
                      {preview.data.total_pages}
                    </div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-muted-foreground">Profiles</div>
                    <div className="text-base font-semibold">
                      {preview.data.distinct_profiles}
                    </div>
                  </div>
                </div>
                {!preview.data.compatible && (
                  <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                    The selected letters do not share one production profile or
                    production account, or some are not queued for print. Split
                    the selection into compatible runs.
                  </p>
                )}
                {preview.data.items
                  .filter((i) => !i.eligible)
                  .map((i) => (
                    <p key={i.print_item_id} className="text-xs text-muted-foreground">
                      {i.letter_reference} — {i.blocker ?? "not eligible"}
                    </p>
                  ))}
              </>
            )}

            <div>
              <Label htmlFor="batch-notes">Notes (optional)</Label>
              <Textarea
                id="batch-notes"
                rows={2}
                value={batchNotes}
                onChange={(e) => setBatchNotes(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                createBatch.isPending ||
                preview.isLoading ||
                preview.data?.compatible !== true
              }
              onClick={() => createBatch.mutate()}
            >
              Create batch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>

  );
};

/**
 * Host pages may mount this section outside a React Query provider (isolated
 * render tests do). Providing a local client keeps the section self-contained
 * instead of crashing its host.
 */
export const PrintProductionQueue: React.FC = () => {
  let hasClient = true;
  try {
    useQueryClient();
  } catch {
    hasClient = false;
  }
  const [fallback] = useState(() => new QueryClient());
  if (hasClient) return <PrintProductionQueueInner />;
  return (
    <QueryClientProvider client={fallback}>
      <PrintProductionQueueInner />
    </QueryClientProvider>
  );
};

export default PrintProductionQueue;
