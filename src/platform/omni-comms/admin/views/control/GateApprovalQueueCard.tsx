/**
 * Omni-Comms Control Center — the approval queue, carried by the CENTRAL
 * workflow engine (`OMNI_COMMS_GATE_APPROVAL`).
 *
 * A request recorded here is intent only. Pressing Approve asks the trusted
 * Release Control Edge boundary to apply the change; the server still enforces
 * the two-person rule, so a request raised by you cannot be approved by you.
 */
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, ShieldAlert } from 'lucide-react';
import type { GateApprovalRequest } from '@/platform/omni-comms/application/gateApprovalWorkflowService';

export interface GateApprovalQueueCardProps {
  open: GateApprovalRequest[];
  recent: GateApprovalRequest[];
  loading: boolean;
  error: string | null;
  busyId: string | null;
  onApprove: (request: GateApprovalRequest) => void;
  onReject: (request: GateApprovalRequest, reason: string) => void;
  onWithdraw: (request: GateApprovalRequest) => void;
}

const statusTone = (status: string) =>
  status === 'APPROVED' || status === 'COMPLETED'
    ? 'default'
    : status === 'REJECTED' || status === 'CANCELLED'
      ? 'destructive'
      : 'secondary';

export const GateApprovalQueueCard: React.FC<GateApprovalQueueCardProps> = ({
  open,
  recent,
  loading,
  error,
  busyId,
  onApprove,
  onReject,
  onWithdraw,
}) => {
  const [reasons, setReasons] = React.useState<Record<string, string>>({});

  return (
    <Card data-testid="omni-comms-approval-queue">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Approval queue</CardTitle>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        </div>
        <CardDescription>
          Gate changes waiting for a second person. Every item is a central
          workflow request (Omnichannel Communications — Delivery Gate
          Approval).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>The approval queue could not be read.</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {open.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing is waiting for approval.
          </p>
        ) : (
          open.map((request) => (
            <div
              key={request.id}
              className="space-y-3 rounded-md border p-3"
              data-testid={`omni-comms-approval-item-${request.id}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">
                    {request.displayName ?? 'Delivery gate change'}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Requested{' '}
                    {request.requestedAt
                      ? new Date(request.requestedAt).toLocaleString()
                      : 'recently'}
                  </div>
                </div>
                <Badge variant={statusTone(request.status)}>{request.status}</Badge>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="h-9 max-w-xs"
                  placeholder="Reason (required to reject)"
                  value={reasons[request.id] ?? ''}
                  onChange={(e) =>
                    setReasons((prev) => ({ ...prev, [request.id]: e.target.value }))
                  }
                />
                <Button
                  size="sm"
                  disabled={busyId === request.id}
                  onClick={() => onApprove(request)}
                >
                  {busyId === request.id ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busyId === request.id || !(reasons[request.id] ?? '').trim()}
                  onClick={() => onReject(request, (reasons[request.id] ?? '').trim())}
                >
                  Reject
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === request.id}
                  onClick={() => onWithdraw(request)}
                >
                  Withdraw
                </Button>
              </div>
            </div>
          ))
        )}

        {recent.length > 0 ? (
          <div className="space-y-2 pt-2">
            <div className="text-sm font-medium">Recent decisions</div>
            {recent.map((request) => (
              <div
                key={request.id}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <span className="text-sm">
                  {request.displayName ?? 'Delivery gate change'}
                </span>
                <Badge variant={statusTone(request.status)}>{request.status}</Badge>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};

export default GateApprovalQueueCard;
