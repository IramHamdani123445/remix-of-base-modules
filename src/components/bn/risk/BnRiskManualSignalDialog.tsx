/**
 * BN Risk — manual signal registration (BN_RISK_REGISTER_MANUAL_SIGNAL).
 *
 * Officers register referrals against a person selected from the governed
 * person search: no raw identifiers are typed, no technical keys are shown.
 * A justification is mandatory, and a restricted note may be recorded when
 * the officer holds the restricted-notes permission.
 */
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { riskCommandService } from '@/services/bn/risk/riskCommandService';
import { riskQueryService } from '@/services/bn/risk/riskQueryService';
import type { BnRiskPersonOption } from '@/types/bn/risk/riskSignals';
import { referenceItems, useRiskReferenceData } from './useRiskReference';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canRecordRestrictedNote: boolean;
  onCompleted: (signalReference?: string) => void;
}

export const BnRiskManualSignalDialog: React.FC<Props> = ({
  open, onOpenChange, canRecordRestrictedNote, onCompleted,
}) => {
  const { data: reference } = useRiskReferenceData();
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [person, setPerson] = React.useState<BnRiskPersonOption | null>(null);
  const [category, setCategory] = React.useState('');
  const [severity, setSeverity] = React.useState('MEDIUM');
  const [summary, setSummary] = React.useState('');
  const [observation, setObservation] = React.useState('');
  const [justification, setJustification] = React.useState('');
  const [restrictedNote, setRestrictedNote] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setSearch(''); setPerson(null); setCategory(''); setSeverity('MEDIUM');
      setSummary(''); setObservation(''); setJustification(''); setRestrictedNote('');
      setError(null); setNotice(null);
    }
  }, [open]);

  const people = useQuery({
    queryKey: ['bn-risk-person-search', search],
    queryFn: async () => {
      const result = await riskQueryService.personSearch(search);
      if (result.status !== 'OK' || !result.data) throw new Error(result.code ?? 'UNAVAILABLE');
      return result.data.rows;
    },
    enabled: open && search.trim().length >= 2 && !person,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const result = await riskCommandService.execute({
        command: 'BN_RISK_REGISTER_MANUAL_SIGNAL',
        justification: justification.trim(),
        payload: {
          person_id: person?.person_id,
          category_code: category,
          severity_code: severity,
          summary: summary.trim(),
          observation: observation.trim() || null,
          restricted_note: canRecordRestrictedNote ? restrictedNote.trim() || null : null,
        },
      });
      if (result.status === 'FAILED') {
        throw new Error(result.errorMessage ?? 'The signal could not be registered.');
      }
      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['bn-risk-signal-queue'] });
      if (result.status === 'DUPLICATE') {
        setNotice(
          `An equivalent signal already exists (${result.signalReference}). No duplicate was created.`,
        );
        return;
      }
      onOpenChange(false);
      onCompleted(result.signalReference);
    },
    onError: (e: Error) => setError(e.message),
  });

  const canSubmit =
    !!person && !!category && summary.trim().length >= 5 &&
    justification.trim().length >= 10 && !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Register a manual signal</DialogTitle>
          <DialogDescription>
            Record a referral or observation made outside the automated checks.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
        )}
        {notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Person</Label>
            {person ? (
              <div className="flex items-center justify-between rounded-md border p-3 text-sm">
                <span>
                  <span className="font-medium">{person.full_name}</span>
                  <span className="block text-muted-foreground">
                    {person.masked_identifier ?? 'Identifier withheld'}
                  </span>
                </span>
                <Button variant="ghost" size="sm" onClick={() => setPerson(null)}>Change</Button>
              </div>
            ) : (
              <>
                <Input
                  value={search}
                  placeholder="Search by name or social security number"
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search.trim().length >= 2 && (
                  <div className="max-h-48 overflow-y-auto rounded-md border divide-y">
                    {people.isLoading && (
                      <p className="p-3 text-sm text-muted-foreground">Searching…</p>
                    )}
                    {people.data?.length === 0 && (
                      <p className="p-3 text-sm text-muted-foreground">No matches found.</p>
                    )}
                    {people.data?.map((p) => (
                      <button
                        key={p.person_id}
                        type="button"
                        className="block w-full p-3 text-left text-sm hover:bg-muted"
                        onClick={() => setPerson(p)}
                      >
                        <span className="font-medium">{p.full_name}</span>
                        <span className="block text-muted-foreground">
                          {p.masked_identifier ?? 'Identifier withheld'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Risk category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue placeholder="Select a category" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {referenceItems(reference, 'CATEGORY').map((i) => (
                    <SelectItem key={i.code} value={i.code}>{i.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Suggested priority</Label>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger><SelectValue placeholder="Select a priority" /></SelectTrigger>
                <SelectContent>
                  {referenceItems(reference, 'TRIAGE_PRIORITY').map((i) => (
                    <SelectItem key={i.code} value={i.code}>{i.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Summary</Label>
            <Input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Short description of what was observed"
            />
          </div>

          <div className="space-y-2">
            <Label>What was observed (optional)</Label>
            <Textarea value={observation} onChange={(e) => setObservation(e.target.value)} rows={3} />
          </div>

          <div className="space-y-2">
            <Label>Why is this being raised?</Label>
            <Textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              rows={3}
              placeholder="Required. At least 10 characters."
            />
          </div>

          {canRecordRestrictedNote && (
            <div className="space-y-2">
              <Label>Restricted note (optional)</Label>
              <Textarea
                value={restrictedNote}
                onChange={(e) => setRestrictedNote(e.target.value)}
                rows={3}
                placeholder="Only visible to officers with restricted-note access."
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!canSubmit} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Registering…' : 'Register signal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
