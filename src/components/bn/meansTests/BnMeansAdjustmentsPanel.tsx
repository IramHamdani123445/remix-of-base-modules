/**
 * BN Means-Test MT7 — adjustments register, request dialog and
 * independent decision panel.
 *
 * Frozen facts are never edited inline. Every action is offered only when
 * the canonical `bn_means_available_actions_v1` query allows it, and every
 * denial reason is rendered verbatim from the backend.
 */
import React from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, ShieldAlert, SlidersHorizontal } from 'lucide-react';
import { formatWithCurrency } from '@/utils/formatCurrency';
import type { BnMeansAvailableAction } from '@/services/bn/meansTests/meansQueryService';
import {
  BN_MEANS_ADJUSTMENT_STATUS_LABEL,
  BN_MEANS_ADJUSTMENT_TARGET_KINDS,
  BN_MEANS_EVIDENCE_REQUIRED_TARGET_KINDS,
  BN_MEANS_MONETARY_TARGET_KINDS,
  BN_MEANS_REASON_LABEL,
  type BnMeansAdjustmentRow,
  type BnMeansAdjustmentTargetKind,
} from '@/types/bn/meansTests/meansAdjustments';

export interface BnMeansAdjustmentsPanelProps {
  readonly adjustments: readonly BnMeansAdjustmentRow[];
  readonly loadFailure: string | null;
  readonly currency: string;
  readonly calculationId: string | null;
  readonly calculationHash: string | null;
  readonly assessmentVersionId: string | null;
  readonly rowVersion: number;
  readonly requestAction: BnMeansAvailableAction | undefined;
  readonly decideAction: BnMeansAvailableAction | undefined;
  readonly busy: boolean;
  /** Increments on every successful command so the form can reset. */
  readonly successToken: number;
  readonly onRequest: (payload: Record<string, unknown>) => void;
  readonly onDecide: (payload: Record<string, unknown>) => void;
}

const EMPTY_FORM = {
  target_kind: 'CALCULATION_LINE' as BnMeansAdjustmentTargetKind,
  target_id: '',
  field_or_line_code: '',
  original_value: '',
  proposed_value: '',
  reason_code: '',
  structured_justification: '',
  evidence_reference: '',
};

function reasonText(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return BN_MEANS_REASON_LABEL[reason] ?? reason;
}

function valueText(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export const BnMeansAdjustmentsPanel: React.FC<BnMeansAdjustmentsPanelProps> = ({
  adjustments,
  loadFailure,
  currency,
  calculationId,
  calculationHash,
  assessmentVersionId,
  rowVersion,
  requestAction,
  decideAction,
  busy,
  successToken,
  onRequest,
  onDecide,
}) => {
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ ...EMPTY_FORM });
  const [decisionReason, setDecisionReason] = React.useState<Record<string, string>>({});
  const [decisionNote, setDecisionNote] = React.useState<Record<string, string>>({});

  // Entered information survives a recoverable failure; it is only cleared
  // once the governed command has actually succeeded.
  React.useEffect(() => {
    if (successToken > 0) {
      setForm({ ...EMPTY_FORM });
      setOpen(false);
    }
  }, [successToken]);

  const canRequest = Boolean(requestAction?.allowed) && !busy;
  const money = (v: unknown) =>
    v === null || v === undefined || v === '' ? '—' : formatWithCurrency(Number(v), currency);

  const submitRequest = () => {
    const monetary = BN_MEANS_MONETARY_TARGET_KINDS.includes(form.target_kind);
    onRequest({
      assessment_version_id: assessmentVersionId,
      calculation_id: calculationId,
      target_kind: form.target_kind,
      target_id: form.target_id || null,
      field_or_line_code: form.field_or_line_code,
      original_value: form.original_value === '' ? null : form.original_value,
      proposed_value: form.proposed_value,
      currency_code: monetary ? currency : null,
      reason_code: form.reason_code,
      structured_justification: form.structured_justification,
      evidence_reference: form.evidence_reference || null,
      expected_row_version: rowVersion,
    });
  };

  const pending = adjustments.filter(
    (a) => a.status === 'REQUESTED' || a.status === 'APPROVED_PENDING_APPLICATION',
  );

  return (
    <div className="space-y-4" data-testid="means-adjustments-panel">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4" /> Adjustment register
          </CardTitle>
          <CardDescription>
            Adjustments are additive. A frozen version, declared fact, verification record or
            existing calculation is never rewritten.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadFailure && (
            <Alert variant="destructive" data-testid="means-adjustments-unavailable">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Adjustments unavailable</AlertTitle>
              <AlertDescription className="text-xs">{loadFailure}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              disabled={!canRequest}
              onClick={() => setOpen((v) => !v)}
              data-testid="means-request-adjustment-open"
            >
              Request adjustment
            </Button>
            {!requestAction?.allowed && requestAction?.reason && (
              <span className="text-xs text-muted-foreground" data-testid="means-request-adjustment-reason">
                {reasonText(requestAction.reason)}
              </span>
            )}
          </div>

          {open && (
            <div className="space-y-3 rounded-md border p-4" data-testid="means-request-adjustment-form">
              <p className="text-xs text-muted-foreground">
                Requested against calculation <span className="break-all">{calculationId ?? '—'}</span> ·
                fingerprint <span className="break-all">{calculationHash ?? '—'}</span> · row version {rowVersion}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="adj-target-kind">Target</Label>
                  <select
                    id="adj-target-kind"
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={form.target_kind}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, target_kind: e.target.value as BnMeansAdjustmentTargetKind }))
                    }
                  >
                    {BN_MEANS_ADJUSTMENT_TARGET_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k.replaceAll('_', ' ').toLowerCase()}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="adj-target-id">Target reference</Label>
                  <Input
                    id="adj-target-id"
                    value={form.target_id}
                    onChange={(e) => setForm((f) => ({ ...f, target_id: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="adj-field">Field or line code</Label>
                  <Input
                    id="adj-field"
                    value={form.field_or_line_code}
                    onChange={(e) => setForm((f) => ({ ...f, field_or_line_code: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="adj-original">Original value</Label>
                  <Input
                    id="adj-original"
                    value={form.original_value}
                    onChange={(e) => setForm((f) => ({ ...f, original_value: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="adj-proposed">Proposed treatment or value</Label>
                  <Input
                    id="adj-proposed"
                    value={form.proposed_value}
                    onChange={(e) => setForm((f) => ({ ...f, proposed_value: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="adj-reason">Reason code</Label>
                  <Input
                    id="adj-reason"
                    value={form.reason_code}
                    onChange={(e) => setForm((f) => ({ ...f, reason_code: e.target.value }))}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="adj-evidence">
                    Supporting evidence reference
                    {BN_MEANS_EVIDENCE_REQUIRED_TARGET_KINDS.includes(form.target_kind) ? ' (required)' : ''}
                  </Label>
                  <Input
                    id="adj-evidence"
                    value={form.evidence_reference}
                    onChange={(e) => setForm((f) => ({ ...f, evidence_reference: e.target.value }))}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="adj-justification">Structured justification</Label>
                  <Textarea
                    id="adj-justification"
                    value={form.structured_justification}
                    onChange={(e) => setForm((f) => ({ ...f, structured_justification: e.target.value }))}
                  />
                </div>
              </div>
              <Button size="sm" disabled={!canRequest} onClick={submitRequest} data-testid="means-request-adjustment-submit">
                Submit adjustment request
              </Button>
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Original</TableHead>
                <TableHead>Proposed</TableHead>
                <TableHead>Effect</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Evidence</TableHead>
                <TableHead>Requester</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Decider</TableHead>
                <TableHead>Decided</TableHead>
                <TableHead>Decision reason</TableHead>
                <TableHead>Recalculation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {adjustments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={14} className="text-sm text-muted-foreground">
                    No adjustment has been requested for this assessment.
                  </TableCell>
                </TableRow>
              ) : (
                adjustments.map((a) => (
                  <TableRow key={a.adjustment_id} data-testid={`means-adjustment-row-${a.adjustment_id}`}>
                    <TableCell className="whitespace-nowrap">{a.adjustment_reference ?? '—'}</TableCell>
                    <TableCell className="text-xs">
                      {a.target_kind ?? '—'}
                      <br />
                      {a.field_or_line_code ?? '—'}
                    </TableCell>
                    <TableCell>{valueText(a.original_value)}</TableCell>
                    <TableCell>{valueText(a.proposed_value)}</TableCell>
                    <TableCell>{a.financial_effect === null ? '—' : money(a.financial_effect)}</TableCell>
                    <TableCell className="text-xs">{a.reason_code ?? '—'}</TableCell>
                    <TableCell className="text-xs">{a.evidence_reference ?? a.evidence_id ?? '—'}</TableCell>
                    <TableCell className="text-xs break-all">{a.requested_by ?? '—'}</TableCell>
                    <TableCell className="text-xs">{a.requested_at ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={a.status === 'REJECTED' ? 'outline' : 'secondary'}>
                        {BN_MEANS_ADJUSTMENT_STATUS_LABEL[a.status] ?? a.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs break-all">{a.decided_by ?? '—'}</TableCell>
                    <TableCell className="text-xs">{a.decided_at ?? '—'}</TableCell>
                    <TableCell className="text-xs">{a.decision_reason_code ?? '—'}</TableCell>
                    <TableCell className="text-xs break-all">
                      {a.applied_calculation_id ?? (a.status === 'APPROVED_PENDING_APPLICATION' ? 'Pending' : '—')}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Adjustment decision</CardTitle>
          <CardDescription>
            An independent checker decides each adjustment. Approval produces a new calculation;
            the original calculation remains authoritative until it does.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">No adjustment is awaiting a decision.</p>
          ) : (
            pending.map((a) => {
              const denied = !decideAction?.allowed || a.is_requester;
              return (
                <div
                  key={a.adjustment_id}
                  className="space-y-3 rounded-md border p-4"
                  data-testid={`means-adjustment-decision-${a.adjustment_id}`}
                >
                  <div className="grid gap-2 sm:grid-cols-3">
                    {[
                      ['Adjustment', a.adjustment_reference ?? a.adjustment_id],
                      ['Original calculation line', a.target_id ?? a.field_or_line_code ?? '—'],
                      ['Original value', valueText(a.original_value)],
                      ['Proposed', valueText(a.proposed_value)],
                      ['Expected financial effect', a.financial_effect === null ? '—' : money(a.financial_effect)],
                      ['Evidence', a.evidence_reference ?? a.evidence_id ?? '—'],
                      ['Requester', a.requested_by ?? '—'],
                      ['Justification', a.justification ?? '—'],
                      ['Status', BN_MEANS_ADJUSTMENT_STATUS_LABEL[a.status] ?? a.status],
                    ].map(([label, value]) => (
                      <div key={String(label)}>
                        <p className="text-xs uppercase text-muted-foreground">{String(label)}</p>
                        <p className="text-sm break-all">{String(value)}</p>
                      </div>
                    ))}
                  </div>

                  {a.application_error && (
                    <Alert variant="destructive" data-testid={`means-adjustment-application-error-${a.adjustment_id}`}>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>Recalculation has not been applied</AlertTitle>
                      <AlertDescription className="text-xs">{a.application_error}</AlertDescription>
                    </Alert>
                  )}

                  {a.is_requester && (
                    <Alert data-testid={`means-adjustment-self-warning-${a.adjustment_id}`}>
                      <ShieldAlert className="h-4 w-4" />
                      <AlertDescription className="text-xs">
                        You requested this adjustment. An independent officer must decide it.
                      </AlertDescription>
                    </Alert>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor={`dec-reason-${a.adjustment_id}`}>Decision reason code</Label>
                      <Input
                        id={`dec-reason-${a.adjustment_id}`}
                        value={decisionReason[a.adjustment_id] ?? ''}
                        onChange={(e) =>
                          setDecisionReason((s) => ({ ...s, [a.adjustment_id]: e.target.value }))
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor={`dec-note-${a.adjustment_id}`}>Decision note</Label>
                      <Input
                        id={`dec-note-${a.adjustment_id}`}
                        value={decisionNote[a.adjustment_id] ?? ''}
                        onChange={(e) => setDecisionNote((s) => ({ ...s, [a.adjustment_id]: e.target.value }))}
                      />
                    </div>
                  </div>

                  {denied ? (
                    <p className="text-xs text-muted-foreground" data-testid={`means-adjustment-denied-${a.adjustment_id}`}>
                      {a.is_requester
                        ? BN_MEANS_REASON_LABEL.SELF_APPROVAL_DENIED
                        : reasonText(decideAction?.reason) ?? BN_MEANS_REASON_LABEL.PERMISSION_DENIED}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={busy}
                        data-testid={`means-adjustment-approve-${a.adjustment_id}`}
                        onClick={() =>
                          onDecide({
                            adjustment_id: a.adjustment_id,
                            decision: 'APPROVE',
                            reason_code: decisionReason[a.adjustment_id] ?? '',
                            decision_note: decisionNote[a.adjustment_id] ?? '',
                            expected_adjustment_row_version: a.row_version,
                          })
                        }
                      >
                        Approve adjustment
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        data-testid={`means-adjustment-reject-${a.adjustment_id}`}
                        onClick={() =>
                          onDecide({
                            adjustment_id: a.adjustment_id,
                            decision: 'REJECT',
                            reason_code: decisionReason[a.adjustment_id] ?? '',
                            decision_note: decisionNote[a.adjustment_id] ?? '',
                            expected_adjustment_row_version: a.row_version,
                          })
                        }
                      >
                        Reject adjustment
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default BnMeansAdjustmentsPanel;
