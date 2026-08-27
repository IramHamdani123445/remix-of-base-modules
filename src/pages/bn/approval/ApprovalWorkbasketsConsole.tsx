/**
 * Approval Workbaskets Console — Phase 3
 *
 * Live, per-workbasket view of pending claim approvals across the
 * department lifecycle (Intake → Closed). Reads directly from the
 * governance foundation seeded in Phase 1:
 *
 *  • `bn_workbasket`         — 14 seeded department queues
 *  • `bn_claim_queue_assignment` — open assignments (is_active = true)
 *  • `bn_claim`              — claim header + status/amount/priority
 *  • `bn_product`            — for product / category filters
 *
 * Filters: workbasket, role, product, priority, SLA bucket, min amount.
 * No hardcoded role/status checks — everything is data driven.
 *
 * Route: /bn/approval/workbaskets
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Loader2, Inbox, AlertTriangle, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface Workbasket {
  id: string;
  basket_code: string;
  basket_name: string;
  assigned_role: string;
  is_active: boolean;
}

interface Assignment {
  id: string;
  claim_id: string;
  workbasket_id: string;
  priority: number;
  assigned_at: string;
  due_at: string | null;
  assigned_to: string | null;
  bn_claim?: {
    id: string;
    claim_number?: string | null;
    status?: string | null;
    total_amount?: number | null;
    bn_product?: { benefit_code?: string; benefit_name?: string; category?: string } | null;
  } | null;
}

function priorityLabel(p: number): { label: string; tone: 'default' | 'secondary' | 'destructive' } {
  if (p <= 2) return { label: 'Urgent', tone: 'destructive' };
  if (p <= 4) return { label: 'High', tone: 'secondary' };
  return { label: 'Normal', tone: 'default' };
}

function slaBucket(dueAt: string | null): { label: string; overdue: boolean } {
  if (!dueAt) return { label: 'No SLA', overdue: false };
  const ms = new Date(dueAt).getTime() - Date.now();
  if (ms < 0) return { label: `Overdue ${Math.ceil(-ms / 86400000)}d`, overdue: true };
  const days = Math.ceil(ms / 86400000);
  return { label: `Due in ${days}d`, overdue: false };
}

async function fetchWorkbaskets(): Promise<Workbasket[]> {
  const { data, error } = await (supabase as any)
    .from('bn_workbasket')
    .select('id, basket_code, basket_name, assigned_role, is_active')
    .eq('is_active', true)
    .order('basket_code');
  if (error) throw error;
  return data ?? [];
}

async function fetchAssignments(): Promise<Assignment[]> {
  const { data, error } = await (supabase as any)
    .from('bn_claim_queue_assignment')
    .select(
      `id, claim_id, workbasket_id, priority, assigned_at, due_at, assigned_to,
       bn_claim:claim_id (
         id, claim_number, status, total_amount,
         bn_product:product_id ( benefit_code, benefit_name, category )
       )`
    )
    .eq('is_active', true)
    .is('completed_at', null)
    .order('priority')
    .order('assigned_at')
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as Assignment[];
}

export default function ApprovalWorkbasketsConsole() {
  const [workbasketId, setWorkbasketId] = useState<string>('ALL');
  const [role, setRole] = useState<string>('ALL');
  const [category, setCategory] = useState<string>('ALL');
  const [priorityMax, setPriorityMax] = useState<string>('10');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [minAmount, setMinAmount] = useState('');

  const { data: workbaskets = [], isLoading: wbLoading } = useQuery({
    queryKey: ['bn', 'workbaskets-active'],
    queryFn: fetchWorkbaskets,
    staleTime: 60_000,
  });

  const { data: assignments = [], isLoading: asgLoading } = useQuery({
    queryKey: ['bn', 'approval-workbasket-assignments'],
    queryFn: fetchAssignments,
    refetchInterval: 30_000,
  });

  const roleOptions = useMemo(
    () => Array.from(new Set(workbaskets.map((w) => w.assigned_role).filter(Boolean))).sort(),
    [workbaskets],
  );
  const categoryOptions = useMemo(
    () => Array.from(new Set(
      assignments.map((a) => a.bn_claim?.bn_product?.category).filter(Boolean) as string[]
    )).sort(),
    [assignments],
  );

  const filteredWorkbaskets = useMemo(
    () => workbaskets.filter((w) => (
      (role === 'ALL' || w.assigned_role === role)
      && (workbasketId === 'ALL' || w.id === workbasketId)
    )),
    [workbaskets, role, workbasketId],
  );

  const minAmt = minAmount ? Number(minAmount) : 0;
  const pMax = Number(priorityMax) || 10;

  const grouped = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    for (const w of filteredWorkbaskets) map.set(w.id, []);
    for (const a of assignments) {
      if (!map.has(a.workbasket_id)) continue;
      if (workbasketId !== 'ALL' && a.workbasket_id !== workbasketId) continue;
      if (a.priority > pMax) continue;
      const sla = slaBucket(a.due_at);
      if (overdueOnly && !sla.overdue) continue;
      const cat = a.bn_claim?.bn_product?.category ?? null;
      if (category !== 'ALL' && cat !== category) continue;
      const amt = Number(a.bn_claim?.total_amount ?? 0);
      if (minAmt > 0 && amt < minAmt) continue;
      map.get(a.workbasket_id)!.push(a);
    }
    return map;
  }, [filteredWorkbaskets, assignments, workbasketId, pMax, overdueOnly, category, minAmt]);

  const totalPending = useMemo(
    () => Array.from(grouped.values()).reduce((n, list) => n + list.length, 0),
    [grouped],
  );

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="t-page-title">Approval Console — Workbaskets</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pending department approvals grouped by workbasket. Updates every 30s.
          </p>
        </div>
        <Badge variant="outline" className="text-sm">
          {asgLoading ? '…' : `${totalPending} pending across ${filteredWorkbaskets.length} basket(s)`}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Workbasket</label>
              <Select value={workbasketId} onValueChange={setWorkbasketId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All workbaskets</SelectItem>
                  {workbaskets.map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.basket_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Role</label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All roles</SelectItem>
                  {roleOptions.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Product category</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All categories</SelectItem>
                  {categoryOptions.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Max priority (1=urgent)</label>
              <Input
                type="number" min={1} max={10} value={priorityMax}
                onChange={(e) => setPriorityMax(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Min amount</label>
              <Input
                type="number" min={0} value={minAmount} placeholder="0"
                onChange={(e) => setMinAmount(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button
                variant={overdueOnly ? 'default' : 'outline'}
                onClick={() => setOverdueOnly((v) => !v)}
                className="w-full"
              >
                <AlertTriangle className="mr-2 h-4 w-4" />
                {overdueOnly ? 'Showing overdue' : 'Overdue only'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {(wbLoading || asgLoading) && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading queues…
        </div>
      )}

      {!wbLoading && !asgLoading && filteredWorkbaskets.map((wb) => {
        const items = grouped.get(wb.id) ?? [];
        return (
          <Card key={wb.id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Inbox className="h-4 w-4" />
                  {wb.basket_name}
                  <Badge variant="outline" className="font-mono text-xs">{wb.basket_code}</Badge>
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Assigned role: <span className="font-medium">{wb.assigned_role}</span>
                </p>
              </div>
              <Badge variant={items.length === 0 ? 'outline' : 'default'}>
                {items.length} pending
              </Badge>
            </CardHeader>
            <CardContent>
              {items.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No pending items.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Claim #</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>SLA</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Assigned to</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((a) => {
                      const c = a.bn_claim;
                      const p = priorityLabel(a.priority);
                      const sla = slaBucket(a.due_at);
                      return (
                        <TableRow key={a.id}>
                          <TableCell className="font-mono text-xs">
                            {c?.claim_number ?? a.claim_id.slice(0, 8)}
                          </TableCell>
                          <TableCell>
                            {c?.bn_product?.benefit_name ?? '—'}
                            {c?.bn_product?.category && (
                              <Badge variant="outline" className="ml-2 text-[10px]">
                                {c.bn_product.category}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell><Badge variant="secondary">{c?.status ?? '—'}</Badge></TableCell>
                          <TableCell><Badge variant={p.tone}>{p.label}</Badge></TableCell>
                          <TableCell>
                            <span className={sla.overdue ? 'text-destructive font-medium' : ''}>
                              {sla.label}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {c?.total_amount != null ? Number(c.total_amount).toLocaleString() : '—'}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {a.assigned_to ?? 'Unassigned'}
                          </TableCell>
                          <TableCell>
                            <Button asChild variant="ghost" size="icon">
                              <Link to={`/bn/claims/${a.claim_id}`} title="Open claim">
                                <ExternalLink className="h-4 w-4" />
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
