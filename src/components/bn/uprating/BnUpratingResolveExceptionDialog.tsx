/**
 * BN Uprating — Resolve exception dialog (Epic 1).
 *
 * Officers may only select a resolution that the exception catalogue permits
 * for the exception code; there is no universal override. A justification is
 * always required and is recorded in exception history.
 */
import React from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2 } from 'lucide-react';
import type { BnUpratingExceptionRow } from '@/types/bn/uprating/upratingRun';

const RESOLUTION_LABELS: Record<string, string> = {
  EXCLUDE: 'Exclude from this run',
  CONFIRM_ELIGIBLE: 'Confirm eligible',
  CORRECTED_AT_SOURCE: 'Corrected at source',
  DEFER: 'Defer to a later run',
  ACCEPT_EXCEPTION: 'Accept exception',
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exception: BnUpratingExceptionRow | null;
  isSaving?: boolean;
  onSubmit: (values: { resolution_code: string; justification: string }) => void | Promise<void>;
}

export const BnUpratingResolveExceptionDialog: React.FC<Props> = ({
  open,
  onOpenChange,
  exception,
  isSaving,
  onSubmit,
}) => {
  const [resolution, setResolution] = React.useState('');
  const [justification, setJustification] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setResolution('');
      setJustification('');
    }
  }, [open, exception?.exception_id]);

  const allowed = exception?.allowed_resolutions ?? [];
  const canSubmit = !!resolution && justification.trim().length >= 5 && !isSaving;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Resolve exception</DialogTitle>
          <DialogDescription>
            Record how this exception is handled for the current population snapshot.
          </DialogDescription>
        </DialogHeader>

        {exception && (
          <div className="space-y-4">
            <div className="rounded-md border p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{exception.award_reference}</span>
                <Badge variant={exception.is_blocking ? 'destructive' : 'secondary'}>
                  {exception.is_blocking ? 'Blocking' : 'Warning'}
                </Badge>
                <Badge variant="outline">{exception.owning_domain}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{exception.business_explanation}</p>
            </div>

            {exception.requires_source_correction && (
              <Alert>
                <AlertDescription>
                  This exception is owned by another area. If the underlying data is corrected there,
                  rebuild the population so the correction is picked up.
                </AlertDescription>
              </Alert>
            )}

            <div className="grid gap-2">
              <Label htmlFor="upr-exc-resolution">Resolution</Label>
              <Select value={resolution} onValueChange={setResolution}>
                <SelectTrigger id="upr-exc-resolution">
                  <SelectValue placeholder="Select a permitted resolution" />
                </SelectTrigger>
                <SelectContent>
                  {allowed.map((code) => (
                    <SelectItem key={code} value={code}>
                      {RESOLUTION_LABELS[code] ?? code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Only resolutions permitted for this exception type are listed.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="upr-exc-justification">Justification</Label>
              <Textarea
                id="upr-exc-justification"
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder="Explain the decision for the audit record."
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() => void onSubmit({ resolution_code: resolution, justification })}
          >
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Record resolution
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
