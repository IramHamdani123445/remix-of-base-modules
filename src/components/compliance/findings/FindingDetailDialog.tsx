/**
 * FindingDetailDialog — canonical Finding Review / Finding Detail surface for
 * the Inspection Findings Register.
 *
 * Read model: `ce_finding_detail_v1` (finding, inspection, employer, evidence,
 * linked violation, real audit timeline).
 * Write model: the same governed RPCs used by the Conversion Queue —
 * `ce_classify_finding_v1` for dispositions and
 * `ce_convert_finding_to_violation_v1` for promotion. No direct table writes.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  AlertTriangle, ArrowRightLeft, Building2, CheckCircle2, ClipboardList,
  ExternalLink, FileWarning, History, Loader2, Paperclip, ShieldAlert,
} from 'lucide-react';

import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useFindingDetail, type FindingsRegisterRow, SEVERITY_OPTIONS,
} from '@/hooks/compliance/useFindingsRegister';

export interface ViolationTypeOption {
  id: string;
  code: string;
  name: string;
  severity_default?: string | null;
  conversion_policy?: string | null;
}

interface Props {
  row: FindingsRegisterRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  violationTypes: ViolationTypeOption[];
  canReview: boolean;
  canConvert: boolean;
  onClassify: (input: {
    findingId: string; disposition: string; reason: string; candidateViolationTypeId?: string | null;
  }) => Promise<unknown>;
  onConvert: (input: {
    findingId: string; violationTypeId: string; summary: string; severity: string;
  }) => Promise<{ violation_number: string } | unknown>;
  busy?: boolean;
}

const DISPOSITION_CHOICES = [
  { value: 'VIOLATION_CANDIDATE', label: 'Violation candidate', help: 'Confirmed non-compliance — eligible for conversion into a violation.' },
  { value: 'FLAG_FOR_REVIEW', label: 'Flag for supervisor review', help: 'Needs an authorised supervisor decision before any violation is raised.' },
  { value: 'INFORMATIONAL', label: 'No violation required (advisory)', help: 'Recorded for the inspection report only. No violation will be raised.' },
];

const safeDate = (v?: string | null, pattern = 'dd MMM yyyy, HH:mm') => {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return 'Unknown';
  try { return format(d, pattern); } catch { return 'Unknown'; }
};

const clean = (v?: string | null, fallback = '—') =>
  v && String(v).trim() ? String(v).replace(/_/g, ' ') : fallback;

export function FindingDetailDialog({
  row, open, onOpenChange, violationTypes, canReview, canConvert,
  onClassify, onConvert, busy,
}: Props) {
  const navigate = useNavigate();
  const detail = useFindingDetail(open && row ? row.id : null);

  const [disposition, setDisposition] = useState('VIOLATION_CANDIDATE');
  const [reason, setReason] = useState('');
  const [typeId, setTypeId] = useState('');
  const [summary, setSummary] = useState('');
  const [severity, setSeverity] = useState('Medium');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !row) return;
    setDisposition(
      ['VIOLATION_CANDIDATE', 'FLAG_FOR_REVIEW', 'INFORMATIONAL'].includes(row.disposition_code)
        ? row.disposition_code : 'VIOLATION_CANDIDATE',
    );
    setReason('');
    setTypeId(row.candidate_violation_type_id ?? '');
    setSummary(row.title || row.description || '');
    setSeverity(
      SEVERITY_OPTIONS.find((s) => s.toLowerCase() === (row.severity || '').toLowerCase()) ?? 'Medium',
    );
  }, [open, row]);

  const isConverted = !!row?.violation_created;
  const canConvertNow = useMemo(
    () => canConvert && !isConverted && row?.disposition_code !== 'INFORMATIONAL',
    [canConvert, isConverted, row],
  );

  const evidence = detail.data?.evidence ?? [];
  const timeline = detail.data?.timeline ?? [];

  const handleClassify = async () => {
    if (!row) return;
    if (reason.trim().length < 10) {
      toast.error('A review note of at least 10 characters is required.');
      return;
    }
    setSaving(true);
    try {
      await onClassify({
        findingId: row.id,
        disposition,
        reason: reason.trim(),
        candidateViolationTypeId: typeId || null,
      });
      toast.success('Finding disposition recorded.');
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The decision could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const handleConvert = async () => {
    if (!row) return;
    if (!typeId) { toast.error('Select the violation type to raise.'); return; }
    if (summary.trim().length < 10) { toast.error('Provide a violation summary of at least 10 characters.'); return; }
    setSaving(true);
    try {
      const res = (await onConvert({
        findingId: row.id, violationTypeId: typeId, summary: summary.trim(), severity,
      })) as { violation_number?: string } | undefined;
      toast.success(
        res?.violation_number ? `Violation ${res.violation_number} created.` : 'Violation created.',
      );
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The finding could not be converted.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileWarning className="h-5 w-5 text-primary" />
            {row?.title?.trim() || 'Untitled finding'}
          </DialogTitle>
          <DialogDescription>
            {clean(row?.employer_name, 'Employer unavailable')} · {clean(row?.inspection_number, 'Inspection unavailable')} · raised {safeDate(row?.created_at, 'dd MMM yyyy')}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="detail">
          <TabsList>
            <TabsTrigger value="detail">Finding</TabsTrigger>
            <TabsTrigger value="evidence">Evidence ({evidence.length})</TabsTrigger>
            <TabsTrigger value="timeline">Lifecycle ({timeline.length})</TabsTrigger>
            <TabsTrigger value="decision" disabled={!canReview}>Decision</TabsTrigger>
          </TabsList>

          {/* -------------------------------------------------- detail */}
          <TabsContent value="detail" className="space-y-4 pt-4">
            <div className="grid gap-3 sm:grid-cols-3 text-sm">
              <Field label="Employer">
                <button
                  className="text-primary hover:underline text-left"
                  onClick={() => row?.employer_id && navigate(`/compliance/field/employer-360/${row.employer_id}`)}
                  disabled={!row?.employer_id}
                >
                  <span className="inline-flex items-center gap-1">
                    <Building2 className="h-3.5 w-3.5" />
                    {clean(row?.employer_name, 'Unavailable')}
                  </span>
                </button>
              </Field>
              <Field label="Inspection">
                <button
                  className="text-primary hover:underline font-mono text-xs"
                  onClick={() => navigate('/compliance/field/inspections')}
                >
                  {clean(row?.inspection_number, 'Unavailable')}
                </button>
              </Field>
              <Field label="Inspector">{clean(row?.inspector_name || row?.inspector_id, 'Unassigned')}</Field>
              <Field label="Finding type">{clean(row?.finding_type, 'Unclassified')}</Field>
              <Field label="Category">{clean(row?.category, 'Uncategorised')}</Field>
              <Field label="Severity">{clean(row?.severity, 'Unknown')}</Field>
              <Field label="Zone / territory">{clean(row?.territory)}</Field>
              <Field label="Current disposition">{clean(row?.disposition_code)}</Field>
              <Field label="Reviewed">
                {row?.reviewed_by ? `${row.reviewed_by} · ${safeDate(row.reviewed_at, 'dd MMM yyyy')}` : 'Not yet reviewed'}
              </Field>
            </div>

            <Separator />
            <div>
              <Label className="text-xs uppercase text-muted-foreground">Description</Label>
              <p className="text-sm mt-1 whitespace-pre-wrap">
                {row?.description?.trim() || 'No description was recorded for this finding.'}
              </p>
            </div>
            {row?.recommended_action ? (
              <div>
                <Label className="text-xs uppercase text-muted-foreground">Recommended action</Label>
                <p className="text-sm mt-1 whitespace-pre-wrap">{row.recommended_action}</p>
              </div>
            ) : null}
            {row?.review_notes ? (
              <div>
                <Label className="text-xs uppercase text-muted-foreground">Latest review note</Label>
                <p className="text-sm mt-1 whitespace-pre-wrap">{row.review_notes}</p>
              </div>
            ) : null}

            {detail.data?.violation ? (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription className="flex flex-wrap items-center gap-2">
                  Converted to
                  <button
                    className="text-primary hover:underline font-mono"
                    onClick={() => navigate(`/compliance/violations/${detail.data!.violation!.id}`)}
                  >
                    {detail.data.violation.violation_number}
                  </button>
                  <Badge variant="outline">{clean(detail.data.violation.status)}</Badge>
                  <span className="text-muted-foreground text-xs">
                    on {safeDate(detail.data.violation.created_at, 'dd MMM yyyy')}
                  </span>
                </AlertDescription>
              </Alert>
            ) : null}
          </TabsContent>

          {/* ------------------------------------------------ evidence */}
          <TabsContent value="evidence" className="pt-4">
            {detail.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : evidence.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No evidence items are attached to this finding.
              </p>
            ) : (
              <ul className="space-y-2">
                {evidence.map((e) => (
                  <li key={e.id} className="flex items-start gap-2 rounded-md border p-3 text-sm">
                    <Paperclip className="h-4 w-4 mt-0.5 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="font-medium truncate">{e.file_name || clean(e.evidence_type, 'Evidence item')}</div>
                      <div className="text-xs text-muted-foreground">
                        {clean(e.evidence_type)} · captured {safeDate(e.captured_at, 'dd MMM yyyy')} · {clean(e.captured_by, 'Unknown')}
                      </div>
                      {e.description ? <p className="text-xs mt-1">{e.description}</p> : null}
                    </div>
                    {e.file_url ? (
                      <a
                        className="ml-auto text-primary hover:underline text-xs inline-flex items-center gap-1"
                        href={e.file_url} target="_blank" rel="noreferrer"
                      >
                        Open <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          {/* ------------------------------------------------ timeline */}
          <TabsContent value="timeline" className="pt-4">
            {detail.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No recorded decisions yet — the finding has only been raised.
              </p>
            ) : (
              <ol className="relative border-l pl-4 space-y-4">
                {timeline.map((t, i) => (
                  <li key={`${t.action}-${i}`} className="text-sm">
                    <span className="absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full bg-primary" />
                    <div className="font-medium">{clean(t.action)}</div>
                    <div className="text-xs text-muted-foreground">
                      {safeDate(t.performed_at)} · {clean(t.performed_by, 'System')}
                    </div>
                    {t.reason ? <p className="text-xs mt-1">{t.reason}</p> : null}
                    {t.new_values && (t.new_values as Record<string, unknown>).reason ? (
                      <p className="text-xs mt-1">{String((t.new_values as Record<string, unknown>).reason)}</p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
            <p className="text-xs text-muted-foreground mt-4 inline-flex items-center gap-1">
              <History className="h-3 w-3" /> Events come from the compliance audit trail; nothing is inferred from the current status.
            </p>
          </TabsContent>

          {/* ------------------------------------------------ decision */}
          <TabsContent value="decision" className="space-y-4 pt-4">
            {isConverted ? (
              <Alert>
                <ShieldAlert className="h-4 w-4" />
                <AlertDescription>
                  This finding has already been converted to a violation and can no longer be re-classified.
                  Manage the outcome from the violation record.
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>Candidate violation type</Label>
                  <Select value={typeId} onValueChange={setTypeId}>
                    <SelectTrigger><SelectValue placeholder="Select the applicable violation type" /></SelectTrigger>
                    <SelectContent>
                      {violationTypes.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {detail.data?.candidate_violation_type?.conversion_policy ? (
                    <p className="text-xs text-muted-foreground">
                      Configured policy: {clean(detail.data.candidate_violation_type.conversion_policy)}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label>Disposition</Label>
                  <RadioGroup value={disposition} onValueChange={setDisposition} className="space-y-2">
                    {DISPOSITION_CHOICES.map((c) => (
                      <label key={c.value} className="flex items-start gap-3 rounded-md border p-3 cursor-pointer">
                        <RadioGroupItem value={c.value} className="mt-1" />
                        <span>
                          <span className="text-sm font-medium block">{c.label}</span>
                          <span className="text-xs text-muted-foreground">{c.help}</span>
                        </span>
                      </label>
                    ))}
                  </RadioGroup>
                </div>

                <div className="space-y-2">
                  <Label>Decision reason / review note <span className="text-destructive">*</span></Label>
                  <Textarea
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Record the basis for this decision (minimum 10 characters)…"
                  />
                </div>

                {canConvertNow ? (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <Label>Violation summary (used if you convert now)</Label>
                      <Input value={summary} onChange={(e) => setSummary(e.target.value)} />
                      <div className="w-48">
                        <Label className="text-xs">Violation severity</Label>
                        <Select value={severity} onValueChange={setSeverity}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {SEVERITY_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Conversion uses the same governed service as the Conversion Queue, including duplicate checks,
                        numbering, evidence linkage and the Verification Queue rule.
                      </p>
                    </div>
                  </>
                ) : null}
              </>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {!isConverted && canReview ? (
            <Button onClick={handleClassify} disabled={saving || busy}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ClipboardList className="h-4 w-4 mr-2" />}
              Save decision
            </Button>
          ) : null}
          {canConvertNow ? (
            <Button variant="default" onClick={handleConvert} disabled={saving || busy}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ArrowRightLeft className="h-4 w-4 mr-2" />}
              Convert to violation
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs uppercase text-muted-foreground">{label}</Label>
      <div className="text-sm mt-0.5">{children}</div>
    </div>
  );
}
