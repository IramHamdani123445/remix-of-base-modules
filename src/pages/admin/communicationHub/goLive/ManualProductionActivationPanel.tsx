import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldCheck, Lock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import type { EventGoLiveStatus, Stage6Blocker } from "@/platform/communication-hub/eventGoLiveStatusService";
import {
  certifyEventManualProduction,
  closeOneRealEmailGateAfterStage6,
  MANUAL_PRODUCTION_TYPED_PHRASE,
} from "@/platform/communication-hub/manualProductionCertificationService";
import { applyReleaseMode } from "@/platform/communication-hub/releaseModeService";
import {
  reconcileManualProductionEntry,
  promoteEventToManualProduction,
} from "@/platform/communication-hub/manualProductionContinuityService";

const ACTIVATE_TYPED_PHRASE = "ACTIVATE MANUAL PRODUCTION";

interface Props {
  moduleCode: string;
  eventCode: string;
  channel: string;
  status: EventGoLiveStatus | null;
  onChanged: () => void;
}

/**
 * Stage 7 — Activate Manual Production.
 *
 * Actions in order:
 * 1. Certify selected event for Manual Production
 * 2. Close One Real Email testing gate (if still open)
 * 3. Global mode impact preview
 * 4. Switch platform mode to MANUAL_PRODUCTION
 * 5. (Observation lives in its own panel below)
 */
export function ManualProductionActivationPanel({
  moduleCode,
  eventCode,
  channel,
  status,
  onChanged,
}: Props) {
  const [certifyReason, setCertifyReason] = useState("");
  const [certifyPhrase, setCertifyPhrase] = useState("");
  const [certifying, setCertifying] = useState(false);

  const [closingGate, setClosingGate] = useState(false);
  const [gateReason, setGateReason] = useState("Stage 6 complete — closing scoped real-email gate");

  const [activateReason, setActivateReason] = useState("");
  const [activatePhrase, setActivatePhrase] = useState("");
  const [switching, setSwitching] = useState(false);

  const [reconciling, setReconciling] = useState(false);
  const [reconcileMsg, setReconcileMsg] = useState<string | null>(null);

  const stage6 = status?.stage6;
  const stage7 = status?.stage7;
  const platform = status?.platform;

  // Server-authoritative eligibility (do NOT infer from browser booleans)
  const eligibleCertId = stage6?.eligible_one_real_email_certification_id ?? null;
  const stage6ReadyForCert = stage6?.stage6_ready_for_manual_production === true && !!eligibleCertId;
  const stage6Blockers = stage6?.stage6_manual_production_blockers ?? [];

  const eventCertified =
    stage7?.manual_event_status === "live_manual_only" ||
    stage7?.manual_event_status === "live_cron_allowed";

  const globalManualActive =
    platform?.current_operating_mode === "MANUAL_PRODUCTION" ||
    platform?.current_operating_mode === "AUTOMATED_PRODUCTION";

  const gateStillOpen = stage6?.real_email_gate_enabled === true;

  const canCertify =
    stage6ReadyForCert &&
    !certifying &&
    certifyReason.trim().length >= 6 &&
    certifyPhrase === MANUAL_PRODUCTION_TYPED_PHRASE;

  const canSwitchMode =
    eventCertified &&
    !switching &&
    activateReason.trim().length >= 6 &&
    activatePhrase === ACTIVATE_TYPED_PHRASE;

  async function handleCertify() {
    if (!eligibleCertId) return;
    setCertifying(true);
    try {
      const result = await certifyEventManualProduction({
        moduleCode,
        eventCode,
        channel,
        oneRealEmailCertificationId: eligibleCertId,
        reason: certifyReason.trim(),
        typedConfirmation: certifyPhrase,
      });
      if ((result as any)?.ok === false) {
        const blockers = ((result as any).blockers ?? []) as Stage6Blocker[];
        const summary = blockers.map((b) => b.code).join(", ") || (result as any).error || "prerequisites_not_met";
        toast.error(`Certification blocked: ${summary}`);
        onChanged();
        return;
      }
      toast.success("Event certified for Manual Production");
      setCertifyReason("");
      setCertifyPhrase("");
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Certification failed");
    } finally {
      setCertifying(false);
    }
  }

  async function handleCloseGate() {
    setClosingGate(true);
    try {
      await closeOneRealEmailGateAfterStage6({
        moduleCode,
        eventCode,
        channel,
        reason: gateReason.trim() || "Stage 6 complete",
      });
      toast.success("One Real Email testing gate closed");
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Gate closure failed");
    } finally {
      setClosingGate(false);
    }
  }

  async function handleSwitchMode() {
    setSwitching(true);
    try {
      const result = await applyReleaseMode({
        newMode: "MANUAL_PRODUCTION",
        reason: activateReason.trim(),
        expectedVersion: platform?.configuration_version ?? undefined,
        moduleCode,
        eventCode,
        channel,
      });
      if (!result?.ok || result.new_mode !== "MANUAL_PRODUCTION") {
        throw new Error("Mode switch did not confirm MANUAL_PRODUCTION");
      }
      toast.success("Platform mode switched to MANUAL_PRODUCTION");
      setActivateReason("");
      setActivatePhrase("");
      onChanged();
    } catch (e: any) {
      const msg = e?.message ?? "Mode switch failed";
      toast.error(msg);
      // Refresh authoritative status on any conflict/failure — never retry with stale evidence.
      onChanged();
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Stage 6 evidence */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm rounded-md border p-3 bg-muted/30">
        <div><span className="text-muted-foreground">Eligible certification:</span>{" "}
          <code className="font-mono text-xs">{eligibleCertId ?? "—"}</code>
        </div>
        <div><span className="text-muted-foreground">Latest certification:</span>{" "}
          <code className="font-mono text-xs">{stage6?.latest_one_real_email_certification_id ?? "—"}</code>
        </div>
        <div><span className="text-muted-foreground">Eligible status:</span>{" "}
          <Badge variant="outline">{stage6?.eligible_one_real_email_certification_status ?? "—"}</Badge>
        </div>
        <div><span className="text-muted-foreground">Latest status:</span>{" "}
          <Badge variant="outline">{stage6?.latest_one_real_email_certification_status ?? "—"}</Badge>
        </div>
        <div><span className="text-muted-foreground">Manual inbox verification:</span>{" "}
          <Badge variant={stage6?.manual_verification_status === "CONFIRMED" ? "default" : "secondary"}>
            {stage6?.manual_verification_status ?? "—"}
          </Badge>
        </div>
        <div><span className="text-muted-foreground">Verified recipient:</span>{" "}
          {stage6?.manual_verified_recipient ?? "—"}
        </div>
        <div><span className="text-muted-foreground">Current event status:</span>{" "}
          <Badge>{stage7?.manual_event_status ?? "—"}</Badge>
        </div>
        <div><span className="text-muted-foreground">Global operating mode:</span>{" "}
          <Badge>{platform?.current_operating_mode ?? "—"}</Badge>
        </div>
        <div><span className="text-muted-foreground">Real-email gate:</span>{" "}
          {gateStillOpen ? <Badge variant="destructive">OPEN</Badge> : <Badge variant="outline">closed</Badge>}
        </div>
        <div><span className="text-muted-foreground">Drift:</span>{" "}
          {stage7?.drift_detected ? <Badge variant="destructive">detected</Badge> : <Badge variant="outline">none</Badge>}
        </div>
      </div>

      {!stage6ReadyForCert && !eventCertified && (
        <Alert variant="destructive">
          <Lock className="h-4 w-4" />
          <AlertTitle>Stage 6 prerequisites not satisfied</AlertTitle>
          <AlertDescription>
            <div className="mb-2">
              Manual Production certification is gated by the server. The
              following prerequisites are outstanding:
            </div>
            {stage6Blockers.length > 0 ? (
              <ul className="list-disc pl-5 space-y-1">
                {stage6Blockers.map((b) => (
                  <li key={b.code}>
                    <code className="font-mono text-xs">{b.code}</code>
                    {b.message ? <> — {b.message}</> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-xs">Waiting on authoritative status…</div>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Action 1 — Certify event (collapsed to a COMPLETED card when done) */}
      {eventCertified ? (
        <Alert>
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <AlertTitle className="flex items-center gap-2">
            1. Event certified for Manual Production
            <Badge>{stage7?.manual_event_status ?? "—"}</Badge>
            {stage7?.manual_approved_at && (
              <span className="text-xs text-muted-foreground">
                approved {new Date(stage7.manual_approved_at).toLocaleString()}
              </span>
            )}
          </AlertTitle>
          <AlertDescription className="text-xs">
            Certification id:{" "}
            <code className="font-mono">{stage7?.manual_event_certification_id ?? "—"}</code>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="rounded-md border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            <div className="font-medium">1. Certify this event for Manual Production</div>
          </div>
          <Textarea
            value={certifyReason}
            onChange={(e) => setCertifyReason(e.target.value)}
            placeholder="Audit reason (min 6 chars)"
            disabled={certifying}
          />
          <Input
            value={certifyPhrase}
            onChange={(e) => setCertifyPhrase(e.target.value)}
            placeholder={`Type: ${MANUAL_PRODUCTION_TYPED_PHRASE}`}
            disabled={certifying}
          />
          <Button onClick={handleCertify} disabled={!canCertify}>
            {certifying && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Certify for Manual Production
          </Button>
        </div>
      )}

      {/* Action 2 — Close gate */}
      {gateStillOpen && (
        <div className="rounded-md border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            <div className="font-medium">2. Close One Real Email testing gate</div>
          </div>
          <Alert>
            <AlertDescription>
              The scoped real-email gate remains open. Stage 6 is complete;
              close it so no additional One Real Email sends are permitted
              for this event without a new gate.
            </AlertDescription>
          </Alert>
          <Textarea
            value={gateReason}
            onChange={(e) => setGateReason(e.target.value)}
            disabled={closingGate}
          />
          <Button variant="secondary" onClick={handleCloseGate} disabled={closingGate}>
            {closingGate && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Close real-email gate
          </Button>
        </div>
      )}

      {/* Action 3+4 — Mode switch (collapsed to COMPLETED when already active) */}
      {globalManualActive ? (
        <Alert>
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <AlertTitle className="flex items-center gap-2">
            Platform operating mode active
            <Badge>{platform?.current_operating_mode}</Badge>
          </AlertTitle>
          <AlertDescription className="text-xs">
            Configuration version{" "}
            <code className="font-mono">{platform?.configuration_version ?? "—"}</code>.
            No further mode action is required for Step 7.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="rounded-md border p-4 space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <div className="font-medium">3. Global Manual Production impact preview</div>
            </div>
            <Alert>
              <AlertTitle>Switching to MANUAL_PRODUCTION is a global change</AlertTitle>
              <AlertDescription>
                All <strong>{platform?.eligible_manual_event_count ?? 0}</strong> currently
                certified events will become eligible for manual operator sends.
              </AlertDescription>
            </Alert>
          </div>

          <div className="rounded-md border p-4 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <div className="font-medium">4. Switch platform mode to MANUAL_PRODUCTION</div>
            </div>
            <Textarea
              value={activateReason}
              onChange={(e) => setActivateReason(e.target.value)}
              placeholder="Audit reason (min 6 chars)"
              disabled={switching || !eventCertified}
            />
            <Input
              value={activatePhrase}
              onChange={(e) => setActivatePhrase(e.target.value)}
              placeholder={`Type: ${ACTIVATE_TYPED_PHRASE}`}
              disabled={switching || !eventCertified}
            />
            <Button onClick={handleSwitchMode} disabled={!canSwitchMode}>
              {switching && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Activate MANUAL_PRODUCTION mode
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
