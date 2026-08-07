/**
 * MEANS-TEST EPIC 6 — link an existing document to a requirement.
 *
 * This dialog never uploads or stores a document. It searches the documents
 * that already exist for the assessment's claim through the governed
 * document boundary and records which requirement and subject they support.
 */
import React from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, FileSearch, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { MeansGovernedSelect } from '@/components/bn/meansTests/controls/MeansControls';
import { meansQueryService } from '@/services/bn/meansTests/meansQueryService';
import {
  evidenceTypesFor,
  validateEvidenceLinkDraft,
  type BnMeansDocumentCandidate,
  type BnMeansEvidenceLink,
  type BnMeansEvidenceLinkDraft,
  type BnMeansEvidenceReference,
  type BnMeansEvidenceRequirement,
} from '@/types/bn/meansTests/meansEvidence';

export interface BnMeansLinkEvidenceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assessmentId: string;
  requirement: BnMeansEvidenceRequirement | null;
  requirements: readonly BnMeansEvidenceRequirement[];
  existingLinks: readonly BnMeansEvidenceLink[];
  reference: BnMeansEvidenceReference | null;
  submitting: boolean;
  commandError: { code: string; message: string } | null;
  onSubmit: (payload: Record<string, unknown>) => void;
}

const today = () => new Date().toISOString().slice(0, 10);

export const BnMeansLinkEvidenceDialog: React.FC<BnMeansLinkEvidenceDialogProps> = ({
  open, onOpenChange, assessmentId, requirement, requirements, existingLinks,
  reference, submitting, commandError, onSubmit,
}) => {
  const [requirementId, setRequirementId] = React.useState<string>('');
  const [term, setTerm] = React.useState('');
  const [selected, setSelected] = React.useState<BnMeansDocumentCandidate | null>(null);
  const [externalRef, setExternalRef] = React.useState('');
  const [evidenceType, setEvidenceType] = React.useState('');
  const [evidenceSource, setEvidenceSource] = React.useState('');
  const [documentDate, setDocumentDate] = React.useState('');
  const [periodFrom, setPeriodFrom] = React.useState('');
  const [periodTo, setPeriodTo] = React.useState('');
  const [expiryDate, setExpiryDate] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setRequirementId(requirement?.requirement_id ?? '');
    setTerm('');
    setSelected(null);
    setExternalRef('');
    setEvidenceType('');
    setEvidenceSource('');
    setDocumentDate('');
    setPeriodFrom(requirement?.period_from ?? '');
    setPeriodTo(requirement?.period_to ?? '');
    setExpiryDate('');
    setNotes('');
    setTouched(false);
  }, [open, requirement]);

  const active = requirements.find((r) => r.requirement_id === requirementId) ?? null;

  const search = useQuery({
    queryKey: ['bn-means-document-search', assessmentId, term],
    queryFn: () => meansQueryService.documentSearch(assessmentId, term),
    enabled: open,
  });

  const draft: BnMeansEvidenceLinkDraft = {
    requirement_code: active?.requirement_code ?? null,
    subject_kind: active?.subject_kind ?? null,
    subject_ref_id: active?.subject_ref_id ?? null,
    document_source: selected ? selected.document_source : externalRef ? 'EXTERNAL_REFERENCE' : null,
    document_ref: selected ? selected.document_ref : externalRef || null,
    evidence_type: evidenceType || null,
    document_date: documentDate || null,
    period_from: periodFrom || null,
    period_to: periodTo || null,
    expiry_date: expiryDate || null,
  };
  const validation = validateEvidenceLinkDraft(draft, existingLinks, today());
  const errorFor = (field: string) =>
    touched ? validation.errors.find((e) => e.field === field)?.message : undefined;

  const candidates = (search.data?.status === 'OK' ? search.data.data : null) ?? [];

  function handleSubmit() {
    setTouched(true);
    if (!validation.ok || !active) return;
    onSubmit({
      requirement_code: active.requirement_code,
      subject_kind: active.subject_kind,
      subject_ref_id: active.subject_ref_id,
      document_source: draft.document_source,
      document_ref: draft.document_ref,
      document_title: selected?.document_title ?? externalRef,
      document_type_code: selected?.document_type_code ?? null,
      evidence_type: evidenceType,
      evidence_source: evidenceSource || null,
      document_date: documentDate || null,
      period_from: periodFrom || null,
      period_to: periodTo || null,
      expiry_date: expiryDate || null,
      officer_notes: notes || null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="means-evidence-link-dialog">
        <DialogHeader>
          <DialogTitle>Link a document to a requirement</DialogTitle>
          <DialogDescription>
            Documents are not stored here. Find a document that already exists for this claim, or
            record an external reference, and say which requirement it supports.
          </DialogDescription>
        </DialogHeader>

        {commandError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{commandError.message}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <MeansGovernedSelect
            id="means-evidence-requirement-select"
            label="Requirement supported"
            value={requirementId}
            onChange={setRequirementId}
            optionSet={{
              state: 'SUCCESS',
              options: requirements.map((r) => ({
                value: r.requirement_id,
                label: `${r.requirement_label} — ${r.subject_label ?? 'This assessment'}`,
                description: r.reason ?? undefined,
              })),
            }}
            required
            error={errorFor('requirement_code') ?? errorFor('subject_ref_id')}
          />

          <div className="space-y-2">
            <Label>Find an existing document</Label>
            <div className="flex gap-2">
              <Input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Search claim documents by name or type"
                data-testid="means-evidence-document-search"
              />
              <Button type="button" variant="outline" onClick={() => void search.refetch()}>
                {search.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />}
              </Button>
            </div>
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border p-1">
              {search.isLoading && (
                <p className="p-2 text-sm text-muted-foreground">Searching documents…</p>
              )}
              {!search.isLoading && candidates.length === 0 && (
                <p className="p-2 text-sm text-muted-foreground">
                  No existing documents matched. Record an external reference below if the document
                  is held outside this system.
                </p>
              )}
              {candidates.map((c) => (
                <button
                  key={`${c.document_source}:${c.document_ref}`}
                  type="button"
                  onClick={() => { setSelected(c); setExternalRef(''); }}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-muted ${
                    selected?.document_ref === c.document_ref ? 'bg-muted' : ''
                  }`}
                  data-testid="means-evidence-document-option"
                >
                  <span className="truncate">{c.document_title ?? c.document_ref}</span>
                  <Badge variant="outline" className="ml-2 shrink-0">
                    {c.document_type_code ?? c.document_source}
                  </Badge>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="means-evidence-external">External reference (only if not held here)</Label>
            <Input
              id="means-evidence-external"
              value={externalRef}
              onChange={(e) => { setExternalRef(e.target.value); setSelected(null); }}
              placeholder="Reference number of a document held elsewhere"
            />
            {errorFor('document_ref') && (
              <p className="text-sm text-destructive">{errorFor('document_ref')}</p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <MeansGovernedSelect
              id="means-evidence-type-select"
              label="Kind of document"
              value={evidenceType}
              onChange={setEvidenceType}
              optionSet={{
                state: 'SUCCESS',
                options: evidenceTypesFor(reference, active?.requirement_code ?? null).map((o) => ({
                  value: o.value, label: o.label,
                })),
              }}
              required
              error={errorFor('evidence_type')}
            />
            <MeansGovernedSelect
              id="means-evidence-source-select"
              label="Where it came from"
              value={evidenceSource}
              onChange={setEvidenceSource}
              optionSet={{
                state: 'SUCCESS',
                options: (reference?.EVIDENCE_SOURCE ?? []).map((o) => ({
                  value: o.value, label: o.label,
                })),
              }}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="means-evidence-doc-date">Document date</Label>
              <Input id="means-evidence-doc-date" type="date" value={documentDate}
                onChange={(e) => setDocumentDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="means-evidence-expiry">Valid until</Label>
              <Input id="means-evidence-expiry" type="date" value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="means-evidence-from">Period covered from</Label>
              <Input id="means-evidence-from" type="date" value={periodFrom}
                onChange={(e) => setPeriodFrom(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="means-evidence-to">Period covered to</Label>
              <Input id="means-evidence-to" type="date" value={periodTo}
                onChange={(e) => setPeriodTo(e.target.value)} />
              {errorFor('period_to') && (
                <p className="text-sm text-destructive">{errorFor('period_to')}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="means-evidence-notes">Officer note</Label>
            <Textarea id="means-evidence-notes" value={notes} rows={2}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What does this document show?" />
          </div>

          {validation.warnings.map((w) => (
            <Alert key={w.field}>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{w.message}</AlertDescription>
            </Alert>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting} data-testid="means-evidence-link-submit">
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Link document
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BnMeansLinkEvidenceDialog;
