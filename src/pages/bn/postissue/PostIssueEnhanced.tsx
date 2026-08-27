/**
 * Enhanced Post-Issue Review (Screen 18)
 *
 * Adds: Bank reconciliation panel, stale cheque detection,
 * batch completion gate, and bulk execution controls.
 */
import React, { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  ListChecks, Clock, Loader2, CheckCircle2, XCircle, SkipForward,
  Pause, Zap, AlertTriangle, Landmark, Timer, ShieldCheck,
} from 'lucide-react';
import {
  useBnPostIssueTasks, useBnPostIssueSummary,
  useExecutePostIssueAction, useExecuteAllPendingTasks,
} from '@/hooks/bn/useBnPostIssue';
import { PostIssueTaskList } from '@/components/bn/postissue/PostIssueTaskList';
import { PostIssueTaskDrawer } from '@/components/bn/postissue/PostIssueTaskDrawer';
import { PostIssueFiltersBar } from '@/components/bn/postissue/PostIssueFiltersBar';
import type { PostIssueFilters } from '@/services/bn/postIssueService';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

import { formatDate, formatNumber } from '@/lib/culture/culture';
import { useActorUserCode } from '@/hooks/bn/useActorUserCode';
const db = supabase as any;

const STAT_CARDS = [
  { key: 'total', label: 'Total', icon: ListChecks, color: 'text-foreground' },
  { key: 'pending', label: 'Pending', icon: Clock, color: 'text-amber-600' },
  { key: 'completed', label: 'Completed', icon: CheckCircle2, color: 'text-green-600' },
  { key: 'failed', label: 'Failed', icon: XCircle, color: 'text-destructive' },
  { key: 'skipped', label: 'Skipped', icon: SkipForward, color: 'text-muted-foreground' },
  { key: 'deferred', label: 'Deferred', icon: Pause, color: 'text-violet-600' },
];

// ─── Stale Cheque Detection ──────────────────────────────────────────

function useStaleChequeScan(batchId?: string) {
  return useQuery({
    queryKey: ['bn', 'stale-cheques', batchId],
    queryFn: async () => {
      const staleDays = 180;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - staleDays);

      let query = db.from('bn_issue_record')
        .select('id, ssn, claim_number, cheque_number, amount, issued_at, status')
        .eq('status', 'ISSUED')
        .lt('issued_at', cutoff.toISOString())
        .order('issued_at', { ascending: true });

      if (batchId) query = query.eq('batch_id', batchId);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: true,
  });
}

function useBatchCompletionGate(batchId?: string) {
  return useQuery({
    queryKey: ['bn', 'batch-completion-gate', batchId],
    queryFn: async () => {
      if (!batchId) return null;
      const { data: tasks } = await db.from('bn_post_issue_task')
        .select('status, is_required')
        .eq('batch_id', batchId);

      const all = tasks || [];
      const required = all.filter((t: any) => t.is_required);
      const requiredDone = required.filter((t: any) => ['COMPLETED', 'SKIPPED'].includes(t.status));
      const allDone = all.every((t: any) => ['COMPLETED', 'SKIPPED', 'CANCELLED'].includes(t.status));

      return {
        totalTasks: all.length,
        requiredTotal: required.length,
        requiredCompleted: requiredDone.length,
        allTasksComplete: allDone,
        allRequiredComplete: requiredDone.length === required.length,
        canFinalizeBatch: requiredDone.length === required.length,
      };
    },
    enabled: !!batchId,
  });
}

function useMarkStaleDated() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (issueIds: string[]) => {
      for (const id of issueIds) {
        await db.from('bn_issue_record').update({
          status: 'STALE_DATED',
        }).eq('id', id).eq('status', 'ISSUED');
      }
      return issueIds.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ['bn', 'stale-cheques'] });
      qc.invalidateQueries({ queryKey: ['bn', 'issue-records'] });
      toast.success(`${count} cheque(s) marked as stale-dated`);
    },
  });
}

export default function PostIssueEnhanced() {
  // Writes must name a person, never the 'CURRENT_USER' placeholder.
  const { actor } = useActorUserCode();

  const [filters, setFilters] = useState<PostIssueFilters>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('tasks');

  const { data: tasks = [], isLoading } = useBnPostIssueTasks(filters);
  const { data: summary } = useBnPostIssueSummary(filters.batch_id);
  const actionMutation = useExecutePostIssueAction();
  const bulkMutation = useExecuteAllPendingTasks();
  const { data: staleCheques = [] } = useStaleChequeScan(filters.batch_id);
  const { data: completionGate } = useBatchCompletionGate(filters.batch_id);
  const staleMutation = useMarkStaleDated();

  const handleAction = async (params: any) => {
    try {
      await actionMutation.mutateAsync(params);
      toast.success(`Task action "${params.action}" completed`);
    } catch (err: any) {
      toast.error(err.message || 'Action failed');
    }
  };

  const handleBulkExecute = async () => {
    if (!filters.batch_id) {
      toast.error('Select a batch first');
      return;
    }
    try {
      const result = await bulkMutation.mutateAsync({
        batchId: filters.batch_id,
        userCode: actor(),
      });
      toast.success(`Completed: ${result.completed}, Failed: ${result.failed}`);
    } catch (err: any) {
      toast.error(err.message || 'Bulk execution failed');
    }
  };

  const pendingCount = tasks.filter(t => t.status === 'PENDING').length;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10">
            <ListChecks className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="t-page-title">Post-Issue Review</h1>
            <p className="t-page-subtitle mt-1">
              Complete claim-side updates, stale cheque detection, and batch finalization
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {pendingCount > 0 && filters.batch_id && (
            <Button onClick={handleBulkExecute} disabled={bulkMutation.isPending} className="gap-2">
              {bulkMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              Execute All Pending ({pendingCount})
            </Button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {STAT_CARDS.map(({ key, label, icon: Icon, color }) => (
          <Card key={key}>
            <CardContent className="p-3 text-center">
              <Icon className={`h-5 w-5 mx-auto mb-1 ${color}`} />
              <div className="text-lg font-bold">{summary?.[key as keyof typeof summary] ?? 0}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Completion Gate */}
      {completionGate && (
        <Card className={completionGate.canFinalizeBatch ? 'border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/10' : ''}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className={`h-5 w-5 ${completionGate.canFinalizeBatch ? 'text-emerald-600' : 'text-amber-600'}`} />
                <span className="text-sm font-medium">Batch Completion Gate</span>
                {completionGate.canFinalizeBatch && (
                  <Badge variant="outline" className="text-emerald-600 border-emerald-300 text-[10px]">
                    ✓ Ready to Finalize
                  </Badge>
                )}
              </div>
              <span className="text-sm font-mono">
                {completionGate.requiredCompleted}/{completionGate.requiredTotal} required
              </span>
            </div>
            <Progress
              value={completionGate.requiredTotal > 0
                ? (completionGate.requiredCompleted / completionGate.requiredTotal) * 100
                : 0}
              className="h-2"
            />
            {!completionGate.allRequiredComplete && (
              <p className="text-xs text-amber-600 mt-2">
                <AlertTriangle className="h-3 w-3 inline mr-1" />
                {completionGate.requiredTotal - completionGate.requiredCompleted} required task(s) still pending
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Overall Progress */}
      {summary && summary.total > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">
                Overall Completion
                {summary.allRequiredDone && (
                  <span className="ml-2 text-xs text-emerald-600 font-semibold">✓ All required tasks complete</span>
                )}
              </span>
              <span className="text-sm font-mono">{summary.completionPct}%</span>
            </div>
            <Progress value={summary.completionPct} className="h-2" />
          </CardContent>
        </Card>
      )}

      {/* Tabbed Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="tasks" className="gap-1.5">
            <ListChecks className="h-3.5 w-3.5" /> Tasks
            {tasks.length > 0 && <span className="text-xs bg-primary/10 text-primary rounded-full px-1.5">{tasks.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="stale" className="gap-1.5">
            <Timer className="h-3.5 w-3.5" /> Stale Cheques
            {staleCheques.length > 0 && <span className="text-xs bg-amber-500/15 text-amber-700 rounded-full px-1.5">{staleCheques.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="reconciliation" className="gap-1.5">
            <Landmark className="h-3.5 w-3.5" /> Reconciliation
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="space-y-4">
          <PostIssueFiltersBar filters={filters} onChange={setFilters} />
          <PostIssueTaskList
            tasks={tasks}
            isLoading={isLoading}
            onSelect={(t) => setSelectedId(t.id)}
          />
        </TabsContent>

        <TabsContent value="stale" className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold">Stale-Dated Cheque Detection</h3>
                  <p className="text-xs text-muted-foreground">Cheques issued more than 180 days ago that remain uncashed</p>
                </div>
                {staleCheques.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => staleMutation.mutate(staleCheques.map((c: any) => c.id))}
                    disabled={staleMutation.isPending}
                    className="gap-1.5"
                  >
                    {staleMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    <Timer className="h-3.5 w-3.5" /> Mark All Stale ({staleCheques.length})
                  </Button>
                )}
              </div>

              {staleCheques.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  <Timer className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  No stale-dated cheques detected
                </div>
              ) : (
                <div className="space-y-2">
                  {staleCheques.map((c: any) => (
                    <div key={c.id} className="flex items-center justify-between rounded border p-3">
                      <div className="flex items-center gap-4">
                        <div>
                          <p className="font-mono text-sm font-medium">{c.cheque_number || '—'}</p>
                          <p className="text-xs text-muted-foreground">SSN: {c.ssn}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Claim: {c.claim_number || '—'}</p>
                          <p className="text-xs text-muted-foreground">
                            Issued: {c.issued_at ? formatDate(new Date(c.issued_at)) : '—'}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-mono font-medium">
                          {formatNumber(c.amount ?? 0, 2)}
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => staleMutation.mutate([c.id])}
                          disabled={staleMutation.isPending}
                          className="text-xs"
                        >
                          Mark Stale
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reconciliation" className="space-y-4">
          <Card>
            <CardContent className="p-8 text-center">
              <Landmark className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-30" />
              <h3 className="text-lg font-medium mb-1">Bank Reconciliation</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Bank statement import and automated reconciliation against issued cheques
                will be available when integrated with the banking adapter.
              </p>
              <div className="mt-4 grid grid-cols-3 gap-3 max-w-sm mx-auto">
                <div className="rounded border p-2 text-center">
                  <p className="text-[10px] text-muted-foreground">Matched</p>
                  <p className="text-lg font-bold text-green-600">—</p>
                </div>
                <div className="rounded border p-2 text-center">
                  <p className="text-[10px] text-muted-foreground">Unmatched</p>
                  <p className="text-lg font-bold text-amber-600">—</p>
                </div>
                <div className="rounded border p-2 text-center">
                  <p className="text-[10px] text-muted-foreground">Exceptions</p>
                  <p className="text-lg font-bold text-destructive">—</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Detail Drawer */}
      <PostIssueTaskDrawer
        taskId={selectedId}
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        onAction={handleAction}
        isActing={actionMutation.isPending}
      />
    </div>
  );
}
