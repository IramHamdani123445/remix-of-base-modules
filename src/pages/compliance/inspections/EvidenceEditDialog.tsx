/**
 * Edit / Replace inspection evidence.
 *
 * Governance rule (Option C + versioning): the captured file itself is
 * IMMUTABLE. Metadata (type, description, linked finding) may be amended by
 * staff with field-execution rights. A corrected file is attached as a NEW
 * superseding version — the original row, file, capturer and timestamp are
 * retained and marked SUPERSEDED, with a mandatory replacement reason. Users
 * without the replacement capability never see a re-attach control.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Loader2, ShieldAlert, Upload } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  EVIDENCE_BUCKET, EVIDENCE_TYPE_LABELS, formatFileSize, uploadEvidenceObject, validateEvidenceFile,
} from '@/lib/compliance/evidenceFileAccess';

const EVIDENCE_TYPES = ['DOCUMENT', 'PHOTO', 'PAYROLL', 'SIGNED_SHEET', 'NOTE', 'OTHER'] as const;

export interface EditableEvidence {
  id: string;
  inspection_id: string | null;
  evidence_type: string;
  description: string | null;
  finding_id: string | null;
  file_name: string;
  version_no: number;
  downstream_locked: boolean;
  captured_by: string | null;
  captured_at: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  evidence: EditableEvidence | null;
  canEdit: boolean;
  canReplace: boolean;
  onSaved?: () => void;
}

export function EvidenceEditDialog({ open, onOpenChange, evidence, canEdit, canReplace, onSaved }: Props) {
  const qc = useQueryClient();
  const [evidenceType, setEvidenceType] = useState('DOCUMENT');
  const [description, setDescription] = useState('');
  const [findingId, setFindingId] = useState('');
  const [replacementFile, setReplacementFile] = useState<File | null>(null);
  const [replacementReason, setReplacementReason] = useState('');

  useEffect(() => {
    if (open && evidence) {
      setEvidenceType(evidence.evidence_type ?? 'DOCUMENT');
      setDescription(evidence.description ?? '');
      setFindingId(evidence.finding_id ?? '');
      setReplacementFile(null);
      setReplacementReason('');
    }
  }, [open, evidence]);

  const findingsQ = useQuery({
    queryKey: ['ce-inspection-findings', evidence?.inspection_id],
    enabled: open && !!evidence?.inspection_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ce_inspection_findings')
        .select('id, title, finding_type')
        .eq('inspection_id', evidence!.inspection_id!);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; title: string | null; finding_type: string | null }>;
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ce-evidence-register'] });
    qc.invalidateQueries({ queryKey: ['ce-evidence-detail'] });
    qc.invalidateQueries({ queryKey: ['inspection-evidence'] });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!evidence) return;
      const { error } = await (supabase.rpc as any)('ce_evidence_update_metadata_v1', {
        p_id: evidence.id,
        p_evidence_type: evidenceType,
        p_description: description.trim() || null,
        p_finding_id: findingId || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Evidence metadata updated');
      invalidate();
      onSaved?.();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to update evidence'),
  });

  const replace = useMutation({
    mutationFn: async () => {
      if (!evidence || !replacementFile || !evidence.inspection_id) return;
      const invalid = validateEvidenceFile(replacementFile);
      if (invalid) throw new Error(invalid);
      if (!replacementReason.trim()) throw new Error('A replacement reason is required');
      const path = await uploadEvidenceObject(evidence.inspection_id, replacementFile);
      const { error } = await (supabase.rpc as any)('ce_evidence_replace_v1', {
        p_id: evidence.id,
        p_file_name: replacementFile.name,
        p_storage_bucket: EVIDENCE_BUCKET,
        p_storage_path: path,
        p_file_size: replacementFile.size,
        p_mime_type: replacementFile.type || null,
        p_reason: replacementReason.trim(),
      });
      if (error) {
        await supabase.storage.from(EVIDENCE_BUCKET).remove([path]).catch(() => {});
        throw error;
      }
    },
    onSuccess: () => {
      toast.success('Superseding evidence version created — the original is retained');
      invalidate();
      onSaved?.();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to create replacement version'),
  });

  const busy = save.isPending || replace.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Evidence</DialogTitle>
          <DialogDescription>
            The original evidence file is immutable. Amend metadata below, or attach a superseding
            version — the original file, capturer and timestamp are always retained.
          </DialogDescription>
        </DialogHeader>

        {evidence?.downstream_locked && (
          <Alert>
            <ShieldAlert className="h-4 w-4" />
            <AlertDescription className="text-xs">
              This evidence supports a converted violation. Relinking it to another finding requires
              oversight authority.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <div className="rounded-md border p-3 text-xs text-muted-foreground space-y-0.5">
            <div><span className="font-medium text-foreground">File:</span> {evidence?.file_name}</div>
            <div><span className="font-medium text-foreground">Version:</span> v{evidence?.version_no ?? 1}</div>
            <div><span className="font-medium text-foreground">Captured by:</span> {evidence?.captured_by ?? '—'} (audit property — not editable)</div>
          </div>

          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={evidenceType} onValueChange={setEvidenceType} disabled={!canEdit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {EVIDENCE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{EVIDENCE_TYPE_LABELS[t] ?? t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Linked Finding</Label>
            <Select value={findingId || 'none'} onValueChange={(v) => setFindingId(v === 'none' ? '' : v)} disabled={!canEdit}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not linked</SelectItem>
                {(findingsQ.data ?? []).map((f) => (
                  <SelectItem key={f.id} value={f.id}>{f.title ?? f.finding_type ?? f.id.slice(0, 8)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={1000} disabled={!canEdit} />
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              <Label className="font-medium">Upload Superseding Evidence</Label>
            </div>
            {canReplace ? (
              <>
                <Input
                  type="file"
                  accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    if (f) {
                      const invalid = validateEvidenceFile(f);
                      if (invalid) { toast.error(invalid); e.target.value = ''; setReplacementFile(null); return; }
                    }
                    setReplacementFile(f);
                  }}
                />
                {replacementFile && (
                  <p className="text-xs text-muted-foreground">
                    {replacementFile.name} • {formatFileSize(replacementFile.size)}
                  </p>
                )}
                <Textarea
                  value={replacementReason}
                  onChange={(e) => setReplacementReason(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="Reason for the replacement (required) — e.g. original scan illegible"
                />
                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={!replacementFile || !replacementReason.trim() || busy}
                  onClick={() => replace.mutate()}
                >
                  {replace.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Create Superseding Version
                </Button>
              </>
            ) : (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <p className="text-xs text-muted-foreground rounded-md border border-dashed p-3">
                      You do not have permission to replace evidence. The original evidence file is
                      immutable — attach a new evidence record instead.
                    </p>
                  </TooltipTrigger>
                  <TooltipContent>Requires field execution authority</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Close</Button>
          <Button onClick={() => save.mutate()} disabled={!canEdit || busy}>
            {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Metadata
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
