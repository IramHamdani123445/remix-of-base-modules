import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PermissionWrapper } from '@/components/ui/permission-wrapper';
import { BnScreenRoleBanner } from '@/components/bn/shared';
import { useMyEffectiveRoles } from '@/hooks/bn/useEffectiveRoles';
import { useMyWorkbaskets } from '@/hooks/bn/useMyWorkbaskets';
import { useUserCode } from '@/hooks/useUserCode';
import { useQuery } from '@tanstack/react-query';
import { fetchMyQueue } from '@/services/bn/workbasketService';
import { Link } from 'react-router-dom';
import { Inbox, Users, ArrowUpRight } from 'lucide-react';

export default function MyBenefitsWorkbench() {
  const { userCode } = useUserCode();
  const { data: roles = [] } = useMyEffectiveRoles();
  const { data: baskets = [] } = useMyWorkbaskets();
  const { data: myTasks = [] } = useQuery({
    queryKey: ['bn', 'my-queue', userCode],
    enabled: !!userCode,
    queryFn: () => fetchMyQueue(userCode!),
  });

  // Group baskets by role
  const basketsByRole = useMemo(() => {
    const map: Record<string, typeof baskets> = {};
    for (const b of baskets) {
      (map[b.role_name] ||= []).push(b);
    }
    return map;
  }, [baskets]);

  const roleNames = useMemo(
    () => Array.from(new Set(roles.map((r) => r.role_name))).sort(),
    [roles],
  );

  return (
    <PermissionWrapper moduleName="bn_claim_worklist">
      <div className="space-y-6 p-6">
        <div>
          <h1 className="t-page-title">My Workbench</h1>
          <p className="t-page-subtitle mt-1 mt-1">
            Tasks and queues for every role you currently hold.
          </p>
        </div>

        <BnScreenRoleBanner
          role="library"
          description="Shows your assigned tasks plus all workbaskets you can serve via direct roles, role bundles, or active delegations."
        />

        {/* Effective roles */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">My Roles ({roleNames.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1">
              {roleNames.map((r) => {
                const sources = roles
                  .filter((er) => er.role_name === r)
                  .map((er) => er.source);
                return (
                  <Badge key={r} variant="secondary" title={sources.join(', ')}>
                    {r}
                    {sources.includes('BUNDLE') && ' (bundle)'}
                    {sources.includes('DELEGATION') && ' (delegated)'}
                  </Badge>
                );
              })}
              {roleNames.length === 0 && (
                <span className="text-sm text-muted-foreground">No BN roles assigned</span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* My Assigned Tasks */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Inbox className="h-4 w-4" /> My Assigned Tasks ({myTasks.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {myTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks currently assigned to you.</p>
            ) : (
              <ul className="space-y-2">
                {myTasks.slice(0, 10).map((t: any) => (
                  <li key={t.id} className="flex items-center justify-between border-b pb-1 text-sm">
                    <span className="font-mono text-xs">{t.claim_id?.slice(0, 8)}…</span>
                    <span>{t.bn_workbasket?.basket_name}</span>
                    <Badge variant="outline">P{t.priority}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* My Role Workbaskets, grouped */}
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Users className="h-4 w-4" /> My Role Workbaskets
          </h2>
          {Object.keys(basketsByRole).length === 0 ? (
            <p className="text-sm text-muted-foreground">No workbaskets available for your roles.</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {Object.entries(basketsByRole).map(([role, list]) => (
                <Card key={role}>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center justify-between">
                      <span>{role}</span>
                      <Badge variant="outline">{list.length}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-1">
                      {list.map((b) => (
                        <li key={b.workbasket_id + role} className="flex items-center justify-between text-sm">
                          <Link
                            to={`/bn/claims?workbasket=${b.workbasket_id}`}
                            className="hover:underline flex items-center gap-1"
                          >
                            {b.basket_name}
                            <ArrowUpRight className="h-3 w-3" />
                          </Link>
                          <span className="font-mono text-xs text-muted-foreground">{b.basket_code}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </PermissionWrapper>
  );
}
