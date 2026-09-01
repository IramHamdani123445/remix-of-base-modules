/**
 * Secure evidence preview + audit trail drawer.
 * Images and PDFs render from a short-lived signed URL; every other format is
 * offered as a controlled download. Nothing is rendered from a persisted URL.
 */
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Loader2, Download, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  downloadEvidenceFile, formatFileSize, isPreviewable, resolveEvidenceUrl, evidenceTypeLabel,
  evidenceAccessMessage,
} from '@/lib/compliance/evidenceFileAccess';
import { useEvidenceDetail, type EvidenceRow } from '@/hooks/compliance/useEvidenceRegister';

interface Props {
  row: EvidenceRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EvidencePreviewDialog({ row, open, onOpenChange }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const detail = useEvidenceDetail(open && row ? row.id : null);
  const kind = row ? isPreviewable(row) : null;

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setErr(null);
    if (!open || !row || !kind) return;
    setLoading(true);
    resolveEvidenceUrl(row, 'VIEW').then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.ok) setUrl(res.url);
      else setErr(evidenceAccessMessage(res));
    });
    return () => { cancelled = true; };
  }, [open, row, kind]);

  if (!row) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="truncate">{row.file_name}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline">{evidenceTypeLabel(row.evidence_type)}</Badge>
            <span>{formatFileSize(row.file_size)}</span>
            <span>•</span>
            <span>{row.inspection_number ?? '—'}</span>
            <span>•</span>
            <span>{row.employer_name ?? '—'}</span>
            <span>•</span>
            <span>v{row.version_no}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {row.description && <p className="text-sm text-muted-foreground">{row.description}</p>}

          <div className="rounded-md border bg-muted/30 p-3 min-h-[160px] flex items-center justify-center">
            {loading ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            ) : err ? (
              <div className="text-center text-sm text-muted-foreground">
                <AlertTriangle className="h-6 w-6 mx-auto mb-2 text-destructive" />
                {err}
              </div>
            ) : url && kind === 'image' ? (
              <img src={url} alt={row.file_name} className="max-h-[420px] rounded" />
            ) : url && kind === 'pdf' ? (
              <iframe src={url} title={row.file_name} className="w-full h-[480px] rounded" />
            ) : (
              <div className="text-center text-sm text-muted-foreground">
                Inline preview is not available for this format.
                <div className="mt-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      const res = await downloadEvidenceFile(row);
                      if (!res.ok) toast.error(evidenceAccessMessage(res));
                    }}
                  >
                    <Download className="h-4 w-4 mr-2" /> Download securely
                  </Button>
                </div>
              </div>
            )}
          </div>

          <Separator />

          <div>
            <h4 className="text-sm font-medium mb-2">Version chain</h4>
            <div className="space-y-1 text-xs">
              {(detail.data?.versions ?? []).map((v) => (
                <div key={v.id} className="flex items-center justify-between rounded border px-2 py-1">
                  <span>v{v.version_no} — {v.file_name}</span>
                  <span className="flex items-center gap-2">
                    <Badge variant={v.status === 'ACTIVE' ? 'default' : 'secondary'}>{v.status}</Badge>
                    <span className="text-muted-foreground">{format(new Date(v.captured_at), 'dd MMM yyyy')}</span>
                  </span>
                </div>
              ))}
              {(detail.data?.versions ?? []).length === 0 && <p className="text-muted-foreground">No version history.</p>}
            </div>
          </div>

          <div>
            <h4 className="text-sm font-medium mb-2">Audit trail</h4>
            <div className="space-y-1 text-xs max-h-56 overflow-y-auto">
              {(detail.data?.audit ?? []).map((a, i) => (
                <div key={i} className="rounded border px-2 py-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{a.action.replace(/_/g, ' ')}</span>
                    <span className="text-muted-foreground">
                      {format(new Date(a.created_at), 'dd MMM yyyy HH:mm')} • {a.actor_code ?? '—'}
                    </span>
                  </div>
                  {a.reason && <div className="text-muted-foreground">Reason: {a.reason}</div>}
                </div>
              ))}
              {(detail.data?.audit ?? []).length === 0 && (
                <p className="text-muted-foreground">No audit entries recorded for this evidence yet.</p>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
