import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, AlertTriangle, MessageSquare, CheckCircle, ChevronDown, ChevronUp, FileText, Edit, Eye, Paperclip, ClipboardCheck, X } from 'lucide-react';
import { StatusBadge } from '@/components/common';
import { useIAFindingMutations } from '@/hooks/useAuditData';
import { AuditEmptyState } from '@/components/audit/workspace/AuditEmptyState';
import { useAuditFields } from '@/hooks/useAuditTrail';
import { useToast } from '@/hooks/use-toast';
import { formatDateForDisplay } from '@/lib/format-config';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { FindingLifecycleControls } from './FindingLifecycleControls';


const RISK_RATINGS = ['Critical', 'High', 'Medium', 'Low'];
const FINDING_STATUSES = ['Draft', 'Open', 'In Review', 'Submitted for Response', 'Responded', 'Closed', 'Resolved'];
const IMPACT_AREAS = ['Financial', 'Operational', 'Compliance', 'Reputational', 'Strategic', 'IT/Technology'];
const ROOT_CAUSE_CATEGORIES = ['Process Gap', 'Policy Gap', 'Control Weakness', 'Human Error', 'System Limitation', 'Training Gap', 'Resource Constraint', 'Oversight', 'Other'];

const emptyForm = {
  title: '', finding_id: '', condition: '', criteria: '', cause: '', effect: '',
  risk_rating: 'Medium', recommendation: '', status: 'Draft', impact_area: '', owner_role: '',
  preventive_action: '', root_cause_category: '', corrective_action_description: '',
  function_area: '', department_head_name: '',
};

interface AuditFindingsTabProps {
  auditId: string;
  auditFindings: any[];
  auditResponses: any[];
  auditActions: any[];
  auditEvidence?: any[];
  auditWorkingPapers?: any[];
  departmentId?: string;
}

export function AuditFindingsTab({ auditId, auditFindings, auditResponses, auditActions, auditEvidence = [], auditWorkingPapers = [], departmentId }: AuditFindingsTabProps) {
  const { create, update } = useIAFindingMutations();
  const { getCreateFields, getUpdateFields } = useAuditFields();
  const { toast } = useToast();
  const [formMode, setFormMode] = useState<'create' | 'edit' | 'view' | null>(null);
  const [editRecord, setEditRecord] = useState<any>(null);
  const [form, setForm] = useState(emptyForm);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const generateFindingId = () => `FND-${Date.now().toString(36).toUpperCase().slice(-6)}`;

  const closeForm = () => { setFormMode(null); setEditRecord(null); };

  const openCreate = () => {
    setForm({ ...emptyForm, finding_id: generateFindingId() });
    setFormMode('create');
    setEditRecord(null);
    setAdvancedOpen(false);
  };

  const openEdit = (r: any) => {
    setForm({
      title: r.title || '', finding_id: r.finding_id || '', condition: r.condition || '', criteria: r.criteria || '',
      cause: r.cause || '', effect: r.effect || '', risk_rating: r.risk_rating || 'Medium',
      recommendation: r.recommendation || '', status: r.status || 'Draft', impact_area: r.impact_area || '',
      owner_role: r.owner_role || '', preventive_action: r.preventive_action || '',
      root_cause_category: r.root_cause_category || '', corrective_action_description: r.corrective_action_description || '',
      function_area: r.function_area || '', department_head_name: r.department_head_name || '',
    });
    setFormMode('edit');
    setEditRecord(r);
  };

  const openView = (r: any) => { openEdit(r); setFormMode('view'); };

  const handleSave = () => {
    if (!form.title || !form.condition) {
      toast({ title: 'Validation', description: 'Title and Condition are required', variant: 'destructive' });
      return;
    }
    const payload = {
      title: form.title, finding_id: form.finding_id, condition: form.condition, criteria: form.criteria || null,
      cause: form.cause || null, effect: form.effect || null, risk_rating: form.risk_rating,
      recommendation: form.recommendation || null, status: form.status, impact_area: form.impact_area || null,
      owner_role: form.owner_role || null, preventive_action: form.preventive_action || null,
      root_cause_category: form.root_cause_category || null, corrective_action_description: form.corrective_action_description || null,
      function_area: form.function_area || null, department_head_name: form.department_head_name || null,
      engagement_id: auditId, department_id: departmentId || null,
      activity_id: null, annual_plan_id: null,
    };
    if (formMode === 'create') {
      create.mutate({ ...payload, ...getCreateFields() } as any, { onSuccess: closeForm });
    } else if (formMode === 'edit' && editRecord) {
      update.mutate({ id: editRecord.id, ...payload, ...getUpdateFields() } as any, { onSuccess: closeForm });
    }
  };

  const getLinkedResponses = (findingId: string) => auditResponses.filter((r: any) => r.finding_id === findingId);
  const getLinkedActions = (findingId: string) => auditActions.filter((a: any) => a.finding_id === findingId);
  const getLinkedEvidence = (findingId: string) => auditEvidence.filter((e: any) => e.finding_id === findingId);
  const getLinkedWPs = (findingId: string) => auditWorkingPapers.filter((w: any) => Array.isArray(w.linked_finding_ids) && w.linked_finding_ids.includes(findingId));

  const riskBorder = (risk: string) => {
    if (risk === 'Critical') return 'border-l-destructive';
    if (risk === 'High') return 'border-l-amber-600';
    if (risk === 'Medium') return 'border-l-amber-400';
    return 'border-l-primary';
  };

  // Stats
  const riskCounts = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  auditFindings.forEach((f: any) => { if (f.risk_rating && riskCounts[f.risk_rating as keyof typeof riskCounts] !== undefined) riskCounts[f.risk_rating as keyof typeof riskCounts]++; });

  return (
    <div className="space-y-4">
      {/* Stats Row */}
      {auditFindings.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Object.entries(riskCounts).map(([risk, count]) => (
            <div key={risk} className="flex items-center gap-2 p-2.5 rounded-lg border border-border/50 bg-background">
              <StatusBadge status={risk} />
              <span className="text-sm font-bold">{count}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{auditFindings.length} finding(s)</p>
        <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" />New Finding</Button>
      </div>

      {/* Findings List */}
      {auditFindings.length === 0 ? (
        <AuditEmptyState icon={AlertTriangle} title="No findings documented"
          description="Findings capture issues identified during audit fieldwork — control weaknesses, non-compliance, process gaps, and other observations."
          actionLabel="Record Finding" onAction={openCreate} />
      ) : (
        <div className="space-y-3">
          {auditFindings.map((finding: any, idx: number) => {
            const responses = getLinkedResponses(finding.id);
            const actions = getLinkedActions(finding.id);
            const linkedEvidence = getLinkedEvidence(finding.id);
            const linkedWPs = getLinkedWPs(finding.id);
            const isExpanded = expandedId === finding.id;
            const hasResponse = responses.length > 0;
            const hasActions = actions.length > 0;

            return (
              <Card key={finding.id} className={`border-l-4 ${riskBorder(finding.risk_rating || 'Medium')} hover:shadow-sm transition-shadow`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{finding.finding_id || `#${idx + 1}`}</span>
                        <StatusBadge status={finding.risk_rating || 'Medium'} />
                        <StatusBadge status={finding.status || 'Draft'} />
                        {finding.impact_area && <Badge variant="outline" className="text-[10px] px-1.5 py-0">{finding.impact_area}</Badge>}
                      </div>
                      <h4 className="text-sm font-semibold">{finding.title}</h4>
                      {finding.condition && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{finding.condition}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span title="Evidence" className={`flex items-center gap-0.5 ${linkedEvidence.length > 0 ? 'text-primary' : ''}`}>
                          <Paperclip className="h-3.5 w-3.5" />{linkedEvidence.length}
                        </span>
                        <span title="Responses" className={`flex items-center gap-0.5 ${hasResponse ? 'text-primary' : ''}`}>
                          <MessageSquare className="h-3.5 w-3.5" />{responses.length}
                        </span>
                        <span title="Actions" className={`flex items-center gap-0.5 ${hasActions ? 'text-emerald-600' : ''}`}>
                          <CheckCircle className="h-3.5 w-3.5" />{actions.length}
                        </span>
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(finding)}><Edit className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setExpandedId(isExpanded ? null : finding.id)}>
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>

                  {/* Expanded Detail */}
                  {isExpanded && (
                    <div className="mt-4 space-y-4 pt-3 border-t border-border/30">
                      <FindingLifecycleControls finding={finding} />
                      <div className="grid grid-cols-2 gap-3">

                        {finding.criteria && <DetailBlock label="Criteria" value={finding.criteria} />}
                        {finding.condition && <DetailBlock label="Condition" value={finding.condition} />}
                        {finding.cause && <DetailBlock label="Cause" value={finding.cause} />}
                        {finding.effect && <DetailBlock label="Effect" value={finding.effect} />}
                      </div>
                      {finding.root_cause_category && <div className="text-xs"><span className="font-medium">Root Cause Category:</span> {finding.root_cause_category}</div>}
                      {finding.recommendation && (
                        <div className="p-3 rounded-lg bg-primary/5 border border-primary/10">
                          <p className="text-xs font-medium text-primary mb-1">Recommendation</p>
                          <p className="text-sm leading-relaxed">{finding.recommendation}</p>
                        </div>
                      )}
                      {finding.preventive_action && (
                        <div className="p-3 rounded-lg bg-muted/50 border border-border/30">
                          <p className="text-xs font-medium mb-1">Preventive Action</p>
                          <p className="text-sm leading-relaxed">{finding.preventive_action}</p>
                        </div>
                      )}
                      {finding.corrective_action_description && (
                        <div className="p-3 rounded-lg bg-muted/50 border border-border/30">
                          <p className="text-xs font-medium mb-1">Corrective Action</p>
                          <p className="text-sm leading-relaxed">{finding.corrective_action_description}</p>
                        </div>
                      )}

                      {/* Linked Evidence */}
                      {linkedEvidence.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1"><Paperclip className="h-3 w-3" />Linked Evidence ({linkedEvidence.length})</p>
                          <div className="flex gap-2 flex-wrap">
                            {linkedEvidence.map((e: any) => (
                              <Badge key={e.id} variant="secondary" className="text-xs">{e.evidence_id || e.description || 'Evidence'}</Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Linked Working Papers */}
                      {linkedWPs.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1"><FileText className="h-3 w-3" />Linked Working Papers ({linkedWPs.length})</p>
                          <div className="flex gap-2 flex-wrap">
                            {linkedWPs.map((w: any) => (
                              <Badge key={w.id} variant="secondary" className="text-xs">{w.working_paper_id} — {w.title}</Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Linked Responses */}
                      {responses.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1"><MessageSquare className="h-3 w-3" />Management Responses ({responses.length})</p>
                          {responses.map((r: any) => (
                            <div key={r.id} className="p-3 rounded-lg border border-border/50 mb-2">
                              <div className="flex items-center justify-between mb-1">
                                <StatusBadge status={r.status || 'Pending'} />
                                <span className="text-xs text-muted-foreground">{r.submitted_date ? formatDateForDisplay(r.submitted_date) : ''}</span>
                              </div>
                              <p className="text-sm">{r.response_text}</p>
                              {r.action_plan && <p className="text-xs text-muted-foreground mt-1">Action Plan: {r.action_plan}</p>}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Linked Actions */}
                      {actions.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1"><CheckCircle className="h-3 w-3" />Corrective Actions ({actions.length})</p>
                          {actions.map((a: any) => {
                            const isOverdue = a.target_date && !['Completed', 'Closed'].includes(a.status || '') && new Date(a.target_date) < new Date();
                            return (
                              <div key={a.id} className={`p-3 rounded-lg border mb-2 ${isOverdue ? 'border-destructive/30 bg-destructive/5' : 'border-border/50'}`}>
                                <div className="flex items-center justify-between">
                                  <p className="text-sm">{a.action_description}</p>
                                  <div className="flex items-center gap-1.5"><StatusBadge status={a.status || 'Open'} />{isOverdue && <StatusBadge status="Overdue" />}</div>
                                </div>
                                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                                  {a.responsible_person && <span>Assigned: {a.responsible_person}</span>}
                                  {a.target_date && <span>Due: {formatDateForDisplay(a.target_date)}</span>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {!hasResponse && !hasActions && linkedEvidence.length === 0 && (
                        <p className="text-xs text-muted-foreground italic">No linked evidence, responses, or actions yet.</p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Inline Create / Edit Form */}
      {formMode && (
        <Card className="border-primary/20">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">
                {formMode === 'create' ? 'New Finding' : formMode === 'edit' ? 'Edit Finding' : 'Finding Detail'}
              </p>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={closeForm}><X className="h-4 w-4" /></Button>
            </div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Core Information</p>
            <div className="grid grid-cols-3 gap-4">
              <div><Label>Finding ID</Label><Input value={form.finding_id} disabled className="bg-muted" /></div>
              <div><Label>Title *</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} disabled={formMode === 'view'} /></div>
              <div><Label>Risk Rating *</Label>
                <Select value={form.risk_rating} onValueChange={v => setForm(f => ({ ...f, risk_rating: v }))} disabled={formMode === 'view'}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{RISK_RATINGS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))} disabled={formMode === 'view'}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{FINDING_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Impact Area</Label>
                <Select value={form.impact_area || '__none__'} onValueChange={v => setForm(f => ({ ...f, impact_area: v === '__none__' ? '' : v }))} disabled={formMode === 'view'}>
                  <SelectTrigger><SelectValue placeholder="Select impact area" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Select impact area</SelectItem>
                    {IMPACT_AREAS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pt-2">Finding Detail (Criteria / Condition / Cause / Effect)</p>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Condition * <span className="text-muted-foreground text-xs">(What was found)</span></Label><Textarea value={form.condition} onChange={e => setForm(f => ({ ...f, condition: e.target.value }))} rows={3} disabled={formMode === 'view'} className="text-sm leading-relaxed" /></div>
              <div><Label>Criteria <span className="text-muted-foreground text-xs">(What should be)</span></Label><Textarea value={form.criteria} onChange={e => setForm(f => ({ ...f, criteria: e.target.value }))} rows={3} disabled={formMode === 'view'} className="text-sm leading-relaxed" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Cause <span className="text-muted-foreground text-xs">(Why it happened)</span></Label><Textarea value={form.cause} onChange={e => setForm(f => ({ ...f, cause: e.target.value }))} rows={3} disabled={formMode === 'view'} className="text-sm leading-relaxed" /></div>
              <div><Label>Effect <span className="text-muted-foreground text-xs">(Impact / consequence)</span></Label><Textarea value={form.effect} onChange={e => setForm(f => ({ ...f, effect: e.target.value }))} rows={3} disabled={formMode === 'view'} className="text-sm leading-relaxed" /></div>
            </div>

            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pt-2">Recommendation & Actions</p>
            <div><Label>Recommendation</Label><Textarea value={form.recommendation} onChange={e => setForm(f => ({ ...f, recommendation: e.target.value }))} rows={3} disabled={formMode === 'view'} className="text-sm leading-relaxed" /></div>
            <div><Label>Corrective Action Description</Label><Textarea value={form.corrective_action_description} onChange={e => setForm(f => ({ ...f, corrective_action_description: e.target.value }))} rows={2} disabled={formMode === 'view'} className="text-sm leading-relaxed" /></div>
            <div><Label>Preventive Action</Label><Textarea value={form.preventive_action} onChange={e => setForm(f => ({ ...f, preventive_action: e.target.value }))} rows={2} disabled={formMode === 'view'} className="text-sm leading-relaxed" /></div>

            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider pt-2 cursor-pointer hover:text-foreground transition-colors">
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
                Additional Classification
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3 space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div><Label>Root Cause Category</Label>
                    <Select value={form.root_cause_category || '__none__'} onValueChange={v => setForm(f => ({ ...f, root_cause_category: v === '__none__' ? '' : v }))} disabled={formMode === 'view'}>
                      <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Select category</SelectItem>
                        {ROOT_CAUSE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Owner Role</Label><Input value={form.owner_role} onChange={e => setForm(f => ({ ...f, owner_role: e.target.value }))} disabled={formMode === 'view'} placeholder="e.g. Department Head" /></div>
                  <div><Label>Function Area</Label><Input value={form.function_area} onChange={e => setForm(f => ({ ...f, function_area: e.target.value }))} disabled={formMode === 'view'} /></div>
                </div>
                <div><Label>Department Head</Label><Input value={form.department_head_name} onChange={e => setForm(f => ({ ...f, department_head_name: e.target.value }))} disabled={formMode === 'view'} /></div>
              </CollapsibleContent>
            </Collapsible>

            {formMode !== 'view' && (
              <div className="flex gap-2 pt-2">
                <Button onClick={handleSave} disabled={create.isPending || update.isPending}>Save Finding</Button>
                <Button variant="outline" onClick={closeForm}>Cancel</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function DetailBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2.5 rounded-lg bg-muted/50 border border-border/30">
      <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground mb-1">{label}</p>
      <p className="text-sm leading-relaxed">{value}</p>
    </div>
  );
}
