/**
 * CreateViolationFromFindingDialog (Phase 4 — strong linkage wizard)
 *
 * Replaces the old single-screen create-form with a 2-step wizard that
 * forces the inspector to consciously link the violation to:
 *   1. Specific evidence captured during this audit
 *   2. The checklist response or working paper that triggered it
 *   3. Any prior open violation of the same employer + same type
 *      (so we don't accidentally double-issue)
 *   4. Any active payment arrangement that may need to be revisited
 *
 * All linkages persist on ce_violations.linked_* / related_* columns.
 */
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertTriangle, FileWarning, History, Link2, Loader2 } from 'lucide-react';
import { InspectionFinding, InspectionVisit, WeeklyPlanItem } from '@/types/inspectionTypes';
import { ViolationType } from '@/types/violation';
import { violationService } from '@/services/violationService';
import { inspectionService } from '@/services/inspectionService';
import { fieldAuditService } from '@/services/fieldAuditService';
import { findingDispositionService } from '@/services/compliance/findingDispositionService';
import { employerPriorContextService, EmployerPriorContext } from '@/services/employerPriorContextService';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Props {
  finding: InspectionFinding;
  visit?: InspectionVisit;
  planItem?: WeeklyPlanItem;
  employerId?: string;
  employerName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onViolationCreated: () => void;
}

interface VioTypeRow { id: string; code: string; name: string; }

export function CreateViolationFromFindingDialog({
  finding, visit, planItem, employerId, employerName, open, onOpenChange, onViolationCreated,
}: Props) {
  const isScouting = planItem?.itemType === 'SCOUTING' || !employerId;

  // Step 1 — violation core
  const [step, setStep] = useState<1 | 2>(1);
  const [violationTypeCode, setViolationTypeCode] = useState<ViolationType>(ViolationType.OTHER);
  const [violationTypeId, setViolationTypeId] = useState<string | null>(null);
  const [summary, setSummary] = useState(finding.title);
  const [description, setDescription] = useState(finding.description);
  const [priority, setPriority] = useState<'Low' | 'Medium' | 'High' | 'Critical'>(finding.severity);
  const [dueDate, setDueDate] = useState('');

  // Scouting fields
  const [candidateBusinessName, setCandidateBusinessName] = useState('');
  const [candidateLocation, setCandidateLocation] = useState('');
  const [candidateActivityType, setCandidateActivityType] = useState('');
  const [estimatedEmployees, setEstimatedEmployees] = useState('');

  // Step 2 — linkage
  const [evidenceList, setEvidenceList] = useState<any[]>([]);
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState<Set<string>>(new Set(finding.evidenceIds ?? []));
  const [linkedChecklistResponseId, setLinkedChecklistResponseId] = useState<string>('');
  const [checklistOptions, setChecklistOptions] = useState<any[]>([]);
  const [workingPaperOptions, setWorkingPaperOptions] = useState<any[]>([]);
  const [linkedWorkingPaperId, setLinkedWorkingPaperId] = useState<string>('');
  const [violationTypes, setViolationTypes] = useState<VioTypeRow[]>([]);

  const [priorContext, setPriorContext] = useState<EmployerPriorContext | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);
  const [relatedPriorViolationId, setRelatedPriorViolationId] = useState<string>('');
  const [relatedArrangementId, setRelatedArrangementId] = useState<string>('');

  const [submitting, setSubmitting] = useState(false);

  // Load violation types from DB so we can resolve type_id for prior-same-type lookup
  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase
        .from('ce_violation_types')
        .select('id, code, name')
        .eq('is_active', true)
        .order('name');
      setViolationTypes((data ?? []) as VioTypeRow[]);
    })();
  }, [open]);

  // Resolve violationTypeId whenever the user picks a type
  useEffect(() => {
    const t = violationTypes.find((v) => v.code === violationTypeCode);
    setViolationTypeId(t?.id ?? null);
  }, [violationTypeCode, violationTypes]);

  // Load evidence + checklist + working papers + prior context once dialog opens
  useEffect(() => {
    if (!open || !visit?.id) return;
    (async () => {
      try {
        const payload = await fieldAuditService.getReportPayload(visit.id);
        setEvidenceList(payload.evidence ?? []);
        setChecklistOptions((payload.checklist ?? []).filter((c: any) => c.response));
        setWorkingPaperOptions(payload.workingPapers ?? []);
      } catch (e) {
        console.warn('Failed to load audit context for linkage', e);
      }
    })();
  }, [open, visit?.id]);

  // Load prior context (depends on employer + selected violation type)
  useEffect(() => {
    if (!open || !employerId) { setPriorContext(null); return; }
    setLoadingContext(true);
    employerPriorContextService
      .getForEmployer({
        employerId,
        excludeInspectionId: visit?.id,
        sameTypeId: violationTypeId,
      })
      .then(setPriorContext)
      .finally(() => setLoadingContext(false));
  }, [open, employerId, visit?.id, violationTypeId]);

  const sameTypePrior = priorContext?.priorSameTypeViolations ?? [];
  const arrangements = (priorContext?.priorArrangements ?? []).filter(
    (a) => a.status && !['CLOSED', 'COMPLETED', 'CANCELLED'].includes(a.status.toUpperCase())
  );

  const toggleEvidence = (id: string) => {
    setSelectedEvidenceIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSubmit = async () => {
    try {
      setSubmitting(true);
      // Server-authoritative guard: classification + no prior conversion
      await findingDispositionService.assertConvertible(finding.id);
      const newViolation = await violationService.create({
        employerId: isScouting ? undefined : (employerId || visit?.employerId),
        violationType: violationTypeCode,
        priority,
        summary,
        description,
        inspectionVisitId: visit?.id,
        inspectionFindingId: finding.id,
        isUnlinked: isScouting,
        candidateBusinessName: isScouting ? candidateBusinessName : undefined,
        candidateLocation: isScouting ? candidateLocation : undefined,
        candidateActivityType: isScouting ? candidateActivityType : undefined,
        estimatedEmployees: isScouting ? parseInt(estimatedEmployees) || undefined : undefined,
        dueDate: dueDate || undefined,
        // Strong linkage
        linkedEvidenceIds: Array.from(selectedEvidenceIds),
        linkedChecklistResponseId: linkedChecklistResponseId || undefined,
        linkedWorkingPaperId: linkedWorkingPaperId || undefined,
        relatedPriorViolationId: relatedPriorViolationId || undefined,
        relatedArrangementId: relatedArrangementId || undefined,
        linkageMetadata: {
          source_finding_id: finding.id,
          source_finding_title: finding.title,
          captured_at: new Date().toISOString(),
        },
      });

      await inspectionService.markFindingAsViolationCreated(finding.id, newViolation.id);
      toast.success('Violation created with full linkage');
      onViolationCreated();
      onOpenChange(false);
      // reset for next use
      setStep(1);
      setSelectedEvidenceIds(new Set());
      setRelatedPriorViolationId('');
      setRelatedArrangementId('');
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message ?? 'Failed to create violation');
    } finally {
      setSubmitting(false);
    }
  };

  const canAdvance = useMemo(() => {
    if (isScouting) return summary && candidateBusinessName && candidateLocation;
    return summary && violationTypeCode;
  }, [summary, violationTypeCode, isScouting, candidateBusinessName, candidateLocation]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Create Violation from Finding · Step {step} of 2</DialogTitle>
          <DialogDescription>
            {step === 1 ? 'Define the violation details' : 'Link evidence, sources, and prior context'}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-3">
          {step === 1 && (
            <div className="space-y-4">
              {isScouting && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Scouting Violation</AlertTitle>
                  <AlertDescription>
                    No employer code yet. You can link this violation later when the business registers.
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label>Violation Type *</Label>
                <Select value={violationTypeCode} onValueChange={(v) => setViolationTypeCode(v as ViolationType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {violationTypes.length > 0
                      ? violationTypes.map((t) => (
                          <SelectItem key={t.id} value={t.code}>{t.name}</SelectItem>
                        ))
                      : Object.values(ViolationType).map((vt) => (
                          <SelectItem key={vt} value={vt}>{vt.replace(/_/g, ' ')}</SelectItem>
                        ))}
                  </SelectContent>
                </Select>
              </div>

              {isScouting && (
                <>
                  <div className="space-y-2">
                    <Label>Business Name *</Label>
                    <Input value={candidateBusinessName} onChange={(e) => setCandidateBusinessName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Location *</Label>
                    <Input value={candidateLocation} onChange={(e) => setCandidateLocation(e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Activity Type</Label>
                      <Input value={candidateActivityType} onChange={(e) => setCandidateActivityType(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Estimated Employees</Label>
                      <Input type="number" value={estimatedEmployees} onChange={(e) => setEstimatedEmployees(e.target.value)} min="0" />
                    </div>
                  </div>
                </>
              )}

              <div className="space-y-2">
                <Label>Summary *</Label>
                <Input value={summary} onChange={(e) => setSummary(e.target.value)} />
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Select value={priority} onValueChange={(v: any) => setPriority(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Low">Low</SelectItem>
                      <SelectItem value="Medium">Medium</SelectItem>
                      <SelectItem value="High">High</SelectItem>
                      <SelectItem value="Critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Due Date</Label>
                  <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              {/* Evidence linkage */}
              <section className="space-y-2">
                <div className="flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-primary" />
                  <Label className="text-base">Link supporting evidence</Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Select the specific evidence items captured during this audit that support this violation.
                </p>
                {evidenceList.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">
                    No evidence captured for this audit. Capture evidence first for stronger traceability.
                  </p>
                ) : (
                  <Card>
                    <CardContent className="p-3 space-y-2 max-h-48 overflow-y-auto">
                      {evidenceList.map((ev) => (
                        <label key={ev.id} className="flex items-start gap-2 cursor-pointer text-sm">
                          <Checkbox
                            checked={selectedEvidenceIds.has(ev.id)}
                            onCheckedChange={() => toggleEvidence(ev.id)}
                            className="mt-0.5"
                          />
                          <div className="flex-1">
                            <div className="font-medium">{ev.file_name ?? ev.fileName ?? 'Evidence'}</div>
                            {ev.description && <div className="text-muted-foreground text-xs">{ev.description}</div>}
                            <Badge variant="outline" className="mt-1 text-xs">
                              {ev.evidence_type ?? ev.evidenceType ?? 'OTHER'}
                            </Badge>
                          </div>
                        </label>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </section>

              {/* Checklist / Working Paper linkage */}
              <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Linked Checklist Response</Label>
                  <Select value={linkedChecklistResponseId} onValueChange={setLinkedChecklistResponseId}>
                    <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">None</SelectItem>
                      {checklistOptions.map((c: any) => (
                        <SelectItem key={c.id} value={c.id}>
                          [{c.response}] {(c.question_text ?? c.questionText ?? '').slice(0, 60)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Linked Working Paper</Label>
                  <Select value={linkedWorkingPaperId} onValueChange={setLinkedWorkingPaperId}>
                    <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">None</SelectItem>
                      {workingPaperOptions.map((w: any) => (
                        <SelectItem key={w.id} value={w.id}>
                          {(w.title ?? w.paper_type ?? 'Working paper').slice(0, 60)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </section>

              {/* Prior context */}
              {loadingContext ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Checking employer history…
                </div>
              ) : (
                <>
                  {sameTypePrior.length > 0 && (
                    <Alert className="border-warning/40 bg-warning/5">
                      <History className="h-4 w-4" />
                      <AlertTitle>Repeat-offence pattern detected</AlertTitle>
                      <AlertDescription className="space-y-2">
                        <p className="text-xs">
                          This employer has {sameTypePrior.length} prior violation(s) of this type. Link to one if this supersedes / continues it.
                        </p>
                        <Select value={relatedPriorViolationId} onValueChange={setRelatedPriorViolationId}>
                          <SelectTrigger><SelectValue placeholder="Don't link to a prior violation" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="">Don't link</SelectItem>
                            {sameTypePrior.map((v) => (
                              <SelectItem key={v.id} value={v.id}>
                                {v.violationNumber} — {v.status} — {v.summary?.slice(0, 50)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </AlertDescription>
                    </Alert>
                  )}

                  {arrangements.length > 0 && (
                    <Alert className="border-primary/40 bg-primary/5">
                      <FileWarning className="h-4 w-4" />
                      <AlertTitle>Active payment arrangement(s) on file</AlertTitle>
                      <AlertDescription className="space-y-2">
                        <p className="text-xs">
                          This employer has an active arrangement. Linking helps Compliance decide whether to revisit the plan.
                        </p>
                        <Select value={relatedArrangementId} onValueChange={setRelatedArrangementId}>
                          <SelectTrigger><SelectValue placeholder="Don't link to an arrangement" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="">Don't link</SelectItem>
                            {arrangements.map((a) => (
                              <SelectItem key={a.id} value={a.id}>
                                {a.arrangementNumber} — {a.status} — debt {a.totalDebt?.toFixed(2) ?? '0.00'}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </AlertDescription>
                    </Alert>
                  )}

                  {priorContext && !priorContext.hasAnyContext && (
                    <p className="text-xs text-muted-foreground italic">No prior compliance history found for this employer.</p>
                  )}
                </>
              )}
            </div>
          )}
        </ScrollArea>

        <div className="flex justify-between gap-2 pt-3 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <div className="flex gap-2">
            {step === 2 && (
              <Button variant="outline" onClick={() => setStep(1)} disabled={submitting}>
                Back
              </Button>
            )}
            {step === 1 ? (
              <Button onClick={() => setStep(2)} disabled={!canAdvance}>
                Next: Linkage
              </Button>
            ) : (
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? 'Creating…' : 'Create Violation'}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
