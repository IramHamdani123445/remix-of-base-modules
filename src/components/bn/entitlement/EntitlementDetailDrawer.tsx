/**
 * Entitlement Detail Drawer
 *
 * Shows full entitlement context + lifecycle actions.
 */
import React, { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, DollarSign, Calendar, Clock, ShieldCheck, AlertTriangle, History } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { formatDateForDisplay } from '@/lib/format-config';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { useBnEntitlementDetail, useBnEntitlementEvents, useExecuteEntitlementAction } from '@/hooks/bn/useBnEntitlement';
import { useBnReasonCodes } from '@/hooks/bn/useBnDecisionEngine';
import {
  ENTITLEMENT_ACTIONS,
  ENTITLEMENT_ROLE_MATRIX,
  ENTITLEMENT_STATUS_LABELS,
  type EntitlementAction,
  type BnEntitlementStatus,
} from '@/services/bn/entitlementService';

const statusColor: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  ACTIVE: 'bg-emerald-500/15 text-emerald-700',
  SUSPENDED: 'bg-amber-500/15 text-amber-700',
  EXHAUSTED: 'bg-muted text-muted-foreground',
  TERMINATED: 'bg-destructive/15 text-destructive',
  CANCELLED: 'bg-destructive/15 text-destructive',
  CLOSED: 'bg-muted text-muted-foreground',
  REOPENED: 'bg-blue-500/15 text-blue-700',
};

interface Props {
  entitlementId: string | null;
  onClose: () => void;
  userRoles?: string[];
  userCode?: string;
}

export const EntitlementDetailDrawer: React.FC<Props> = ({
  entitlementId,
  onClose,
  userRoles = ['admin', 'supervisor'],
  userCode = 'SYSTEM',
}) => {
  // `error` matters here: without it a failed load rendered nothing but the
  // drawer title, and this drawer is the only route to Suspend, Terminate and
  // Cancel — so the whole entitlement lifecycle looked simply absent.
  const { data: ent, isLoading, error: loadError } = useBnEntitlementDetail(entitlementId || undefined);
  const { data: events = [] } = useBnEntitlementEvents(entitlementId || undefined);
  const executeAction = useExecuteEntitlementAction();

  const [dialogAction, setDialogAction] = useState<EntitlementAction | null>(null);
  const [narrative, setNarrative] = useState('');
  const [reasonCodeId, setReasonCodeId] = useState('');
  const { data: reasonCodes } = useBnReasonCodes(dialogAction?.action);

  // Available actions based on current status and role
  const highestRole = userRoles.find(r => ENTITLEMENT_ROLE_MATRIX[r.toUpperCase()]?.canAct) || '';
  const roleConfig = ENTITLEMENT_ROLE_MATRIX[highestRole.toUpperCase()];
  const availableActions = ENTITLEMENT_ACTIONS.filter(a =>
    (roleConfig?.actions ?? []).includes(a.action) &&
    ent && a.fromStatuses.includes(ent.status as BnEntitlementStatus)
  );

  const handleConfirmAction = () => {
    if (!dialogAction || !entitlementId) return;
    if (dialogAction.requiresNarrative && !narrative.trim()) {
      toast.error('Narrative is required.');
      return;
    }
    if (dialogAction.requiresReasonCode && !reasonCodeId) {
      toast.error('Please select a reason code.');
      return;
    }
    executeAction.mutate(
      { entitlementId, action: dialogAction.action, narrative, reasonCodeId: reasonCodeId || undefined, performedBy: userCode },
      {
        onSuccess: (res) => {
          toast.success(`${dialogAction.label} completed. Status → ${res.newStatus}`);
          setDialogAction(null);
          setNarrative('');
          setReasonCodeId('');
        },
        onError: (err: any) => toast.error(err.message),
      }
    );
  };

  const utilizationPct = ent ? Math.min(100, ((ent.total_disbursed ?? 0) / Math.max(ent.total_entitlement, 1)) * 100) : 0;

  return (
    <>
      <Sheet open={!!entitlementId} onOpenChange={() => onClose()}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Entitlement Detail</SheetTitle>
          </SheetHeader>

          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}

          {!isLoading && loadError && (
            <Alert variant="destructive" className="mt-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Could not load this entitlement</AlertTitle>
              <AlertDescription>
                {(loadError as any)?.message ?? String(loadError)}
                {' '}No action can be taken until it loads.
              </AlertDescription>
            </Alert>
          )}

          {!isLoading && !loadError && !ent && (
            <Alert className="mt-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Entitlement not found</AlertTitle>
              <AlertDescription>
                This entitlement no longer exists, or you do not have access to it.
              </AlertDescription>
            </Alert>
          )}

          {ent && (
            <div className="space-y-5 mt-4">
              {/* Header */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-semibold text-lg">
                    {ent.claim_number || ent.id.slice(0, 8)}
                  </span>
                  <Badge variant="outline" className={`${statusColor[ent.status] || ''}`}>
                    {ENTITLEMENT_STATUS_LABELS[ent.status] || ent.status}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-muted-foreground">SSN:</span> <span className="font-mono">{ent.ssn}</span></div>
                  <div><span className="text-muted-foreground">Benefit:</span> {ent.benefit_name || '—'}</div>
                  <div><span className="text-muted-foreground">Type:</span> {ent.entitlement_type}</div>
                  <div><span className="text-muted-foreground">Frequency:</span> {ent.payment_frequency}</div>
                </div>
              </div>

              <Separator />

              {/* Financial Summary */}
              <div className="space-y-3">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <DollarSign className="h-4 w-4" /> Financial
                </h4>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded border p-2 text-center">
                    <p className="text-[10px] text-muted-foreground">Weekly Rate</p>
                    <p className="font-mono font-bold text-sm">${(ent.weekly_rate ?? 0).toFixed(2)}</p>
                  </div>
                  <div className="rounded border p-2 text-center">
                    <p className="text-[10px] text-muted-foreground">Total Entitlement</p>
                    <p className="font-mono font-bold text-sm">${(ent.total_entitlement ?? 0).toFixed(2)}</p>
                  </div>
                  <div className="rounded border p-2 text-center">
                    <p className="text-[10px] text-muted-foreground">Remaining</p>
                    <p className="font-mono font-bold text-sm">${(ent.remaining_amount ?? 0).toFixed(2)}</p>
                  </div>
                </div>
                {ent.lump_sum_amount != null && ent.lump_sum_amount > 0 && (
                  <div className="rounded border p-2 text-center">
                    <p className="text-[10px] text-muted-foreground">Lump Sum</p>
                    <p className="font-mono font-bold text-sm">${ent.lump_sum_amount.toFixed(2)}</p>
                  </div>
                )}
                {/* Utilization bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Utilization</span>
                    <span>{utilizationPct.toFixed(0)}%</span>
                  </div>
                  <Progress value={utilizationPct} className="h-2" />
                </div>
              </div>

              <Separator />

              {/* Dates */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <Calendar className="h-4 w-4" /> Dates
                </h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-muted-foreground">Effective From:</span> {formatDateForDisplay(ent.effective_from)}</div>
                  <div><span className="text-muted-foreground">Effective To:</span> {ent.effective_to ? formatDateForDisplay(ent.effective_to) : 'Open-ended'}</div>
                  <div><span className="text-muted-foreground">Next Review:</span> {ent.next_review_date ? formatDateForDisplay(ent.next_review_date) : '—'}</div>
                  <div><span className="text-muted-foreground">Duration:</span> {ent.duration_weeks ? `${ent.duration_weeks} weeks` : '—'}</div>
                  <div><span className="text-muted-foreground">Weeks Paid:</span> {ent.weeks_paid ?? 0}</div>
                  <div><span className="text-muted-foreground">Activated:</span> {ent.activated_at ? formatDateForDisplay(ent.activated_at) : '—'}</div>
                </div>
              </div>

              <Separator />

              {/* Override indicator */}
              {ent.override_applied && (
                <>
                  <div className="flex items-center gap-2 p-2 rounded border border-amber-300 bg-amber-50 text-sm">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <span className="text-amber-700 font-medium">Override Applied</span>
                    {ent.override_reason && <span className="text-xs text-muted-foreground">— {ent.override_reason}</span>}
                  </div>
                  <Separator />
                </>
              )}

              {/* Suspension detail */}
              {ent.status === 'SUSPENDED' && ent.suspended_at && (
                <>
                  <div className="p-2 rounded border border-amber-300 bg-amber-50 text-sm space-y-1">
                    <p className="font-medium text-amber-700">Suspended</p>
                    <p className="text-xs text-muted-foreground">
                      By {ent.suspended_by} on {formatDateForDisplay(ent.suspended_at)}
                    </p>
                    {ent.suspension_reason && <p className="text-xs italic">"{ent.suspension_reason}"</p>}
                  </div>
                  <Separator />
                </>
              )}

              {/* Payable instructions summary */}
              <div className="space-y-1">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" /> Payable Instructions
                </h4>
                <div className="flex items-center gap-3 text-sm">
                  <span>{ent.active_instructions} active</span>
                  <span className="text-muted-foreground">•</span>
                  <span className="text-muted-foreground">${(ent.total_disbursed ?? 0).toFixed(2)} disbursed</span>
                </div>
              </div>

              <Separator />

              {/* Event log */}
              {events.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <History className="h-4 w-4" /> Event History
                  </h4>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {events.slice(0, 10).map((ev: any) => (
                      <div key={ev.id} className="text-xs flex items-center gap-2">
                        <span className="text-muted-foreground">{formatDateForDisplay(ev.performed_at)}</span>
                        <Badge variant="secondary" className="text-[10px]">{ev.event_type}</Badge>
                        <span className="truncate">{ev.description || ev.notes || ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Separator />

              {/* Actions */}
              {availableActions.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">Actions</h4>
                  <div className="flex flex-wrap gap-2">
                    {availableActions.map((action) => (
                      <Button
                        key={action.action}
                        variant={action.variant}
                        size="sm"
                        disabled={executeAction.isPending}
                        onClick={() => { setDialogAction(action); setNarrative(''); setReasonCodeId(''); }}
                      >
                        {action.label}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              <Separator />

              {/* Links */}
              <div className="flex gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/bn/claims/${ent.claim_id}`}>Open Workbench</Link>
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Action Dialog */}
      <Dialog open={!!dialogAction} onOpenChange={() => setDialogAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogAction?.label} Entitlement</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {dialogAction?.requiresReasonCode && (
              <div>
                <Label>Reason Code</Label>
                <Select value={reasonCodeId} onValueChange={setReasonCodeId}>
                  <SelectTrigger><SelectValue placeholder="Select reason..." /></SelectTrigger>
                  <SelectContent>
                    {(reasonCodes ?? []).map((rc: any) => (
                      <SelectItem key={rc.id} value={rc.id}>{rc.reason_label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Narrative / Justification</Label>
              <Textarea
                value={narrative}
                onChange={(e) => setNarrative(e.target.value)}
                placeholder="Enter justification..."
                rows={4}
              />
            </div>
            <div className="space-y-1 text-xs text-muted-foreground">
              <p><strong>Payable Impact:</strong> {dialogAction?.payableImpact}</p>
              <p><strong>Claim Impact:</strong> {dialogAction?.claimImpact}</p>
              <p><strong>Notification:</strong> {dialogAction?.notificationTrigger || 'None'}</p>
              <p><strong>Audit:</strong> {dialogAction?.auditEvent}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogAction(null)}>Cancel</Button>
            <Button onClick={handleConfirmAction} disabled={executeAction.isPending}>
              Confirm {dialogAction?.label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
