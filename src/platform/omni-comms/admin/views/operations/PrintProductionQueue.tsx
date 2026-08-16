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
import { Printer, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
      </header>

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
                  <TableCell colSpan={8} className="text-sm text-muted-foreground">
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
