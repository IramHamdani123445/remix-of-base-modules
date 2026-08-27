import React, { useState } from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { BnStatusBadge } from '@/components/bn/shared/BnStatusBadge';
import { Loader2, Plus, Trash2, CheckCircle2, ShieldCheck, Rocket, XCircle, RotateCcw, Zap } from 'lucide-react';
import { useBnBatchDetail, useBnBatchItems } from '@/hooks/bn/useBnBatchOperations';
import { getAvailableBatchActions, type BatchAction, type ExecuteBatchActionParams } from '@/services/bn/batchOperationsService';
import { formatDateForDisplay } from '@/lib/format-config';
import { AddPayablesDialog } from '@/components/bn/batch/AddPayablesDialog';
import { PaymentExecutionPanel } from '@/components/bn/batch/PaymentExecutionPanel';

import { formatNumber } from '@/lib/culture/culture';
import { useActorUserCode } from '@/hooks/bn/useActorUserCode';
const ACTION_CONFIG: Record<string, { label: string; icon: any; variant: any; requiresNarrative: boolean }> = {
  VALIDATE:  { label: 'Validate',  icon: CheckCircle2, variant: 'outline',     requiresNarrative: false },
  APPROVE:   { label: 'Approve',   icon: ShieldCheck,  variant: 'default',     requiresNarrative: true },
  RELEASE:   { label: 'Release',   icon: Rocket,       variant: 'default',     requiresNarrative: true },
  ISSUE:     { label: 'Issue',     icon: Zap,          variant: 'default',     requiresNarrative: false },
  CANCEL:    { label: 'Cancel',    icon: XCircle,      variant: 'destructive', requiresNarrative: true },
  REOPEN:    { label: 'Reopen',    icon: RotateCcw,    variant: 'outline',     requiresNarrative: true },
};

interface Props {
  batchId: string | null;
  open: boolean;
  onClose: () => void;
  onAction: (params: ExecuteBatchActionParams) => Promise<void>;
  isActing: boolean;
}

export const BatchDetailDrawer: React.FC<Props> = ({ batchId, open, onClose, onAction, isActing }) => {
  // Writes must name a person, never the 'CURRENT_USER' placeholder.
  const { actor, userCode } = useActorUserCode();

  const { data: batch, isLoading: bLoading } = useBnBatchDetail(batchId || undefined);
  const { data: items = [], isLoading: iLoading } = useBnBatchItems(batchId || undefined);
  const [narrative, setNarrative] = useState('');
  const [showAddPayables, setShowAddPayables] = useState(false);

  const availableActions = batch ? getAvailableBatchActions(batch.status) : [];
  // Filter to workflow actions (not ADD/REMOVE which are handled separately)
  const workflowActions = availableActions.filter(
    a => !['ADD_PAYABLES', 'REMOVE_PAYABLE'].includes(a)
  );
  const canAddPayables = availableActions.includes('ADD_PAYABLES');
  const canRemove = availableActions.includes('REMOVE_PAYABLE');

  const handleWorkflowAction = async (action: BatchAction) => {
    const cfg = ACTION_CONFIG[action];
    if (cfg?.requiresNarrative && !narrative.trim()) return;
    await onAction({
      batchId: batchId!,
      action,
      userCode: actor(),
      narrative: narrative.trim() || undefined,
    });
    setNarrative('');
  };

  const handleRemoveItem = async (itemId: string) => {
    await onAction({
      batchId: batchId!,
      action: 'REMOVE_PAYABLE',
      userCode: actor(),
      removeItemId: itemId,
      narrative: 'Removed from batch',
    });
  };

  const handleAddPayables = async (payableIds: string[]) => {
    await onAction({
      batchId: batchId!,
      action: 'ADD_PAYABLES',
      userCode: actor(),
      payableIds,
    });
    setShowAddPayables(false);
  };

  const activeItems = items.filter(i => i.item_status !== 'REMOVED');

  return (
    <>
      <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {bLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : batch ? (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-3">
                  <span className="font-mono">{batch.batch_number}</span>
                  <BnStatusBadge status={batch.status} dot />
                </SheetTitle>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                {/* Batch Info */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground">Date:</span> {formatDateForDisplay(batch.batch_date)}</div>
                  <div><span className="text-muted-foreground">Method:</span> {batch.payment_method}</div>
                  <div><span className="text-muted-foreground">Office:</span> {batch.office_code}</div>
                  <div><span className="text-muted-foreground">Currency:</span> {batch.currency}</div>
                  <div><span className="text-muted-foreground">Created:</span> {batch.created_by}</div>
                  {batch.approved_by && <div><span className="text-muted-foreground">Approved:</span> {batch.approved_by}</div>}
                  {batch.released_by && <div><span className="text-muted-foreground">Released:</span> {batch.released_by}</div>}
                </div>

                {/* Totals */}
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: 'Total Items', value: batch.total_items },
                    { label: 'Total Amount', value: `${batch.currency} ${formatNumber(batch.total_amount, 2)}` },
                    { label: 'Validated', value: batch.validated_items },
                    { label: 'Issued', value: batch.issued_items },
                  ].map(({ label, value }) => (
                    <div key={label} className="p-2.5 rounded-md bg-muted text-center">
                      <div className="text-lg font-bold">{value}</div>
                      <div className="text-[10px] text-muted-foreground uppercase">{label}</div>
                    </div>
                  ))}
                </div>

                <Separator />

                {/* Items */}
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Batch Items ({activeItems.length})</h3>
                  {canAddPayables && (
                    <Button size="sm" variant="outline" onClick={() => setShowAddPayables(true)} className="gap-1">
                      <Plus className="h-3.5 w-3.5" /> Add Payables
                    </Button>
                  )}
                </div>

                {iLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                ) : activeItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No items in this batch yet.</p>
                ) : (
                  <div className="border rounded-md overflow-hidden max-h-[350px] overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className="text-xs">#</TableHead>
                          <TableHead className="text-xs">SSN</TableHead>
                          <TableHead className="text-xs">Claim</TableHead>
                          <TableHead className="text-xs">Type</TableHead>
                          <TableHead className="text-xs text-right">Amount</TableHead>
                          <TableHead className="text-xs">Status</TableHead>
                          {canRemove && <TableHead className="text-xs w-8" />}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {activeItems.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell className="font-mono text-xs">{item.sequence_number}</TableCell>
                            <TableCell className="font-mono text-xs">{item.ssn}</TableCell>
                            <TableCell className="text-xs">{item.claim_number || '—'}</TableCell>
                            <TableCell className="text-xs">{item.instruction_type}</TableCell>
                            <TableCell className="text-right font-mono text-xs">
                              {formatNumber(item.amount, 2)}
                            </TableCell>
                            <TableCell><BnStatusBadge status={item.item_status} size="sm" /></TableCell>
                            {canRemove && (
                              <TableCell>
                                {!['ISSUED', 'REMOVED'].includes(item.item_status) && (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-6 w-6"
                                    onClick={(e) => { e.stopPropagation(); handleRemoveItem(item.id); }}
                                  >
                                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                  </Button>
                                )}
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* Validation Errors Summary */}
                {activeItems.some(i => i.validation_errors?.length) && (
                  <div className="p-3 bg-destructive/5 border border-destructive/20 rounded-md">
                    <h4 className="text-xs font-semibold text-destructive mb-2">Validation Errors</h4>
                    {activeItems
                      .filter(i => i.validation_errors?.length)
                      .map(i => (
                        <div key={i.id} className="text-xs mb-1">
                          <span className="font-mono">{i.ssn}</span>: {i.validation_errors!.join('; ')}
                        </div>
                      ))}
                  </div>
                )}

                <Separator />

                {/* EFT / Cheque execution controls (visible once batch is APPROVED or RELEASED) */}
                {['APPROVED', 'RELEASED', 'PARTIALLY_ISSUED', 'ISSUED'].includes(batch.status) && (
                  <>
                    {/* userCode here is display only, and falls back to the signed-in
                        user rather than a placeholder, so the screen never shows
                        'CURRENT_USER'. */}
                    <PaymentExecutionPanel
                      batchId={batch.id}
                      batchType={(batch as any).batch_type || batch.payment_method as any}
                      countryCode={'KN'}
                      bankAccountRef={(batch as any).bank_account_ref || batch.office_code || 'DEFAULT'}
                      userCode={batch.created_by || userCode || '—'}
                      canExecute={['APPROVED', 'RELEASED', 'PARTIALLY_ISSUED'].includes(batch.status)}
                    />
                    <Separator />
                  </>
                )}

                {/* Actions */}
                {workflowActions.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold">Actions</h3>
                    {workflowActions.some(a => ACTION_CONFIG[a]?.requiresNarrative) && (
                      <div className="space-y-1.5">
                        <Label className="text-xs">Narrative / Reason</Label>
                        <Textarea
                          value={narrative}
                          onChange={(e) => setNarrative(e.target.value)}
                          placeholder="Enter reason for this action..."
                          rows={2}
                          className="text-sm"
                        />
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {workflowActions.map((action) => {
                        const cfg = ACTION_CONFIG[action];
                        if (!cfg) return null;
                        const Icon = cfg.icon;
                        const disabled = isActing || (cfg.requiresNarrative && !narrative.trim());
                        return (
                          <Button
                            key={action}
                            variant={cfg.variant}
                            size="sm"
                            disabled={disabled}
                            onClick={() => handleWorkflowAction(action)}
                            className="gap-1.5"
                          >
                            {isActing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
                            {cfg.label}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Notes */}
                {batch.notes && (
                  <div className="p-3 bg-muted rounded-md text-sm">
                    <span className="text-muted-foreground font-medium">Notes: </span>{batch.notes}
                  </div>
                )}
                {batch.cancel_reason && (
                  <div className="p-3 bg-destructive/5 border border-destructive/20 rounded-md text-sm">
                    <span className="text-destructive font-medium">Cancel Reason: </span>{batch.cancel_reason}
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">Batch not found.</p>
          )}
        </SheetContent>
      </Sheet>

      {/* Add Payables Dialog */}
      <AddPayablesDialog
        open={showAddPayables}
        onClose={() => setShowAddPayables(false)}
        onAdd={handleAddPayables}
        paymentMethod={batch?.payment_method}
        officeCode={batch?.office_code}
        isAdding={isActing}
      />
    </>
  );
};
