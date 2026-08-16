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
  approveGateRequestWithTask,
  recordGatePause,
  recordGateRequest,
  rejectGateRequestWithTask,
  withdrawGateRequestWithTask,
  type GateApprovalRequest,
  type GateIntent,
} from '@/platform/omni-comms/application/gateApprovalWorkflowService';
import { notifyGateApprovalEvent } from '@/platform/notifications/gateApprovalNotifications';
import PauseDeliveryDialog from './PauseDeliveryDialog';

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
import {
  OMNI_COMMS_CHANNEL_CATALOGUE,
  getChannelDescriptor,
} from '@/platform/omni-comms/domain/channelCatalogue';
import type { TestCentreChannel } from '@/platform/omni-comms/application/channelTestCentreTypes';

const HEALTHY_WORD_ROWS = new Set(['dispatcher', 'callbacks', 'safety']);

/**
 * Channels whose delivery gate is governed here. Derived from the canonical
 * capability matrix — never hand-authored — so a channel appears the moment
 * it genuinely gains Release Control.
 */
const GOVERNED_CHANNELS = OMNI_COMMS_CHANNEL_CATALOGUE.filter(
  (d) => d.capabilities['release-control'].uiApplicable,
);

/** Channels that are configurable but have no governed delivery gate yet. */
const OTHER_CHANNELS = OMNI_COMMS_CHANNEL_CATALOGUE.filter(
  (d) => !d.capabilities['release-control'].uiApplicable,
);

/** Channels the Control Center can govern end-to-end. */
export type GovernedChannel = 'email' | 'sms';

const channelHref = (channel: string, tab = 'overview') =>
  `/admin/omnichannel-communications/channels?channel=${channel}&tab=${tab}`;

export const OmniCommsControlCenter: React.FC = () => {
  const client = useOmniCommsRpcClient();
  const releaseTransport = useChannelReleaseControlTransport();
  const testTransport = useChannelTestDeliveryTransport();
  const { organizationId, organizationName, departmentId } = useOmniCommsTenant();

  // Which governed channel this screen is controlling right now.
  const [channel, setChannel] = React.useState<GovernedChannel>('email');
  const CHANNEL: TestCentreChannel & GovernedChannel = channel;
  const CHANNEL_LABEL = getChannelDescriptor(channel).label;
  const fixHref = React.useCallback(
    (indicatorKey: string) => channelHref(channel, tabForHealthIndicator(indicatorKey)),
    [channel],
  );

  const [snapshot, setSnapshot] = React.useState<DeliveryToggleSnapshot | null>(null);
  const [bindingId, setBindingId] = React.useState<string | null>(null);
  const [canTest, setCanTest] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [busyRequestId, setBusyRequestId] = React.useState<string | null>(null);
  const [pauseOpen, setPauseOpen] = React.useState(false);

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
          channel: CHANNEL,
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
  }, [client, organizationId, departmentId, CHANNEL]);

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
    [releaseTransport, organizationId, departmentId, CHANNEL],
  );

  const gateScope = React.useMemo(
    () => ({
      organizationId: organizationId as string,
      departmentId: departmentId ?? null,
      channel: CHANNEL,
      gate: 'channel_delivery',
    }),
    [organizationId, departmentId, CHANNEL],
  );

  /** Turning delivery ON: always a two-person request, recorded centrally. */
  const requestEnable = React.useCallback(async () => {
    // Record the intent in the central workflow FIRST, so the request and its
    // approval task exist before the server is asked to act. A failure here is
    // surfaced — a gate change must never look recorded when it is not.
    const recorded = await recordGateRequest(gateScope, 'enable');
    void notifyGateApprovalEvent({
      event: 'requested',
      subject: recorded.displayName ?? `Turn on automatic ${CHANNEL_LABEL} delivery`,
      workflowInstanceId: recorded.id,
    });
    const outcome = await applyDeliveryIntent('enable');
    // The server activated it straight away (second person moved the switch):
    // close the central request and its task in the same action.
    if ((outcome as { state?: string } | null)?.state === 'on') {
      await approveGateRequestWithTask(recorded.id, 'Confirmed by the second approver.');
      void notifyGateApprovalEvent({
        event: 'approved',
        subject: recorded.displayName ?? 'Delivery gate change',
        workflowInstanceId: recorded.id,
      });
    }
  }, [gateScope, applyDeliveryIntent]);

  /** Turning delivery OFF: immediate, reason mandatory, no approval. */
  const pauseDelivery = React.useCallback(
    async (reason: string) => {
      await applyDeliveryIntent('disable');
      await recordGatePause(gateScope, reason);
    },
    [gateScope, applyDeliveryIntent],
  );

  const onToggleDelivery = (next: boolean) => {
    if (!organizationId) return;
    if (!next) {
      setPauseOpen(true);
      return;
    }
    setBusy(true);
    void (async () => {
      try {
        await requestEnable();
        await Promise.all([load(), approvals.refresh()]);
      } catch (e) {
        toastError(e, 'The delivery switch could not be changed');
        await approvals.refresh();
      } finally {
        setBusy(false);
      }
    })();
  };

  const onConfirmPause = (reason: string) => {
    setBusy(true);
    void (async () => {
      try {
        await pauseDelivery(reason);
        setPauseOpen(false);
        await Promise.all([load(), approvals.refresh()]);
      } catch (e) {
        toastError(e, 'Automatic delivery could not be turned off');
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
        await approveGateRequestWithTask(request.id, 'Approved from the Control Center.');
        void notifyGateApprovalEvent({
          event: 'approved',
          subject: request.displayName ?? 'Delivery gate change',
          workflowInstanceId: request.id,
        });
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
        await rejectGateRequestWithTask(request.id, reason);
        void notifyGateApprovalEvent({
          event: 'rejected',
          subject: request.displayName ?? 'Delivery gate change',
          comment: reason,
          workflowInstanceId: request.id,
        });
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
        await withdrawGateRequestWithTask(request.id, 'Withdrawn from the Control Center.');

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
          <div
            className="flex flex-wrap gap-2"
            role="tablist"
            aria-label="Channel"
            data-testid="omni-comms-control-channel-picker"
          >
            {GOVERNED_CHANNELS.map((d) => (
              <Button
                key={d.channel}
                role="tab"
                aria-selected={d.channel === channel}
                size="sm"
                variant={d.channel === channel ? 'default' : 'outline'}
                onClick={() => setChannel(d.channel as GovernedChannel)}
                data-testid={`omni-comms-control-channel-${d.channel}`}
              >
                {d.label}
              </Button>
            ))}
          </div>

          <ChannelDeliverySwitch
            label={`Automatic ${CHANNEL_LABEL} delivery`}
            snapshot={snapshot}
            loading={loading}
            busy={busy}
            onChange={onToggleDelivery}
          />

          <PauseDeliveryDialog
            open={pauseOpen}
            channelLabel={CHANNEL_LABEL}
            busy={busy}
            onCancel={() => setPauseOpen(false)}
            onConfirm={onConfirmPause}
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
        channelLabel={CHANNEL_LABEL}
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

      <Card data-testid="omni-comms-other-channels">
        <CardHeader>
          <CardTitle className="text-base">Other channels</CardTitle>
          <CardDescription>
            These channels are configured in their own workspace. They have no
            automatic delivery gate yet, so nothing can be sent from them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {OTHER_CHANNELS.map((d) => (
            <div
              key={d.channel}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
            >
              <div>
                <p className="text-sm font-medium">{d.label}</p>
                <p className="text-xs text-muted-foreground">
                  {d.databaseSupported
                    ? d.implemented
                      ? 'Delivery adapter deployed. Gate coming with its release contract.'
                      : 'Configuration only — no delivery adapter is deployed.'
                    : 'Not available yet — the platform cannot store this channel.'}
                </p>
              </div>
              <Button
                asChild={d.databaseSupported}
                size="sm"
                variant="outline"
                disabled={!d.databaseSupported}
              >
                {d.databaseSupported
                  ? <Link to={channelHref(d.channel)}>Open workspace</Link>
                  : <span>Open workspace</span>}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

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
