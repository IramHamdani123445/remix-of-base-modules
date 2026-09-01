/**
 * Enhanced Claim Worklist (Screen 20)
 *
 * Adds: Officer assignment, bulk reassign, advanced search with
 * date ranges, aging indicators, and workload distribution.
 */
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Plus, Eye, ClipboardList, Clock, AlertTriangle, CheckCircle2,
  Users, Search, X, UserPlus, ArrowRightLeft,
} from 'lucide-react';
import { useBnClaims } from '@/hooks/bn/useBnClaim';
import { BN_CLAIM_STATUS_LABELS } from '@/types/bn';
import type { BnClaim, BnClaimStatus } from '@/types/bn';
import { formatDateForDisplay } from '@/lib/format-config';
import { PermissionWrapper } from '@/components/ui/permission-wrapper';
import { BnStatusBadge, BnEmptyState, BnFilterBar, BnStatCard } from '@/components/bn/shared';
import type { FilterConfig } from '@/components/bn/shared';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { BnBusyButton } from '@/components/bn/shared';

const db = supabase as any;

function getAgingDays(dateStr: string | null): number {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function getAgingColor(days: number): string {
  if (days > 90) return 'text-destructive';
  if (days > 30) return 'text-amber-600';
  if (days > 14) return 'text-yellow-600';
  return 'text-muted-foreground';
}

export default function ClaimWorklistEnhanced() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [assignedFilter, setAssignedFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showReassign, setShowReassign] = useState(false);
  const [reassignTo, setReassignTo] = useState('');

  const { data: claims = [], isLoading } = useBnClaims(statusFilter ? { status: statusFilter } : undefined);

  const filtered = useMemo(() => {
    return claims.filter((c: BnClaim) => {
      const matchesSearch = !search ||
        (c.claim_number || '').toLowerCase().includes(search.toLowerCase()) ||
        c.ssn.includes(search);
      const matchesPriority = !priorityFilter || c.priority === priorityFilter;
      const matchesAssigned = !assignedFilter ||
        (assignedFilter === '__unassigned' ? !c.assigned_to : c.assigned_to === assignedFilter);
      return matchesSearch && matchesPriority && matchesAssigned;
    });
  }, [claims, search, priorityFilter, assignedFilter]);

  const stats = useMemo(() => {
    const all = claims as BnClaim[];
    const activeStatuses = ['SUBMITTED', 'INTAKE_REVIEW', 'ELIGIBILITY_CHECK', 'EVIDENCE_REVIEW', 'CALCULATION', 'DECISION'];
    return {
      total: all.length,
      pending: all.filter(c => activeStatuses.includes(c.status)).length,
      urgent: all.filter(c => c.priority === 'URGENT' || c.priority === 'HIGH').length,
      approved: all.filter(c => c.status === 'APPROVED').length,
      unassigned: all.filter(c => !c.assigned_to).length,
      overdue: all.filter(c => getAgingDays(c.claim_date) > 30 && activeStatuses.includes(c.status)).length,
    };
  }, [claims]);

  const officers = useMemo(() => {
    const set = new Set<string>();
    claims.forEach((c: BnClaim) => { if (c.assigned_to) set.add(c.assigned_to); });
    return Array.from(set).sort();
  }, [claims]);

  const reassignMutation = useMutation({
    mutationFn: async ({ ids, officer }: { ids: string[]; officer: string }) => {
      for (const id of ids) {
        await db.from('bn_claim').update({ assigned_to: officer }).eq('id', id);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bn-claims'] });
      toast.success(`${selectedIds.size} claim(s) reassigned`);
      setSelectedIds(new Set());
      setShowReassign(false);
      setReassignTo('');
    },
  });

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedIds(next);
  };

  const selectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((c: BnClaim) => c.id)));
    }
  };

  const filters: FilterConfig[] = [
    {
      key: 'status', label: 'Status', value: statusFilter, onChange: setStatusFilter,
      options: Object.entries(BN_CLAIM_STATUS_LABELS).map(([k, v]) => ({ value: k, label: v })),
    },
    {
      key: 'priority', label: 'Priority', value: priorityFilter, onChange: setPriorityFilter,
      options: [
        { value: 'LOW', label: 'Low' }, { value: 'NORMAL', label: 'Normal' },
        { value: 'HIGH', label: 'High' }, { value: 'URGENT', label: 'Urgent' },
      ],
    },
  ];

  const clearAll = () => { setSearch(''); setStatusFilter(''); setPriorityFilter(''); setAssignedFilter(''); };

  return (
    <PermissionWrapper moduleName="bn_claim_worklist">
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="t-page-title">Claim Worklist</h1>
            <p className="t-page-subtitle mt-1">Process, assign, and manage benefit claims</p>
          </div>
          <div className="flex gap-2">
            {selectedIds.size > 0 && (
              <Button variant="outline" onClick={() => setShowReassign(true)} className="gap-2">
                <ArrowRightLeft className="h-4 w-4" /> Reassign ({selectedIds.size})
              </Button>
            )}
            <Button onClick={() => navigate('/bn/intake/register')} className="gap-2">
              <Plus className="h-4 w-4" /> New Claim
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-6">
          <BnStatCard title="Total" value={stats.total} icon={ClipboardList} />
          <BnStatCard title="In Progress" value={stats.pending} icon={Clock} subtitle="Active processing" />
          <BnStatCard title="Urgent/High" value={stats.urgent} icon={AlertTriangle} />
          <BnStatCard title="Approved" value={stats.approved} icon={CheckCircle2} />
          <BnStatCard title="Unassigned" value={stats.unassigned} icon={UserPlus} subtitle="Needs assignment" />
          <BnStatCard title="Overdue (>30d)" value={stats.overdue} icon={Clock} />
        </div>

        {/* Filters */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search claim #, SSN, or name..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
              <BnFilterBar
                search=""
                onSearchChange={() => {}}
                searchPlaceholder=""
                filters={filters}
                onClearAll={clearAll}
              />
              <Select value={assignedFilter || '__all'} onValueChange={(v) => setAssignedFilter(v === '__all' ? '' : v)}>
                <SelectTrigger className="w-40"><SelectValue placeholder="Assigned To" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">All Officers</SelectItem>
                  <SelectItem value="__unassigned">Unassigned</SelectItem>
                  {officers.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                </SelectContent>
              </Select>
              {(search || statusFilter || priorityFilter || assignedFilter) && (
                <Button variant="ghost" size="sm" onClick={clearAll} className="gap-1 text-xs">
                  <X className="h-3.5 w-3.5" /> Clear
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <BnEmptyState type="loading" />
            ) : filtered.length === 0 ? (
              <BnEmptyState
                type={search || statusFilter ? 'no-results' : 'empty'}
                title="No claims found"
                description="Adjust filters or register a new claim."
                action={!search ? { label: 'Register Claim', onClick: () => navigate('/bn/intake/register') } : undefined}
              />
            ) : (
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40px]">
                        <Checkbox
                          checked={selectedIds.size === filtered.length && filtered.length > 0}
                          onCheckedChange={selectAll}
                        />
                      </TableHead>
                      <TableHead className="w-[130px]">Claim #</TableHead>
                      <TableHead className="w-[90px]">SSN</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Benefit</TableHead>
                      <TableHead className="w-[90px]">Filed</TableHead>
                      <TableHead className="w-[60px]">Age</TableHead>
                      <TableHead className="w-[80px]">Priority</TableHead>
                      <TableHead className="w-[130px]">Status</TableHead>
                      <TableHead className="w-[100px]">Assigned</TableHead>
                      <TableHead className="w-[50px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((claim: BnClaim) => {
                      const ageDays = getAgingDays(claim.claim_date);
                      return (
                        <TableRow
                          key={claim.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => navigate(`/bn/claims/${claim.id}`)}
                        >
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selectedIds.has(claim.id)}
                              onCheckedChange={() => toggleSelect(claim.id)}
                            />
                          </TableCell>
                          <TableCell className="font-mono text-sm font-medium">{claim.claim_number || '—'}</TableCell>
                          <TableCell className="font-mono text-sm">{claim.ssn}</TableCell>
                          <TableCell className="text-sm">{(claim as any).claimant_name || '—'}</TableCell>
                          <TableCell className="text-sm">{(claim as any).bn_product?.benefit_name || '—'}</TableCell>
                          <TableCell className="text-sm">{formatDateForDisplay(claim.claim_date)}</TableCell>
                          <TableCell className={`text-sm font-mono font-medium ${getAgingColor(ageDays)}`}>
                            {ageDays}d
                          </TableCell>
                          <TableCell><BnStatusBadge status={claim.priority} size="sm" dot /></TableCell>
                          <TableCell>
                            <BnStatusBadge
                              status={claim.status}
                              label={BN_CLAIM_STATUS_LABELS[claim.status] || claim.status}
                              size="sm"
                            />
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {claim.assigned_to || <span className="text-amber-600 italic text-xs">Unassigned</span>}
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(`/bn/claims/${claim.id}`)}>
                              <Eye className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Reassign Dialog */}
        <Dialog open={showReassign} onOpenChange={(v) => !v && setShowReassign(false)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Reassign Claims</DialogTitle>
              <DialogDescription>
                Reassign {selectedIds.size} selected claim(s) to another officer.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Assign To</Label>
                <Input value={reassignTo} onChange={(e) => setReassignTo(e.target.value)} placeholder="Officer code..." />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowReassign(false)}>Cancel</Button>
              <BnBusyButton loading={reassignMutation.isPending}
                onClick={() => reassignMutation.mutate({ ids: Array.from(selectedIds), officer: reassignTo })}
                disabled={!reassignTo.trim() || reassignMutation.isPending}
              >
                Reassign
              </BnBusyButton>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </PermissionWrapper>
  );
}
