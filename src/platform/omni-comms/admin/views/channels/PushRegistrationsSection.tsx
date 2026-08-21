/**
 * Omni-Comms — governed Push registration administration.
 *
 * A registration is created ONLY by the owning installation itself; the
 * recipient binding is derived server-side from the authenticated session.
 * This screen inspects and retires registrations — it never accepts, returns
 * or displays a device token, only a short non-reversible fingerprint.
 *
 * Boundaries: no provider SDK, no façade emission, no dispatch job.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import type { OmniCommsRpcClient } from '@/platform/omni-comms/application/omniCommsRpcErrors';
import {
  listPushRegistrations,
  retirePushRegistration,
  PUSH_PLATFORM_LABEL,
  type PushRegistrationRow,
} from '@/platform/omni-comms/application/pushRegistrationService';
import { toastError } from './channelFormPrimitives';

export const PushRegistrationsSection: React.FC<{
  client: OmniCommsRpcClient;
  orgId: string;
}> = ({ client, orgId }) => {
  const [rows, setRows] = useState<PushRegistrationRow[]>([]);
  const [includeRetired, setIncludeRetired] = useState(false);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listPushRegistrations(client, orgId, includeRetired);
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      toastError(e, 'Could not load push registrations');
    } finally {
      setLoading(false);
    }
  }, [client, orgId, includeRetired]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const retire = async (row: PushRegistrationRow) => {
    try {
      await retirePushRegistration(client, row.id, 'retired_by_operator');
      toast.success('Registration retired.');
      await refresh();
    } catch (e) {
      toastError(e, 'Could not retire the registration');
    }
  };

  return (
    <Card data-testid="omni-comms-push-registrations">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Push registrations</CardTitle>
          <CardDescription>
            Installations that registered themselves for push. Tokens are never shown
            or entered here — the recipient binding is derived server-side from the
            signed-in installation.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIncludeRetired((v) => !v)}
          >
            {includeRetired ? 'Hide retired' : 'Show retired'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No installation has registered for push in this organisation yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Platform</TableHead>
                <TableHead>Application</TableHead>
                <TableHead>Token fingerprint</TableHead>
                <TableHead>Recipient</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead className="text-right">Manage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{PUSH_PLATFORM_LABEL[row.platform] ?? row.platform}</TableCell>
                  <TableCell>
                    {row.app_identifier ?? '—'}
                    {row.device_model ? (
                      <div className="text-xs text-muted-foreground">{row.device_model}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.token_fingerprint}</TableCell>
                  <TableCell className="text-xs">
                    {row.recipient_reference ?? '—'}
                    {row.recipient_reference_verified ? null : (
                      <Badge variant="secondary" className="ml-2">unverified</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.state === 'active' ? 'default' : 'secondary'}>
                      {row.state}
                    </Badge>
                    {row.failure_count > 0 ? (
                      <div className="text-xs text-muted-foreground">
                        {row.failure_count} failure(s)
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs">
                    {row.last_seen_at ? new Date(row.last_seen_at).toLocaleString() : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.state === 'active' ? (
                      <Button variant="ghost" size="sm" onClick={() => void retire(row)}>
                        Retire
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

export default PushRegistrationsSection;
