/**
 * Rules Administration — Version governance, compare, simulate, approve, publish
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  BookOpen, Copy, CheckCircle, XCircle, Send, Eye, Play,
  GitCompare, Search, Plus, ArrowRight, Shield, Clock, AlertTriangle,
} from 'lucide-react';
import { PermissionWrapper } from '@/components/ui/permission-wrapper';
import { PageHeader } from '@/components/common/PageHeader';
import { BnStatusBadge, BnEmptyState, BnScreenRoleBanner } from '@/components/bn/shared';
import { useUserCode } from '@/hooks/useUserCode';
import { useBnProducts } from '@/hooks/bn/useBnProduct';
import {
  useBnRuleVersions,
  useBnCloneVersion,
  useBnCompareVersions,
  useBnSubmitForApproval,
  useBnApproveVersion,
  useBnRejectVersion,
  useBnPublishVersion,
} from '@/hooks/bn/useBnRulesAdmin';

import { RULE_VERSION_STATUSES, assertVersionReadiness, type RuleVersionSummary } from '@/services/bn/rulesAdminService';

// Canonical lifecycle: DRAFT -> PENDING_APPROVAL -> APPROVED -> ACTIVE -> ARCHIVED
const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  PENDING_APPROVAL: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  APPROVED: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  ACTIVE: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  ARCHIVED: 'bg-secondary text-secondary-foreground',
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending Approval',
  APPROVED: 'Approved',
  ACTIVE: 'Active',
  ARCHIVED: 'Archived',
};

/**
 * Per-row readiness. The governance registry used to expose Submit / Approve /
 * Publish with no indication of whether the version could actually pass the
 * gate, so failures only surfaced at the final click with an opaque message.
 * Each actionable row now runs the same gate the service runs and names its
 * blocking issues up front.
 */
function useVersionReadiness(versions: RuleVersionSummary[]) {
  const actionable = versions.filter((v) => v.status !== 'ACTIVE' && v.status !== 'ARCHIVED');
  const results = useQueries({
    queries: actionable.map((v) => ({
      queryKey: ['bn', 'version-readiness', v.id],
      queryFn: () => assertVersionReadiness(v.id),
      staleTime: 60_000,
      retry: false,
    })),
  });
  const map = new Map<string, { loading: boolean; ok: boolean; errors: string[] }>();
  actionable.forEach((v, i) => {
    const r = results[i];
    map.set(v.id, {
      loading: r.isLoading,
      ok: !!r.data?.ok,
      errors: r.data?.errors ?? [],
    });
  });
  return map;
}

function ReadinessCell({
  state,
  productId,
}: {
  state?: { loading: boolean; ok: boolean; errors: string[] };
  productId: string;
}) {
  if (!state) return <span className="text-muted-foreground text-xs">—</span>;
  if (state.loading) return <span className="text-muted-foreground text-xs">Checking…</span>;
  if (state.ok) {
    return (
      <Badge variant="outline" className="text-green-600 border-green-300">
        <CheckCircle className="h-3 w-3 mr-1" /> Ready to publish
      </Badge>
    );
  }
  return (
    <Link to={`/bn/config/products/${productId}`} onClick={(e) => e.stopPropagation()}>
      <Badge
        variant="outline"
        className="text-destructive border-destructive/40 hover:bg-destructive/10"
        title={state.errors.join('\n')}
      >
        <AlertTriangle className="h-3 w-3 mr-1" />
        {state.errors.length} blocking issue{state.errors.length === 1 ? '' : 's'}
      </Badge>
    </Link>
  );
}

export default function RulesAdministration() {

  const { userCode } = useUserCode();
  const { data: products = [] } = useBnProducts();
  const [productFilter, setProductFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selectedVersion, setSelectedVersion] = useState<RuleVersionSummary | null>(null);
  const [compareBaseId, setCompareBaseId] = useState<string>('');
  const [compareTargetId, setCompareTargetId] = useState<string>('');
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [cloneLabel, setCloneLabel] = useState('');
  const [cloneNotes, setCloneNotes] = useState('');
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [actionType, setActionType] = useState<'approve' | 'reject' | 'publish' | null>(null);
  const [actionComments, setActionComments] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');

  const { data: versions = [], isLoading } = useBnRuleVersions(
    productFilter !== 'all' ? productFilter : undefined
  );
  const cloneMutation = useBnCloneVersion();
  const submitMutation = useBnSubmitForApproval();
  const approveMutation = useBnApproveVersion();
  const rejectMutation = useBnRejectVersion();
  const publishMutation = useBnPublishVersion();

  const { data: compareResult } = useBnCompareVersions(
    compareBaseId || undefined,
    compareTargetId || undefined
  );

  const readiness = useVersionReadiness(versions);


  const filtered = versions.filter((v) => {
    if (statusFilter !== 'all' && v.status !== statusFilter) return false;
    if (search && !v.versionLabel.toLowerCase().includes(search.toLowerCase()) &&
        !v.productName.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleClone = () => {
    if (!selectedVersion || !cloneLabel) return;
    cloneMutation.mutate({
      sourceVersionId: selectedVersion.id,
      newLabel: cloneLabel,
      changeNotes: cloneNotes,
      userCode: userCode || 'system',
    });
    setShowCloneDialog(false);
    setCloneLabel('');
    setCloneNotes('');
  };

  const handleSubmit = (versionId: string) => {
    submitMutation.mutate({ versionId, userCode: userCode || 'system' });
  };

  const handleAction = () => {
    if (!selectedVersion) return;
    if (actionType === 'approve') {
      approveMutation.mutate({ versionId: selectedVersion.id, approverCode: userCode || 'system', comments: actionComments });
    } else if (actionType === 'reject') {
      rejectMutation.mutate({ versionId: selectedVersion.id, rejectorCode: userCode || 'system', reason: actionComments });
    } else if (actionType === 'publish') {
      publishMutation.mutate({ versionId: selectedVersion.id, effectiveDate, publisherCode: userCode || 'system' });
    }
    setShowActionSheet(false);
    setActionType(null);
    setActionComments('');
    setEffectiveDate('');
  };

  return (
    <PermissionWrapper moduleName="bn_configuration">
      <div className="space-y-6 p-6">
        <PageHeader
          title="Rule Version Governance"
          subtitle="Approve, publish, retire, and audit product rule versions"
          breadcrumbs={[
            { label: 'Benefit Management', href: '/bn/claims' },
            { label: 'Configuration' },
            { label: 'Rule Version Governance' },
          ]}
        />

        <BnScreenRoleBanner
          role="governance"
          description="Governance only — review, compare, approve, publish, retire and roll back product rule versions. Eligibility, calculation, documents, workflow and timelines are edited inside Product Catalog against a specific draft version."
        />

        <Tabs defaultValue="versions" className="w-full">
          <TabsList>
            <TabsTrigger value="versions" className="gap-1.5"><BookOpen className="h-3.5 w-3.5" /> Version Registry</TabsTrigger>
            <TabsTrigger value="compare" className="gap-1.5"><GitCompare className="h-3.5 w-3.5" /> Compare Versions</TabsTrigger>
          </TabsList>

          {/* ── Version Registry Tab ─────────────────────────────── */}
          <TabsContent value="versions" className="mt-6 space-y-4">
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search versions..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={productFilter} onValueChange={setProductFilter}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="All Products" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Products</SelectItem>
                  {products.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.benefit_code} — {p.benefit_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {RULE_VERSION_STATUSES.map(s => (
                    <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {RULE_VERSION_STATUSES.map(s => (
                <Card key={s} className="cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all" onClick={() => setStatusFilter(s)}>
                  <CardContent className="p-3 text-center">
                    <div className="text-2xl font-bold">{versions.filter(v => v.status === s).length}</div>
                    <div className="text-xs text-muted-foreground">{STATUS_LABELS[s]}</div>
                  </CardContent>
                </Card>
              ))}
            </div>


            {/* Version Table */}
            <Card>
              <CardContent className="p-0">
                {filtered.length === 0 ? (
                  <BnEmptyState type="empty" title="No rule versions found" description="Create a new product version to get started." />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>Version</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-center">Rules</TableHead>
                        <TableHead>Effective</TableHead>
                        <TableHead>Author</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((v) => (
                        <TableRow key={v.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedVersion(v)}>
                          <TableCell className="font-medium">{v.productName}</TableCell>
                          <TableCell>
                            <span className="font-mono text-sm">{v.versionLabel}</span>
                            <span className="text-muted-foreground text-xs ml-1.5">#{v.versionNumber}</span>
                          </TableCell>
                          <TableCell>
                            <Badge className={STATUS_COLORS[v.status] || ''} variant="secondary">
                              {STATUS_LABELS[v.status] || v.status.replace('_', ' ')}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                              <span title="Eligibility">{v.eligibilityRuleCount}E</span>
                              <span title="Calculation">{v.calculationRuleCount}C</span>
                              <span title="Timeline">{v.timelineRuleCount}T</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">{v.effectiveDate || '—'}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{v.enteredBy || '—'}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {v.status === 'DRAFT' && (
                                <>
                                  <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); handleSubmit(v.id); }}>
                                    <Send className="h-3 w-3 mr-1" /> Submit
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setSelectedVersion(v); setShowCloneDialog(true); }}>
                                    <Copy className="h-3 w-3" />
                                  </Button>
                                </>
                              )}
                              {v.status === 'PENDING_APPROVAL' && (
                                <>
                                  <Button size="sm" variant="outline" className="text-green-600" onClick={(e) => {
                                    e.stopPropagation(); setSelectedVersion(v); setActionType('approve'); setShowActionSheet(true);
                                  }}>
                                    <CheckCircle className="h-3 w-3 mr-1" /> Approve
                                  </Button>
                                  <Button size="sm" variant="outline" className="text-destructive" onClick={(e) => {
                                    e.stopPropagation(); setSelectedVersion(v); setActionType('reject'); setShowActionSheet(true);
                                  }}>
                                    <XCircle className="h-3 w-3 mr-1" /> Reject
                                  </Button>
                                </>
                              )}
                              {v.status === 'APPROVED' && (
                                <Button size="sm" variant="default" onClick={(e) => {
                                  e.stopPropagation(); setSelectedVersion(v); setActionType('publish'); setShowActionSheet(true);
                                }}>
                                  <ArrowRight className="h-3 w-3 mr-1" /> Publish
                                </Button>
                              )}
                              {v.status === 'ACTIVE' && (
                                <Badge variant="outline" className="text-green-600 border-green-300"><Shield className="h-3 w-3 mr-1" /> Active</Badge>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Compare Tab ──────────────────────────────────────── */}
          <TabsContent value="compare" className="mt-6 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><GitCompare className="h-4 w-4" /> Version Comparison</CardTitle>
                <CardDescription>Select two versions to see rule-level differences</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <Select value={compareBaseId} onValueChange={setCompareBaseId}>
                    <SelectTrigger className="w-[260px]"><SelectValue placeholder="Base version..." /></SelectTrigger>
                    <SelectContent>
                      {versions.map(v => (
                        <SelectItem key={v.id} value={v.id}>{v.productName} — {v.versionLabel}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  <Select value={compareTargetId} onValueChange={setCompareTargetId}>
                    <SelectTrigger className="w-[260px]"><SelectValue placeholder="Compare version..." /></SelectTrigger>
                    <SelectContent>
                      {versions.filter(v => v.id !== compareBaseId).map(v => (
                        <SelectItem key={v.id} value={v.id}>{v.productName} — {v.versionLabel}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {compareResult && (
                  <>
                    {/* Summary */}
                    <div className="flex gap-4 text-sm">
                      <Badge variant="outline" className="text-green-600">+{compareResult.summary.added} added</Badge>
                      <Badge variant="outline" className="text-destructive">-{compareResult.summary.removed} removed</Badge>
                      <Badge variant="outline" className="text-amber-600">~{compareResult.summary.modified} modified</Badge>
                      <Badge variant="outline" className="text-muted-foreground">{compareResult.summary.unchanged} unchanged</Badge>
                    </div>

                    <Separator />

                    {/* Diff Table */}
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Type</TableHead>
                          <TableHead>Rule Code</TableHead>
                          <TableHead>Rule Name</TableHead>
                          <TableHead>Change</TableHead>
                          <TableHead>Details</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {compareResult.diffs
                          .filter(d => d.changeType !== 'unchanged')
                          .map((d, i) => (
                          <TableRow key={i}>
                            <TableCell><Badge variant="secondary" className="text-xs">{d.ruleType}</Badge></TableCell>
                            <TableCell className="font-mono text-xs">{d.ruleCode}</TableCell>
                            <TableCell>{d.ruleName}</TableCell>
                            <TableCell>
                              <Badge className={
                                d.changeType === 'added' ? 'bg-green-100 text-green-800' :
                                d.changeType === 'removed' ? 'bg-destructive/10 text-destructive' :
                                'bg-amber-100 text-amber-800'
                              } variant="secondary">{d.changeType}</Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[300px] truncate">
                              {d.fieldDiffs.map(f => `${f.field}: ${JSON.stringify(f.oldValue)} → ${JSON.stringify(f.newValue)}`).join('; ') || '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                        {compareResult.diffs.filter(d => d.changeType !== 'unchanged').length === 0 && (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                              Versions are identical — no differences found.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* ── Clone Dialog (Sheet) ──────────────────────────────── */}
        <Sheet open={showCloneDialog} onOpenChange={setShowCloneDialog}>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Clone Version as Draft</SheetTitle>
              <SheetDescription>
                Create a new draft from {selectedVersion?.versionLabel} ({selectedVersion?.productName})
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-4 mt-6">
              <div>
                <label className="text-sm font-medium">New Version Label</label>
                <Input value={cloneLabel} onChange={(e) => setCloneLabel(e.target.value)} placeholder="e.g., v3.1-draft" />
              </div>
              <div>
                <label className="text-sm font-medium">Change Notes</label>
                <Textarea value={cloneNotes} onChange={(e) => setCloneNotes(e.target.value)} placeholder="Describe the reason for this revision..." rows={3} />
              </div>
              <Button onClick={handleClone} disabled={!cloneLabel || cloneMutation.isPending} className="w-full">
                <Copy className="h-4 w-4 mr-2" /> Create Draft
              </Button>
            </div>
          </SheetContent>
        </Sheet>

        {/* ── Action Sheet (Approve/Reject/Publish) ─────────────── */}
        <Sheet open={showActionSheet} onOpenChange={setShowActionSheet}>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>
                {actionType === 'approve' && 'Approve Version'}
                {actionType === 'reject' && 'Reject Version'}
                {actionType === 'publish' && 'Publish Version'}
              </SheetTitle>
              <SheetDescription>
                {selectedVersion?.productName} — {selectedVersion?.versionLabel}
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-4 mt-6">
              {actionType === 'publish' && (
                <div>
                  <label className="text-sm font-medium">Effective Date *</label>
                  <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
                  <p className="text-xs text-muted-foreground mt-1">The currently active version will be retired on this date.</p>
                </div>
              )}
              <div>
                <label className="text-sm font-medium">
                  {actionType === 'reject' ? 'Rejection Reason *' : 'Comments'}
                </label>
                <Textarea value={actionComments} onChange={(e) => setActionComments(e.target.value)} rows={3} placeholder={
                  actionType === 'reject' ? 'Explain what needs to be revised...' : 'Optional comments...'
                } />
              </div>
              <Button
                onClick={handleAction}
                disabled={
                  (actionType === 'reject' && !actionComments) ||
                  (actionType === 'publish' && !effectiveDate)
                }
                variant={actionType === 'reject' ? 'destructive' : 'default'}
                className="w-full"
              >
                {actionType === 'approve' && <><CheckCircle className="h-4 w-4 mr-2" /> Approve</>}
                {actionType === 'reject' && <><XCircle className="h-4 w-4 mr-2" /> Reject & Return to Draft</>}
                {actionType === 'publish' && <><ArrowRight className="h-4 w-4 mr-2" /> Publish & Activate</>}
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </PermissionWrapper>
  );
}
