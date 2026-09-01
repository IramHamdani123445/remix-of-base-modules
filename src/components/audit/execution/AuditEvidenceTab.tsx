import React, { useState, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, FileText, Trash2, Loader2, Eye, Edit, ExternalLink, Paperclip, X } from 'lucide-react';
import { StatusBadge, DataTable } from '@/components/common';
import type { DataTableColumn } from '@/components/common';
import { useEngagementEvidence } from '@/hooks/useEngagementData';
import { useIAEvidenceMutations } from '@/hooks/useAuditDataExtended';
import { AuditEmptyState } from '@/components/audit/workspace/AuditEmptyState';
import { formatDateForDisplay } from '@/lib/format-config';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useUserCode } from '@/hooks/useUserCode';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const ALLOWED_FILE_TYPES = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/png', 'image/jpeg'];
const MAX_FILE_SIZE = 20 * 1024 * 1024;

const emptyForm = {
  evidence_id: '', reference_no: '', description: '', file_name: '',
  file_url: '', file_type: '', tags: '' as string, activity_id: '', finding_id: '',
};

interface AuditEvidenceTabProps {
  auditId: string;
  auditFindings?: any[];
  auditActivities?: any[];
}

export function AuditEvidenceTab({ auditId, auditFindings = [], auditActivities = [] }: AuditEvidenceTabProps) {
  const { data: evidence = [], isLoading } = useEngagementEvidence(auditId);
  const { create, update, remove } = useIAEvidenceMutations();
  const { toast } = useToast();
  const { userCode } = useUserCode();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit' | 'view' | null>(null);
  const [editRecord, setEditRecord] = useState<any>(null);
  const [form, setForm] = useState(emptyForm);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const generateEvidenceId = () => `EVD-${Date.now().toString(36).toUpperCase().slice(-6)}`;

  const openCreate = () => {
    setForm({ ...emptyForm, evidence_id: generateEvidenceId() });
    setFormMode('create');
    setEditRecord(null);
    setAdvancedOpen(false);
  };

  const openEdit = (r: any) => {
    setForm({
      evidence_id: r.evidence_id || '', reference_no: r.reference_no || '',
      description: r.description || '', file_name: r.file_name || '',
      file_url: r.file_url || '', file_type: r.file_type || '',
      tags: Array.isArray(r.tags) ? r.tags.join(', ') : '', activity_id: r.activity_id || '', finding_id: r.finding_id || '',
    });
    setFormMode('edit');
    setEditRecord(r);
  };

  const openView = (r: any) => {
    openEdit(r);
    setFormMode('view');
  };

  const closeForm = () => {
    setFormMode(null);
    setEditRecord(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSave = async () => {
    if (!form.evidence_id) return;
    let fileUrl = form.file_url;
    let fileName = form.file_name;
    let fileType = form.file_type;
    let fileSize: number | null = null;

    const fileInput = fileInputRef.current;
    if (fileInput?.files?.[0]) {
      const file = fileInput.files[0];
      if (!ALLOWED_FILE_TYPES.includes(file.type) || file.size > MAX_FILE_SIZE) {
        toast({ title: 'Invalid File', description: 'Check file type or size (max 20MB)', variant: 'destructive' });
        return;
      }
      setUploading(true);
      const path = `evidence/${auditId}/${Date.now()}_${file.name}`;
      const { error } = await supabase.storage.from('audit-attachments').upload(path, file);
      setUploading(false);
      if (error) { toast({ title: 'Upload Failed', variant: 'destructive' }); return; }
      // Private bucket: persist the object path, resolve a signed URL on read.
      fileUrl = path;
      fileName = file.name;
      fileType = file.type;
      fileSize = file.size;
    }

    const tagsArray = form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : null;
    const payload = {
      evidence_id: form.evidence_id, reference_no: form.reference_no || null,
      description: form.description || null, file_name: fileName || null,
      file_url: fileUrl || null, file_type: fileType || null, file_size: fileSize,
      tags: tagsArray, activity_id: form.activity_id || null, finding_id: form.finding_id || null,
      engagement_id: auditId, uploaded_by: userCode || null, upload_date: new Date().toISOString(),
    };

    if (formMode === 'create') {
      create.mutate({ ...payload, created_by: userCode || null } as any, {
        onSuccess: () => closeForm(),
      });
    } else if (formMode === 'edit' && editRecord) {
      update.mutate({ id: editRecord.id, ...payload, updated_by: userCode || null } as any, {
        onSuccess: () => closeForm(),
      });
    }
  };

  const columns: DataTableColumn<any>[] = [
    { key: 'evidence_id', header: 'ID', render: (r) => <span className="font-mono text-xs">{r.evidence_id || '—'}</span> },
    { key: 'reference_no', header: 'Ref', render: (r) => <span className="text-xs">{r.reference_no || '—'}</span> },
    { key: 'description', header: 'Description', render: (r) => <span className="text-sm max-w-[200px] truncate block">{r.description || r.file_name || '—'}</span> },
    { key: 'file_name', header: 'File', render: (r) => {
      if (!r.file_url && !r.file_name) return <span className="text-muted-foreground text-xs">None</span>;
      return (
        <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={(e) => { e.stopPropagation(); if (r.file_url) window.open(r.file_url, '_blank'); }}>
          <Paperclip className="h-3 w-3 mr-1" />{r.file_name || 'View'}
        </Button>
      );
    }},
    { key: 'activity_id', header: 'Activity', render: (r) => {
      if (!r.activity_id) return <span className="text-muted-foreground text-xs">—</span>;
      const act = auditActivities.find((a: any) => a.id === r.activity_id);
      return <span className="text-xs">{act?.name || act?.title || r.activity_id.slice(0, 8)}</span>;
    }},
    { key: 'finding_id', header: 'Finding', render: (r) => {
      if (!r.finding_id) return <span className="text-muted-foreground text-xs">—</span>;
      const finding = auditFindings.find((f: any) => f.id === r.finding_id);
      return <span className="text-xs">{finding?.title || r.finding_id.slice(0, 8)}</span>;
    }},
    { key: 'tags', header: 'Tags', render: (r) => {
      if (!r.tags?.length) return <span className="text-muted-foreground text-xs">—</span>;
      return <div className="flex gap-1 flex-wrap">{r.tags.slice(0, 3).map((t: string, i: number) => <Badge key={i} variant="secondary" className="text-[10px] px-1.5 py-0">{t}</Badge>)}</div>;
    }},
    { key: 'upload_date', header: 'Uploaded', render: (r) => r.upload_date || r.created_at ? formatDateForDisplay(r.upload_date || r.created_at) : '—' },
  ];

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{evidence.length} evidence item(s)</p>
        <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" />Add Evidence</Button>
      </div>

      {/* Inline Form */}
      {formMode && (
        <Card className="border-primary/20">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">
                {formMode === 'create' ? 'Add New Evidence' : formMode === 'edit' ? 'Edit Evidence' : 'Evidence Detail'}
              </p>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={closeForm}><X className="h-4 w-4" /></Button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div><Label>Evidence ID *</Label><Input value={form.evidence_id} onChange={e => setForm(f => ({ ...f, evidence_id: e.target.value }))} disabled={formMode !== 'create'} className={formMode !== 'create' ? 'bg-muted' : ''} /></div>
              <div><Label>Reference No.</Label><Input value={form.reference_no} onChange={e => setForm(f => ({ ...f, reference_no: e.target.value }))} disabled={formMode === 'view'} placeholder="e.g. EVD-REF-001" /></div>
            </div>
            <div><Label>Description *</Label><Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} disabled={formMode === 'view'} className="text-sm" placeholder="Describe what this evidence is" /></div>

            {formMode !== 'view' && (
              <div>
                <Label>Attach File</Label>
                <Input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg" className="text-xs" />
                <p className="text-xs text-muted-foreground mt-1">PDF, DOC, XLS, PNG, JPG — max 20MB</p>
              </div>
            )}
            {form.file_name && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 border border-border/30">
                <Paperclip className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm">{form.file_name}</span>
                {form.file_url && <Button variant="link" size="sm" className="h-auto p-0 text-xs ml-auto" onClick={() => window.open(form.file_url, '_blank')}><ExternalLink className="h-3 w-3 mr-1" />Open</Button>}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div><Label>Link to Activity</Label>
                <Select value={form.activity_id || '__none__'} onValueChange={v => setForm(f => ({ ...f, activity_id: v === '__none__' ? '' : v }))} disabled={formMode === 'view'}>
                  <SelectTrigger><SelectValue placeholder="Select activity (optional)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {auditActivities.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name || a.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Link to Finding</Label>
                <Select value={form.finding_id || '__none__'} onValueChange={v => setForm(f => ({ ...f, finding_id: v === '__none__' ? '' : v }))} disabled={formMode === 'view'}>
                  <SelectTrigger><SelectValue placeholder="Select finding (optional)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {auditFindings.map((f: any) => <SelectItem key={f.id} value={f.id}>{f.title} ({f.risk_rating})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground transition-colors">
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
                Tags & Metadata
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3">
                <div><Label>Tags <span className="text-xs text-muted-foreground">(comma-separated)</span></Label>
                  <Input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} disabled={formMode === 'view'} placeholder="e.g. payroll, interview, supporting" />
                </div>
              </CollapsibleContent>
            </Collapsible>

            {formMode !== 'view' && (
              <div className="flex gap-2 pt-2">
                <Button onClick={handleSave} disabled={create.isPending || update.isPending || uploading}>
                  {uploading ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Uploading...</> : formMode === 'create' ? 'Add Evidence' : 'Save Changes'}
                </Button>
                <Button variant="outline" onClick={closeForm}>Cancel</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {evidence.length === 0 && !formMode ? (
        <AuditEmptyState icon={FileText} title="No evidence collected"
          description="Evidence includes documents, screenshots, interview notes, system extracts, and any supporting material gathered during audit procedures."
          actionLabel="Add Evidence" onAction={openCreate} />
      ) : evidence.length > 0 && (
        <Card><CardContent className="pt-4">
          <DataTable columns={columns} data={evidence} emptyMessage="No evidence items."
            renderActions={(row) => (
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); openView(row); }}><Eye className="h-3.5 w-3.5" /></Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); openEdit(row); }}><Edit className="h-3.5 w-3.5" /></Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={(e) => { e.stopPropagation(); remove.mutate(row.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            )}
          />
        </CardContent></Card>
      )}
    </div>
  );
}
