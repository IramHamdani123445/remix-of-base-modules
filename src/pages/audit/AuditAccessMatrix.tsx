import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StandardModal } from '@/components/common';
import { ExternalLink, Search, ShieldAlert, Users } from 'lucide-react';
import {
  SOD_CONFLICT_LABELS,
  useAuditAccessMatrix,
  useAuditPermissionReconciliation,
  type AccessMatrixUser,
} from '@/hooks/audit/useAuditAccessMatrix';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  PASS: 'default',
  MISSING: 'destructive',
  MISMATCHED: 'destructive',
  UNUSED: 'outline',
};

/**
 * Internal Audit → Configuration → Access Matrix.
 *
 * Read / explain / audit only. Internal Audit consumes central identity and
 * the central permission registry — user, role and permission administration
 * stays in Central User Management and Roles & Permissions.
 */
export default function AuditAccessMatrix() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<AccessMatrixUser | null>(null);

  const { data: matrix, isLoading } = useAuditAccessMatrix();
  const { data: reconciliation, isLoading: reconLoading } = useAuditPermissionReconciliation();

  const users = useMemo(() => {
    const list = matrix?.users || [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((u) =>
      [u.full_name, u.email, ...(u.ia_roles || []), ...(u.roles || [])]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [matrix, search]);

  const reconStats = useMemo(() => {
    const rows = reconciliation?.rows || [];
    return {
      total: rows.length,
      pass: rows.filter((r) => r.final_status === 'PASS').length,
      missing: rows.filter((r) => r.final_status === 'MISSING').length,
      mismatched: rows.filter((r) => r.final_status === 'MISMATCHED').length,
      unused: rows.filter((r) => r.final_status === 'UNUSED').length,
    };
  }, [reconciliation]);

  if (isLoading) return <div className="container mx-auto p-6 space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div>;

  if (!matrix?.success) {
    return (
      <div className="container mx-auto p-6">
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertDescription>{matrix?.error || 'The Access Matrix is not available to your role.'}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />Internal Audit Access Matrix
          </h1>
          <p className="text-sm text-muted-foreground max-w-3xl">
            Explains effective Internal Audit access. Internal Audit does not maintain its own users,
            roles or permissions — it consumes central identity and applies audit business scope through
            auditor registration, department scope and engagement assignment.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate('/admin/users')}>
            <ExternalLink className="h-3.5 w-3.5 mr-1" />Open Central User Management
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/admin/roles')}>
            <ExternalLink className="h-3.5 w-3.5 mr-1" />Open Roles &amp; Permissions
          </Button>
        </div>
      </div>

      <Tabs defaultValue="matrix">
        <TabsList>
          <TabsTrigger value="matrix">Access Matrix ({matrix.users?.length || 0})</TabsTrigger>
          <TabsTrigger value="reconciliation">Permission Reconciliation</TabsTrigger>
        </TabsList>

        <TabsContent value="matrix" className="space-y-4 mt-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search user, email or role..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground bg-muted/40">
                    <th className="text-left p-2 font-medium">User</th>
                    <th className="text-left p-2 font-medium">Email</th>
                    <th className="text-center p-2 font-medium">Active</th>
                    <th className="text-left p-2 font-medium">IA Role(s)</th>
                    <th className="text-left p-2 font-medium">Auditor Record</th>
                    <th className="text-left p-2 font-medium">Department Scope</th>
                    <th className="text-center p-2 font-medium">Capabilities</th>
                    <th className="text-center p-2 font-medium">Lead</th>
                    <th className="text-center p-2 font-medium">Reviewer</th>
                    <th className="text-center p-2 font-medium">Active</th>
                    <th className="text-left p-2 font-medium">SoD</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr
                      key={u.profile_id}
                      className="border-b last:border-0 hover:bg-muted/30 cursor-pointer"
                      onClick={() => setSelected(u)}
                    >
                      <td className="p-2 font-medium">{u.full_name}</td>
                      <td className="p-2 text-xs">{u.email}</td>
                      <td className="p-2 text-center">
                        <Badge variant={u.is_active ? 'default' : 'outline'}>{u.is_active ? 'Yes' : 'No'}</Badge>
                      </td>
                      <td className="p-2 text-xs">{(u.ia_roles || []).join(', ') || '—'}</td>
                      <td className="p-2 text-xs">
                        {u.auditor ? `${u.auditor.auditor_role || 'Auditor'} · ${u.auditor.employment_status || 'Active'}` : '—'}
                      </td>
                      <td className="p-2 text-xs">{(u.department_scope || []).join(', ') || '—'}</td>
                      <td className="p-2 text-center tabular-nums">{u.capabilities?.length || 0}</td>
                      <td className="p-2 text-center tabular-nums">{u.lead_assignments}</td>
                      <td className="p-2 text-center tabular-nums">{u.reviewer_assignments}</td>
                      <td className="p-2 text-center tabular-nums">{u.active_engagements}</td>
                      <td className="p-2">
                        {u.sod_conflicts?.length ? (
                          <Badge variant="destructive">{u.sod_conflicts.length}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">None</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!users.length && (
                    <tr><td colSpan={11} className="p-6 text-center text-muted-foreground">No users match this search.</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reconciliation" className="space-y-4 mt-4">
          {reconLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : !reconciliation?.success ? (
            <Alert variant="destructive"><AlertDescription>Permission reconciliation is not available to your role.</AlertDescription></Alert>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  { label: 'Capabilities', value: reconStats.total },
                  { label: 'Pass', value: reconStats.pass },
                  { label: 'Missing', value: reconStats.missing },
                  { label: 'Mismatched', value: reconStats.mismatched },
                  { label: 'Unused', value: reconStats.unused },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg border bg-card p-3">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
                    <p className="text-xl font-bold tabular-nums">{s.value}</p>
                  </div>
                ))}
              </div>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">UI capability → registry reconciliation</CardTitle></CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground bg-muted/40">
                        <th className="text-left p-2 font-medium">Capability</th>
                        <th className="text-left p-2 font-medium">Module</th>
                        <th className="text-left p-2 font-medium">Action</th>
                        <th className="text-left p-2 font-medium">Registry</th>
                        <th className="text-left p-2 font-medium">Roles Granted</th>
                        <th className="text-left p-2 font-medium">Final Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(reconciliation.rows || []).map((r, i) => (
                        <tr key={`${r.capability}-${r.module}-${r.action}-${i}`} className="border-b last:border-0">
                          <td className="p-2 font-mono text-xs">{r.capability}</td>
                          <td className="p-2 text-xs">{r.module}</td>
                          <td className="p-2 text-xs">{r.action}</td>
                          <td className="p-2 text-xs">{r.registry_status}</td>
                          <td className="p-2 text-xs">{(r.roles_granted || []).join(', ') || '—'}</td>
                          <td className="p-2">
                            <Badge variant={STATUS_VARIANT[r.final_status] || 'secondary'}>{r.final_status}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              {!!reconciliation.registry_only?.length && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Registered but not consumed by any IA screen</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-2">
                    {reconciliation.registry_only.map((r, i) => (
                      <Badge key={i} variant="outline">{r.module}:{r.action}</Badge>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      <StandardModal
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
        title={selected?.full_name || 'User'}
        size="lg"
      >
        {selected && (
          <div className="space-y-4 text-sm">
            <section>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Identity</p>
              <p>{selected.email}</p>
              <Badge variant={selected.is_active ? 'default' : 'outline'}>{selected.is_active ? 'Active' : 'Inactive'}</Badge>
            </section>

            <section>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Central role assignments</p>
              <div className="flex flex-wrap gap-1">
                {(selected.roles || []).map((r) => <Badge key={r} variant="secondary">{r}</Badge>)}
                {!selected.roles?.length && <span className="text-muted-foreground">None</span>}
              </div>
            </section>

            <section>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                Internal Audit capabilities inherited through roles
              </p>
              <div className="flex flex-wrap gap-1">
                {(selected.capabilities || []).map((c) => <Badge key={c} variant="outline" className="font-mono text-[10px]">{c}</Badge>)}
                {!selected.capabilities?.length && <span className="text-muted-foreground">None</span>}
              </div>
            </section>

            <section>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Audit context</p>
              <ul className="list-disc ml-5 text-sm">
                <li>Auditor record: {selected.auditor ? `${selected.auditor.auditor_role || 'Auditor'} (${selected.auditor.employment_status || 'Active'})` : 'Not registered as an auditor'}</li>
                <li>Lead assignments: {selected.lead_assignments}</li>
                <li>Reviewer assignments: {selected.reviewer_assignments}</li>
                <li>Active engagements: {selected.active_engagements}</li>
                <li>Department management scope: {(selected.department_scope || []).join(', ') || 'None'}</li>
              </ul>
            </section>

            <section>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Segregation of duties</p>
              {selected.sod_conflicts?.length ? (
                <ul className="list-disc ml-5">
                  {selected.sod_conflicts.map((c) => (
                    <li key={c}><strong>{c}</strong> — {SOD_CONFLICT_LABELS[c] || 'Potential conflict'}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">No potential conflicts detected.</p>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                These warnings are informational. Transaction-level segregation of duties remains enforced server-side.
              </p>
            </section>
          </div>
        )}
      </StandardModal>
    </div>
  );
}
