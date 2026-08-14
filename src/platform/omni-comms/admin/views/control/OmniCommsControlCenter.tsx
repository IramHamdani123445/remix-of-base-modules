/**
 * Omnichannel Communications — CONTROL CENTER.
 *
 * One screen holding every operator gate:
 *   - the master automatic-delivery switch,
 *   - the read-only health gates (with a direct Fix link each),
 *   - the business-event delivery switches,
 *   - the test send action,
 *   - automatic processing status,
 *   - the approval queue, carried by the central workflow engine.
 *
 * Safety is unchanged: the browser sends scope and intent only. Every gate
 * decision — including the two-person rule — stays with the server.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { RefreshCw, ShieldAlert } from 'lucide-react';

import { useOmniCommsTenant } from '../../../context/OmniCommsTenantContext';
import { useOmniCommsRpcClient } from '../../hooks/useOmniCommsRpcClient';
import { useChannelReleaseControlTransport } from '../../hooks/useChannelReleaseControlTransport';
import { useChannelTestDeliveryTransport } from '../../hooks/useChannelTestDeliveryTransport';
import { useOmniCommsGateApprovals } from '../../hooks/useOmniCommsGateApprovals';
import { tabForHealthIndicator } from '../../navigation/channelSimpleSections';
import {
  buildDeliveryCancelBody,
  buildDeliveryRequestBody,
  getDeliveryToggleSnapshot,
  type DeliveryToggleSnapshot,
} from '@/platform/omni-comms/application/deliveryToggleService';
import { getChannelTestCentreSummary } from '@/platform/omni-comms/application/channelTestCentreService';
import { getChannelTestDeliveryDiagnostics } from '@/platform/omni-comms/application/channelTestDeliveryService';
import {
  approveGateRequest,
  recordGateRequest,
  rejectGateRequest,
  withdrawGateRequest,
  type GateApprovalRequest,
  type GateIntent,
} from '@/platform/omni-comms/application/gateApprovalWorkflowService';
import { notifyGateApprovalEvent } from '@/platform/notifications/gateApprovalNotifications';
import { ChannelDeliverySwitch } from '../channels/simple/ChannelDeliverySwitch';
import { ReadOnlyHealthSwitch } from '../channels/simple/ReadOnlyHealthSwitch';
import { BusinessEventDeliverySwitch } from '../channels/simple/BusinessEventDeliverySwitch';
import { SimpleTestDeliveryCard } from '../channels/simple/SimpleTestDeliveryCard';
import {
  HEALTH_ROW_LABEL,
  HEALTH_ROW_ORDER,
  HEALTH_ROW_PROBLEM,
} from '../channels/simple/SimpleOverviewSurface';
import { toastError } from '../channels/channelFormPrimitives';
import OmniCommsAutomationOverviewCard from '../OmniCommsAutomationOverviewCard';
import GateApprovalQueueCard from './GateApprovalQueueCard';
import DeliveryStatusPanel from './DeliveryStatusPanel';
import TestDeliveryTraceCard from './TestDeliveryTraceCard';
import GateAuditHistoryCard from './GateAuditHistoryCard';
import { getChannelReleaseControlSummary } from '@/platform/omni-comms/application/channelReleaseControlService';
import type { ReleaseHistoryEntry } from '@/platform/omni-comms/application/channelReleaseControlTypes';
import type { ChannelTestDelivery } from '@/platform/omni-comms/application/channelTestDeliveryTypes';
import { useAutomationStatus } from '../../hooks/useAutomationStatus';

const CHANNEL = 'email';
const CHANNEL_LABEL = 'Email';
const HEALTHY_WORD_ROWS = new Set(['dispatcher', 'callbacks', 'safety']);

const fixHref = (indicatorKey: string) =>
  `/admin/omnichannel-communications/channels?channel=email&tab=${tabForHealthIndicator(indicatorKey)}`;

export const OmniCommsControlCenter: React.FC = () => {
  const client = useOmniCommsRpcClient();
  const releaseTransport = useChannelReleaseControlTransport();
  const testTransport = useChannelTestDeliveryTransport();
  const { organizationId, organizationName, departmentId } = useOmniCommsTenant();

  const [snapshot, setSnapshot] = React.useState<DeliveryToggleSnapshot | null>(null);
  const [bindingId, setBindingId] = React.useState<string | null>(null);
  const [canTest, setCanTest] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [busyRequestId, setBusyRequestId] = React.useState<string | null>(null);
  const [testDeliveries, setTestDeliveries] = React.useState<readonly ChannelTestDelivery[]>([]);
  const [history, setHistory] = React.useState<readonly ReleaseHistoryEntry[]>([]);
  const automation = useAutomationStatus(organizationId, Boolean(organizationId));

  const approvals = useOmniCommsGateApprovals(organizationId);

  const load = React.useCallback(async () => {
    if (!organizationId) {
      setSnapshot(null);
      return;
    }
    setLoading(true);
    try {
      const [toggle, testCentre, diagnostics, releaseSummary] = await Promise.all([
        getDeliveryToggleSnapshot(client, {
          organizationId,
          departmentId: departmentId ?? null,
          channel: CHANNEL,
        }).catch(() => null),
        getChannelTestCentreSummary(client, organizationId, CHANNEL, departmentId ?? null)
          .catch(() => null),
        getChannelTestDeliveryDiagnostics(
          client, organizationId, CHANNEL, departmentId ?? null, null, 5,
        ).catch(() => null),
        getChannelReleaseControlSummary(client, {
          organizationId,
          departmentId: departmentId ?? null,
          channel: 'email',
          historyLimit: 25,
        }).catch(() => null),
      ]);
      setSnapshot(toggle);
      setBindingId(
        (testCentre as { selected_binding_id?: string | null } | null)
          ?.selected_binding_id ?? null,
      );
      setCanTest(
        (diagnostics as { can_execute?: boolean } | null)?.can_execute === true,
      );
      setTestDeliveries(diagnostics?.deliveries ?? []);
      setHistory(releaseSummary?.history ?? []);
    } finally {
      setLoading(false);
    }
  }, [client, organizationId, departmentId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const applyDeliveryIntent = React.useCallback(
    async (intent: GateIntent) => {
      const res = await releaseTransport.invoke(
        buildDeliveryRequestBody({
          organizationId: organizationId as string,
          departmentId: departmentId ?? null,
          channel: CHANNEL,
          intent,
        }),
      );
      if (res.error) throw new Error(res.error.message ?? 'delivery_request_failed');
      const outcome = res.data as { state?: string; blockers?: string[] } | null;
      if (outcome?.state === 'action_required') {
        throw new Error(outcome.blockers?.[0] ?? 'delivery_not_ready');
      }
      return outcome;
    },
    [releaseTransport, organizationId, departmentId],
  );

  const onToggleDelivery = (next: boolean) => {
    if (!organizationId) return;
    const intent: GateIntent = next ? 'enable' : 'disable';
    setBusy(true);
    void (async () => {
      try {
        // Record the intent in the central workflow FIRST, so the request is
        // visible in the queue even when a second person is still required.
        await recordGateRequest(
          { organizationId, departmentId: departmentId ?? null, channel: CHANNEL, gate: 'channel_delivery' },
          intent,
        ).catch(() => null);
        await applyDeliveryIntent(intent);
        await Promise.all([load(), approvals.refresh()]);
      } catch (e) {
        toastError(e, 'The delivery switch could not be changed');
        await approvals.refresh();
      } finally {
        setBusy(false);
      }
    })();
  };

  const onApprove = (request: GateApprovalRequest) => {
    setBusyRequestId(request.id);
    void (async () => {
      try {
        await applyDeliveryIntent(request.intent ?? 'enable');
        await approveGateRequest(request.id, 'Approved from the Control Center.');
        await Promise.all([load(), approvals.refresh()]);
      } catch (e) {
        toastError(e, 'The gate change could not be approved');
      } finally {
        setBusyRequestId(null);
      }
    })();
  };

  const onReject = (request: GateApprovalRequest, reason: string) => {
    setBusyRequestId(request.id);
    void (async () => {
      try {
        await rejectGateRequest(request.id, reason);
        await approvals.refresh();
      } catch (e) {
        toastError(e, 'The gate change could not be rejected');
      } finally {
        setBusyRequestId(null);
      }
    })();
  };

  const onWithdraw = (request: GateApprovalRequest) => {
    setBusyRequestId(request.id);
    void (async () => {
      try {
        await withdrawGateRequest(request.id, 'Withdrawn from the Control Center.');
        // The workflow record alone does not clear the server-side release
        // proposal; without this the switch stays stuck awaiting approval.
        if ((request.intent ?? 'enable') === 'enable' && organizationId) {
          const res = await releaseTransport.invoke(
            buildDeliveryCancelBody({
              organizationId,
              departmentId: departmentId ?? null,
              channel: CHANNEL,
            }),
          );
          if (res.error) throw new Error(res.error.message ?? 'delivery_cancel_failed');
        }
        await Promise.all([load(), approvals.refresh()]);
      } catch (e) {
        toastError(e, 'The request could not be withdrawn');
      } finally {
        setBusyRequestId(null);
      }
    })();
  };

  const onCancelProposal = () => {
    if (!organizationId) return;
    setBusy(true);
    void (async () => {
      try {
        const res = await releaseTransport.invoke(
          buildDeliveryCancelBody({
            organizationId,
            departmentId: departmentId ?? null,
            channel: CHANNEL,
          }),
        );
        if (res.error) throw new Error(res.error.message ?? 'delivery_cancel_failed');
        await Promise.all([load(), approvals.refresh()]);
      } catch (e) {
        toastError(e, 'The pending request could not be withdrawn');
      } finally {
        setBusy(false);
      }
    })();
  };

  const indicatorByKey = new Map(
    (snapshot?.indicators ?? []).map((i) => [i.key, i.ready] as const),
  );
  const rows = HEALTH_ROW_ORDER.filter((key) => indicatorByKey.has(key));
  const firstProblem = rows.find((key) => indicatorByKey.get(key) !== true) ?? null;
  const events = snapshot?.permittedEventCodes ?? [];

  if (!organizationId) {
    return (
      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Select an organisation</AlertTitle>
        <AlertDescription>
          Choose an organisation above to open its communication controls.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6" data-testid="omni-comms-control-center">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Control Center</CardTitle>
              <CardDescription>
                Every communication gate for {organizationName ?? 'this organisation'} in one place.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <ChannelDeliverySwitch
            label={`Automatic ${CHANNEL_LABEL} delivery`}
            snapshot={snapshot}
            loading={loading}
            busy={busy}
            onChange={onToggleDelivery}
          />

          {snapshot?.state === 'awaiting_approval' ? (
            <Alert data-testid="omni-comms-pending-proposal">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>A request to turn delivery on is waiting</AlertTitle>
              <AlertDescription className="mt-2 space-y-2">
                <p>
                  {snapshot.awaitingSelfApproval
                    ? 'You raised this request, so a different administrator must confirm it. '
                      + 'Withdraw it if you want to use the switch again yourself.'
                    : 'Turn the switch on to confirm this request as the second approver.'}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={onCancelProposal}
                  data-testid="omni-comms-withdraw-proposal"
                >
                  Withdraw request
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          {loading && !snapshot ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="space-y-2" data-testid="omni-comms-control-gates">
              {rows.map((key) => {
                const ready = indicatorByKey.get(key) === true;
                return (
                  <ReadOnlyHealthSwitch
                    key={key}
                    indicatorKey={key}
                    label={HEALTH_ROW_LABEL[key] ?? key}
                    ready={ready}
                    statusWord={
                      ready
                        ? (HEALTHY_WORD_ROWS.has(key) ? 'Healthy' : 'Ready')
                        : 'Needs attention'
                    }
                    onFix={(k) => { window.location.assign(fixHref(k)); }}
                  />
                );
              })}
            </div>
          )}

          {firstProblem ? (
            <Alert variant="destructive" data-testid="omni-comms-control-blocker">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>{HEALTH_ROW_PROBLEM[firstProblem] ?? 'Needs attention.'}</AlertTitle>
              <AlertDescription className="mt-2">
                <Button asChild size="sm" variant="outline">
                  <Link to={fixHref(firstProblem)}>Fix</Link>
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <DeliveryStatusPanel
        snapshot={snapshot}
        automation={automation.status}
        pendingApprovals={approvals.open.length}
      />

      <GateApprovalQueueCard
        open={approvals.open}
        recent={approvals.recent}
        loading={approvals.loading}
        error={approvals.error}
        busyId={busyRequestId}
        onApprove={onApprove}
        onReject={onReject}
        onWithdraw={onWithdraw}
      />

      <SimpleTestDeliveryCard
        client={client}
        transport={testTransport}
        organizationId={organizationId}
        departmentId={departmentId ?? null}
        channel={CHANNEL}
        channelLabel={CHANNEL_LABEL}
        bindingId={bindingId}
        canExecute={canTest}
      />

      <TestDeliveryTraceCard
        deliveries={testDeliveries}
        loading={loading}
        onRefresh={() => void load()}
      />

      <OmniCommsAutomationOverviewCard organizationId={organizationId} />

      <GateAuditHistoryCard
        history={history}
        requests={[...approvals.open, ...approvals.recent]}
        loading={loading}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Business event gates</CardTitle>
          <CardDescription>
            The business moments that send {CHANNEL_LABEL} automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No business event is configured to send {CHANNEL_LABEL} yet.
            </p>
          ) : (
            events.map((code) => (
              <BusinessEventDeliverySwitch
                key={code}
                eventCode={code}
                channelLabel={CHANNEL_LABEL}
                enabled={snapshot?.state === 'on'}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default OmniCommsControlCenter;
