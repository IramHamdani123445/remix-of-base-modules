/**
 * FindingReviewDialog — classify an inspection finding before any violation
 * exists. The reviewer picks the candidate violation type; the configured
 * policy on that type (ce_violation_types) decides whether the finding can be
 * converted directly or must be confirmed by an independent supervisor.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Info, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  DISPOSITION_LABELS,
  FindingDisposition,
  ViolationTypePolicy,
  findingDispositionService,
} from '@/services/compliance/findingDispositionService';

interface Props {
  findingId: string | null;
  findingTitle?: string;
  currentDisposition?: FindingDisposition | string | null;
  currentCandidateViolationTypeId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClassified: (disposition: FindingDisposition) => void;
}

const CHOICES: Exclude<FindingDisposition, 'CONVERTED'>[] = [
  'INFORMATIONAL',
  'FLAG_FOR_REVIEW',
  'VIOLATION_CANDIDATE',
];

const CHOICE_HELP: Record<string, string> = {
  INFORMATIONAL: 'Recorded for the inspection report only. No violation will be raised.',
  FLAG_FOR_REVIEW: 'Needs supervisor / authorised review before a violation can be raised.',
  VIOLATION_CANDIDATE: 'Confirmed non-compliance — may be converted into a violation.',
};

export function FindingReviewDialog({
  findingId, findingTitle, currentDisposition, currentCandidateViolationTypeId,
  open, onOpenChange, onClassified,
}: Props) {
  const [choice, setChoice] = useState<Exclude<FindingDisposition, 'CONVERTED'>>('VIOLATION_CANDIDATE');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [types, setTypes] = useState<ViolationTypePolicy[]>([]);
  const [typeId, setTypeId] = useState<string>('');

  useEffect(() => {
    if (!open) return;
    const current = (currentDisposition ?? 'PENDING_REVIEW') as FindingDisposition;
    setChoice(CHOICES.includes(current as any) ? (current as any) : 'VIOLATION_CANDIDATE');
    setNotes('');
    setTypeId(currentCandidateViolationTypeId ?? '');
    findingDispositionService
      .listInspectionViolationTypes()
      .then(setTypes)
      .catch(() => setTypes([]));
  }, [open, currentDisposition, currentCandidateViolationTypeId]);

  const selectedPolicy = useMemo(
    () => types.find((t) => t.id === typeId) ?? null,
    [types, typeId],
  );

  const policyHint = useMemo(() => {
    if (!selectedPolicy) return 'Select a candidate violation type to see its configured conversion policy.';
    switch (selectedPolicy.conversionPolicy) {
      case 'INFORMATIONAL_ONLY':
        return 'Configuration: informational only — findings of this type never become violations.';
      case 'REVIEW_REQUIRED':
        return selectedPolicy.makerCheckerRequired
          ? 'Configuration: review-first with maker-checker — an independent supervisor must confirm this finding as a violation candidate.'
          : 'Configuration: review-first — the finding must be confirmed as a violation candidate before conversion.';
      default:
        return 'Configuration: direct conversion — an authorised officer may convert this finding straight away.';
    }
  }, [selectedPolicy]);

  const requiresReason =
    selectedPolicy?.makerCheckerRequired && choice === 'VIOLATION_CANDIDATE';

  const handleSave = async () => {
    if (!findingId) return;
    if (requiresReason && !notes.trim()) {
      toast.error('A decision reason is required for review-first violation types.');
      return;
    }
    setSaving(true);
    try {
      await findingDispositionService.classify(
        findingId,
        choice,
        notes || undefined,
        typeId || null,
      );
      toast.success(`Finding classified: ${DISPOSITION_LABELS[choice]}`);
      onClassified(choice);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to classify finding');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Review Finding</DialogTitle>
          <DialogDescription>
            {findingTitle ? `“${findingTitle}” — ` : ''}
            decide how this finding should be treated before any violation is raised.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="candidate-type">Candidate violation type</Label>
            <Select value={typeId} onValueChange={setTypeId}>
              <SelectTrigger id="candidate-type">
                <SelectValue placeholder="Not classified yet" />
              </SelectTrigger>
              <SelectContent>
                {types.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs">{policyHint}</AlertDescription>
            </Alert>
          </div>

          <RadioGroup value={choice} onValueChange={(v) => setChoice(v as any)} className="space-y-3">
            {CHOICES.map((c) => (
              <label key={c} className="flex items-start gap-3 rounded-md border p-3 cursor-pointer">
                <RadioGroupItem value={c} id={`disp-${c}`} className="mt-1" />
                <span>
                  <span className="block text-sm font-medium">{DISPOSITION_LABELS[c]}</span>
                  <span className="block text-xs text-muted-foreground">{CHOICE_HELP[c]}</span>
                </span>
              </label>
            ))}
          </RadioGroup>

          <div className="space-y-2">
            <Label htmlFor="review-notes">
              Review notes{requiresReason ? ' *' : ''}
            </Label>
            <Textarea
              id="review-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Why this classification was chosen"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !findingId}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save classification
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
