/**
 * Claim Workbench — Section 11: Action Bar
 * 
 * Source: bn_claim_transition_rule (transition matrix)
 * Renders available actions based on current status + user roles
 * 
 * Each action triggers:
 *   1. bn_claim.status update
 *   2. bn_claim_event insert (audit)
 *   3. Future: cl_head.status sync
 *   4. Future: workflow_instances task creation
 *   5. Future: notification_templates trigger
 */
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Save, AlertTriangle } from 'lucide-react';
import { BnActionToolbar, BnToolbarGroup } from '@/components/bn/shared/BnActionToolbar';
import type { ClaimTransition } from '@/services/bn/claimWorkbenchService';
import { BnBusyButton } from '@/components/bn/shared';

interface ClaimActionBarProps {
  claimId: string;
  currentStatus: string;
  availableTransitions: ClaimTransition[];
  onSave: () => void;
  onExecuteAction: (action: ClaimTransition, narrative?: string, reasonCode?: string) => void;
  isSaving: boolean;
  isExecuting: boolean;
  hasUnsavedChanges: boolean;
}

const actionVariant: Record<string, 'default' | 'destructive' | 'outline' | 'secondary'> = {
  APPROVE: 'default',
  DENY: 'destructive',
  SUSPEND: 'destructive',
  WITHDRAW: 'destructive',
  CLOSE: 'secondary',
  REOPEN: 'outline',
  SUBMIT: 'default',
  START_REVIEW: 'default',
  CHECK_ELIGIBILITY: 'default',
  REQUEST_EVIDENCE: 'outline',
  RUN_CALCULATION: 'default',
  SUBMIT_DECISION: 'default',
  REQUEST_INFO: 'outline',
};

export const ClaimActionBar: React.FC<ClaimActionBarProps> = ({
  claimId, currentStatus, availableTransitions, onSave, onExecuteAction,
  isSaving, isExecuting, hasUnsavedChanges,
}) => {
  const [confirmAction, setConfirmAction] = useState<ClaimTransition | null>(null);
  const [narrative, setNarrative] = useState('');
  const [reasonCode, setReasonCode] = useState('');

  const handleConfirm = () => {
    if (confirmAction) {
      onExecuteAction(confirmAction, narrative || undefined, reasonCode || undefined);
      setConfirmAction(null);
      setNarrative('');
      setReasonCode('');
    }
  };

  const handleActionClick = (transition: ClaimTransition) => {
    if (transition.requiresNarrative || transition.requiresReasonCode) {
      setConfirmAction(transition);
    } else {
      onExecuteAction(transition);
    }
  };

  return (
    <>
      <BnActionToolbar sticky>
        <BnToolbarGroup>
          <Badge variant="outline" className="font-mono text-xs">
            {currentStatus.replace(/_/g, ' ')}
          </Badge>
          {hasUnsavedChanges && (
            <Badge variant="outline" className="bg-amber-500/15 text-amber-700 border-amber-300 text-xs">
              Unsaved changes
            </Badge>
          )}
        </BnToolbarGroup>

        <BnToolbarGroup>
          {hasUnsavedChanges && (
            <BnBusyButton loading={isSaving} size="sm" variant="outline" onClick={onSave} disabled={isSaving} className="gap-1">
              <Save className="h-3.5 w-3.5" /> Save
            </BnBusyButton>
          )}

          {availableTransitions.map(transition => (
            <Button
              key={transition.action}
              size="sm"
              variant={actionVariant[transition.action] || 'outline'}
              onClick={() => handleActionClick(transition)}
              disabled={isExecuting}
            >
              {transition.label}
            </Button>
          ))}
        </BnToolbarGroup>
      </BnActionToolbar>

      {/* Confirmation Dialog for actions requiring narrative/reason */}
      <Dialog open={!!confirmAction} onOpenChange={open => !open && setConfirmAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {confirmAction?.action === 'DENY' || confirmAction?.action === 'SUSPEND'
                ? <AlertTriangle className="h-5 w-5 text-destructive" />
                : null}
              Confirm: {confirmAction?.label}
            </DialogTitle>
            <DialogDescription>
              This will change the claim status from {currentStatus.replace(/_/g, ' ')} to {confirmAction?.toStatus.replace(/_/g, ' ')}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {confirmAction?.requiresNarrative && (
              <div>
                <Label>Narrative <span className="text-destructive">*</span></Label>
                <Textarea
                  value={narrative}
                  onChange={e => setNarrative(e.target.value)}
                  placeholder="Provide reason or notes..."
                  rows={3}
                  className="mt-1"
                />
              </div>
            )}
            {confirmAction?.requiresReasonCode && (
              <div>
                <Label>Reason Code <span className="text-destructive">*</span></Label>
                <Input
                  value={reasonCode}
                  onChange={e => setReasonCode(e.target.value)}
                  placeholder="Enter reason code"
                  className="mt-1"
                />
              </div>
            )}

            {confirmAction?.preconditions && confirmAction.preconditions.length > 0 && (
              <div className="rounded-md bg-muted/50 p-3">
                <p className="text-xs font-medium text-muted-foreground mb-1">Preconditions:</p>
                {confirmAction.preconditions.map((pc, i) => (
                  <p key={i} className="text-xs text-muted-foreground">• {pc}</p>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>Cancel</Button>
            <Button
              variant={confirmAction?.action === 'DENY' || confirmAction?.action === 'SUSPEND' ? 'destructive' : 'default'}
              onClick={handleConfirm}
              disabled={
                (confirmAction?.requiresNarrative && !narrative.trim()) ||
                (confirmAction?.requiresReasonCode && !reasonCode.trim()) ||
                isExecuting
              }
            >
              Confirm {confirmAction?.label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
