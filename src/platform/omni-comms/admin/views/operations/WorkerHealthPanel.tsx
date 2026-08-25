/**
 * Scheduled worker health.
 *
 * Observational only. Reads public.platform_worker_lease, which every recurring
 * platform worker updates when it takes (or fails to take) its single-flight
 * lease. "Skipped" is not an error: it means a tick was suppressed because the
 * previous run was still inside its execution budget — exactly the protection
 * that stops workers from stacking up and saturating the database.
 */

import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";

interface WorkerLeaseRow {
  worker_name: string;
  leased_until: string | null;
  lease_seconds: number | null;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_outcome: string | null;
  run_count: number | null;
  skipped_count: number | null;
}

function when(value: string | null): string {
  if (!value) return "Never";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "—";
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 0) return "in the future";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

const WorkerHealthPanel: React.FC = () => {
  const [rows, setRows] = useState<WorkerLeaseRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = supabase.from("platform_worker_lease" as never) as unknown as {
        select: (columns: string) => Promise<{ data: unknown; error: { message: string } | null }>;
      };
      const { data, error: queryError } = await query.select(
        "worker_name,leased_until,lease_seconds,last_started_at,last_finished_at,last_outcome,run_count,skipped_count",
      );
      if (queryError) throw new Error(queryError.message);
      const list = (data as WorkerLeaseRow[] | null) ?? [];
      setRows(
        [...list].sort((a, b) => a.worker_name.localeCompare(b.worker_name)),
      );
    } catch (e: unknown) {
      setRows(null);
      setError(e instanceof Error ? e.message : "Unable to load worker health");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card data-testid="platform-worker-health">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div>
          <CardTitle className="text-base">Scheduled worker health</CardTitle>
          <p className="text-sm text-muted-foreground">
            Each recurring worker takes a short reservation before it runs, so a new
            run can never pile on top of one that is still going.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
          data-testid="platform-worker-health-refresh"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-destructive" data-testid="platform-worker-health-error">
            {error}
          </p>
        ) : rows === null ? (
          <p className="text-sm text-muted-foreground">Loading worker health…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No recurring workers are registered.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Worker</TableHead>
                <TableHead>Running now</TableHead>
                <TableHead>Last started</TableHead>
                <TableHead>Last finished</TableHead>
                <TableHead className="text-right">Runs</TableHead>
                <TableHead className="text-right">Skipped (still busy)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const busy =
                  row.leased_until != null &&
                  new Date(row.leased_until).getTime() > Date.now();
                return (
                  <TableRow key={row.worker_name}>
                    <TableCell className="font-medium">{row.worker_name}</TableCell>
                    <TableCell>
                      <Badge variant={busy ? "default" : "outline"}>
                        {busy ? "Running" : "Idle"}
                      </Badge>
                    </TableCell>
                    <TableCell>{when(row.last_started_at)}</TableCell>
                    <TableCell>{when(row.last_finished_at)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.run_count ?? 0}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.skipped_count ?? 0}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

export default WorkerHealthPanel;
