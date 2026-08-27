import React, { useState, useMemo, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Plus, Loader2, Edit, Eye, ClipboardCheck, ChevronDown, ChevronRight,
  FileText, AlertTriangle, Paperclip, CheckCircle2, Clock, AlertCircle,
  X, Trash2, ExternalLink, Upload, Shield, Lightbulb
} from 'lucide-react';
import { StatusBadge } from '@/components/common';
import { useEngagementActivities, useEngagementEvidence, useEngagementWorkingPapers } from '@/hooks/useEngagementData';
import { useIAActivityMutations, useIAEvidenceMutations, useIAWorkingPaperMutations } from '@/hooks/useAuditDataExtended';
import { useIAFindings, useIAFindingMutations } from '@/hooks/useAuditData';
import { AuditEmptyState } from '@/components/audit/workspace/AuditEmptyState';
import { formatDateForDisplay } from '@/lib/format-config';
import { useAuditFields } from '@/hooks/useAuditTrail';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useUserCode } from '@/hooks/useUserCode';

const ACTIVITY_STATUSES = ['Planned', 'In Progress', 'Completed', 'Deferred', 'Cancelled'];
const ACTIVITY_TYPES = ['Document Review', 'Walkthrough', 'Testing', 'Interview', 'Observation', 'Data Analysis', 'Sampling', 'Reconciliation', 'Inspection', 'Other'];
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
const RISK_RATINGS = ['Critical', 'High', 'Medium', 'Low'];
const FINDING_STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'];

const emptyActivityForm = {
  name: '', title: '', description: '', status: 'Planned', activity_type: '',
  planned_date_from: '', planned_date_to: '', actual_date_from: '', actual_date_to: '',
  control_area: '', function_area: '', location: '', priority: 'Medium',
  auditor_id: '', auditor_name: '',
};

const ALLOWED_FILE_TYPES = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/png', 'image/jpeg'];
const MAX_FILE_SIZE = 20 * 1024 * 1024;

interface AuditActivitiesTabProps {
  auditId: string;
  departmentAuditId?: string;
  auditors?: any[];
}

// ===== Inline Evidence Form inside Activity =====
function InlineEvidenceForm({ auditId, activityId, onClose }: { auditId: string; activityId: string; onClose: () => void }) {
  const { create } = useIAEvidenceMutations();
  const { toast } = useToast();
  const { userCode } = useUserCode();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ evidence_id: `EVD-${Date.now().toString(36).toUpperCase().slice(-6)}`, description: '', reference_no: '' });

  const handleSave = async () => {
    if (!form.description) return;
    let fileUrl = '', fileName = '', fileType = '';
    let fileSize: number | null = null;
    const file = fileRef.current?.files?.[0];
    if (file) {
      if (!ALLOWED_FILE_TYPES.includes(file.type) || file.size > MAX_FILE_SIZE) {
        toast({ title: 'Invalid file', variant: 'destructive' }); return;
      }
      setUploading(true);
      const path = `evidence/${auditId}/${Date.now()}_${file.name}`;
      const { error } = await supabase.storage.from('audit-attachments').upload(path, file);
      setUploading(false);
      if (error) { toast({ title: 'Upload failed', variant: 'destructive' }); return; }
      // Private bucket: persist the object path, resolve a signed URL on read.
      fileUrl = path;
      fileName = file.name; fileType = file.type; fileSize = file.size;
    }
    create.mutate({
      evidence_id: form.evidence_id, description: form.description, reference_no: form.reference_no || null,
      file_name: fileName || null, file_url: fileUrl || null, file_type: fileType || null, file_size: fileSize,
      activity_id: activityId, engagement_id: auditId, uploaded_by: userCode || null,
      upload_date: new Date().toISOString(), created_by: userCode || null,
    } as any, { onSuccess: onClose });
  };

  return (
    <div className="p-3 bg-muted/30 rounded-lg border border-border/50 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold flex items-center gap-1.5"><Paperclip className="h-3.5 w-3.5" />Add Evidence</p>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}><X className="h-3.5 w-3.5" /></Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs">Description *</Label><Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What evidence is this?" className="h-8 text-xs" /></div>
        <div><Label className="text-xs">Reference</Label><Input value={form.reference_no} onChange={e => setForm(f => ({ ...f, reference_no: e.target.value }))} placeholder="Optional ref" className="h-8 text-xs" /></div>
      </div>
      <div><Label className="text-xs">Attach File</Label><Input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg" className="text-xs h-8" /></div>
      <div className="flex gap-2">
        <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={create.isPending || uploading}>
          {uploading ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Uploading...</> : 'Save Evidence'}
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

// ===== Inline Working Paper Form =====
function InlineWorkingPaperForm({ auditId, activityId, onClose }: { auditId: string; activityId: string; onClose: () => void }) {
  const { create } = useIAWorkingPaperMutations();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ title: '', reference_number: '', description: '', paper_type: 'Analysis' });

  const handleSave = async () => {
    if (!form.title) return;
    const workingPaperId = form.reference_number.trim() || `WP-${Date.now().toString(36).toUpperCase()}`;

    create.mutate({
      title: form.title.trim(),
      working_paper_id: workingPaperId,
      description: form.description.trim() || null,
      audit_area: form.paper_type.trim() || 'Analysis',
      engagement_id: auditId,
      activity_id: activityId,
      status: 'Draft',
    } as any, { onSuccess: onClose });
  };

  return (
    <div className="p-3 bg-muted/30 rounded-lg border border-border/50 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" />Add Working Paper</p>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}><X className="h-3.5 w-3.5" /></Button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div><Label className="text-xs">Title *</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Title" className="h-8 text-xs" /></div>
        <div><Label className="text-xs">Working Paper ID</Label><Input value={form.reference_number} onChange={e => setForm(f => ({ ...f, reference_number: e.target.value }))} placeholder="WP-001" className="h-8 text-xs" /></div>
        <div><Label className="text-xs">Audit Area</Label><Input value={form.paper_type} onChange={e => setForm(f => ({ ...f, paper_type: e.target.value }))} placeholder="Analysis" className="h-8 text-xs" /></div>
      </div>
      <div><Label className="text-xs">Description</Label><Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className="text-xs" /></div>
      <div className="flex gap-2">
        <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={create.isPending}>Save Working Paper</Button>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

// ===== Inline Finding Form =====
function InlineFindingForm({ auditId, activityId, onClose }: { auditId: string; activityId: string; onClose: () => void }) {
  const { create } = useIAFindingMutations();
  const [form, setForm] = useState({ title: '', description: '', risk_rating: 'Medium', recommendation: '' });

  const handleSave = () => {
    if (!form.title) return;
    const findingId = `FND-${Date.now().toString(36).toUpperCase()}`;

    create.mutate({
      finding_id: findingId,
      title: form.title.trim(),
      condition: form.description.trim() || null,
      risk_rating: form.risk_rating,
      recommendation: form.recommendation.trim() || null,
      status: 'Open',
      engagement_id: auditId,
      activity_id: activityId,
    } as any, { onSuccess: onClose });
  };

  return (
    <div className="p-3 bg-muted/30 rounded-lg border border-border/50 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" />Raise Finding</p>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}><X className="h-3.5 w-3.5" /></Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs">Title *</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Finding title" className="h-8 text-xs" /></div>
        <div><Label className="text-xs">Risk Rating</Label>
          <Select value={form.risk_rating} onValueChange={v => setForm(f => ({ ...f, risk_rating: v }))}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{RISK_RATINGS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <div><Label className="text-xs">Description</Label><Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className="text-xs" /></div>
      <div><Label className="text-xs">Recommendation</Label><Textarea value={form.recommendation} onChange={e => setForm(f => ({ ...f, recommendation: e.target.value }))} rows={2} className="text-xs" placeholder="Recommended action" /></div>
      <div className="flex gap-2">
        <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={create.isPending}>Raise Finding</Button>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

// ===== Activity Card with inline sub-sections and inline actions =====
function ActivityCard({ activity, evidence, workingPapers, findings, auditId, onEdit }: {
  activity: any; evidence: any[]; workingPapers: any[]; findings: any[];
  auditId: string; onEdit: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [inlineForm, setInlineForm] = useState<'evidence' | 'working-paper' | 'finding' | null>(null);
  const { remove: removeEvidence } = useIAEvidenceMutations();
  const { remove: removeWP } = useIAWorkingPaperMutations();

  const statusColor = activity.status === 'Completed' ? 'text-emerald-600' :
    activity.status === 'In Progress' ? 'text-amber-500' : 'text-muted-foreground';
  const statusIcon = activity.status === 'Completed' ? <CheckCircle2 className={`h-4 w-4 ${statusColor}`} /> :
    activity.status === 'In Progress' ? <Clock className={`h-4 w-4 ${statusColor}`} /> :
    <Clock className={`h-4 w-4 ${statusColor}`} />;

  // Smart guidance
  const alerts: string[] = [];
  if (evidence.length === 0 && activity.status !== 'Cancelled') alerts.push('No evidence uploaded');
  if (workingPapers.length === 0 && activity.status !== 'Planned' && activity.status !== 'Cancelled') alerts.push('No working paper created');
  if (activity.status === 'In Progress' && !activity.actual_date_from) alerts.push('Actual start date not set');

  let nextAction = '';
  let nextActionType: 'evidence' | 'working-paper' | 'finding' | null = null;
  if (activity.status === 'Planned') { nextAction = 'Start this activity and upload evidence'; nextActionType = 'evidence'; }
  else if (activity.status === 'In Progress' && evidence.length === 0) { nextAction = 'Upload supporting evidence'; nextActionType = 'evidence'; }
  else if (activity.status === 'In Progress' && workingPapers.length === 0) { nextAction = 'Create a working paper to document analysis'; nextActionType = 'working-paper'; }
  else if (activity.status === 'In Progress' && findings.length === 0) { nextAction = 'Raise finding if issues identified'; nextActionType = 'finding'; }
  else if (activity.status === 'In Progress') { nextAction = 'Mark as completed when fieldwork is done'; }

  // Completion progress
  const steps = [evidence.length > 0, workingPapers.length > 0, findings.length > 0 || activity.status === 'Completed'];
  const stepPct = Math.round((steps.filter(Boolean).length / steps.length) * 100);

  return (
    <Card className={`transition-all ${expanded ? 'ring-1 ring-primary/30 shadow-sm' : 'hover:shadow-sm'}`}>
      {/* Header row */}
      <div className="flex items-start gap-3 p-4 cursor-pointer hover:bg-muted/20 transition-colors" onClick={() => setExpanded(!expanded)}>
        <div className="mt-1">
          {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {statusIcon}
            <span className="font-semibold text-sm">{activity.name || activity.title || 'Untitled Activity'}</span>
            {activity.activity_type && <Badge variant="outline" className="text-[10px] px-1.5 py-0">{activity.activity_type}</Badge>}
            {activity.priority && <StatusBadge status={activity.priority} />}
          </div>
          {activity.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{activity.description}</p>}
          <div className="flex items-center gap-4 mt-1.5 text-[11px] text-muted-foreground">
            {activity.auditor_name && <span>👤 {activity.auditor_name}</span>}
            {(activity.planned_date_from || activity.start_date) && (
              <span>📅 {formatDateForDisplay(activity.planned_date_from || activity.start_date)}
                {(activity.planned_date_to || activity.end_date) ? ` – ${formatDateForDisplay(activity.planned_date_to || activity.end_date)}` : ''}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {/* Mini progress */}
          <div className="w-16 flex flex-col items-end gap-0.5">
            <span className="text-[10px] text-muted-foreground font-medium">{stepPct}%</span>
            <Progress value={stepPct} className="h-1.5 w-full" />
          </div>
          {/* Inline counters */}
          <div className="flex items-center gap-2 text-[11px]">
            <span className="flex items-center gap-0.5" title="Evidence"><Paperclip className="h-3 w-3" />{evidence.length}</span>
            <span className="flex items-center gap-0.5" title="Working Papers"><FileText className="h-3 w-3" />{workingPapers.length}</span>
            <span className="flex items-center gap-0.5" title="Findings"><AlertTriangle className="h-3 w-3" />{findings.length}</span>
          </div>
          <StatusBadge status={activity.status || 'Planned'} />
          <div className="flex gap-0.5" onClick={e => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}><Edit className="h-3.5 w-3.5" /></Button>
          </div>
        </div>
      </div>

      {/* Expanded: inline workspace */}
      {expanded && (
        <div className="border-t border-border/50">
          {/* Smart guidance bar */}
          {(nextAction || alerts.length > 0) && (
            <div className="px-4 pt-3 space-y-1.5">
              {nextAction && (
                <div className="flex items-center gap-2 text-xs px-3 py-2 bg-primary/5 text-primary rounded-md border border-primary/10">
                  <Lightbulb className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1"><strong>Next:</strong> {nextAction}</span>
                  {nextActionType && (
                    <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 border-primary/20 text-primary hover:bg-primary/10" onClick={() => setInlineForm(nextActionType)}>
                      Do It Now
                    </Button>
                  )}
                </div>
              )}
              {alerts.map((a, i) => (
                <div key={i} className="flex items-center gap-2 text-xs px-3 py-1.5 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 rounded-md border border-amber-200/50 dark:border-amber-800/30">
                  <AlertCircle className="h-3 w-3 shrink-0" />{a}
                </div>
              ))}
            </div>
          )}

          {/* Inline action buttons */}
          <div className="flex items-center gap-2 px-4 py-3">
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setInlineForm('evidence')}>
              <Upload className="h-3 w-3" />Add Evidence
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setInlineForm('working-paper')}>
              <FileText className="h-3 w-3" />Add Working Paper
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setInlineForm('finding')}>
              <AlertTriangle className="h-3 w-3" />Raise Finding
            </Button>
          </div>

          {/* Inline form (if open) */}
          {inlineForm && (
            <div className="px-4 pb-3">
              {inlineForm === 'evidence' && <InlineEvidenceForm auditId={auditId} activityId={activity.id} onClose={() => setInlineForm(null)} />}
              {inlineForm === 'working-paper' && <InlineWorkingPaperForm auditId={auditId} activityId={activity.id} onClose={() => setInlineForm(null)} />}
              {inlineForm === 'finding' && <InlineFindingForm auditId={auditId} activityId={activity.id} onClose={() => setInlineForm(null)} />}
            </div>
          )}

          {/* Linked data sections */}
          <div className="px-4 pb-4 space-y-3">
            {/* Evidence */}
            <div className="rounded-lg border border-border/40 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-muted/30">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Paperclip className="h-3 w-3" /> Evidence ({evidence.length})
                </p>
              </div>
              {evidence.length === 0 ? (
                <p className="text-xs text-muted-foreground italic px-3 py-2">No evidence linked yet.</p>
              ) : (
                <div className="divide-y divide-border/30">
                  {evidence.map((e: any) => (
                    <div key={e.id} className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted/20">
                      <Paperclip className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="font-mono text-muted-foreground text-[10px]">{e.evidence_id || '—'}</span>
                      <span className="truncate flex-1">{e.description || e.file_name || '—'}</span>
                      {e.file_url && <Button variant="link" size="sm" className="h-auto p-0 text-[10px]" onClick={() => window.open(e.file_url, '_blank')}><ExternalLink className="h-3 w-3" /></Button>}
                      <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-destructive" onClick={() => removeEvidence.mutate(e.id)}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Working Papers */}
            <div className="rounded-lg border border-border/40 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-muted/30">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <FileText className="h-3 w-3" /> Working Papers ({workingPapers.length})
                </p>
              </div>
              {workingPapers.length === 0 ? (
                <p className="text-xs text-muted-foreground italic px-3 py-2">No working papers linked yet.</p>
              ) : (
                <div className="divide-y divide-border/30">
                  {workingPapers.map((wp: any) => (
                    <div key={wp.id} className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted/20">
                      <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="font-mono text-muted-foreground text-[10px]">{wp.working_paper_id || '—'}</span>
                      <span className="truncate flex-1">{wp.title || '—'}</span>
                      <StatusBadge status={wp.audit_area || 'General'} />
                      <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-destructive" onClick={() => removeWP.mutate(wp.id)}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Findings */}
            <div className="rounded-lg border border-border/40 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-muted/30">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <AlertTriangle className="h-3 w-3" /> Findings ({findings.length})
                </p>
              </div>
              {findings.length === 0 ? (
                <p className="text-xs text-muted-foreground italic px-3 py-2">No findings raised from this activity.</p>
              ) : (
                <div className="divide-y divide-border/30">
                  {findings.map((f: any) => (
                    <div key={f.id} className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted/20">
                      <AlertTriangle className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="truncate flex-1 font-medium">{f.title || '—'}</span>
                      <StatusBadge status={f.risk_rating || 'Medium'} />
                      <StatusBadge status={f.status || 'Open'} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ===== Main Component =====
export function AuditActivitiesTab({ auditId, departmentAuditId, auditors = [] }: AuditActivitiesTabProps) {
  const { data: activities = [], isLoading } = useEngagementActivities(auditId);
  const { data: allEvidence = [] } = useEngagementEvidence(auditId);
  const { data: allWorkingPapers = [] } = useEngagementWorkingPapers(auditId);
  const { data: allFindings = [] } = useIAFindings();
  const { create, update } = useIAActivityMutations();
  const { getCreateFields, getUpdateFields } = useAuditFields();
  const [modal, setModal] = useState<{ mode: 'create' | 'edit' | null; record?: any }>({ mode: null });
  const [form, setForm] = useState(emptyActivityForm);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const engagementFindings = useMemo(() => allFindings.filter((f: any) => f.engagement_id === auditId), [allFindings, auditId]);

  // Progress stats
  const completedCount = activities.filter((a: any) => a.status === 'Completed').length;
  const inProgressCount = activities.filter((a: any) => a.status === 'In Progress').length;
  const plannedCount = activities.filter((a: any) => a.status === 'Planned').length;
  const progressPct = activities.length > 0 ? Math.round((completedCount / activities.length) * 100) : 0;

  const filteredActivities = filterStatus === 'all' ? activities : activities.filter((a: any) => a.status === filterStatus);

  const openCreate = () => { setForm({ ...emptyActivityForm }); setModal({ mode: 'create' }); setAdvancedOpen(false); };
  const openEdit = (r: any) => {
    setForm({
      name: r.name || '', title: r.title || '', description: r.description || '', status: r.status || 'Planned',
      activity_type: r.activity_type || '', planned_date_from: r.planned_date_from || r.start_date || '',
      planned_date_to: r.planned_date_to || r.end_date || '', actual_date_from: r.actual_date_from || '',
      actual_date_to: r.actual_date_to || '', control_area: r.control_area || '', function_area: r.function_area || '',
      location: r.location || '', priority: r.priority || 'Medium', auditor_id: r.auditor_id || '', auditor_name: r.auditor_name || '',
    });
    setModal({ mode: 'edit', record: r });
  };

  const handleSave = () => {
    if (!form.name) return;
    const payload = {
      name: form.name, title: form.title || form.name, description: form.description || null,
      status: form.status, activity_type: form.activity_type || null,
      planned_date_from: form.planned_date_from || null, planned_date_to: form.planned_date_to || null,
      actual_date_from: form.actual_date_from || null, actual_date_to: form.actual_date_to || null,
      start_date: form.planned_date_from || null, end_date: form.planned_date_to || null,
      control_area: form.control_area || null, function_area: form.function_area || null,
      location: form.location || null, priority: form.priority || null,
      auditor_id: form.auditor_id || null, auditor_name: form.auditor_name || null,
      engagement_id: auditId, department_audit_id: departmentAuditId || null,
    };
    if (modal.mode === 'create') {
      create.mutate({ ...payload, ...getCreateFields() } as any, { onSuccess: () => setModal({ mode: null }) });
    } else if (modal.mode === 'edit' && modal.record) {
      update.mutate({ id: modal.record.id, ...payload, ...getUpdateFields() } as any, { onSuccess: () => setModal({ mode: null }) });
    }
  };

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      {/* Progress Dashboard */}
      <Card className="bg-gradient-to-r from-primary/5 to-transparent border-primary/10">
        <CardContent className="py-4 px-5">
          <div className="flex items-center gap-6">
            <div className="flex-1">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold">Fieldwork Progress</span>
                <span className="text-sm font-bold text-primary">{progressPct}%</span>
              </div>
              <Progress value={progressPct} className="h-2.5" />
            </div>
            <div className="flex gap-5 text-center shrink-0">
              <div><p className="text-xl font-bold">{activities.length}</p><p className="text-[10px] text-muted-foreground uppercase font-medium">Total</p></div>
              <div><p className="text-xl font-bold text-muted-foreground">{plannedCount}</p><p className="text-[10px] text-muted-foreground uppercase font-medium">Planned</p></div>
              <div><p className="text-xl font-bold text-amber-600">{inProgressCount}</p><p className="text-[10px] text-muted-foreground uppercase font-medium">Active</p></div>
              <div><p className="text-xl font-bold text-emerald-600">{completedCount}</p><p className="text-[10px] text-muted-foreground uppercase font-medium">Done</p></div>
              <div className="border-l border-border/50 pl-5">
                <p className="text-xl font-bold">{allEvidence.length}</p><p className="text-[10px] text-muted-foreground uppercase font-medium">Evidence</p>
              </div>
              <div><p className="text-xl font-bold">{allWorkingPapers.length}</p><p className="text-[10px] text-muted-foreground uppercase font-medium">Papers</p></div>
              <div><p className="text-xl font-bold">{engagementFindings.length}</p><p className="text-[10px] text-muted-foreground uppercase font-medium">Findings</p></div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Toolbar */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Activities</SelectItem>
              {ACTIVITY_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">{filteredActivities.length} of {activities.length}</span>
        </div>
        <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" />Add Activity</Button>
      </div>

      {/* Empty state */}
      {activities.length === 0 ? (
        <Card className="border-dashed border-2 border-muted-foreground/20">
          <CardContent className="py-12 text-center space-y-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <ClipboardCheck className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">No Activities Added Yet</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                Activities are the core of your audit fieldwork. Each activity is a working unit where you upload evidence, create working papers, and raise findings.
              </p>
            </div>
            <div className="flex items-center justify-center gap-3">
              <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" />Add First Activity</Button>
              <Button variant="outline"><ClipboardCheck className="h-4 w-4 mr-1" />Load Checklist Template</Button>
            </div>
            <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
              <Lightbulb className="h-3 w-3" />
              Tip: Start by loading a checklist template based on the audit type and department
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredActivities.map((activity: any) => {
            const actEvidence = allEvidence.filter((e: any) => e.activity_id === activity.id);
            const actWPs = allWorkingPapers.filter((wp: any) => wp.activity_id === activity.id);
            const actFindings = engagementFindings.filter((f: any) => f.activity_id === activity.id);
            return (
              <ActivityCard
                key={activity.id}
                activity={activity}
                evidence={actEvidence}
                workingPapers={actWPs}
                findings={actFindings}
                auditId={auditId}
                onEdit={() => openEdit(activity)}
              />
            );
          })}
        </div>
      )}

      {/* Create / Edit Form */}
      {modal.mode !== null && (
        <Card className="border-primary/20 shadow-md">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">{modal.mode === 'create' ? '✚ New Activity' : '✎ Edit Activity'}</p>
              <Button variant="ghost" size="sm" onClick={() => setModal({ mode: null })}>✕</Button>
            </div>

            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Core Information</p>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Activity Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Review payroll records" /></div>
              <div><Label>Activity Type</Label>
                <Select value={form.activity_type || '__none__'} onValueChange={v => setForm(f => ({ ...f, activity_type: v === '__none__' ? '' : v }))}>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Select type</SelectItem>
                    {ACTIVITY_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} className="text-sm leading-relaxed" /></div>

            <div className="grid grid-cols-3 gap-4">
              <div><Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{ACTIVITY_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Priority</Label>
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Assigned Auditor</Label>
                {auditors.length > 0 ? (
                  <Select value={form.auditor_id || '__none__'} onValueChange={v => { const a = auditors.find((x: any) => x.id === v); setForm(f => ({ ...f, auditor_id: v === '__none__' ? '' : v, auditor_name: a?.name || '' })); }}>
                    <SelectTrigger><SelectValue placeholder="Select auditor" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Select auditor</SelectItem>
                      {auditors.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={form.auditor_name} onChange={e => setForm(f => ({ ...f, auditor_name: e.target.value }))} placeholder="Auditor name" />
                )}
              </div>
            </div>

            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pt-2">Schedule</p>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Planned Start</Label><Input type="date" value={form.planned_date_from} onChange={e => setForm(f => ({ ...f, planned_date_from: e.target.value }))} /></div>
              <div><Label>Planned End</Label><Input type="date" value={form.planned_date_to} onChange={e => setForm(f => ({ ...f, planned_date_to: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Actual Start</Label><Input type="date" value={form.actual_date_from} onChange={e => setForm(f => ({ ...f, actual_date_from: e.target.value }))} /></div>
              <div><Label>Actual End</Label><Input type="date" value={form.actual_date_to} onChange={e => setForm(f => ({ ...f, actual_date_to: e.target.value }))} /></div>
            </div>

            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider pt-2 cursor-pointer hover:text-foreground transition-colors">
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
                Additional Details
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3 space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div><Label>Control Area</Label><Input value={form.control_area} onChange={e => setForm(f => ({ ...f, control_area: e.target.value }))} placeholder="e.g. Payroll Controls" /></div>
                  <div><Label>Function Area</Label><Input value={form.function_area} onChange={e => setForm(f => ({ ...f, function_area: e.target.value }))} placeholder="e.g. Human Resources" /></div>
                  <div><Label>Location</Label><Input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Head Office" /></div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} disabled={create.isPending || update.isPending}>Save Activity</Button>
              <Button variant="outline" onClick={() => setModal({ mode: null })}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
