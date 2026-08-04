/**
 * Read-only summary of documents linked to a compliance case.
 * No uploads or mutations here — this is investigation/referral context only.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2 } from 'lucide-react';

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

interface Props {
  caseId: string;
}

export function CaseDocumentsTab({ caseId }: Props) {
  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['ce_case_documents', caseId],
    enabled: !!caseId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ce_case_documents')
        .select('id, title, document_type, description, uploaded_by_name, created_at, verified, is_confidential')
        .eq('case_id', caseId)
        .order('created_at', { ascending: false });
      if (error) return [];
      return data ?? [];
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Documents ({documents.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : documents.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No documents attached to this case</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Uploaded By</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((d: any) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">
                    {d.title}
                    {d.description ? (
                      <div className="text-xs text-muted-foreground truncate max-w-xs">{d.description}</div>
                    ) : null}
                  </TableCell>
                  <TableCell>{d.document_type || '-'}</TableCell>
                  <TableCell>{d.uploaded_by_name || '-'}</TableCell>
                  <TableCell>{d.created_at ? formatDate(d.created_at) : '-'}</TableCell>
                  <TableCell className="space-x-1">
                    {d.verified ? (
                      <Badge variant="outline">Verified</Badge>
                    ) : (
                      <Badge variant="outline">Unverified</Badge>
                    )}
                    {d.is_confidential ? <Badge variant="destructive">Confidential</Badge> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default CaseDocumentsTab;
