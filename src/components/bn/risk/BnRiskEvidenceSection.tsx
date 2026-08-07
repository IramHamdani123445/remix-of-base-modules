/**
 * BN Risk — evidence panel (EPIC 1).
 *
 * The Risk module never stores its own documents: officers link official
 * records already held by the Board and record whether each one is usable.
 */
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatAuditDate } from '@/lib/dateFormat';
import { riskAssessmentService } from '@/services/bn/risk/riskAssessmentService';
import type {
  BnRiskAssessmentActionCode,
  BnRiskEvidenceRow,
  BnRiskFactorRow,
} from '@/types/bn/risk/riskAssessment';
import { referenceItems, useRiskReferenceData } from './useRiskReference';

const ASSESSMENT_SCOPE = '__ASSESSMENT__';

interface Props {
  assessmentId: string;
  rowVersion: number;
  evidence: readonly BnRiskEvidenceRow[];
  factors: readonly BnRiskFactorRow[];
  isActionEnabled: (action: BnRiskAssessmentActionCode) => boolean;
  onChanged: () => void;
}

export const BnRiskEvidenceSection: React.FC<Props> = ({
  assessmentId, rowVersion, evidence, factors, isActionEnabled, onChanged,
}) => {
  const queryClient = useQueryClient();
  const { data: reference } = useRiskReferenceData();

  const [linkOpen, setLinkOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [documentId, setDocumentId] = React.useState<string | null>(null);
  const [linkFactor, setLinkFactor] = React.useState(ASSESSMENT_SCOPE);
  const [usabilityRow, setUsabilityRow] = React.useState<BnRiskEvidenceRow | null>(null);
  const [usabilityCode, setUsabilityCode] = React.useState('');
  const [usabilityReason, setUsabilityReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const candidates = useQuery({
    queryKey: ['bn-risk-evidence-search', assessmentId, debounced],
    queryFn: async () => {
      const result = await riskAssessmentService.evidenceSearch(assessmentId, debounced || undefined);
      if (result.status !== 'OK' || !result.data) throw new Error(result.code ?? result.status);
      return result.data.rows;
    },
    enabled: linkOpen,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['bn-risk-assessment-detail', assessmentId] });
    queryClient.invalidateQueries({ queryKey: ['bn-risk-assessment-actions', assessmentId] });
    onChanged();
  };

  const linkMutation = useMutation({
    mutationFn: async () => {
      const result = await riskAssessmentService.execute({
        command: 'BN_RISK_OP_LINK_EVIDENCE',
        assessmentId,
        expectedRowVersion: rowVersion,
        payload: {
          document_id: documentId,
          scope_code: linkFactor === ASSESSMENT_SCOPE ? 'ASSESSMENT' : 'FACTOR',
          factor_id: linkFactor === ASSESSMENT_SCOPE ? null : linkFactor,
        },
      });
      if (result.status === 'FAILED') {
        throw new Error(result.errorMessage ?? 'The document could not be linked.');
      }
      return result;
    },
    onSuccess: () => { setLinkOpen(false); setDocumentId(null); invalidate(); },
    onError: (e: Error) => setError(e.message),
  });

  const unlinkMutation = useMutation({
    mutationFn: async (row: BnRiskEvidenceRow) => {
      const result = await riskAssessmentService.execute({
        command: 'BN_RISK_OP_UNLINK_EVIDENCE',
        assessmentId,
        expectedRowVersion: rowVersion,
        payload: { evidence_link_id: row.evidence_link_id },
      });
      if (result.status === 'FAILED') {
        throw new Error(result.errorMessage ?? 'The document could not be unlinked.');
      }
      return result;
    },
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  });

  const usabilityMutation = useMutation({
    mutationFn: async () => {
      const result = await riskAssessmentService.execute({
        command: 'BN_RISK_OP_RECORD_EVIDENCE_USABILITY',
        assessmentId,
        expectedRowVersion: rowVersion,
        payload: {
          evidence_link_id: usabilityRow?.evidence_link_id,
          usability_code: usabilityCode,
          usability_reason: usabilityReason.trim() || null,
        },
      });
      if (result.status === 'FAILED') {
        throw new Error(result.errorMessage ?? 'The assessment of this document could not be saved.');
      }
      return result;
    },
    onSuccess: () => { setUsabilityRow(null); invalidate(); },
    onError: (e: Error) => setError(e.message),
  });

  const linked = evidence.filter((e) => e.status === 'LINKED');

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Evidence</CardTitle>
          <CardDescription>
            Official records linked to this review. Each one must be assessed as usable
            before information gathering can be completed.
          </CardDescription>
        </div>
        <Button
          size="sm"
          disabled={!isActionEnabled('LINK_EVIDENCE')}
          onClick={() => { setError(null); setLinkOpen(true); }}
        >
          Link a document
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Applies to</TableHead>
                <TableHead>Usability</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {linked.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No documents linked yet.
                  </TableCell>
                </TableRow>
              )}
              {linked.map((row) => {
                const factor = factors.find((f) => f.factor_id === row.factor_id);
                return (
                  <TableRow key={row.evidence_link_id}>
                    <TableCell>
                      {row.document_title ?? row.document_reference ?? 'Document'}
                      <span className="block text-xs text-muted-foreground">
                        {row.document_reference} {row.document_source ? `· ${row.document_source}` : ''}
                      </span>
                    </TableCell>
                    <TableCell>
                      {row.received_on ? formatAuditDate(row.received_on, false) : '—'}
                    </TableCell>
                    <TableCell>
                      {row.scope_code === 'FACTOR'
                        ? (factor?.factor_reference ?? 'A factor')
                        : 'The whole assessment'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.usability_code === 'PENDING' ? 'outline' : 'secondary'}>
                        {row.usability_label}
                      </Badge>
                      {row.usability_reason && (
                        <span className="block text-xs text-muted-foreground">
                          {row.usability_reason}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="space-x-2 text-right whitespace-nowrap">
                      <Button
                        size="sm" variant="outline"
                        disabled={!isActionEnabled('RECORD_EVIDENCE_USABILITY')}
                        onClick={() => {
                          setError(null);
                          setUsabilityRow(row);
                          setUsabilityCode(row.usability_code === 'PENDING' ? '' : row.usability_code);
                          setUsabilityReason(row.usability_reason ?? '');
                        }}
                      >
                        Assess
                      </Button>
                      <Button
                        size="sm" variant="ghost"
                        disabled={!isActionEnabled('LINK_EVIDENCE') || unlinkMutation.isPending}
                        onClick={() => unlinkMutation.mutate(row)}
                      >
                        Unlink
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Link an official document</DialogTitle>
            <DialogDescription>
              Only records already held by the Board for this person can be linked.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Search documents</Label>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Title or reference" />
            </div>
            <div className="space-y-2">
              <Label>Applies to</Label>
              <Select value={linkFactor} onValueChange={setLinkFactor}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value={ASSESSMENT_SCOPE}>The whole assessment</SelectItem>
                  {factors.filter((f) => f.status === 'ACTIVE').map((f) => (
                    <SelectItem key={f.factor_id} value={f.factor_id}>
                      {f.factor_reference} — {f.factor_type_label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {candidates.isLoading && <Skeleton className="h-32 w-full" />}
            {candidates.isError && (
              <Alert variant="destructive">
                <AlertDescription>
                  Documents could not be searched. This is not confirmation that none exist.
                </AlertDescription>
              </Alert>
            )}
            {candidates.data && (
              <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-2">
                {candidates.data.length === 0 && (
                  <p className="p-2 text-sm text-muted-foreground">No matching documents.</p>
                )}
                {candidates.data.map((c) => (
                  <button
                    key={c.document_id}
                    type="button"
                    disabled={c.already_linked}
                    onClick={() => setDocumentId(c.document_id)}
                    className={`w-full rounded-md border p-2 text-left text-sm ${
                      documentId === c.document_id ? 'border-primary bg-accent' : 'border-transparent'
                    } ${c.already_linked ? 'opacity-50' : 'hover:bg-accent'}`}
                  >
                    <span className="font-medium">{c.document_title ?? c.document_reference}</span>
                    <span className="block text-xs text-muted-foreground">
                      {c.business_context ?? c.document_type_code ?? ''}
                      {c.already_linked ? ' · already linked' : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkOpen(false)}>Cancel</Button>
            <Button
              disabled={!documentId || linkMutation.isPending}
              onClick={() => linkMutation.mutate()}
            >
              {linkMutation.isPending ? 'Linking…' : 'Link document'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!usabilityRow} onOpenChange={(o) => { if (!o) setUsabilityRow(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Is this document usable</DialogTitle>
            <DialogDescription>
              Record whether the document supports the review. This is an evidence
              judgement only — it does not decide the case.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Usability</Label>
              <Select value={usabilityCode} onValueChange={setUsabilityCode}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {referenceItems(reference, 'EVIDENCE_USABILITY').map((i) => (
                    <SelectItem key={i.code} value={i.code}>{i.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Textarea
                rows={3}
                value={usabilityReason}
                onChange={(e) => setUsabilityReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUsabilityRow(null)}>Cancel</Button>
            <Button
              disabled={!usabilityCode || usabilityMutation.isPending}
              onClick={() => usabilityMutation.mutate()}
            >
              {usabilityMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};
