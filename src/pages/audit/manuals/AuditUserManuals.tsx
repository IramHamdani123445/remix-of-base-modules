import { useEffect } from 'react';
import { Download, FileText, FileType2, BookOpen } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import manifest from './auditManualsManifest.json';

type Manual = {
  id: string;
  title: string;
  description: string;
  role: string;
  version: string;
  generated: string;
  approvalDate: string | null;
  pdf: string;
  docx: string;
  pdfSizeKb: number;
  docxSizeKb: number;
};

const manuals = manifest as Manual[];

/**
 * Downloads inside the Lovable preview iframe are blocked, so fetch the file
 * and hand the browser a blob URL (with a window.open fallback).
 */
async function downloadFile(path: string) {
  const url = new URL(path, window.location.origin).toString();
  const fileName = path.split('/').pop() ?? 'download';
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export default function AuditUserManuals() {
  useEffect(() => {
    document.title = 'Internal Audit User Manuals | Downloads';
    const meta = document.querySelector('meta[name="description"]');
    if (meta) {
      meta.setAttribute(
        'content',
        'Download the Internal Audit user manuals for every role as PDF or DOCX, with version and approval tracking.',
      );
    }
  }, []);

  return (
    <div className="p-6 space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-muted-foreground">
          <BookOpen className="h-5 w-5" />
          <span className="text-sm">Internal Audit</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Internal Audit User Manuals</h1>
        <p className="text-muted-foreground max-w-3xl">
          Role-based manuals generated from the live application, with screenshots. Each manual
          carries a Document Control section recording its version history, change log and
          approval date. Re-export after every approval.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {manuals.map((m) => (
          <Card key={m.id} className="flex flex-col">
            <CardHeader className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-base">{m.title}</CardTitle>
                <Badge variant="secondary">v{m.version}</Badge>
              </div>
              <CardDescription>{m.description}</CardDescription>
            </CardHeader>
            <CardContent className="mt-auto space-y-3">
              <dl className="text-xs text-muted-foreground space-y-1">
                <div className="flex justify-between gap-2">
                  <dt>Role</dt>
                  <dd className="font-mono">{m.role}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Generated</dt>
                  <dd>{m.generated}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Approval date</dt>
                  <dd>{m.approvalDate ?? 'Pending'}</dd>
                </div>
              </dl>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => downloadFile(m.pdf)}
                >
                  <FileType2 className="h-4 w-4" />
                  PDF
                  <span className="text-xs text-muted-foreground">{m.pdfSizeKb} KB</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => downloadFile(m.docx)}
                >
                  <FileText className="h-4 w-4" />
                  DOCX
                  <span className="text-xs text-muted-foreground">{m.docxSizeKb} KB</span>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Download className="h-4 w-4" />
            Version control
          </CardTitle>
          <CardDescription>
            Minor versions (1.1, 1.2 …) cover clarifications and screenshot refreshes; a major
            version (2.0) is required when a process, role or control gate changes. A manual is
            only released once the Head of Internal Audit records an approval date.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
