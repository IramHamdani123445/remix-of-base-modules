import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldAlert, ZapOff, Ban } from "lucide-react";
import { toast } from "sonner";
import { getGoLiveCompletion, type GoLiveCompletion } from "@/platform/communication-hub/goLiveCompletionService";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  moduleCode: string;
  eventCode: string;
  channel: string;
  reloadNonce: number;
  onChanged: () => void;
}

/**
 * Stage 9 — server-authoritative review & complete panel.
 * Everything rendered here is derived from server state. sessionStorage
 * is never consulted.
 */
export function GoLiveCompletionPanel({
  moduleCode,
  eventCode,
  channel,
  reloadNonce,
  onChanged,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [completion, setCompletion] = useState<GoLiveCompletion | null>(null);
  const [rollingBack, setRollingBack] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await getGoLiveCompletion({ moduleCode, eventCode, channel });
        if (!cancelled) setCompletion(res);
      } catch (e: any) {
        if (!cancelled) toast.error(e?.message ?? "Failed to load Stage 9 status");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [moduleCode, eventCode, channel, reloadNonce]);

  async function handleRollback(target: "MANUAL" | "SUSPEND" | "DISARM" | "EMERGENCY_STOP") {
    const reason = prompt(`Audit reason for ${target}?`);
    if (!reason || reason.trim().length < 6) {
      toast.error("Reason required (min 6 chars)");
      return;
    }
    setRollingBack(true);
    try {
      if (target === "DISARM") {
        const { error } = await (supabase as any).rpc("disarm_comm_hub_automation", { p_reason: reason });
        if (error) throw new Error(error.message ?? "disarm failed");
      } else if (target === "EMERGENCY_STOP") {
        const { error } = await (supabase as any).rpc("disarm_comm_hub_automation", { p_reason: `EMERGENCY_STOP: ${reason}` });
        if (error) throw new Error(error.message ?? "emergency stop failed");
      } else {
        const target_status = target === "MANUAL" ? "live_manual_only" : "SUSPENDED";
        const { error } = await (supabase as any).rpc("rollback_comm_hub_event_production", {
          p_payload: {
            module_code: moduleCode,
            event_code: eventCode,
            channel,
            target_status,
            reason,
          },
        });
        if (error) throw new Error(error.message ?? "rollback failed");
      }
      toast.success(`${target} applied`);
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Rollback failed");
    } finally {
      setRollingBack(false);
    }
  }

  if (loading && !completion) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading Stage 9 evidence…
      </div>
    );
  }
  if (!completion) return null;

  const { outcome, is_stage9_complete, status } = completion;
  const s6 = status.stage6, s7 = status.stage7, s8 = status.stage8, p = status.platform;

  const outcomeVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    LIVE_MANUAL: "default",
    LIVE_AUTOMATED_ARMED: "default",
    LIVE_AUTOMATED_STANDBY: "secondary",
    STAGE_6_COMPLETE: "secondary",
    INCOMPLETE: "outline",
    SUSPENDED: "destructive",
    DRIFT_DETECTED: "destructive",
    EMERGENCY_STOP: "destructive",
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border p-4">
        <div className="flex items-center gap-3">
          <div className="text-sm text-muted-foreground">Server-derived outcome:</div>
          <Badge variant={outcomeVariant[outcome] ?? "outline"} className="text-sm">
            {outcome}
          </Badge>
          {is_stage9_complete && <Badge className="bg-green-600">Stage 9 complete</Badge>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <SectionCard title="Preview / Dry Run">
          {/* Preview + dry-run IDs live on Stage 6 lineage indirectly */}
          <div className="text-xs text-muted-foreground">
            See Stage 3–5 evidence — anchored by the ONE_REAL_EMAIL certification.
          </div>
        </SectionCard>

        <SectionCard title="One Real Email">
          <KV label="Execution" value={s6.one_real_email_execution_id} mono />
          <KV label="Certification" value={s6.one_real_email_certification_id} mono />
          <KV label="Provider msg id" value={s6.provider_message_id} mono />
          <KV label="Delivery attempt" value={s6.delivery_attempt_id} mono />
          <KV label="Trace" value={s6.trace_id} mono />
          <KV label="Manual verification" value={s6.manual_verification_status} />
        </SectionCard>

        <SectionCard title="Manual Production">
          <KV label="Event certification" value={s7.manual_event_certification_id} mono />
          <KV label="Status" value={s7.manual_event_status} />
          <KV label="Approved at" value={s7.manual_approved_at} />
          <KV label="Observations" value={String(s7.manual_observation_count)} />
          <KV label="Latest inbox" value={s7.latest_manual_observation_inbox} />
          <KV label="Global mode" value={p.current_operating_mode} />
        </SectionCard>

        <SectionCard title="Automated Production">
          <KV label="Automation status" value={s8.automation_event_certification_status} />
          <KV label="Certified at" value={s8.automation_certified_at} />
          <KV label="Automation state" value={p.automation_state} />
          <KV label="Scheduler" value={String(p.scheduler_enabled)} />
          <KV label="Triggers" value={String(p.automatic_triggers_enabled)} />
          <KV label="Retry worker" value={String(p.retry_worker_enabled)} />
          <KV label="Eligible cron events" value={String(p.eligible_automated_event_count)} />
        </SectionCard>

        <SectionCard title="Governance">
          <KV label="Configuration version" value={String(p.configuration_version)} />
          <KV label="Dispatch enabled" value={String(p.dispatch_enabled)} />
          <KV label="Drift" value={s7.drift_detected ? `yes — ${s7.drift_reason ?? ""}` : "none"} />
          <KV label="Real-email gate" value={s6.real_email_gate_enabled ? "OPEN" : "closed"} />
        </SectionCard>
      </div>

      {/* Emergency controls */}
      <div className="rounded-md border border-destructive/40 p-4 space-y-2">
        <div className="flex items-center gap-2 text-destructive font-medium">
          <ShieldAlert className="h-4 w-4" /> Emergency & rollback controls
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => handleRollback("DISARM")} disabled={rollingBack}>
            <ZapOff className="h-4 w-4 mr-1" /> Disarm automation
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleRollback("MANUAL")} disabled={rollingBack}>
            Downgrade to Manual
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleRollback("SUSPEND")} disabled={rollingBack}>
            Suspend event
          </Button>
          <Button variant="destructive" size="sm" onClick={() => handleRollback("EMERGENCY_STOP")} disabled={rollingBack}>
            <Ban className="h-4 w-4 mr-1" /> Engage Emergency Stop
          </Button>
        </div>
        <div className="text-xs text-muted-foreground">
          Every rollback requires an audit reason and preserves evidence.
        </div>
      </div>

      {!is_stage9_complete && (
        <Alert>
          <AlertTitle>Not complete</AlertTitle>
          <AlertDescription>
            Stage 9 completes when the server-derived outcome is
            <strong> LIVE_MANUAL</strong> or <strong> LIVE_AUTOMATED_ARMED</strong>.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border p-3 bg-muted/30 space-y-1">
      <div className="text-sm font-medium">{title}</div>
      {children}
    </div>
  );
}

function KV({ label, value, mono }: { label: string; value: unknown; mono?: boolean }) {
  return (
    <div className="text-xs">
      <span className="text-muted-foreground">{label}:</span>{" "}
      {value == null || value === "" ? (
        <span className="text-muted-foreground">—</span>
      ) : mono ? (
        <code className="font-mono">{String(value)}</code>
      ) : (
        <span>{String(value)}</span>
      )}
    </div>
  );
}
