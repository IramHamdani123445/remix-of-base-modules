/**
 * Attach Evidence — Compliance Inspection Evidence Register.
 *
 * The binary is uploaded to the PRIVATE `ce-field-evidence` bucket and the
 * metadata row is created by the governed RPC `ce_evidence_attach_v1`, which
 * validates the inspection/finding relationship, records the authenticated
 * capturer and writes the audit entry. Success is only reported when BOTH the
 * storage object and the database record exist.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, MapPin } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  EVIDENCE_BUCKET, EVIDENCE_TYPE_LABELS, formatFileSize, uploadEvidenceObject, validateEvidenceFile,
} from '@/lib/compliance/evidenceFileAccess';

const EVIDENCE_TYPES = ['DOCUMENT', 'PHOTO', 'PAYROLL', 'SIGNED_SHEET', 'NOTE', 'OTHER'] as const;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selects an inspection when the dialog is opened from a workspace. */
  inspectionId?: string;
  onCreated?: () => void;
}

interface InspectionOption {
  id: string;
  inspection_number: string;
  employer_name: string | null;
  employer_id: string;
  status: string | null;
}

export function EvidenceUploadDialog({ open, onOpenChange, inspectionId, onCreated }: Props) {
  const qc = useQueryClient();
  const [selectedInspection, setSelectedInspection] = useState<string>('');
  const [findingId, setFindingId] = useState<string>('');
  const [evidenceType, setEvidenceType] = useState<string>('DOCUMENT');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [gpsLat, setGpsLat] = useState<string>('');
  const [gpsLng, setGpsLng] = useState<string>('');

  useEffect(() => {
    if (open) {
      setSelectedInspection(inspectionId ?? '');
      setFindingId('');
      setEvidenceType('DOCUMENT');
      setDescription('');
      setFile(null);
      setGpsLat('');
      setGpsLng('');
    }
  }, [open, inspectionId]);

  const inspectionsQ = useQuery({
    queryKey: ['ce-inspections-picker'],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ce_inspections')
        .select('id, inspection_number, employer_name, employer_id, status')
        .order('scheduled_date', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as InspectionOption[];
    },
  });

  const selected = useMemo(
    () => (inspectionsQ.data ?? []).find((i) => i.id === selectedInspection) ?? null,
    [inspectionsQ.data, selectedInspection],
  );

  const findingsQ = useQuery({
    queryKey: ['ce-inspection-findings', selectedInspection],
    enabled: open && !!selectedInspection,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ce_inspection_findings')
        .select('id, title, finding_type')
        .eq('inspection_id', selectedInspection)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; title: string | null; finding_type: string | null }>;
    },
  });

  const captureGps = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by this browser');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsLat(pos.coords.latitude.toFixed(6));
        setGpsLng(pos.coords.longitude.toFixed(6));
      },
      () => toast.error('Unable to read location'),
    );
  };

  const canSubmit = useMemo(() => {
    if (!selectedInspection) return false;
    if (evidenceType === 'NOTE') return description.trim().length > 0 || !!file;
    return !!file;
  }, [selectedInspection, evidenceType, description, file]);

  const upload = useMutation({
    mutationFn: async () => {
      let storagePath: string | null = null;
      let fileName = description.trim().slice(0, 80) || 'Note';
      let fileSize: number | null = null;
      let mimeType: string | null = null;

      if (file) {
        const invalid = validateEvidenceFile(file);
        if (invalid) throw new Error(invalid);
        storagePath = await uploadEvidenceObject(selectedInspection, file);
        fileName = file.name;
        fileSize = file.size;
        mimeType = file.type || null;
      }

      const { data, error } = await (supabase.rpc as any)('ce_evidence_attach_v1', {
        p_inspection_id: selectedInspection,
        p_evidence_type: evidenceType,
        p_file_name: fileName,
        p_storage_bucket: storagePath ? EVIDENCE_BUCKET : null,
        p_storage_path: storagePath,
        p_file_size: fileSize,
        p_mime_type: mimeType,
        p_description: description.trim() || null,
        p_finding_id: findingId || null,
        p_gps_lat: gpsLat ? Number(gpsLat) : null,
        p_gps_lng: gpsLng ? Number(gpsLng) : null,
      });
      if (error) {
        // Roll the orphan object back so storage and metadata never diverge.
        if (storagePath) await supabase.storage.from(EVIDENCE_BUCKET).remove([storagePath]).catch(() => {});
        throw error;
      }
      return data as string;
    },
    onSuccess: () => {
      toast.success('Evidence attached');
      qc.invalidateQueries({ queryKey: ['ce-evidence-register'] });
      qc.invalidateQueries({ queryKey: ['ce-evidence-facets'] });
      qc.invalidateQueries({ queryKey: ['inspection-evidence'] });
      onCreated?.();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to attach evidence'),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Attach Evidence</DialogTitle>
          <DialogDescription>
            Evidence is stored in secure compliance storage and linked to an inspection. The employer is
            derived from the selected inspection.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Inspection *</Label>
            <Select value={selectedInspection} onValueChange={(v) => { setSelectedInspection(v); setFindingId(''); }} disabled={!!inspectionId}>
              <SelectTrigger><SelectValue placeholder="Select an inspection" /></SelectTrigger>
              <SelectContent>
                {(inspectionsQ.data ?? []).map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.inspection_number} — {i.employer_name ?? i.employer_id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selected && (
              <p className="text-xs text-muted-foreground">
                Employer: <span className="font-medium">{selected.employer_name ?? '—'}</span> ({selected.employer_id})
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type *</Label>
              <Select value={evidenceType} onValueChange={setEvidenceType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EVIDENCE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{EVIDENCE_TYPE_LABELS[t] ?? t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Finding (optional)</Label>
              <Select value={findingId || 'none'} onValueChange={(v) => setFindingId(v === 'none' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not linked</SelectItem>
                  {(findingsQ.data ?? []).map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.title ?? f.finding_type ?? f.id.slice(0, 8)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>File {evidenceType === 'NOTE' ? '(optional for notes)' : '*'}</Label>
            <Input
              type="file"
              accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                if (f) {
                  const invalid = validateEvidenceFile(f);
                  if (invalid) { toast.error(invalid); e.target.value = ''; setFile(null); return; }
                }
                setFile(f);
              }}
            />
            {file && (
              <p className="text-xs text-muted-foreground">
                {file.name} • {formatFileSize(file.size)} • {file.type || 'unknown type'}
              </p>
            )}
            <p className="text-xs text-muted-foreground">Max 25 MB. Images, PDF, Word, Excel, CSV and text only.</p>
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this evidence and where was it obtained?"
              rows={3}
              maxLength={1000}
            />
          </div>

          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
            <div className="space-y-1.5">
              <Label className="text-xs">GPS Lat</Label>
              <Input value={gpsLat} onChange={(e) => setGpsLat(e.target.value)} placeholder="17.30" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">GPS Lng</Label>
              <Input value={gpsLng} onChange={(e) => setGpsLng(e.target.value)} placeholder="-62.72" />
            </div>
            <Button type="button" variant="outline" size="icon" onClick={captureGps} title="Use current location">
              <MapPin className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={upload.isPending}>Cancel</Button>
          <Button onClick={() => upload.mutate()} disabled={!canSubmit || upload.isPending}>
            {upload.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Attach Evidence
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
