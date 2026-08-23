/**
 * FindingReviewDialog — classify an inspection finding before any violation
 * exists. Implements the Finding -> classify -> Flag / Violation candidate
 * step of the inspection lifecycle.
 */
import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  DISPOSITION_LABELS,
  FindingDisposition,
  findingDispositionService,
} from '@/services/compliance/findingDispositionService';

interface Props {
  findingId: string | null;
  findingTitle?: string;
  currentDisposition?: FindingDisposition | string | null;
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
  findingId, findingTitle, currentDisposition, open, onOpenChange, onClassified,
}: Props) {
  const [choice, setChoice] = useState<Exclude<FindingDisposition, 'CONVERTED'>>('VIOLATION_CANDIDATE');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const current = (currentDisposition ?? 'PENDING_REVIEW') as FindingDisposition;
    setChoice(CHOICES.includes(current as any) ? (current as any) : 'VIOLATION_CANDIDATE');
    setNotes('');
  }, [open, currentDisposition]);

  const handleSave = async () => {
    if (!findingId) return;
    setSaving(true);
    try {
      await findingDispositionService.classify(findingId, choice, notes || undefined);
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
            <Label htmlFor="review-notes">Review notes</Label>
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
