import React from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { BnEmptyState } from '@/components/bn/shared';
import { formatAuditTimestamp } from '@/lib/culture/culture';
import { downloadLetterPdf } from '@/services/bn/communication/letterGenerator';
import { ensureBnLetterSnapshot } from '@/services/bn/communication/bnLetterRenderer';
import { useUserCode } from '@/hooks/useUserCode';
import { Download, Printer } from 'lucide-react';
import { toast } from 'sonner';

const db = supabase as any;

interface Props { letterId: string | null; open: boolean; onOpenChange: (o: boolean) => void; }

export const LetterPreviewDialog: React.FC<Props> = ({ letterId, open, onOpenChange }) => {
  const { userCode } = useUserCode();
  const { data, isLoading } = useQuery({
    queryKey: ['bn-letter-detail', letterId],
    enabled: !!letterId && open,
    queryFn: async () => {
      const rendered = await ensureBnLetterSnapshot(letterId!);
      const { data: letter } = await db.from('bn_letter').select('*').eq('id', letterId).maybeSingle();
      if (!letter) return null;
      const [{ data: template }, { data: logs }] = await Promise.all([
        letter.template_id
          ? db.from('notification_templates').select('id, name, subject, html_body, body, template_code, version_no, channel').eq('id', letter.template_id).maybeSingle()
          : Promise.resolve({ data: null }),
        db.from('bn_communication_log').select('id, status, created_at, channel, delivery_method, error_message, context')
          .eq('letter_id', letterId).order('created_at', { ascending: true }),
      ]);
      return { letter, rendered, template: template || null, logs: logs || [] };
    },
  });

  const letter = data?.letter;
  const template = data?.template;
  const merge = letter?.merge_context || {};
  const printableHtml = data?.rendered?.printableHtml || '';

  const handlePrint = () => {
    if (!printableHtml) return;
    const win = window.open('', '_blank', 'width=900,height=900');
    if (!win) return toast.error('Popup blocked. Please allow popups to print the letter.');
    win.document.open();
    win.document.write(printableHtml);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 250);
  };

  const handleDownload = async () => {
    try { await downloadLetterPdf(letterId!, userCode || 'SYSTEM'); }
    catch (e: any) { toast.error(e?.message || 'Could not download PDF'); }
  };

  const events: Array<{ label: string; at?: string | null; by?: string | null }> = letter ? [
    { label: 'Generated', at: letter.generated_at || letter.created_at, by: letter.created_by },
    { label: 'Approved', at: letter.approved_at, by: letter.approved_by },
    { label: 'Printed', at: letter.printed_at, by: letter.printed_by },
    { label: 'Dispatched', at: letter.dispatched_at, by: letter.dispatched_by },
    { label: 'Delivered', at: letter.delivered_at },
    { label: 'Returned', at: letter.returned_at },
    { label: 'Cancelled', at: letter.cancelled_at },
  ].filter((e) => !!e.at) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[94vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>View Letter</DialogTitle>
          <DialogDescription>
            {letter?.reference_number || data?.rendered?.referenceNumber || 'Reference pending'}
            {template?.name ? ` · ${template.name}` : ''}
            {letter?.template_version_no ? ` · v${letter.template_version_no}` : ''}
          </DialogDescription>
        </DialogHeader>

        {isLoading || !letter ? (
          <BnEmptyState type="loading" title="Loading letter…" />
        ) : (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/20 p-3">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 flex-1">
              <Field label="Status" value={<Badge variant="outline">{letter.status}</Badge>} />
                <Field label="Reference No." value={letter.reference_number || data?.rendered?.referenceNumber || '—'} />
              <Field label="Recipient" value={letter.recipient_name || '—'} />
              <Field label="Document Type" value={letter.document_type || '—'} />
                <Field label="Created" value={formatAuditTimestamp(letter.created_at)} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={handlePrint}><Printer className="h-3.5 w-3.5 mr-1.5" />Print</Button>
                <Button size="sm" variant="outline" onClick={handleDownload}><Download className="h-3.5 w-3.5 mr-1.5" />Download PDF</Button>
                <span className="text-xs text-muted-foreground italic">Archived evidence — read only</span>
              </div>
            </div>

            {printableHtml ? (
              <iframe title="Printable Benefit letter" className="h-[68vh] w-full rounded-md border bg-background" srcDoc={printableHtml} />
              ) : (
              <p className="text-muted-foreground italic border rounded p-3">No printable letter was generated. Check that a LETTER template is configured for this event.</p>
              )}

            <Separator />

            {template && (
              <details>
                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                  Template details ({template.template_code} · {String(template.channel).toUpperCase()} · v{template.version_no})
                </summary>
                <pre className="mt-2 text-xs bg-muted/50 rounded p-2 overflow-auto max-h-60">
{`Subject: ${template.subject || '—'}\n\n${template.html_body || template.body || ''}`}
                </pre>
              </details>
            )}

            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Merge values used ({Object.keys(merge).length})</summary>
              <pre className="mt-2 text-xs bg-muted/50 rounded p-2 overflow-auto max-h-60">{JSON.stringify(merge, null, 2)}</pre>
            </details>

            <Separator />

            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Lifecycle history</p>
              {events.length === 0 ? (
                <p className="text-muted-foreground text-sm">No lifecycle events yet.</p>
              ) : (
                <ol className="space-y-1">
                  {events.map((e, i) => (
                    <li key={i} className="flex items-center gap-3 text-sm">
                      <Badge variant="outline" className="min-w-[100px] justify-center">{e.label}</Badge>
                      <span>{formatAuditTimestamp(e.at)}</span>
                      {e.by && <span className="text-xs text-muted-foreground">by {e.by}</span>}
                    </li>
                  ))}
                </ol>
              )}
            </div>

            {data?.logs && data.logs.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Communication log entries</p>
                <div className="border rounded divide-y">
                  {data.logs.map((l: any) => (
                    <div key={l.id} className="flex items-center justify-between p-2 text-xs gap-2">
                      <Badge variant="outline">{l.status}</Badge>
                      <span className="text-muted-foreground">{l.delivery_method || l.channel}</span>
                      <span>{formatAuditTimestamp(l.created_at)}</span>
                      {l.error_message && <span className="text-destructive truncate">{l.error_message}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

const Field: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    <div className="font-medium">{value}</div>
  </div>
);

export default LetterPreviewDialog;
