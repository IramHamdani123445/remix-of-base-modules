/**
 * A4.1.2C §7 — Operations wiring proof.
 *
 * The simplified Operations page MUST derive its 8-stage lifecycle, safety
 * banners, and Next Action from a SINGLE server-authoritative RPC
 * (`get_comm_hub_operations_summary`). It must NOT independently combine
 * getEventGoLiveStatus + listRevalidationCycles + local inference.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/platform/communication-hub/runtimeContractService", async (orig) => {
  const actual: any = await orig();
  return {
    ...actual,
    auditRuntimeContract: vi.fn(async () => ({
      ok: true, checked_at: new Date().toISOString(),
      checks: [], summary: { total: 0, pass: 0, fail: 0 },
    })),
  };
});
vi.mock("@/pages/admin/communicationHub/goLive/moduleEventDirectoryService", () => ({
  fetchModuleEventDirectory: vi.fn(async () => []),
  groupModules: () => [], eventsForModule: () => [], isDiagnosticEvent: () => false,
}));
vi.mock("@/components/ui/permission-wrapper", () => ({
  PermissionWrapper: ({ children }: any) => <>{children}</>,
}));
// Older services must NOT be consumed by Operations any more.
vi.mock("@/platform/communication-hub/eventGoLiveStatusService", () => ({
  getEventGoLiveStatus: vi.fn(async () => {
    throw new Error("Operations page must not call getEventGoLiveStatus");
  }),
}));
vi.mock("@/platform/communication-hub/revalidationService", async (orig) => {
  const actual: any = await orig();
  return {
    ...actual,
    listRevalidationCycles: vi.fn(async () => {
      throw new Error("Operations page must not call listRevalidationCycles");
    }),
  };
});

const summaryMock = vi.fn();
vi.mock("@/platform/communication-hub/operationsSummaryService", () => ({
  getOperationsSummary: (...args: any[]) => summaryMock(...args),
}));

import CommunicationHubWorkspaceLayout from "@/pages/admin/communicationHub/goLive/CommunicationHubWorkspaceLayout";
import SimpleOperationsPage from "@/pages/admin/communicationHub/goLive/SimpleOperationsPage";

function makeSummary(overrides: any = {}) {
  return {
    evaluated_at: new Date().toISOString(),
    selection: { module_code: "APPEALS", event_code: "APPEAL_RECEIVED_NOTICE", channel: "email" },
    platform: {
      operating_mode: "MANUAL_PRODUCTION", automation_state: "STANDBY",
      dispatch_enabled: true, scheduler_enabled: false, provider_boundary_approved: false,
    },
    event: {
      event_status: "MANUAL_PRODUCTION",
      event_certification_id: "cert-1", ore_certification_id: "ore-1",
      production_lineage_id: "lineage-1", evidence_authority: "SERVER",
    },
    baseline: { status: "ANCHORED", attestation_id: "att-1", fingerprint: "fp", diagnosis_required: false, correction_required: false },
    stages: [
      { code: "READINESS", status: "COMPLETED", certification_id: null, execution_id: null, completed_at: null, evidence_source: "SERVER", blocker_codes: [] },
      { code: "PREVIEW_APPROVAL", status: "COMPLETED", certification_id: null, execution_id: null, completed_at: null, evidence_source: "SERVER", blocker_codes: [] },
      { code: "DRY_RUN", status: "COMPLETED", certification_id: null, execution_id: null, completed_at: null, evidence_source: "SERVER", blocker_codes: [] },
      { code: "CONTROLLED_STUB", status: "COMPLETED", certification_id: null, execution_id: null, completed_at: null, evidence_source: "SERVER", blocker_codes: [] },
      { code: "ONE_REAL_EMAIL", status: "COMPLETED", certification_id: "ore-1", execution_id: null, completed_at: null, evidence_source: "SERVER", blocker_codes: [] },
      { code: "MANUAL_PRODUCTION", status: "CURRENT", certification_id: null, execution_id: null, completed_at: null, evidence_source: "SERVER", blocker_codes: [] },
      { code: "CONTROLLED_REVALIDATION", status: "FUTURE", certification_id: null, execution_id: null, completed_at: null, evidence_source: "SERVER", blocker_codes: [] },
      { code: "AUTOMATED_PRODUCTION", status: "FUTURE", certification_id: null, execution_id: null, completed_at: null, evidence_source: "SERVER", blocker_codes: [] },
    ],
    revalidation: {
      active_cycle: null, usable_authorisation: null, active_preparation_execution: null,
      recovery_required: false, inbox_confirmation_required: false, next_action: null,
    },
    sources: { event_status: "AVAILABLE", baseline_status: "AVAILABLE", revalidation_status: "IDLE", execution_status: "UNAVAILABLE" },
    blockers: [], warnings: [], ...overrides,
  };
}

function renderOps() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/admin/communication-hub/go-live?module=APPEALS&event=APPEAL_RECEIVED_NOTICE&channel=email"]}>
        <Routes>
          <Route element={<CommunicationHubWorkspaceLayout />}>
            <Route path="/admin/communication-hub/go-live" element={<SimpleOperationsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  summaryMock.mockReset();
  summaryMock.mockResolvedValue(makeSummary());
});

describe("A4.1.2C §7 — Operations reads only the summary RPC", () => {
  it("invokes get_comm_hub_operations_summary with the selection", async () => {
    renderOps();
    await waitFor(() => expect(summaryMock).toHaveBeenCalled());
    expect(summaryMock.mock.calls[0][0]).toMatchObject({
      moduleCode: "APPEALS", eventCode: "APPEAL_RECEIVED_NOTICE", channel: "email",
    });
  });

  it("renders one CURRENT stage exactly as marked by the summary", async () => {
    renderOps();
    await screen.findByTestId("ops-lifecycle-stepper");
    const currents = document.querySelectorAll('[data-testid^="ops-lifecycle-stage-"][data-state="current"]');
    expect(currents.length).toBe(1);
  });

  it("respects server-supplied blockers and warnings", async () => {
    summaryMock.mockResolvedValue(makeSummary({
      blockers: [{ code: "PROVIDER_BOUNDARY_NOT_APPROVED", message: "Sealed server-side." }],
    }));
    renderOps();
    await waitFor(() => {
      expect(screen.getByText(/PROVIDER_BOUNDARY_NOT_APPROVED/)).toBeTruthy();
    });
  });
});
