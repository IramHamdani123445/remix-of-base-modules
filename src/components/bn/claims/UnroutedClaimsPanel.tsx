/**
 * Claims that are in no workbasket at all.
 *
 * Every queue screen only ever showed claims that had an assignment, so a claim
 * that failed to route was invisible — it existed, but no officer's queue
 * contained it and nothing said so. This panel makes that population visible
 * and gives it a one-click repair, using the same routing service intake and
 * status transitions use, so the repair can never disagree with normal routing.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useUserCode } from '@/hooks/useUserCode';
import { BN_CLAIM_STATUS_LABELS } from '@/types/bn';
import {
  findUnroutedClaims,
  routeClaims,
  routeClaimToWorkbasket,
} from '@/services/bn/workflow/routeClaimToWorkbasket';

export function UnroutedClaimsPanel() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { userCode } = useUserCode();
  const [busy, setBusy] = useState(false);

  const { data: claims = [], isLoading, refetch } = useQuery({
    queryKey: ['bn', 'unrouted-claims'],
    queryFn: () => findUnroutedClaims(200),
  });

  const refreshQueues = async () => {
    await Promise.all([
      refetch(),
      queryClient.invalidateQueries({ queryKey: ['bn', 'queue-claims'] }),
      queryClient.invalidateQueries({ queryKey: ['bn', 'my-queue'] }),
    ]);
  };

  const handleRouteOne = async (claimId: string) => {
    setBusy(true);
    try {
      const r = await routeClaimToWorkbasket(claimId, userCode || 'SYSTEM');
      if (r.toWorkbasketId) {
        toast.success(`Placed in ${r.workbasketName ?? 'a workbasket'}`);
      } else {
        // A configuration gap is reported as-is; nothing is guessed.
        toast.warning(`Still not routed — ${r.reason}`);
      }
      await refreshQueues();
    } finally {
      setBusy(false);
    }
  };

  const handleRouteAll = async () => {
    setBusy(true);
    try {
      const summary = await routeClaims(
        claims.map((c) => c.id),
        userCode || 'SYSTEM',
      );
      const placed = summary.byOutcome.ASSIGNED + summary.byOutcome.MOVED;
      toast.success(
        `${placed} of ${summary.total} placed in a workbasket` +
        (summary.byOutcome.UNROUTED
          ? ` — ${summary.byOutcome.UNROUTED} still need workflow or workbasket configuration`
          : ''),
      );
      await refreshQueues();
    } finally {
      setBusy(false);
    }
  };

  if (isLoading || claims.length === 0) return null;

  return (
    <Card className="border-destructive/40">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Not in any workbasket ({claims.length})
            </CardTitle>
            <CardDescription>
              These claims are active but no queue owns them, so no officer will see them.
            </CardDescription>
          </div>
          <Button size="sm" onClick={handleRouteAll} disabled={busy}>
            <RefreshCw className="mr-1 h-3 w-3" /> Route all
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Claim</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Why</TableHead>
              <TableHead className="w-[110px]">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {claims.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">
                  <Button
                    variant="link"
                    className="h-auto p-0"
                    onClick={() => navigate(`/bn/claims/${c.id}`)}
                  >
                    {c.claimNumber || c.id.slice(0, 8)}
                  </Button>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {(BN_CLAIM_STATUS_LABELS as any)[c.status ?? ''] || c.status || '—'}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{c.reason}</TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => handleRouteOne(c.id)}
                  >
                    Route
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default UnroutedClaimsPanel;
