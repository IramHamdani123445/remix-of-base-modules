/**
 * Omni-Comms Health — Certification Evidence view.
 *
 * Renders the source-controlled privileged certification record next to the
 * revision reported by the deployed runtime health probe. It never executes,
 * triggers or simulates a certification run: certification is performed by a
 * privileged workflow outside the administration interface.
 */
import React from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useOmniCommsEdgeHealthProbe } from "@/platform/omni-comms/admin/hooks/useOmniCommsEdgeHealthProbe";
import {
  OMNI_COMMS_CERTIFICATION_EVIDENCE as EVIDENCE,
  revisionMatch,
} from "@/platform/omni-comms/registry/certificationEvidence";
import OmniCommsPostureBadge from "@/platform/omni-comms/admin/components/OmniCommsPostureBadge";
import { OMNI_COMMS_POSTURE_STATEMENTS } from "@/platform/omni-comms/admin/posture/omniCommsPosture";

const NOT_RECORDED = "Not recorded";

interface Row {
  field: string;
  label: string;
  value: string;
}

export const CertificationEvidenceTab: React.FC = () => {
  const { result, probing, probe } = useOmniCommsEdgeHealthProbe();

  React.useEffect(() => {
    void probe();
  }, [probe]);

  const deployedRevision = result?.buildTag ?? null;
  const match = revisionMatch(EVIDENCE.certifiedCommit, deployedRevision);

  const rows: Row[] = [
    { field: "certification_state", label: "Certification state", value: EVIDENCE.state },
    {
      field: "certified_commit",
      label: "Certified commit",
      value: EVIDENCE.certifiedCommit ?? NOT_RECORDED,
    },
    {
      field: "deployed_edge_revision",
      label: "Deployed Edge revision",
      value: deployedRevision ?? (probing ? "Checking…" : NOT_RECORDED),
    },
    {
      field: "revision_match",
      label: "Certified commit matches deployed revision",
      value:
        match === "unknown"
          ? "Cannot be determined"
          : match === "match"
            ? "Yes"
            : "No",
    },
    {
      field: "workflow_run_id",
      label: "Certification workflow run",
      value: EVIDENCE.workflowRunId ?? NOT_RECORDED,
    },
    {
      field: "scenario_count_and_result",
      label: "Scenario inventory",
      value: `${EVIDENCE.scenarioCount} scenarios · ${EVIDENCE.scenarioResult ?? NOT_RECORDED}`,
    },
    {
      field: "cleanup_result",
      label: "Fixture cleanup",
      value: EVIDENCE.cleanupResult ?? NOT_RECORDED,
    },
    {
      field: "safety_invariants",
      label: "Safety invariants",
      value: EVIDENCE.safetyInvariants ?? NOT_RECORDED,
    },
    {
      field: "sql_verifier_result",
      label: "SQL verifier",
      value: EVIDENCE.sqlVerifierResult ?? NOT_RECORDED,
    },
    {
      field: "certification_timestamp",
      label: "Certification timestamp",
      value: EVIDENCE.certifiedAt ?? NOT_RECORDED,
    },
  ];

  return (
    <div data-testid="omni-comms-certification-evidence" className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-1 h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <div>
              <CardTitle className="text-base">Certification evidence</CardTitle>
              <CardDescription>
                Source-controlled record of the privileged certification run.
                This screen cannot start a certification run.
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <OmniCommsPostureBadge
              facet={{
                id: "privileged_certification",
                label: "Certification",
                value:
                  EVIDENCE.state === "certified"
                    ? "Privileged certification complete"
                    : OMNI_COMMS_POSTURE_STATEMENTS.certificationPending,
                tone: EVIDENCE.state === "certified" ? "positive" : "pending",
                detail:
                  "Privileged certification is executed outside this interface.",
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => void probe()}
              disabled={probing}
              aria-label="Re-check deployed runtime revision"
            >
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              Re-check revision
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border rounded-md border">
            {rows.map((r) => (
              <div
                key={r.field}
                data-field={r.field}
                className="grid gap-1 p-3 sm:grid-cols-[minmax(0,18rem)_1fr] sm:gap-4"
              >
                <dt className="text-sm text-muted-foreground">{r.label}</dt>
                <dd className="break-all font-mono text-sm text-foreground">{r.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {match === "mismatch" ? (
        <Alert variant="destructive">
          <AlertTitle>Certified commit does not match the deployed runtime</AlertTitle>
          <AlertDescription>
            The recorded certification does not describe the runtime currently
            deployed. Treat the deployed runtime as uncertified.
          </AlertDescription>
        </Alert>
      ) : null}

      <p className="text-sm text-muted-foreground">
        {EVIDENCE.summary}
      </p>
    </div>
  );
};

export default CertificationEvidenceTab;
