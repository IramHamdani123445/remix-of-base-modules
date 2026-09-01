import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Scale, Search, AlertTriangle, RefreshCw, Loader2, Gavel, Building2, FileText,
  ShieldAlert, ChevronLeft, ChevronRight, X, Eye,
} from 'lucide-react';
import { formatCurrency } from '@/utils/formatCurrency';
import { formatDisplayDate } from '@/lib/dateFormat';
import { legalEscalationService } from '@/services/legalEscalationService';
import { useAuditFields } from '@/hooks/useAuditTrail';
import RecommendationReviewDialog from '@/components/compliance/legal/RecommendationReviewDialog';
import {
  useLegalRecommendationRegister,
  formatWaiting,
  ATTENTION_REASON_LABELS,
  RECOMMENDATION_TABS,
  RECOMMENDATION_SORTS,
  RECOMMENDATION_PAGE_SIZES,
  RECOMMENDATION_AMOUNT_BANDS,
  RECOMMENDATION_DATE_WINDOWS,
  type RecommendationRow,
} from '@/hooks/compliance/useLegalRecommendationRegister';

/**
 * Compliance → Legal Recommendation Queue.
 *
 * Enterprise review and approval workspace: management decides whether an
 * employer should be escalated to Legal. Approval is executed by the governed
 * RPC, which mints exactly one referral — so this screen never offers a
 * separate "create referral" action; approved rows link straight to Legal Pack
 * Preparation instead.
 */

const TONE: Record<string, string> = {
  danger: 'bg-destructive/10 text-destructive border-destructive/30',
  warning: 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400',
  success: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400',
  info: 'bg-primary/10 text-primary border-primary/30',
  muted: 'bg-muted text-muted-foreground border-border',
};

function ToneBadge({ tone, children }: { tone?: string | null; children: React.ReactNode }) {
  return <Badge variant="outline" className={TONE[tone || 'muted']}>{children}</Badge>;
}

function Kpi({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: string }) {
  return (
    <Card className="p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold ${tone === 'danger' ? 'text-destructive' : ''}`}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
    </Card>
  );
}

const LegalRecommendationQueue = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { userCode } = useAuditFields();
  const { filters, setFilters, resetFilters, data, isLoading, isFetching, error, refetch } =
    useLegalRecommendationRegister();
  const [searchDraft, setSearchDraft] = useState(filters.search);
  const [openId, setOpenId] = useState<string | null>(null);

  const kpis = data?.kpis;
  const actor = data?.actor;
  const facets = data?.facets;
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / filters.page_size));

  const generateMut = useMutation({
    mutationFn: () => legalEscalationService.generateRecommendations(userCode || 'SYSTEM'),
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['ce-legal-recommendations'] });
      if (count === 0) {
        toast.info('No new recommendations generated', {
          description: 'No employers currently meet the configured legal escalation thresholds.',
        });
      } else {
        toast.success(`${count} recommendation${count !== 1 ? 's' : ''} generated from compliance data`);
      }
    },
    onError: (err: any) =>
      toast.error('Failed to generate recommendations', { description: err?.message || 'Unknown error' }),
  });

  const applySort = (key: string) => {
    if (filters.sort === key) setFilters({ dir: filters.dir === 'asc' ? 'desc' : 'asc' });
    else setFilters({ sort: key, dir: 'desc' });
  };

  const activeFilterCount = [
    filters.search, filters.status, filters.risk, filters.zone, filters.source,
    filters.legal_state, filters.rule, filters.amount_band, filters.date_window,
  ].filter(Boolean).length;

  if (error) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertDescription>{(error as Error).message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Scale className="h-6 w-6" /> Legal Escalation Review
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Management review of employers recommended for legal escalation. Approval creates the legal referral and hands it to pack preparation.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
            </Button>
            {actor?.can_generate && (
              <Button onClick={() => generateMut.mutate()} disabled={generateMut.isPending}>
                {generateMut.isPending
                  ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  : <RefreshCw className="h-4 w-4 mr-2" />}
                Detect new recommendations
              </Button>
            )}
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Kpi label="Pending review" value={kpis?.pending ?? '—'} hint={`${data?.thresholds?.review_sla_days ?? 3}-day review SLA`} />
          <Kpi label="Review overdue" value={kpis?.overdue ?? '—'} tone={(kpis?.overdue ?? 0) > 0 ? 'danger' : undefined} />
          <Kpi label="High / critical pending" value={kpis?.high_risk_pending ?? '—'} />
          <Kpi label="Pending exposure" value={kpis ? formatCurrency(Number(kpis.pending_exposure || 0)) : '—'} hint={`${kpis?.employers ?? 0} employers`} />
          <Kpi label="Approved / referred" value={`${kpis?.approved ?? 0} / ${kpis?.referred ?? 0}`} hint={`${kpis?.rejected ?? 0} rejected`} />
          <Kpi label="Oldest pending" value={formatWaiting(kpis?.oldest_pending_hours)} hint={`${kpis?.qualifying_cases ?? 0} qualifying cases`} />
        </div>

        {/* Requires attention */}
        {(data?.attention?.length ?? 0) > 0 && (
          <Card className="p-3 border-amber-500/40">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <span className="text-sm font-semibold">Requires attention</span>
              <Badge variant="secondary">{data!.attention.length}</Badge>
            </div>
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {data!.attention.map((a, i) => (
                <button
                  key={`${a.recommendation_id}-${i}`}
                  onClick={() => setOpenId(a.recommendation_id)}
                  className="text-left rounded-md border p-2 hover:bg-accent transition-colors"
                >
                  <div className="text-sm font-medium truncate">{a.employer_name || 'Employer'}</div>
                  <div className="text-xs text-muted-foreground">
                    {ATTENTION_REASON_LABELS[a.reason] || a.reason} · {formatCurrency(Number(a.amount || 0))}
                  </div>
                </button>
              ))}
            </div>
          </Card>
        )}

        {/* Tabs */}
        <Tabs value={filters.tab} onValueChange={(v) => setFilters({ tab: v })}>
          <TabsList className="flex-wrap h-auto">
            {RECOMMENDATION_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="gap-1">
                {t.label}
                <Badge variant="secondary" className="ml-1">{data?.tab_counts?.[t.value] ?? 0}</Badge>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* Toolbar */}
        <Card className="p-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            <form
              className="relative flex-1 min-w-[220px]"
              onSubmit={(e) => { e.preventDefault(); setFilters({ search: searchDraft }); }}
            >
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search employer, registration no., case, referral or rule…"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                onBlur={() => setFilters({ search: searchDraft })}
              />
            </form>

            <Select value={filters.status || 'ALL'} onValueChange={(v) => setFilters({ status: v === 'ALL' ? '' : v })}>
              <SelectTrigger className="w-[190px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                {(facets?.statuses ?? []).map((s) => <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.risk || 'ALL'} onValueChange={(v) => setFilters({ risk: v === 'ALL' ? '' : v })}>
              <SelectTrigger className="w-[150px]"><SelectValue placeholder="Risk" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All risk bands</SelectItem>
                {(facets?.risks ?? []).map((s) => <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.zone || 'ALL'} onValueChange={(v) => setFilters({ zone: v === 'ALL' ? '' : v })}>
              <SelectTrigger className="w-[150px]"><SelectValue placeholder="Zone" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All zones</SelectItem>
                {(facets?.zones ?? []).map((z) => <SelectItem key={z} value={z}>{z}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.source || 'ALL'} onValueChange={(v) => setFilters({ source: v === 'ALL' ? '' : v })}>
              <SelectTrigger className="w-[190px]"><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All sources</SelectItem>
                {(facets?.sources ?? []).map((s) => <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.legal_state || 'ALL'} onValueChange={(v) => setFilters({ legal_state: v === 'ALL' ? '' : v })}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="Referral progress" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Any referral progress</SelectItem>
                {(facets?.legal_states ?? []).map((s) => <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.rule || 'ALL'} onValueChange={(v) => setFilters({ rule: v === 'ALL' ? '' : v })}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="Escalation rule" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All rules</SelectItem>
                {(facets?.rules ?? []).map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.amount_band || 'ALL'} onValueChange={(v) => setFilters({ amount_band: v === 'ALL' ? '' : v })}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Exposure" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Any exposure</SelectItem>
                {RECOMMENDATION_AMOUNT_BANDS.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.date_window || 'ALL'} onValueChange={(v) => setFilters({ date_window: v === 'ALL' ? '' : v })}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Recommended" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Any date</SelectItem>
                {RECOMMENDATION_DATE_WINDOWS.map((w) => <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>)}
              </SelectContent>
            </Select>

            {filters.amount_band === 'CUSTOM' && (
              <>
                <Input className="w-28" placeholder="Min" value={filters.amount_min} onChange={(e) => setFilters({ amount_min: e.target.value })} />
                <Input className="w-28" placeholder="Max" value={filters.amount_max} onChange={(e) => setFilters({ amount_max: e.target.value })} />
              </>
            )}
            {filters.date_window === 'CUSTOM' && (
              <>
                <Input type="date" className="w-40" value={filters.date_from} onChange={(e) => setFilters({ date_from: e.target.value })} />
                <Input type="date" className="w-40" value={filters.date_to} onChange={(e) => setFilters({ date_to: e.target.value })} />
              </>
            )}

            <Select value={filters.sort} onValueChange={(v) => setFilters({ sort: v })}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RECOMMENDATION_SORTS.map((s) => <SelectItem key={s.value} value={s.value}>Sort: {s.label}</SelectItem>)}
              </SelectContent>
            </Select>

            {activeFilterCount > 0 && (
              <Button variant="ghost" onClick={() => { resetFilters(); setSearchDraft(''); }}>
                <X className="h-4 w-4 mr-1" /> Clear ({activeFilterCount})
              </Button>
            )}
          </div>
        </Card>

        {/* Register */}
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="cursor-pointer" onClick={() => applySort('employer')}>Employer</TableHead>
                  <TableHead className="cursor-pointer" onClick={() => applySort('zone')}>Zone</TableHead>
                  <TableHead className="cursor-pointer" onClick={() => applySort('risk')}>Risk</TableHead>
                  <TableHead>Why escalate</TableHead>
                  <TableHead className="text-right cursor-pointer" onClick={() => applySort('cases')}>Cases</TableHead>
                  <TableHead className="text-right cursor-pointer" onClick={() => applySort('amount')}>Exposure</TableHead>
                  <TableHead className="cursor-pointer" onClick={() => applySort('recommended')}>Recommended</TableHead>
                  <TableHead className="cursor-pointer" onClick={() => applySort('waiting')}>Waiting</TableHead>
                  <TableHead className="cursor-pointer" onClick={() => applySort('status')}>Status</TableHead>
                  <TableHead>Referral progress</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={11}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
                ))}

                {!isLoading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-10 text-muted-foreground">
                      No recommendations match this view. Adjust the filters or run detection to pick up newly qualifying employers.
                    </TableCell>
                  </TableRow>
                )}

                {rows.map((r: RecommendationRow) => (
                  <TableRow key={r.recommendation_id} className="hover:bg-accent/40">
                    <TableCell>
                      <button className="text-left" onClick={() => setOpenId(r.recommendation_id)}>
                        <div className="font-medium">{r.employer_name || '—'}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.employer_id} · {r.source_label}
                          {r.source_case_number ? ` · ${r.source_case_number}` : ''}
                        </div>
                      </button>
                    </TableCell>
                    <TableCell className="text-sm">{r.zone}</TableCell>
                    <TableCell>
                      <ToneBadge tone={r.risk_tone}>{r.risk_label}</ToneBadge>
                    </TableCell>
                    <TableCell className="max-w-[240px]">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-xs text-muted-foreground line-clamp-2">
                            {r.rule_summary || r.recommendation_reason || 'Threshold met'}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-sm">
                          {r.rule_summary || r.recommendation_reason || 'Threshold met'}
                        </TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="text-right">{r.qualifying_case_count}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(Number(r.grand_total || 0))}
                      {r.high_value && <div className="text-[10px] text-amber-600">High exposure</div>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDisplayDate(r.recommended_date || r.recommended_at)}
                      <div className="text-xs text-muted-foreground">{r.recommended_by || 'System'}</div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatWaiting(r.waiting_hours)}
                      {r.review_overdue && <div className="text-[10px] text-destructive">Overdue</div>}
                      {!r.review_overdue && r.review_due_soon && <div className="text-[10px] text-amber-600">Due soon</div>}
                    </TableCell>
                    <TableCell><ToneBadge tone={r.status_tone}>{r.status_label}</ToneBadge></TableCell>
                    <TableCell>
                      {r.referral_id ? (
                        <button
                          className="text-left text-sm text-primary hover:underline"
                          onClick={() => navigate(`/compliance/legal/pack-preparation?referral=${r.referral_id}`)}
                        >
                          {r.referral_number}
                          <div className="text-xs text-muted-foreground">{r.legal_state_label}</div>
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {r.approved_no_referral ? 'Approved — no referral' : r.legal_state_label}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.is_pending ? (
                        <Button size="sm" variant={actor?.can_decide && !r.is_own_recommendation ? 'default' : 'outline'}
                          onClick={() => setOpenId(r.recommendation_id)}>
                          {actor?.can_decide && !r.is_own_recommendation
                            ? <><Gavel className="h-4 w-4 mr-1" /> Review</>
                            : <><Eye className="h-4 w-4 mr-1" /> View</>}
                        </Button>
                      ) : r.referral_id ? (
                        <Button size="sm" variant="outline"
                          onClick={() => navigate(`/compliance/legal/pack-preparation?referral=${r.referral_id}`)}>
                          <FileText className="h-4 w-4 mr-1" /> Prepare pack
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => setOpenId(r.recommendation_id)}>
                          <Eye className="h-4 w-4 mr-1" /> View
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 p-3 border-t">
            <div className="text-sm text-muted-foreground">
              {total === 0 ? 'No records' : `Showing ${(filters.page - 1) * filters.page_size + 1}–${Math.min(filters.page * filters.page_size, total)} of ${total}`}
            </div>
            <div className="flex items-center gap-2">
              <Select value={String(filters.page_size)} onValueChange={(v) => setFilters({ page_size: Number(v), page: 1 })}>
                <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RECOMMENDATION_PAGE_SIZES.map((s) => <SelectItem key={s} value={String(s)}>{s} / page</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" disabled={filters.page <= 1}
                onClick={() => setFilters({ page: filters.page - 1 })}><ChevronLeft className="h-4 w-4" /></Button>
              <span className="text-sm">{filters.page} / {pageCount}</span>
              <Button variant="outline" size="icon" disabled={filters.page >= pageCount}
                onClick={() => setFilters({ page: filters.page + 1 })}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        </Card>

        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate('/compliance/legal/pack-preparation')}>
            <FileText className="h-4 w-4 mr-1" /> Legal pack preparation
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate('/compliance/enforcement/legal-queue')}>
            <Gavel className="h-4 w-4 mr-1" /> Legal review &amp; handover
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate('/compliance/legal/approved-escalations')}>
            <Building2 className="h-4 w-4 mr-1" /> Approved escalations
          </Button>
        </div>

        <RecommendationReviewDialog
          recommendationId={openId}
          open={Boolean(openId)}
          onOpenChange={(v) => !v && setOpenId(null)}
        />
      </div>
    </TooltipProvider>
  );
};

export default LegalRecommendationQueue;
