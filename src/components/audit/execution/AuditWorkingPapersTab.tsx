import React, { useMemo, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Plus, FileText, Trash2, Loader2, Paperclip, Eye, Download, X, ChevronDown, ChevronRight } from 'lucide-react';
import { StatusBadge, DataTable } from '@/components/common';
import type { DataTableColumn } from '@/components/common';
import { useEngagementWorkingPapers, useEngagementEvidence } from '@/hooks/useEngagementData';
import { useIAWorkingPaperMutations } from '@/hooks/useAuditDataExtended';
import { AuditEmptyState } from '@/components/audit/workspace/AuditEmptyState';
import { formatDateForDisplay } from '@/lib/format-config';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { useUserCode } from '@/hooks/useUserCode';
import { openAuditFile, downloadAuditFile } from '@/lib/audit/auditFileAccess';
import {
  AUDIT_ACCEPT_ATTRIBUTE,
  AUDIT_ATTACHMENT_BUCKET,
  formatFileSize,
  removeAuditObjects,
  uploadAuditAttachment,
  validateAuditFile,
} from '@/lib/audit/auditAttachmentUpload';

/**
 * IA-POST-UAT-04 — Working Paper attachments.
 *
 * Root cause of the original defect: the tab rendered an "Attach File" input that
 * `handleCreate` never read, so a selected file was silently discarded.
 *
 * Canonical model reused here (no fourth attachment architecture):
 *   Working Paper (ia_working_papers.evidence_ids[])
 *     → ia_evidence row (file metadata + object path)
 *       → private bucket `audit-attachments`
 * Reads always resolve a short-lived signed URL through `auditFileAccess`.
 */

interface AuditWorkingPapersTabProps {
  auditId: string;
}

interface StagedFile {
  file: File;
  error?: string;
}

export function AuditWorkingPapersTab({ auditId }: AuditWorkingPapersTabProps) {
  const { data: papers = [], isLoading } = useEngagementWorkingPapers(auditId);
  const { data: evidence = [] } = useEngagementEvidence(auditId);
  const { create, remove } = useIAWorkingPaperMutations();
  const { userCode } = useUserCode();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showForm, setShowForm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState({ title: '', reference_number: '', description: '', paper_type: 'Analysis' });

  const evidenceById = useMemo(() => {
    const map = new Map<string, any>();
    (evidence as any[]).forEach(e => map.set(e.id, e));
    return map;
  }, [evidence]);

  const attachmentsFor = (paper: any): any[] =>
    ((paper?.evidence_ids as string[]) || []).map(id => evidenceById.get(id)).filter(Boolean);

  const onFilesSelected = (files: FileList | null) => {
    if (!files || files.length === 0) { setStaged([]); return; }
    const next: StagedFile[] = Array.from(files).map(file => {
      const check = validateAuditFile(file);
      return { file, error: check.ok ? undefined : check.reason };
    });
    setStaged(next);
  };

  const clearStaged = () => {
    setStaged([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const resetForm = () => {
    setShowForm(false);
    setForm({ title: '', reference_number: '', description: '', paper_type: 'Analysis' });
    clearStaged();
  };

  const handleCreate = async () => {
    if (!form.title.trim()) {
      toast({ title: 'Title is required', variant: 'destructive' });
      return;
    }
    const invalid = staged.find(s => s.error);
    if (invalid) {
      toast({ title: 'Attachment rejected', description: invalid.error, variant: 'destructive' });
      return;
    }

    const workingPaperId = form.reference_number.trim() || `WP-${Date.now().toString(36).toUpperCase()}`;
    setUploading(true);

    let paperRow: any = null;
    const uploadedPaths: string[] = [];
    const evidenceIds: string[] = [];

    try {
      // 1. Working Paper first — a failure here must leave no orphan attachment.
      paperRow = await create.mutateAsync({
        title: form.title.trim(),
        working_paper_id: workingPaperId,
        description: form.description.trim() || null,
        audit_area: form.paper_type.trim() || 'Analysis',
        engagement_id: auditId,
        status: 'Draft',
      } as any);

      // 2. Upload each validated file into the PRIVATE audit bucket.
      for (const item of staged) {
        const uploaded = await uploadAuditAttachment('working-papers', auditId, paperRow.id, item.file);
        uploadedPaths.push(uploaded.path);

        // 3. Persist canonical attachment metadata (object path — never a signed URL).
        const { data: evRow, error: evErr } = await supabase
          .from('ia_evidence')
          .insert({
            evidence_id: `WP-EV-${Date.now().toString(36).toUpperCase()}-${evidenceIds.length + 1}`,
            description: `Working paper attachment — ${form.title.trim()}`,
            reference_no: workingPaperId,
            engagement_id: auditId,
            file_name: uploaded.originalName,
            file_url: uploaded.path,
            file_type: uploaded.mimeType,
            file_size: uploaded.size,
            uploaded_by: userCode || null,
            created_by: userCode || null,
            upload_date: new Date().toISOString(),
          } as any)
          .select()
          .single();
        if (evErr) throw new Error(evErr.message);
        evidenceIds.push(evRow.id);
      }

      // 4. Link attachments to the Working Paper.
      if (evidenceIds.length) {
        const { error: linkErr } = await supabase
          .from('ia_working_papers')
          .update({ evidence_ids: evidenceIds } as any)
          .eq('id', paperRow.id);
        if (linkErr) throw new Error(linkErr.message);
      }

      queryClient.invalidateQueries({ queryKey: ['eng_working_papers'] });
      queryClient.invalidateQueries({ queryKey: ['eng_evidence'] });
      queryClient.invalidateQueries({ queryKey: ['ia_evidence'] });
      toast({
        title: 'Working paper saved',
        description: evidenceIds.length
          ? `${evidenceIds.length} attachment(s) stored securely.`
          : 'No attachment was added.',
      });
      resetForm();
    } catch (err: any) {
      // Atomicity — remove orphan objects, metadata and the misleading paper row.
      await removeAuditObjects(uploadedPaths);
      if (evidenceIds.length) {
        await supabase.from('ia_evidence').delete().in('id', evidenceIds);
      }
      if (paperRow?.id) {
        await supabase.from('ia_working_papers').delete().eq('id', paperRow.id);
      }
      queryClient.invalidateQueries({ queryKey: ['eng_working_papers'] });
      toast({
        title: 'Working paper not saved',
        description: err?.message || 'The upload failed and nothing was stored.',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  const handleView = async (att: any) => {
    const ok = await openAuditFile(AUDIT_ATTACHMENT_BUCKET, att.file_url);
    if (!ok) toast({ title: 'Unable to open file', description: 'You may not have access to this attachment.', variant: 'destructive' });
  };

  const handleDownload = async (att: any) => {
    try {
      await downloadAuditFile(AUDIT_ATTACHMENT_BUCKET, att.file_url, att.file_name || 'attachment');
    } catch (err: any) {
      toast({ title: 'Download failed', description: err?.message, variant: 'destructive' });
    }
  };

  const columns: DataTableColumn<any>[] = [
    {
      key: 'expand', header: '', render: (r) => {
        const count = attachmentsFor(r).length;
        if (!count) return <span className="text-muted-foreground text-xs pl-1">—</span>;
        return (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setExpanded(e => ({ ...e, [r.id]: !e[r.id] }))}>
            {expanded[r.id] ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </Button>
        );
      }
    },
    { key: 'working_paper_id', header: 'Ref', render: (r) => <span className="font-mono text-xs">{r.working_paper_id || '—'}</span> },
    { key: 'title', header: 'Title', render: (r) => <span className="font-medium text-sm">{r.title || '—'}</span> },
    { key: 'audit_area', header: 'Area', render: (r) => <StatusBadge status={r.audit_area || 'General'} /> },
    { key: 'description', header: 'Description', render: (r) => <span className="text-xs max-w-[180px] truncate block">{r.description || '—'}</span> },
    {
      key: 'attachments', header: 'Attachments', render: (r) => {
        const count = attachmentsFor(r).length;
        return count
          ? <span className="text-xs inline-flex items-center gap-1"><Paperclip className="h-3 w-3" />{count}</span>
          : <span className="text-muted-foreground text-xs">None</span>;
      }
    },
    { key: 'created_at', header: 'Created', render: (r) => r.created_at ? formatDateForDisplay(r.created_at) : '—' },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status || 'Draft'} /> },
  ];

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{papers.length} working paper(s)</p>
        <Button size="sm" onClick={() => setShowForm(!showForm)}><Plus className="h-4 w-4 mr-1" />Add Working Paper</Button>
      </div>

      {showForm && (
        <Card className="border-primary/20">
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Title *</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Working paper title" /></div>
              <div><Label>Reference #</Label><Input value={form.reference_number} onChange={e => setForm(f => ({ ...f, reference_number: e.target.value }))} placeholder="e.g. WP-001" /></div>
              <div><Label>Type</Label><Input value={form.paper_type} onChange={e => setForm(f => ({ ...f, paper_type: e.target.value }))} placeholder="Analysis, Walkthrough, etc." /></div>
            </div>
            <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} /></div>
            <div>
              <Label>Attach Files</Label>
              <Input
                ref={fileInputRef}
                type="file"
                multiple
                accept={AUDIT_ACCEPT_ATTRIBUTE}
                className="text-xs"
                onChange={e => onFilesSelected(e.target.files)}
              />
              <p className="text-[11px] text-muted-foreground mt-1">PDF, Word, Excel or image. Maximum 20 MB per file. Files are stored in secure audit storage.</p>
              {staged.length > 0 && (
                <div className="mt-2 space-y-1">
                  {staged.map((s, i) => (
                    <div key={i} className={`flex items-center gap-2 text-xs rounded border px-2 py-1 ${s.error ? 'border-destructive/50 text-destructive' : 'border-border'}`}>
                      <Paperclip className="h-3 w-3 shrink-0" />
                      <span className="truncate flex-1">{s.file.name}</span>
                      <span className="text-muted-foreground">{formatFileSize(s.file.size)}</span>
                      <span className="text-muted-foreground">{s.file.type || 'unknown'}</span>
                      {s.error && <span className="font-medium">{s.error}</span>}
                    </div>
                  ))}
                  <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={clearStaged}><X className="h-3 w-3 mr-1" />Clear selection</Button>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCreate} disabled={create.isPending || uploading}>
                {uploading ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Saving...</> : 'Add Working Paper'}
              </Button>
              <Button variant="outline" onClick={resetForm} disabled={uploading}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {papers.length === 0 && !showForm ? (
        <AuditEmptyState icon={FileText} title="No working papers" description="Upload audit analyses, test results, and supporting documentation" actionLabel="Add Working Paper" onAction={() => setShowForm(true)} />
      ) : (
        <Card><CardContent className="pt-4 space-y-3">
          <DataTable columns={columns} data={papers} emptyMessage="No working papers."
            renderActions={(row) => (
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => remove.mutate(row.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          />
          {(papers as any[]).filter(p => expanded[p.id] && attachmentsFor(p).length).map(p => (
            <div key={p.id} className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-2">
              <p className="text-xs font-semibold">{p.working_paper_id} — attachments</p>
              {attachmentsFor(p).map((att: any) => (
                <div key={att.id} className="flex items-center gap-2 text-xs">
                  <Paperclip className="h-3 w-3 shrink-0" />
                  <span className="truncate flex-1">{att.file_name}</span>
                  <span className="text-muted-foreground">{formatFileSize(att.file_size)}</span>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void handleView(att)}><Eye className="h-3 w-3 mr-1" />View</Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void handleDownload(att)}><Download className="h-3 w-3 mr-1" />Download</Button>
                </div>
              ))}
            </div>
          ))}
        </CardContent></Card>
      )}
    </div>
  );
}
