/**
 * Operator-facing panel: Correct Legacy Baseline Attestation.
 *
 * - Shows the four convergence booleans from `diagnose_comm_hub_legacy_attestation_fingerprint`.
 * - When any are false, exposes the "Correct Legacy Baseline Attestation" action.
 * - The action requires a business reason and the exact typed phrase.
 * - The RPC supersedes the previous ACTIVE attestation and creates a new
 *   ACTIVE row storing the canonical evidence_core_v2 and sha256-v2 hash.
 * - After correction, diagnose runs again and must return all four true.
 *
 * This panel never sends email, changes operating mode, arms automation,
 * or mutates the ORE / event certification / production lineage.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import {
  CORRECT_BASELINE_TYPED_PHRASE,
  correctLegacyAttestation,
  diagnoseLegacyAttestation,
  isBaselineConverged,
  type BaselineDiagnosis,
} from "@/platform/communication-hub/legacyBaselineAttestationService";

interface Props {
  moduleCode: string;
  eventCode: string;
  channel: string;
  onChanged?: () => void;
}

const CHECKS: Array<{ key: keyof BaselineDiagnosis; label: string }> = [
  { key: "current_rpc_matches_current_core_rehash", label: "Current snapshot RPC matches current core rehash" },
  { key: "attestation_stored_matches_attestation_core_rehash", label: "Stored attestation matches attestation core rehash" },
  { key: "current_core_matches_attestation_core", label: "Current core equals attestation core" },
  { key: "current_fingerprint_matches_attestation_fingerprint", label: "Current fingerprint equals attestation fingerprint" },
];

export function LegacyBaselineAttestationPanel({
  moduleCode,
  eventCode,
  channel,
  onChanged,
}: Props) {
  const [diagnosis, setDiagnosis] = useState<BaselineDiagnosis | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reason, setReason] = useState("Baseline convergence — align stored attestation with canonical evidence_core_v2");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const d = await diagnoseLegacyAttestation({ moduleCode, eventCode, channel });
      setDiagnosis(d);
    } catch (e: any) {
      setLoadError(e?.message ?? "Failed to load baseline diagnosis");
    } finally {
      setLoading(false);
    }
  }, [moduleCode, eventCode, channel]);

  useEffect(() => {
    void load();
  }, [load]);

  const converged = isBaselineConverged(diagnosis);

  const onCorrect = async () => {
    if (typed !== CORRECT_BASELINE_TYPED_PHRASE) {
      toast.error(`Type exactly: ${CORRECT_BASELINE_TYPED_PHRASE}`);
      return;
    }
    if (reason.trim().length < 8) {
      toast.error("Provide a business reason (min 8 characters).");
      return;
    }
    setBusy(true);
    try {
      const res = await correctLegacyAttestation(
        { moduleCode, eventCode, channel },
        reason.trim(),
        typed,
      );
      if (!res.ok) {
        toast.error("Correction refused by server. See console for details.");
        console.warn("correct_comm_hub_legacy_baseline_attestation refused", res);
      } else {
        toast.success(
          res.idempotent
            ? "Baseline already converged (no change needed)."
            : "Baseline attestation corrected.",
        );
        setTyped("");
      }
      await load();
      onChanged?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Correction failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4" />
          Baseline convergence
        </CardTitle>
        <CardDescription>
          Aligns the active legacy evidence attestation with the current canonical
          <code className="mx-1">evidence_core_v2</code> and its
          <code className="mx-1">sha256-v2</code> fingerprint. Does not send email,
          change operating mode, or modify the One Real Email lineage.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Running diagnosis…
          </div>
        ) : loadError ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Diagnosis failed</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="grid gap-2">
              {CHECKS.map((c) => {
                const val = diagnosis?.[c.key];
                const ok = val === true;
                return (
                  <div
                    key={String(c.key)}
                    className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                  >
                    <span>{c.label}</span>
                    <span className={ok ? "text-emerald-600" : "text-amber-600"}>
                      {ok ? "PASS" : val === false ? "FAIL" : "UNKNOWN"}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="grid gap-1 text-xs text-muted-foreground">
              <div>
                Current fingerprint:{" "}
                <code>{String(diagnosis?.current_fingerprint_v2 ?? "—")}</code>
              </div>
              <div>
                Attestation fingerprint:{" "}
                <code>{String(diagnosis?.attestation_fingerprint_v2 ?? "—")}</code>
              </div>
              {diagnosis?.active_attestation_id ? (
                <div>
                  Active attestation:{" "}
                  <code>{String(diagnosis.active_attestation_id)}</code>
                </div>
              ) : null}
            </div>

            {converged ? (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>Baseline converged</AlertTitle>
                <AlertDescription>
                  All four checks pass. No correction required.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 dark:bg-amber-950/20">
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Correction required</AlertTitle>
                  <AlertDescription>
                    The stored attestation does not match the canonical evidence
                    core. Apply the correction below. The previous attestation is
                    preserved as SUPERSEDED; ORE, event certification, production
                    lineage and lifecycle state are unchanged.
                  </AlertDescription>
                </Alert>

                <div className="grid gap-2">
                  <Label htmlFor="baseline-reason">Business reason</Label>
                  <Textarea
                    id="baseline-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    disabled={busy}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="baseline-typed">
                    Type <code>{CORRECT_BASELINE_TYPED_PHRASE}</code> to confirm
                  </Label>
                  <Input
                    id="baseline-typed"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    autoComplete="off"
                    disabled={busy}
                  />
                </div>
                <Button
                  onClick={onCorrect}
                  disabled={busy || typed !== CORRECT_BASELINE_TYPED_PHRASE}
                >
                  {busy ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Correcting…
                    </>
                  ) : (
                    "Correct Legacy Baseline Attestation"
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default LegacyBaselineAttestationPanel;
