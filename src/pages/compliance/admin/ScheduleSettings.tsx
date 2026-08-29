import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Calendar, Settings2, ExternalLink, CheckCircle2, XCircle, Clock, RefreshCw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateForDisplay } from "@/lib/format-config";

interface AutomationJob {
  id: string;
  job_code: string;
  name: string;
  description: string | null;
  schedule_cron: string | null;
  is_enabled: boolean;
  last_run_at: string | null;
  last_run_status: string | null;
  /** Cron expression actually registered with the scheduler (null when not scheduled). */
  active_cron?: string | null;
  /** Edge function bound to this job; null means the job has no runtime binding. */
  edge_function?: string | null;
  sync_state?: string | null;
}

const SYNC_STATE_LABEL: Record<string, { label: string; variant: "default" | "outline" | "destructive" | "secondary" }> = {
  IN_SYNC: { label: "Running as configured", variant: "default" },
  DRIFT: { label: "Schedule drift", variant: "destructive" },
  NOT_SCHEDULED: { label: "Not scheduled", variant: "destructive" },
  ORPHAN_SCHEDULE: { label: "Orphan schedule", variant: "destructive" },
  NO_RUNTIME_BINDING: { label: "No runtime binding", variant: "destructive" },
  NOT_APPLICABLE: { label: "On demand", variant: "outline" },
};

/**
 * Compliance Schedule Settings
 * Shows configured schedule vs the schedule that is actually registered with the
 * background scheduler, sourced from ce_v_automation_job_schedule_truth.
 * Edits happen in Job Configuration; this page can reconcile the scheduler.
 */
const ScheduleSettings = () => {
  const queryClient = useQueryClient();

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["compliance-schedule-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ce_v_automation_job_schedule_truth")
        .select("id, job_code, name, schedule_cron:configured_cron, is_enabled, last_run_at, last_run_status, active_cron, edge_function, sync_state")
        .order("job_code");
      if (error) throw error;
      return (data || []) as unknown as AutomationJob[];
    },
  });

  const syncSchedules = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("ce_sync_automation_job_schedules");
      if (error) throw error;
      return data as { scheduled: number; unscheduled: number; unmapped_jobs: string[] };
    },
    onSuccess: (result) => {
      toast.success(
        `Scheduler reconciled — ${result?.scheduled ?? 0} scheduled, ${result?.unscheduled ?? 0} removed` +
          (result?.unmapped_jobs?.length ? `, ${result.unmapped_jobs.length} without runtime binding` : ""),
      );
      queryClient.invalidateQueries({ queryKey: ["compliance-schedule-settings"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not reconcile schedules"),
  });

  const scheduled = jobs.filter((j) => j.schedule_cron && j.schedule_cron.trim().length > 0);
  const onDemand = jobs.filter((j) => !j.schedule_cron || j.schedule_cron.trim().length === 0);
  const enabledCount = scheduled.filter((j) => j.is_enabled).length;
  const outOfSync = jobs.filter((j) => j.sync_state && !["IN_SYNC", "NOT_APPLICABLE"].includes(j.sync_state));

  const renderSyncState = (state: string | null | undefined) => {
    if (!state) return <span className="text-muted-foreground text-xs">—</span>;
    const cfg = SYNC_STATE_LABEL[state] ?? { label: state, variant: "outline" as const };
    return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
  };


  const renderStatus = (status: string | null) => {
    if (!status) return <span className="text-muted-foreground text-xs">—</span>;
    const ok = /success|complete/i.test(status);
    return (
      <Badge variant={ok ? "default" : "destructive"} className="capitalize">
        {status.toLowerCase()}
      </Badge>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Calendar className="h-6 w-6 text-primary" />
            Schedule Settings
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cron schedules for all Compliance &amp; Enforcement automation jobs. Edit schedules and parameters in Job Configuration.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncSchedules.mutate()}
            disabled={syncSchedules.isPending}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${syncSchedules.isPending ? "animate-spin" : ""}`} />
            Reconcile Scheduler
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/scheduler">
              <ExternalLink className="h-4 w-4 mr-1" /> Central Scheduler
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/compliance/admin/automation/jobs">
              <Settings2 className="h-4 w-4 mr-1" /> Job Configuration
            </Link>
          </Button>
        </div>
      </div>

      {outOfSync.length > 0 && (
        <Card className="border-destructive/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {outOfSync.length} job{outOfSync.length === 1 ? "" : "s"} not executing as configured
            </CardTitle>
            <CardDescription>
              {outOfSync.map((j) => j.job_code).join(", ")} — use Reconcile Scheduler, or bind a runtime function in
              Job Configuration for jobs reported as having no runtime binding.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Scheduled jobs</CardDescription>
            <CardTitle className="text-3xl">{scheduled.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Currently enabled</CardDescription>
            <CardTitle className="text-3xl text-primary">{enabledCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Out of sync</CardDescription>
            <CardTitle className={`text-3xl ${outOfSync.length ? "text-destructive" : ""}`}>{outOfSync.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>On-demand / event-driven</CardDescription>
            <CardTitle className="text-3xl">{onDemand.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>


      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Scheduled Jobs</CardTitle>
          <CardDescription>Jobs with a cron expression. Toggle on/off and edit cadence in Job Configuration.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-6">Loading…</p>
          ) : scheduled.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">No scheduled jobs configured.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Cron</TableHead>
                    <TableHead>Enabled</TableHead>
                    <TableHead>Last Run</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scheduled.map((j) => (
                    <TableRow key={j.id}>
                      <TableCell>
                        <div className="font-medium">{j.name}</div>
                        {j.description && (
                          <div className="text-xs text-muted-foreground line-clamp-1">{j.description}</div>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{j.job_code}</TableCell>
                      <TableCell className="font-mono text-xs">{j.schedule_cron}</TableCell>
                      <TableCell>
                        {j.is_enabled ? (
                          <span className="inline-flex items-center gap-1 text-primary text-sm">
                            <CheckCircle2 className="h-4 w-4" /> On
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-muted-foreground text-sm">
                            <XCircle className="h-4 w-4" /> Off
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {j.last_run_at ? (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" /> {formatDateForDisplay(j.last_run_at)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Never</span>
                        )}
                      </TableCell>
                      <TableCell>{renderStatus(j.last_run_status)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">On-Demand / Event-Driven Jobs</CardTitle>
          <CardDescription>Jobs without a cron expression. Run manually or triggered by events.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-6">Loading…</p>
          ) : onDemand.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">No on-demand jobs registered.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Enabled</TableHead>
                    <TableHead>Last Run</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {onDemand.map((j) => (
                    <TableRow key={j.id}>
                      <TableCell>
                        <div className="font-medium">{j.name}</div>
                        {j.description && (
                          <div className="text-xs text-muted-foreground line-clamp-1">{j.description}</div>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{j.job_code}</TableCell>
                      <TableCell>
                        {j.is_enabled ? (
                          <Badge variant="default">On</Badge>
                        ) : (
                          <Badge variant="outline">Off</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {j.last_run_at ? formatDateForDisplay(j.last_run_at) : <span className="text-muted-foreground">Never</span>}
                      </TableCell>
                      <TableCell>{renderStatus(j.last_run_status)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ScheduleSettings;
