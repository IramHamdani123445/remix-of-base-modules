import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Inbox, HandMetal, ArrowUpRight, Clock } from 'lucide-react';
import { useBnWorkbaskets, useBnQueueClaims, useBnMyQueue, usePickBnClaim, useReleaseBnClaim } from '@/hooks/bn/useBnWorkbasket';
import { useUserCode } from '@/hooks/useUserCode';
import { BN_CLAIM_STATUS_LABELS } from '@/types/bn';
import { formatDateForDisplay } from '@/lib/format-config';
import { PermissionWrapper } from '@/components/ui/permission-wrapper';
import { toast } from 'sonner';
import type { BnClaimQueueAssignment, BnWorkbasket } from '@/types/bn';
import { UnroutedClaimsPanel } from '@/components/bn/claims/UnroutedClaimsPanel';

export default function ClaimQueue() {
  const navigate = useNavigate();
  const { userCode } = useUserCode();
  const { data: workbaskets = [] } = useBnWorkbaskets();
  const [selectedBasket, setSelectedBasket] = useState<string | null>(null);
  const { data: queueClaims = [], isLoading: queueLoading } = useBnQueueClaims(selectedBasket || undefined);
  const { data: myQueue = [] } = useBnMyQueue(userCode);
  const pickClaim = usePickBnClaim();
  const releaseClaim = useReleaseBnClaim();

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

    return (
      <TableRow key={item.id} className={isOverdue(item.due_at) ? 'bg-destructive/5' : ''}>
        <TableCell className="font-medium">
          <Button variant="link" className="p-0 h-auto" onClick={() => navigate(`/bn/claims/${claim.id}`)}>
            {claim.claim_number || claim.id.slice(0, 8)}
          </Button>
        </TableCell>
        <TableCell>{claim.ssn}</TableCell>
        <TableCell>
          <Badge variant="outline">{(BN_CLAIM_STATUS_LABELS as any)[claim.status] || claim.status}</Badge>
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

  return (
    <PermissionWrapper moduleName="benefits_management">
      <div className="space-y-6 p-6">
        <h1 className="t-page-title">Claim Queue</h1>

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
            <h3 className="text-sm font-medium text-muted-foreground mb-3">Workbaskets</h3>
            {workbaskets.map((basket: BnWorkbasket) => (
              <Button
                key={basket.id}
                variant={selectedBasket === basket.id ? 'default' : 'outline'}
                className="w-full justify-start"
                onClick={() => setSelectedBasket(basket.id)}
              >
                <Inbox className="mr-2 h-4 w-4" />
                {basket.basket_name}
              </Button>
            ))}
            {workbaskets.length === 0 && (
              <p className="text-sm text-muted-foreground">No workbaskets configured</p>
            )}
          </div>

          <div className="col-span-9">
            {selectedBasket ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    {workbaskets.find(b => b.id === selectedBasket)?.basket_name || 'Queue'}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {queueLoading ? (
                    <p className="text-sm text-muted-foreground">Loading...</p>
                  ) : queueClaims.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No claims in this queue</p>
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
