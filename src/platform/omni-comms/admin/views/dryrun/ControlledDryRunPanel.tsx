/**
 * Omni-Comms — Controlled Dry-Run Test Surface (Phase 5).
 *
 * Rendered as a tab inside the existing Overview permanent route
 * (`/admin/omnichannel-communications?view=dry-run`). It adds no new route.
 *
 * This surface submits exactly one `mode = dry_run` request through the
 * canonical `sendCommunication()` façade using a single synthetic
 * `example.com` recipient. It never sends email, never contacts a provider,
 * never creates a dispatch job or delivery attempt, and never enables
 * shadow, queued or live delivery.
 */
import React from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FlaskConical,
  Loader2,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useOmniCommsTenant } from "@/platform/omni-comms/context/OmniCommsTenantContext";
import { OmniCommsTenantSelector } from "@/platform/omni-comms/admin/components/OmniCommsTenantSelector";
import { useOmniCommsRpcClient } from "@/platform/omni-comms/admin/hooks/useOmniCommsRpcClient";
import {
  getEventContract,
  listAllEventDefinitionsForPicker,
  listEventContracts,
} from "@/platform/omni-comms/application/eventCatalogueService";
import type { EventDefinitionListItem } from "@/platform/omni-comms/application/eventCatalogueTypes";
import { getSetupReadiness } from "@/platform/omni-comms/application/setupReadinessService";
import type { OpsRequestDetail } from "@/platform/omni-comms/application/operationsTypes";
import type { SendCommunicationResult } from "@/platform/omni-comms/sendCommunication";
import {
  ADMIN_DRY_RUN_DEFAULT_LOCALE,
  buildIdempotencyKey,
  buildSafeSkeletonPayload,
  buildSyntheticRecipient,
  executeControlledDryRun,
  getControlledDryRunGate,
  isExecutionPermitted,
  isValidationStale,
  loadDryRunInvariants,
  mapDryRunFailure,
  mapDryRunRpcError,
  newDryRunId,
  parsePayloadText,
  validateDryRunPayload,
  type DryRunGate,
  type DryRunGuidance,
  type DryRunInvariants,
  type DryRunSubmissionState,
  type DryRunSyntheticRecipient,
  type DryRunValidationResult,
  type DryRunValidationScope,
} from "@/platform/omni-comms/application/controlledDryRunService";

const LOCALES = ["en", "en-GB", "es", "fr"];

function Line({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right break-all">{value}</span>
    </div>
  );
}

function GuidanceAlert({ guidance }: { guidance: DryRunGuidance }) {
  return (
    <Alert variant="destructive" data-testid="omni-dry-run-guidance">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>{guidance.title}</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>{guidance.message}</p>
        <p className="text-xs">
          No communication was sent and no provider was contacted.
        </p>
        {guidance.target ? (
          <Button asChild size="sm" variant="outline">
            <Link to={`${guidance.target.route}${guidance.target.query ?? ""}`}>
              {guidance.target.label} <ArrowRight className="h-3 w-3 ml-1" />
            </Link>
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

export const ControlledDryRunPanel: React.FC = () => {
  const { organizationId, departmentId, loading: tenantLoading } =
    useOmniCommsTenant();
  const rpc = useOmniCommsRpcClient();

  const [gate, setGate] = React.useState<DryRunGate | null>(null);
  const [gateLoading, setGateLoading] = React.useState(true);

  const [events, setEvents] = React.useState<EventDefinitionListItem[]>([]);
  const [eventDefinitionId, setEventDefinitionId] = React.useState<string | null>(
    null,
  );
  const [locale, setLocale] = React.useState(ADMIN_DRY_RUN_DEFAULT_LOCALE);
  const [payloadText, setPayloadText] = React.useState("{}");
  const [sampleNote, setSampleNote] = React.useState<string | null>(null);

  const [dryRunReady, setDryRunReady] = React.useState(false);
  const [readinessLoading, setReadinessLoading] = React.useState(false);

  const [validation, setValidation] =
    React.useState<DryRunValidationResult | null>(null);
  const [validatedScope, setValidatedScope] =
    React.useState<DryRunValidationScope | null>(null);

  const [state, setState] = React.useState<DryRunSubmissionState>("not_ready");
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [guidance, setGuidance] = React.useState<DryRunGuidance | null>(null);
  const [result, setResult] = React.useState<SendCommunicationResult | null>(null);
  const [recipient, setRecipient] =
    React.useState<DryRunSyntheticRecipient | null>(null);
  const [runId, setRunId] = React.useState<string>(() => newDryRunId());
  const [detail, setDetail] = React.useState<OpsRequestDetail | null>(null);
  const [invariants, setInvariants] = React.useState<DryRunInvariants | null>(null);

  const selectedEvent = events.find((e) => e.id === eventDefinitionId) ?? null;

  const currentScope: DryRunValidationScope = {
    organizationId: organizationId ?? "",
    departmentId: departmentId ?? null,
    eventDefinitionId: eventDefinitionId ?? "",
    payloadText,
  };
  const stale = isValidationStale(validatedScope, currentScope);

  // Server feature gate.
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      setGateLoading(true);
      try {
        const g = await getControlledDryRunGate(rpc);
        if (!cancelled) setGate(g);
      } catch {
        if (!cancelled) {
          setGate({
            state: "unavailable",
            reason: "The controlled dry-run gate could not be read.",
            source: "client",
            caller_module_code: "OMNI_COMMS_ADMIN_DRY_RUN",
            allowed_mode: "dry_run",
            allowed_channels: ["email"],
            recipient_limit: 1,
            required_recipient_domain: "example.com",
            live_delivery_enabled: false,
            can_view: false,
            can_operate: false,
            can_view_sensitive_content: false,
            checked_at: new Date().toISOString(),
          });
        }
      } finally {
        if (!cancelled) setGateLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rpc]);

  // Event picker.
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listAllEventDefinitionsForPicker(rpc, {
          status: "active",
          maxItems: 300,
        });
        if (!cancelled) setEvents(rows);
      } catch {
        if (!cancelled) setEvents([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rpc]);

  // Readiness gate — dry run may only be offered when setup says so.
  const loadReadiness = React.useCallback(async () => {
    if (!organizationId || !eventDefinitionId) {
      setDryRunReady(false);
      return;
    }
    setReadinessLoading(true);
    try {
      const payload = await getSetupReadiness(rpc, {
        organizationId,
        departmentId,
        eventDefinitionId,
        channel: "email",
        locale,
      });
      setDryRunReady(payload.dry_run_ready === true);
    } catch {
      setDryRunReady(false);
    } finally {
      setReadinessLoading(false);
    }
  }, [rpc, organizationId, departmentId, eventDefinitionId, locale]);

  React.useEffect(() => {
    void loadReadiness();
  }, [loadReadiness]);

  // Seed a safe synthetic payload from the published contract.
  React.useEffect(() => {
    let cancelled = false;
    if (!eventDefinitionId) {
      setSampleNote(null);
      return;
    }
    void (async () => {
      try {
        const contracts = await listEventContracts(rpc, {
          eventDefinitionId,
          status: "published",
          limit: 1,
        });
        const head = contracts[0];
        if (!head) {
          if (!cancelled) setSampleNote("No published contract for this event.");
          return;
        }
        const row = await getEventContract(rpc, head.id);
        if (cancelled || !row) return;
        if (row.sample_payload && !row.sample_payload_redacted) {
          setPayloadText(JSON.stringify(row.sample_payload, null, 2));
          setSampleNote("Seeded from the published contract sample payload.");
        } else {
          setPayloadText(
            JSON.stringify(buildSafeSkeletonPayload(row.json_schema), null, 2),
          );
          setSampleNote(
            "Seeded with a synthetic skeleton derived from the published schema.",
          );
        }
        setValidation(null);
        setValidatedScope(null);
      } catch {
        if (!cancelled) setSampleNote("The contract sample could not be read.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rpc, eventDefinitionId]);

  const parsed = parsePayloadText(payloadText);

  const executionPermitted =
    isExecutionPermitted(gate, dryRunReady) &&
    Boolean(organizationId) &&
    Boolean(selectedEvent) &&
    parsed.ok &&
    validation?.valid === true &&
    !stale;

  const onValidate = async (): Promise<void> => {
    if (!organizationId || !eventDefinitionId) return;
    if (!parsed.ok || !parsed.value) {
      setGuidance(mapDryRunFailure("payload_invalid"));
      setState("validation_failed");
      return;
    }
    setState("validating_payload");
    setGuidance(null);
    try {
      const v = await validateDryRunPayload(rpc, {
        organizationId,
        departmentId,
        eventDefinitionId,
        payload: parsed.value,
      });
      setValidation(v);
      setValidatedScope({ ...currentScope });
      setState(v.valid ? "ready" : "validation_failed");
      if (!v.valid) setGuidance(mapDryRunFailure("payload_invalid"));
    } catch (err) {
      setValidation(null);
      setValidatedScope(null);
      setGuidance(mapDryRunRpcError(err));
      setState("validation_failed");
    }
  };

  const onExecute = async (): Promise<void> => {
    setConfirmOpen(false);
    if (!organizationId || !selectedEvent) return;
    if (!parsed.ok || !parsed.value) return;

    const rec = buildSyntheticRecipient(runId, locale);
    setRecipient(rec);
    setState("submitting");
    setGuidance(null);
    setDetail(null);
    setInvariants(null);

    try {
      const outcome = await executeControlledDryRun({
        eventCode: selectedEvent.code,
        organizationId,
        departmentId,
        payload: parsed.value,
        recipient: rec,
        runId,
        idempotencyKey: buildIdempotencyKey(selectedEvent.code, runId),
      });
      setResult(outcome.result);
      setState(outcome.state);

      const firstBlocker = outcome.result.blockers?.[0];
      if (firstBlocker) setGuidance(mapDryRunFailure(firstBlocker));

      if (outcome.result.requestId) {
        try {
          const loaded = await loadDryRunInvariants(rpc, {
            requestId: outcome.result.requestId,
            organizationId,
            result: outcome.result,
          });
          setDetail(loaded.detail);
          setInvariants(loaded.invariants);
        } catch {
          setDetail(null);
          setInvariants(null);
        }
      }
    } catch (err) {
      setGuidance(mapDryRunRpcError(err));
      setState("blocked");
    }
  };

  const onNewRun = (): void => {
    setRunId(newDryRunId());
    setResult(null);
    setRecipient(null);
    setDetail(null);
    setInvariants(null);
    setGuidance(null);
    setState(validation?.valid && !stale ? "ready" : "not_ready");
  };

  if (tenantLoading || gateLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading controlled dry-run
        surface…
      </div>
    );
  }

  const gateEnabled = gate?.state === "enabled";

  return (
    <div className="space-y-4" data-testid="omni-comms-dry-run-panel">
      <Alert>
        <FlaskConical className="h-4 w-4" />
        <AlertTitle>Controlled dry run — no delivery</AlertTitle>
        <AlertDescription>
          This surface submits one <strong>dry-run</strong> request through the
          canonical send façade using a single synthetic{" "}
          <code>example.com</code> recipient. No email is sent, no provider is
          contacted, and no dispatch job or delivery attempt is created.
        </AlertDescription>
      </Alert>

      {!gateEnabled ? (
        <Alert variant="destructive" data-testid="omni-comms-dry-run-gate-closed">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>
            {gate?.state === "disabled"
              ? "Controlled dry run is disabled"
              : "Controlled dry run is unavailable"}
          </AlertTitle>
          <AlertDescription>
            {gate?.reason ?? "The server did not permit this surface."}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Test scope</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void loadReadiness()}
            disabled={readinessLoading}
            data-testid="omni-comms-dry-run-refresh"
          >
            {readinessLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-1">Recheck readiness</span>
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <OmniCommsTenantSelector />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="omni-dry-run-event">Event</Label>
              <Select
                value={eventDefinitionId ?? ""}
                onValueChange={(v) => {
                  setEventDefinitionId(v);
                  setValidation(null);
                  setValidatedScope(null);
                  setState("not_ready");
                }}
              >
                <SelectTrigger id="omni-dry-run-event">
                  <SelectValue placeholder="Select an active event" />
                </SelectTrigger>
                <SelectContent>
                  {events.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="omni-dry-run-locale">Locale</Label>
              <Select value={locale} onValueChange={setLocale}>
                <SelectTrigger id="omni-dry-run-locale">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOCALES.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-md border p-3">
            <Line label="Channel" value="email (fixed)" />
            <Line label="Mode" value="dry_run (fixed)" />
            <Line label="Recipients" value="1 synthetic example.com address" />
            <Line
              label="Configuration readiness"
              value={
                dryRunReady ? (
                  <Badge className="bg-emerald-600 hover:bg-emerald-700">
                    Dry-run ready
                  </Badge>
                ) : (
                  <Badge variant="destructive">Not ready</Badge>
                )
              }
            />
          </div>

          {!dryRunReady && eventDefinitionId ? (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Configuration is not dry-run ready</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>Complete the outstanding setup steps first.</p>
                <Button asChild size="sm" variant="outline">
                  <Link to="/admin/omnichannel-communications?view=setup">
                    Open Setup Wizard <ArrowRight className="h-3 w-3 ml-1" />
                  </Link>
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Synthetic payload</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {sampleNote ? (
            <p className="text-xs text-muted-foreground">{sampleNote}</p>
          ) : null}
          <Textarea
            id="omni-dry-run-payload"
            aria-label="Synthetic payload"
            data-testid="omni-comms-dry-run-payload"
            className="font-mono text-xs min-h-[220px]"
            value={payloadText}
            onChange={(e) => {
              setPayloadText(e.target.value);
              setState("not_ready");
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              onClick={() => void onValidate()}
              disabled={
                !gateEnabled ||
                !organizationId ||
                !eventDefinitionId ||
                state === "validating_payload"
              }
              data-testid="omni-comms-dry-run-validate"
            >
              {state === "validating_payload" ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : null}
              Validate payload
            </Button>
            <span className="text-xs text-muted-foreground">
              {parsed.bytes.toLocaleString()} bytes
            </span>
            {!parsed.ok ? (
              <span className="text-xs text-destructive">{parsed.error}</span>
            ) : null}
            {validation && stale ? (
              <span className="text-xs text-amber-600">
                Inputs changed — revalidate before executing.
              </span>
            ) : null}
          </div>

          {validation ? (
            <div className="rounded-md border p-3">
              <Line
                label="Validation"
                value={
                  validation.valid ? (
                    <Badge className="bg-emerald-600 hover:bg-emerald-700">
                      Valid
                    </Badge>
                  ) : (
                    <Badge variant="destructive">Invalid</Badge>
                  )
                }
              />
              <Line
                label="Contract version"
                value={`v${validation.contract_version}`}
              />
              <Line
                label="Contract checksum"
                value={validation.contract_checksum ?? "—"}
              />
              {validation.errors?.length ? (
                <ul className="mt-2 space-y-1 text-xs text-destructive">
                  {validation.errors.map((e, i) => (
                    <li key={`${e.code}-${i}`}>
                      {e.field ? `${e.field}: ` : ""}
                      {e.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Execute controlled dry run</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={!executionPermitted || state === "submitting"}
            data-testid="omni-comms-dry-run-execute"
          >
            {state === "submitting" ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <FlaskConical className="h-4 w-4 mr-1" />
            )}
            Run dry-run test
          </Button>
          <p className="text-xs text-muted-foreground">
            Idempotency key:{" "}
            <code>
              {selectedEvent
                ? buildIdempotencyKey(selectedEvent.code, runId)
                : "—"}
            </code>
          </p>
          {guidance ? <GuidanceAlert guidance={guidance} /> : null}
        </CardContent>
      </Card>

      {result ? (
        <Card data-testid="omni-comms-dry-run-result">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {invariants?.safetyViolated ? (
                <XCircle className="h-4 w-4 text-destructive" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              )}
              Dry-run result
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md border p-3">
              <Line label="Request" value={result.requestId || "—"} />
              <Line label="Mode" value={result.mode} />
              <Line label="Status" value={result.status} />
              <Line
                label="Replayed"
                value={result.replayed ? "Yes — idempotent replay" : "No"}
              />
              <Line label="Recipient" value={recipient?.email ?? "—"} />
              <Line
                label="Messages rendered"
                value={String(result.messages?.length ?? 0)}
              />
              <Line
                label="Blockers"
                value={
                  result.blockers?.length
                    ? result.blockers.join(", ")
                    : "None"
                }
              />
            </div>

            {invariants ? (
              <div className="rounded-md border p-3">
                <Line
                  label="Dispatch jobs created"
                  value={String(invariants.dispatchJobCount)}
                />
                <Line
                  label="Delivery attempts created"
                  value={String(invariants.deliveryAttemptCount)}
                />
                <Line label="Provider contacted" value="No" />
                <Line label="Email sent" value="No" />
                <Line
                  label="Timeline recorded"
                  value={invariants.timelinePresent ? "Yes" : "No"}
                />
                {invariants.safetyViolated ? (
                  <Alert variant="destructive" className="mt-2">
                    <ShieldAlert className="h-4 w-4" />
                    <AlertTitle>Safety invariant violated</AlertTitle>
                    <AlertDescription>
                      A dispatch job or delivery attempt exists for a dry-run
                      request. Report this immediately.
                    </AlertDescription>
                  </Alert>
                ) : null}
              </div>
            ) : null}

            {detail?.messages?.length ? (
              <div className="rounded-md border p-3 space-y-1 text-sm">
                {detail.messages.map((msg) => (
                  <div key={msg.id} className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{msg.channel}</span>
                    <span className="font-medium">{msg.status}</span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {result.requestId ? (
                <Button asChild size="sm" variant="outline">
                  <Link
                    to={`/admin/omnichannel-communications/operations?request=${result.requestId}`}
                  >
                    Open in Operations <ArrowRight className="h-3 w-3 ml-1" />
                  </Link>
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={onNewRun}>
                Start a new dry run
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run a controlled dry-run test?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  One dry-run request will be created for{" "}
                  <strong>{selectedEvent?.code}</strong> with a single
                  synthetic <code>example.com</code> recipient.
                </p>
                <p>
                  No email is sent. No provider is contacted. No dispatch job or
                  delivery attempt is created.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void onExecute()}
              data-testid="omni-comms-dry-run-confirm"
            >
              Run dry run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ControlledDryRunPanel;
