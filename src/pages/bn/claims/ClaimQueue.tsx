import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Inbox, HandMetal, ArrowUpRight, Clock } from 'lucide-react';
import {
  useBnWorkbaskets,
  useBnQueueClaims,
  useBnMyQueue,
  usePickBnClaim,
  useReleaseBnClaim,
  useBasketClaimCounts,
} from '@/hooks/bn/useBnWorkbasket';
import { useMyWorkbaskets } from '@/hooks/bn/useMyWorkbaskets';
import { useBasketArrivalAlerts, useClearBasketArrivalAlerts } from '@/hooks/bn/useBasketArrivalAlerts';
import { useMyEffectiveRoles } from '@/hooks/bn/useEffectiveRoles';
import { useUserCode } from '@/hooks/useUserCode';
import { BN_CLAIM_STATUS_LABELS } from '@/types/bn';
import { formatDateForDisplay } from '@/lib/format-config';
import { PermissionWrapper } from '@/components/ui/permission-wrapper';
import { toast } from 'sonner';
import type { BnClaimQueueAssignment, BnWorkbasket } from '@/types/bn';
import { UnroutedClaimsPanel } from '@/components/bn/claims/UnroutedClaimsPanel';

/** Roles allowed to look beyond their own baskets. */
const OVERSIGHT_ROLES = ['BN_SUPERVISOR', 'BN_MANAGER', 'BN_DIRECTOR', 'BN_CONFIG_ADMIN'];
/** Generic oversight markers so tenant role names (Admin, LEGAL_ADMIN, FinanceManager…) count too. */
const OVERSIGHT_MARKERS = ['ADMIN', 'SUPERVISOR', 'MANAGER', 'DIRECTOR'];

const isOversightRole = (role: string) => {
  const upper = (role || '').toUpperCase();
  return OVERSIGHT_ROLES.includes(upper) || OVERSIGHT_MARKERS.some((m) => upper.includes(m));
};

interface QueueBasket {
  id: string;
  basket_name: string;
  role_name?: string;
  is_primary?: boolean;
}

export default function ClaimQueue() {
  const navigate = useNavigate();
  const { userCode } = useUserCode();
  const { data: myBaskets = [], isLoading: myBasketsLoading } = useMyWorkbaskets();
  const { data: myRoles = [] } = useMyEffectiveRoles();
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const { data: allBaskets = [] } = useBnWorkbaskets();
  const [selectedBasket, setSelectedBasket] = useState<string | null>(null);
  const { data: queueClaims = [], isLoading: queueLoading } = useBnQueueClaims(selectedBasket || undefined);
  const { data: myQueue = [] } = useBnMyQueue(userCode);
  const pickClaim = usePickBnClaim();
  const releaseClaim = useReleaseBnClaim();

  const roleNames = useMemo(
    () => Array.from(new Set(myRoles.map((r) => r.role_name))).sort(),
    [myRoles],
  );
  const canSeeAll = roleNames.some(isOversightRole);

  // Deduplicate: the same basket can be reachable through several roles.
  const mineBaskets: QueueBasket[] = useMemo(() => {
    const map = new Map<string, QueueBasket>();
    for (const b of myBaskets) {
      const existing = map.get(b.workbasket_id);
      if (existing) {
        existing.is_primary = existing.is_primary || b.is_primary;
        continue;
      }
      map.set(b.workbasket_id, {
        id: b.workbasket_id,
        basket_name: b.basket_name,
        role_name: b.role_name,
        is_primary: b.is_primary,
      });
    }
    return Array.from(map.values()).sort((a, b) => a.basket_name.localeCompare(b.basket_name));
  }, [myBaskets]);

  // Oversight users with no basket of their own start on the "All baskets" scope.
  const autoSwitched = useRef(false);
  useEffect(() => {
    if (autoSwitched.current || myBasketsLoading) return;
    if (canSeeAll && mineBaskets.length === 0) {
      autoSwitched.current = true;
      setScope('all');
    }
  }, [canSeeAll, mineBaskets.length, myBasketsLoading]);


  const baskets: QueueBasket[] =
    scope === 'all'
      ? (allBaskets as BnWorkbasket[]).map((b) => ({
          id: b.id,
          basket_name: b.basket_name,
          role_name: (b as any).assigned_role,
        }))
      : mineBaskets;

  const basketIds = useMemo(() => baskets.map((b) => b.id), [baskets]);
  const { data: counts = {} } = useBasketClaimCounts(basketIds);
  const { data: arrivals = {} } = useBasketArrivalAlerts(basketIds);
  const clearArrivals = useClearBasketArrivalAlerts();

  // Opening a basket clears its "new arrival" alerts for this user.
  const openBasket = (basketId: string) => {
    setSelectedBasket(basketId);
    if ((arrivals[basketId] ?? 0) > 0) clearArrivals.mutate(basketId);
  };


  // Auto-select: primary basket first, then the first basket holding work.
  useEffect(() => {
    if (baskets.length === 0) {
      setSelectedBasket(null);
      return;
    }
    if (selectedBasket && baskets.some((b) => b.id === selectedBasket)) return;
    const withWork = baskets.find((b) => (counts[b.id]?.total ?? 0) > 0);
    const primary = baskets.find((b) => b.is_primary && (counts[b.id]?.total ?? 0) > 0);
    setSelectedBasket((primary || withWork || baskets.find((b) => b.is_primary) || baskets[0]).id);
  }, [baskets, counts, selectedBasket]);


  const handlePick = async (assignmentId: string) => {
    if (!userCode) return;
    try {
      await pickClaim.mutateAsync({ assignmentId, userCode });
      toast.success('Claim picked successfully');
    } catch {
      toast.error('Failed to pick claim');
    }
  };

  const handleRelease = async (assignmentId: string) => {
    try {
      await releaseClaim.mutateAsync(assignmentId);
      toast.success('Claim released');
    } catch {
      toast.error('Failed to release claim');
    }
  };

  const isOverdue = (dueAt: string | null) => {
    if (!dueAt) return false;
    return new Date(dueAt) < new Date();
  };

  const renderClaimRow = (item: BnClaimQueueAssignment, showActions = true) => {
    const claim = item.bn_claim;
    if (!claim) return null;

    // Stage and queue are two different truths: the status is the lifecycle
    // stage, the basket is the officer queue that owns the claim. Showing only
    // the status made an award-setup claim in a payment queue look wrong, so
    // both are stated, and a disagreement is marked rather than hidden.
    const owningBasket = baskets.find((b) => b.id === (item.workbasket_id ?? selectedBasket));
    const disposition = stepForClaimStatus(claim.status);
    const stage = disposition.kind === 'STEP' ? disposition.step : null;
    const parked = disposition.kind === 'HOLD';
    const mismatched =
      !!stage && !!owningBasket && !basketServesStage((owningBasket as any).basket_code, stage);

    return (
      <TableRow key={item.id} className={isOverdue(item.due_at) ? 'bg-destructive/5' : ''}>
        <TableCell className="font-medium">
          <Button variant="link" className="p-0 h-auto" onClick={() => navigate(`/bn/claims/${claim.id}`)}>
            {claim.claim_number || claim.id.slice(0, 8)}
          </Button>
        </TableCell>
        <TableCell>{claim.ssn}</TableCell>
        <TableCell>
          <div className="flex flex-col gap-1">
            <Badge variant="outline">{(BN_CLAIM_STATUS_LABELS as any)[claim.status] || claim.status}</Badge>
            <span className="text-xs text-muted-foreground">
              {stage ? `${stage} stage` : parked ? 'Parked with current owner' : 'No stage owns this claim'}
              {owningBasket ? ` · ${owningBasket.basket_name ?? (owningBasket as any).basket_code} queue` : ''}
            </span>
            {mismatched && (
              <span
                className="text-xs text-destructive"
                title={`This queue does not serve the ${stage} stage. The workflow step for that stage names the wrong queue, or the stage has no step.`}
              >
                Stage / queue mismatch
              </span>
            )}
          </div>
        </TableCell>

        <TableCell>
          <Badge variant={item.priority <= 2 ? 'destructive' : item.priority <= 4 ? 'default' : 'outline'}>
            P{item.priority}
          </Badge>
        </TableCell>
        <TableCell>
          {item.due_at ? (
            <span className={isOverdue(item.due_at) ? 'text-destructive font-medium' : ''}>
              {formatDateForDisplay(item.due_at)}
              {isOverdue(item.due_at) && ' ⚠️'}
            </span>
          ) : '—'}
        </TableCell>
        <TableCell>{item.assigned_to || 'Unassigned'}</TableCell>
        {showActions && (
          <TableCell>
            <div className="flex gap-1">
              {!item.picked_at ? (
                <Button size="sm" variant="outline" onClick={() => handlePick(item.id)}>
                  <HandMetal className="mr-1 h-3 w-3" /> Pick
                </Button>
              ) : item.assigned_to === userCode ? (
                <Button size="sm" variant="ghost" onClick={() => handleRelease(item.id)}>
                  Release
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => navigate(`/bn/claims/${claim.id}`)}>
                <ArrowUpRight className="h-3 w-3" />
              </Button>
            </div>
          </TableCell>
        )}
      </TableRow>
    );
  };

  const selected = baskets.find((b) => b.id === selectedBasket);

  return (
    <PermissionWrapper moduleName="bn_claim_queue">
      <div className="space-y-6 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="t-page-title">Claim Queue</h1>
            <p className="t-page-subtitle mt-1">
              {scope === 'mine'
                ? `Workbaskets you serve as ${roleNames.length ? roleNames.join(', ') : 'your assigned roles'}.`
                : 'All active workbaskets.'}
            </p>
          </div>
          {canSeeAll && (
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={scope === 'mine' ? 'default' : 'outline'}
                onClick={() => { setScope('mine'); setSelectedBasket(null); }}
              >
                My baskets
              </Button>
              <Button
                size="sm"
                variant={scope === 'all' ? 'default' : 'outline'}
                onClick={() => { setScope('all'); setSelectedBasket(null); }}
              >
                All baskets
              </Button>
            </div>
          )}
        </div>

        {/* Claims no queue owns — invisible until now. */}
        <UnroutedClaimsPanel />

        {/* My Queue */}
        {myQueue.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4 text-primary" />
                My Assigned Claims ({myQueue.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Claim</TableHead>
                    <TableHead>SSN</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Assigned To</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>{myQueue.map(item => renderClaimRow(item))}</TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Workbaskets */}
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-3 space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground mb-3">
              {scope === 'mine' ? 'My Workbaskets' : 'All Workbaskets'}
            </h3>
            {baskets.map((basket) => {
              const count = counts[basket.id];
              const newCount = arrivals[basket.id] ?? 0;
              return (
                <Button
                  key={basket.id}
                  variant={selectedBasket === basket.id ? 'default' : 'outline'}
                  className="w-full justify-start"
                  onClick={() => openBasket(basket.id)}
                >
                  <Inbox className="mr-2 h-4 w-4 shrink-0" />
                  <span className="truncate">{basket.basket_name}</span>
                  <span className="ml-auto flex items-center gap-1">
                    {newCount > 0 && (
                      <Badge className="bg-primary text-primary-foreground px-1.5">{newCount} new</Badge>
                    )}
                    {count?.overdue ? (
                      <Badge variant="destructive" className="px-1.5">{count.overdue}</Badge>
                    ) : null}
                    <Badge variant="secondary" className="px-1.5">{count?.total ?? 0}</Badge>
                  </span>
                </Button>
              );
            })}

            {baskets.length === 0 && !myBasketsLoading && (
              <p className="text-sm text-muted-foreground">
                {scope === 'mine'
                  ? canSeeAll
                    ? 'You have no personal workbasket — switch to All baskets to work on behalf of any role.'
                    : roleNames.length > 0
                      ? `No workbasket is configured for your role${roleNames.length > 1 ? 's' : ''} (${roleNames.join(', ')}).`
                      : 'You hold no benefits role, so no workbasket is assigned to you.'
                  : 'No workbaskets configured'}
              </p>
            )}
          </div>

          <div className="col-span-9">
            {selectedBasket ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    {selected?.basket_name || 'Queue'}
                    {selected?.role_name && (
                      <Badge variant="outline" className="ml-2 font-normal">{selected.role_name}</Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {queueLoading ? (
                    <p className="text-sm text-muted-foreground">Loading...</p>
                  ) : queueClaims.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No claims currently in {selected?.basket_name || 'this queue'}.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Claim</TableHead>
                          <TableHead>SSN</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Priority</TableHead>
                          <TableHead>Due</TableHead>
                          <TableHead>Assigned To</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>{queueClaims.map(item => renderClaimRow(item))}</TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <Inbox className="mx-auto h-12 w-12 mb-3 opacity-30" />
                  <p>Select a workbasket to view claims</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

      </div>
    </PermissionWrapper>
  );
}
