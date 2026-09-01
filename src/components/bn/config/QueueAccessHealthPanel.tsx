import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  useWorkbasketPermissionGaps,
  useReconcileWorkbasketPermissions,
} from '@/hooks/bn/useWorkbasketPermissionGaps';

interface Props {
  /** Compact summary card (no table) for configuration validation screens. */
  compact?: boolean;
}

export function QueueAccessHealthPanel({ compact = false }: Props) {
  const { data: gaps = [], isLoading, refetch } = useWorkbasketPermissionGaps();
  const reconcile = useReconcileWorkbasketPermissions();

  const healthy = !isLoading && gaps.length === 0;
  const missingRoles = Array.from(new Set(gaps.map((g) => g.assigned_role)));
  const unknownRoles = Array.from(new Set(gaps.filter((g) => !g.role_exists).map((g) => g.assigned_role)));

  const onReconcile = async () => {
    try {
      const granted = await reconcile.mutateAsync();
      toast.success(
        granted.length
          ? `Granted queue access for ${granted.length} role/module pair${granted.length === 1 ? '' : 's'}`
          : 'No new grants were required',
      );
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not reconcile queue access');
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" />
          Queue Access Health
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
          {!healthy && !isLoading && (
            <Button size="sm" onClick={onReconcile} disabled={reconcile.isPending}>
              {reconcile.isPending ? 'Reconciling…' : 'Reconcile access'}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Checking basket role access…</p>
        ) : healthy ? (
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            All basket roles can open the Claim Queue.
          </div>
        ) : (
          <>
            <div className="flex items-start gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive" />
              <span>
                {missingRoles.length} basket role{missingRoles.length === 1 ? '' : 's'} cannot open their own
                queue — those baskets are invisible to their owners.
                {unknownRoles.length > 0 && (
                  <> {unknownRoles.length} basket role{unknownRoles.length === 1 ? ' does' : 's do'} not exist in the role register and must be corrected on the workbasket.</>
                )}
              </span>
            </div>

            {!compact && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Role</TableHead>
                    <TableHead>Workbasket</TableHead>
                    <TableHead>Missing access</TableHead>
                    <TableHead>Role exists</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {gaps.map((g) => (
                    <TableRow key={`${g.assigned_role}-${g.basket_code}-${g.missing_module}`}>
                      <TableCell className="font-mono text-xs">{g.assigned_role}</TableCell>
                      <TableCell className="text-sm">
                        {g.basket_name} <span className="text-muted-foreground">({g.basket_code})</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-xs">{g.missing_module}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={g.role_exists ? 'secondary' : 'destructive'}>
                          {g.role_exists ? 'Yes' : 'No'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default QueueAccessHealthPanel;
