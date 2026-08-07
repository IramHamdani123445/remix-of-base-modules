/**
 * BN Risk — link related signals dialog (BN_RISK_LINK_SIGNALS).
 *
 * Linking is a working aid: both original signals are always preserved and
 * remain individually auditable.
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
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { riskCommandService } from '@/services/bn/risk/riskCommandService';
import { riskQueryService } from '@/services/bn/risk/riskQueryService';
import { referenceItems, useRiskReferenceData } from './useRiskReference';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  signalId: string;
  signalReference: string;
  rowVersion: number;
  onCompleted: () => void;
}

export const BnRiskLinkSignalsDialog: React.FC<Props> = ({
  open, onOpenChange, signalId, signalReference, rowVersion, onCompleted,
}) => {
  const { data: reference } = useRiskReferenceData();
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [selected, setSelected] = React.useState<string | null>(null);
  const [linkType, setLinkType] = React.useState('POSSIBLY_RELATED');
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setSearch(''); setSelected(null); setLinkType('POSSIBLY_RELATED');
      setReason(''); setError(null);
    }
  }, [open]);

  const candidates = useQuery({
    queryKey: ['bn-risk-link-candidates', signalId, search],
    queryFn: async () => {
      const result = await riskQueryService.relatedSignalSearch(signalId, search || undefined);
      if (result.status !== 'OK' || !result.data) throw new Error(result.code ?? 'UNAVAILABLE');
      return result.data.rows;
    },
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const result = await riskCommandService.execute({
        command: 'BN_RISK_LINK_SIGNALS',
        signalId,
        expectedRowVersion: rowVersion,
        payload: {
          related_signal_id: selected,
          link_type_code: linkType,
          link_reason: reason.trim() || null,
        },
      });
      if (result.status === 'FAILED') throw new Error(result.errorMessage ?? 'Link failed');
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bn-risk-signal-queue'] });
      queryClient.invalidateQueries({ queryKey: ['bn-risk-signal-detail', signalId] });
      queryClient.invalidateQueries({ queryKey: ['bn-risk-signal-actions', signalId] });
      onOpenChange(false);
      onCompleted();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Link related signals to {signalReference}</DialogTitle>
          <DialogDescription>
            Both signals are kept. Linking only records that the observations may
            belong together.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Find a signal</Label>
            <Input
              value={search}
              placeholder="Search by signal reference, source reference or identifier"
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="max-h-64 overflow-y-auto rounded-md border divide-y">
            {candidates.isLoading && (
              <p className="p-3 text-sm text-muted-foreground">Loading candidates…</p>
            )}
            {candidates.isError && (
              <p className="p-3 text-sm text-destructive">
                Related signals could not be loaded.
              </p>
            )}
            {candidates.data?.length === 0 && (
              <p className="p-3 text-sm text-muted-foreground">
                No candidate signals found.
              </p>
            )}
            {candidates.data?.map((row) => (
              <button
                key={row.signal_id}
                type="button"
                onClick={() => setSelected(row.signal_id)}
                className={`flex w-full items-start justify-between gap-3 p-3 text-left text-sm hover:bg-muted ${
                  selected === row.signal_id ? 'bg-muted' : ''
                }`}
              >
                <span>
                  <span className="font-medium">{row.signal_reference}</span>
                  <span className="block text-muted-foreground">{row.summary}</span>
                </span>
                <Badge variant="secondary">{row.status_label}</Badge>
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <Label>Relationship</Label>
            <Select value={linkType} onValueChange={setLinkType}>
              <SelectTrigger><SelectValue placeholder="Select relationship" /></SelectTrigger>
              <SelectContent>
                {referenceItems(reference, 'LINK_TYPE').map((i) => (
                  <SelectItem key={i.code} value={i.code}>{i.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Why are these related? (optional)</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!selected || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Linking…' : 'Link signals'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
