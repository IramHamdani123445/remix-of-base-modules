import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldCheck, Zap, ZapOff, Radar } from "lucide-react";
import { toast } from "sonner";
import type { EventGoLiveStatus } from "@/platform/communication-hub/eventGoLiveStatusService";
import {
  runAutomationReadinessProbe,
  AUTOMATION_READINESS_CHECK_CODES,
  type ReadinessProbeBlocker,
  type ReadinessProbeSuccess,
  type ReadinessProbeCheck,
  type ReadinessCheckStatus,
} from "@/platform/communication-hub/automationReadinessProbeService";
import {
  certifyEventAutomatedProduction,
  AUTOMATED_CERTIFY_TYPED_PHRASE,
  AUTOMATED_ACTIVATE_TYPED_PHRASE,
  AUTOMATED_ARM_TYPED_PHRASE,
} from "@/platform/communication-hub/automatedProductionCertificationService";
import { supabase } from "@/integrations/supabase/client";
import { applyReleaseMode } from "@/platform/communication-hub/releaseModeService";
import { deriveStep8, STEP8_STATE_LABELS } from "./goLiveStateResolver";

interface Props {
  moduleCode: string;
  eventCode: string;
  channel: string;
  status: EventGoLiveStatus | null;
  onChanged: () => void;
}

export function AutomatedProductionActivationPanel({
  moduleCode,
  eventCode,
  channel,
  status,
  onChanged,
}: Props) {
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<ReadinessProbeBlocker | null>(null);
  const [certReason, setCertReason] = useState("");
  const [certPhrase, setCertPhrase] = useState("");
  const [certifying, setCertifying] = useState(false);
  const [activateReason, setActivateReason] = useState("");
  const [activatePhrase, setActivatePhrase] = useState("");
  const [switching, setSwitching] = useState(false);
  const [armReason, setArmReason] = useState("");
  const [armPhrase, setArmPhrase] = useState("");
  const [arming, setArming] = useState(false);
  const [disarming, setDisarming] = useState(false);

  const stage8 = status?.stage8;
  const platform = status?.platform;
  const stage7 = status?.stage7;

  const eventCronCertified = stage8?.automation_event_certification_status === "live_cron_allowed";
  const globalAutomatedActive = platform?.current_operating_mode === "AUTOMATED_PRODUCTION";
  const armed = platform?.automation_state === "ARMED";

  const readinessByCode = new Map(
    (stage8?.readiness_checks ?? []).map((c) => [c.check_code, c]),
  );

  async function handleProbe() {
    setProbing(true);
    try {
      const result = await runAutomationReadinessProbe({ moduleCode, eventCode, channel });
      if (result.ok === false) {
        setProbeError(result.blocker);
        toast.error(`Readiness probe error: ${result.blocker.code}`);
      } else {
        setProbeError(null);
        toast.success("Automation readiness probe complete");
      }
      onChanged();
    } catch (e: any) {
      setProbeError({ code: "READINESS_PROBE_TRANSPORT_ERROR", detail: e?.message });
      toast.error(e?.message ?? "Readiness probe failed");
    } finally {
      setProbing(false);
    }
  }

  async function handleCertify() {
    setCertifying(true);
    try {
      await certifyEventAutomatedProduction({
        moduleCode,
        eventCode,
        channel,
        reason: certReason.trim(),
        typedConfirmation: certPhrase,
      });
      toast.success("Event certified for Automated Production");
      setCertReason("");
      setCertPhrase("");
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Certification failed");
    } finally {
      setCertifying(false);
    }
  }

  async function handleSwitchMode() {
    if (activatePhrase !== AUTOMATED_ACTIVATE_TYPED_PHRASE) {
      toast.error("Typed confirmation mismatch");
      return;
    }
    setSwitching(true);
    try {
      const result = await applyReleaseMode({
        newMode: "AUTOMATED_PRODUCTION",
        reason: activateReason.trim(),
        expectedVersion: platform?.configuration_version ?? undefined,
        moduleCode,
        eventCode,
        channel,
      });
      if (!result?.ok || result.new_mode !== "AUTOMATED_PRODUCTION") {
        throw new Error("Mode switch did not confirm AUTOMATED_PRODUCTION");
      }
      toast.success("Platform mode switched to AUTOMATED_PRODUCTION (STANDBY)");
      setActivateReason("");
      setActivatePhrase("");
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Mode switch failed");
      onChanged();
    } finally {
      setSwitching(false);
    }
  }

  async function handleArm() {
    setArming(true);
    try {
      const { error } = await (supabase as any).rpc("arm_comm_hub_automation", {
        p_reason: armReason.trim(),
        p_confirmation: armPhrase,
        p_expected_version: platform?.configuration_version ?? null,
      });
      if (error) throw new Error(error.message ?? "arm failed");
      toast.success("Automation ARMED");
      setArmReason("");
      setArmPhrase("");
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Arm failed");
    } finally {
      setArming(false);
    }
  }

  async function handleDisarm() {
    setDisarming(true);
    try {
      const { error } = await (supabase as any).rpc("disarm_comm_hub_automation", {
        p_reason: "Operator disarm from Stage 8 panel",
      });
      if (error) throw new Error(error.message ?? "disarm failed");
      toast.success("Automation disarmed");
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Disarm failed");
    } finally {
      setDisarming(false);
    }
  }

  const canCertify =
    stage7?.manual_event_status === "live_manual_only" &&
    stage8?.readiness_all_ok_and_fresh &&
    !stage7?.drift_detected &&
    (stage7?.manual_observation_count ?? 0) >= 1 &&
    stage7?.latest_manual_observation_inbox === "CONFIRMED" &&
    certReason.trim().length >= 6 &&
    certPhrase === AUTOMATED_CERTIFY_TYPED_PHRASE;

  const step8State = deriveStep8(status);

  return (
    <div className="space-y-6">
      <Alert>
        <AlertDescription className="text-xs flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">Stage 8 state:</span>
          <Badge variant={step8State === "ARMED_PENDING_HEARTBEAT" ? "default" : "secondary"} className="font-mono">
            {step8State}
          </Badge>
          <span className="text-muted-foreground">·</span>
          <span>{STEP8_STATE_LABELS[step8State]}</span>
        </AlertDescription>
      </Alert>

      {/* Manual + observation summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm rounded-md border p-3 bg-muted/30">
        <div>Manual event status: <Badge>{stage7?.manual_event_status ?? "—"}</Badge></div>
        <div>Global mode: <Badge>{platform?.current_operating_mode ?? "—"}</Badge></div>
        <div>Automation state: <Badge variant={armed ? "default" : "outline"}>{platform?.automation_state ?? "—"}</Badge></div>
        <div>Config version: {platform?.configuration_version ?? "—"}</div>
        <div>Manual observations confirmed: {stage7?.latest_manual_observation_inbox === "CONFIRMED" ? "yes" : "no"}</div>
        <div>Drift: {stage7?.drift_detected ? <Badge variant="destructive">yes</Badge> : "none"}</div>
      </div>

      {/* Action 1 — Readiness probes */}
      <div className="rounded-md border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Radar className="h-4 w-4" />
          <div className="font-medium">1. Automation readiness probes (9 checks)</div>
          <Badge
            className="ml-auto"
            variant={
              probeError ? "destructive" : stage8?.readiness_all_ok_and_fresh ? "default" : "secondary"
            }
          >
            {probeError
              ? "probe ERROR"
              : stage8?.readiness_all_ok_and_fresh
                ? "all fresh & OK"
                : "incomplete or stale"}
          </Badge>
        </div>
        {probeError && (
          <Alert variant="destructive">
            <AlertTitle className="font-mono text-xs">{probeError.code}</AlertTitle>
            <AlertDescription className="text-xs space-y-1">
              {probeError.object_name && (
                <div>
                  <span className="text-muted-foreground">object:</span>{" "}
                  <span className="font-mono">{probeError.object_name}</span>
                </div>
              )}
              {probeError.detail && <div>{probeError.detail}</div>}
              {probeError.fix_action && (
                <div className="text-muted-foreground">Fix: {probeError.fix_action}</div>
              )}
              <div className="text-muted-foreground">
                Automated certification remains disabled. Operating mode is unchanged. No readiness
                PASS rows were created.
              </div>
            </AlertDescription>
          </Alert>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
          {AUTOMATION_READINESS_CHECK_CODES.map((code) => {
            const r = readinessByCode.get(code);
            return (
              <div key={code} className="rounded border p-2 flex items-center justify-between">
                <span className="font-mono">{code}</span>
                <span>
                  {probeError ? (
                    <Badge variant="destructive">ERROR</Badge>
                  ) : r ? (
                    <Badge variant={r.result && r.fresh ? "default" : "destructive"}>
                      {r.result ? "OK" : "FAIL"}{r.fresh ? "" : " · stale"}
                    </Badge>
                  ) : (
                    <Badge variant="outline">not run</Badge>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        <Button onClick={handleProbe} disabled={probing} variant="secondary">
          {probing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Run readiness probes
        </Button>
      </div>


      {/* Action 2 — Certify */}
      <div className="rounded-md border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          <div className="font-medium">2. Certify this event as live_cron_allowed</div>
          {eventCronCertified && <Badge className="ml-auto">CERTIFIED</Badge>}
        </div>
        <Textarea
          value={certReason}
          onChange={(e) => setCertReason(e.target.value)}
          placeholder="Audit reason (min 6 chars)"
          disabled={certifying || eventCronCertified}
        />
        <Input
          value={certPhrase}
          onChange={(e) => setCertPhrase(e.target.value)}
          placeholder={`Type: ${AUTOMATED_CERTIFY_TYPED_PHRASE}`}
          disabled={certifying || eventCronCertified}
        />
        <Button onClick={handleCertify} disabled={!canCertify || eventCronCertified}>
          {certifying && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Certify for Automated Production
        </Button>
      </div>

      {/* Action 3 — Impact preview */}
      <div className="rounded-md border p-4 space-y-2">
        <div className="font-medium">3. Automated Production impact</div>
        <Alert>
          <AlertDescription>
            <strong>{platform?.eligible_automated_event_count ?? 0}</strong> event(s)
            already carry <code>live_cron_allowed</code> and will become active
            for scheduled/automatic dispatch when automation is armed.
          </AlertDescription>
        </Alert>
      </div>

      {/* Action 4 — Switch to AUTOMATED_PRODUCTION (STANDBY) */}
      <div className="rounded-md border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4" />
          <div className="font-medium">4. Switch platform mode to AUTOMATED_PRODUCTION (STANDBY)</div>
          {globalAutomatedActive && <Badge className="ml-auto">{platform?.current_operating_mode}</Badge>}
        </div>
        <Alert>
          <AlertDescription>
            Mode change alone does not arm automation. Scheduler, retry worker
            and automatic triggers stay OFF; state stays <strong>STANDBY</strong>.
          </AlertDescription>
        </Alert>
        <Textarea
          value={activateReason}
          onChange={(e) => setActivateReason(e.target.value)}
          placeholder="Audit reason (min 6 chars)"
          disabled={switching || globalAutomatedActive || !eventCronCertified}
        />
        <Input
          value={activatePhrase}
          onChange={(e) => setActivatePhrase(e.target.value)}
          placeholder={`Type: ${AUTOMATED_ACTIVATE_TYPED_PHRASE}`}
          disabled={switching || globalAutomatedActive || !eventCronCertified}
        />
        <Button onClick={handleSwitchMode} disabled={switching || globalAutomatedActive || !eventCronCertified}>
          {switching && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Switch to AUTOMATED_PRODUCTION
        </Button>
      </div>

      {/* Action 5/6 — Arm / Disarm */}
      <div className="rounded-md border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <div className="font-medium">5. Arm automation</div>
          <Badge className="ml-auto" variant={armed ? "default" : "outline"}>
            state: {platform?.automation_state ?? "—"}
          </Badge>
        </div>
        <Alert>
          <AlertTitle>Pre-arm summary</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5 space-y-1 text-xs">
              <li>Eligible cron events: {platform?.eligible_automated_event_count ?? 0}</li>
              <li>Batch size: {"—"} (see control settings)</li>
              <li>Dispatch enabled: {String(platform?.dispatch_enabled ?? false)}</li>
              <li>Emergency stop available: yes (toggle from control center)</li>
            </ul>
          </AlertDescription>
        </Alert>
        <Textarea
          value={armReason}
          onChange={(e) => setArmReason(e.target.value)}
          placeholder="Audit reason (min 6 chars)"
          disabled={arming || armed || !globalAutomatedActive}
        />
        <Input
          value={armPhrase}
          onChange={(e) => setArmPhrase(e.target.value)}
          placeholder={`Type: ${AUTOMATED_ARM_TYPED_PHRASE}`}
          disabled={arming || armed || !globalAutomatedActive}
        />
        <div className="flex gap-2">
          <Button
            onClick={handleArm}
            disabled={arming || armed || !globalAutomatedActive || armPhrase !== AUTOMATED_ARM_TYPED_PHRASE || armReason.trim().length < 6}
          >
            {arming && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            ARM automation
          </Button>
          {armed && (
            <Button variant="destructive" onClick={handleDisarm} disabled={disarming}>
              {disarming && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <ZapOff className="h-4 w-4 mr-1" />
              Disarm
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
