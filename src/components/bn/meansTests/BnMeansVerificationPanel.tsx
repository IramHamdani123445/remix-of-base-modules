/**
 * BN Means-Test MT6 — verification workspace.
 *
 * Verification is applied to INDIVIDUAL facts of the frozen submitted
 * version. The panel never mutates a declared value; it only records a
 * verification decision through the governed command boundary
 * (`BN_MEANS_VERIFY_INFORMATION`). Availability is decided by the
 * canonical available-actions query, never by React.
 */
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatWithCurrency } from '@/utils/formatCurrency';

export type BnMeansVerificationOutcome =
  | 'VERIFIED'
  | 'REJECTED'
  | 'CLARIFICATION_REQUIRED'
  | 'NOT_APPLICABLE';

export interface BnMeansVerificationRow {
  readonly factKind: 'HOUSEHOLD' | 'INCOME' | 'ASSET' | 'DEDUCTION' | 'EVIDENCE';
  readonly factId: string;
  readonly label: string;
  readonly declaredValue: string;
  readonly source: string;
  readonly effectivePeriod: string;
  readonly evidenceStatus: string;
}

export interface BnMeansVerificationRecord {
  readonly fact_kind?: unknown;
  readonly fact_id?: unknown;
  readonly outcome?: unknown;
  readonly reason_code?: unknown;
  readonly notes?: unknown;
  readonly verified_by?: unknown;
  readonly verified_at?: unknown;
}

export interface BnMeansVerificationPanelProps {
  readonly groups: readonly { readonly title: string; readonly rows: readonly BnMeansVerificationRow[] }[];
  readonly verifications: readonly BnMeansVerificationRecord[];
  readonly canVerify: boolean;
  readonly disabledReason: string | null;
  readonly busy: boolean;
  readonly onVerify: (input: {
    factKind: string;
    factId: string;
    outcome: BnMeansVerificationOutcome;
    reasonCode?: string;
    note?: string;
  }) => void;
}

const OUTCOME_ACTIONS: readonly { outcome: BnMeansVerificationOutcome; label: string; needsReason: boolean }[] = [
  { outcome: 'VERIFIED', label: 'Verify', needsReason: false },
  { outcome: 'REJECTED', label: 'Reject', needsReason: true },
  { outcome: 'CLARIFICATION_REQUIRED', label: 'Request clarification', needsReason: true },
  { outcome: 'NOT_APPLICABLE', label: 'Mark not applicable', needsReason: false },
];

export function buildFactGroups(
  data: Record<string, unknown>,
  currency: string,
): readonly { title: string; rows: BnMeansVerificationRow[] }[] {
  const rows = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const money = (v: unknown) => (v === null || v === undefined ? '—' : formatWithCurrency(Number(v), currency));
  const period = (from: unknown, to: unknown) =>
    `${from ? String(from) : '—'} → ${to ? String(to) : 'open'}`;

  return [
    {
      title: 'Household',
      rows: rows(data.household).map((r) => ({
        factKind: 'HOUSEHOLD' as const,
        factId: String(r.member_id),
        label: String(r.relationship_code ?? 'Member'),
        declaredValue: r.is_dependant ? 'Dependant' : 'Non-dependant',
        source: String(r.fact_source ?? 'DECLARED'),
        effectivePeriod: period(r.member_from, r.member_to),
        evidenceStatus: String(r.evidence_status ?? 'NONE'),
      })),
    },
    {
      title: 'Income',
      rows: rows(data.income).map((r) => ({
        factKind: 'INCOME' as const,
        factId: String(r.income_fact_id),
        label: String(r.category_code ?? ''),
        declaredValue: `${money(r.declared_amount)} ${String(r.declared_frequency ?? '')} · annualised ${money(r.normalised_annual_amount)}`,
        source: String(r.fact_source ?? 'DECLARED'),
        effectivePeriod: period(r.effective_from, r.effective_to),
        evidenceStatus: String(r.evidence_status ?? 'NONE'),
      })),
    },
    {
      title: 'Assets',
      rows: rows(data.assets).map((r) => ({
        factKind: 'ASSET' as const,
        factId: String(r.asset_fact_id),
        label: String(r.category_code ?? ''),
        declaredValue: `${money(r.valuation_amount)} · share ${String(r.ownership_share ?? 1)}`,
        source: String(r.fact_source ?? 'DECLARED'),
        effectivePeriod: String(r.valuation_date ?? '—'),
        evidenceStatus: String(r.evidence_status ?? 'NONE'),
      })),
    },
    {
      title: 'Deductions',
      rows: rows(data.deductions).map((r) => ({
        factKind: 'DEDUCTION' as const,
        factId: String(r.deduction_fact_id),
        label: String(r.category_code ?? ''),
        declaredValue: `${money(r.claimed_amount)} · annualised ${money(r.normalised_annual_amount)} · ${String(r.approval_status ?? 'CLAIMED')}`,
        source: String(r.claim_basis ?? 'CLAIMED'),
        effectivePeriod: period(r.effective_from, r.effective_to),
        evidenceStatus: String(r.evidence_status ?? 'NONE'),
      })),
    },
    {
      title: 'Evidence',
      rows: rows(data.evidence).map((r) => ({
        factKind: 'EVIDENCE' as const,
        factId: String(r.evidence_id),
        label: String(r.evidence_type ?? ''),
        declaredValue: String(r.dms_document_id ?? r.dms_reference ?? '—'),
        source: String(r.fact_kind ?? 'ASSESSMENT'),
        effectivePeriod: String(r.received_at ?? '—'),
        evidenceStatus: String(r.status ?? '—'),
      })),
    },
  ];
}

export const BnMeansVerificationPanel: React.FC<BnMeansVerificationPanelProps> = ({
  groups,
  verifications,
  canVerify,
  disabledReason,
  busy,
  onVerify,
}) => {
  const [reason, setReason] = React.useState<Record<string, string>>({});
  const [note, setNote] = React.useState<Record<string, string>>({});

  const latest = React.useMemo(() => {
    const map = new Map<string, BnMeansVerificationRecord>();
    for (const v of verifications) {
      map.set(`${String(v.fact_kind)}:${String(v.fact_id)}`, v);
    }
    return map;
  }, [verifications]);

  return (
    <div className="space-y-6" data-testid="means-verification-panel">
      {!canVerify && (
        <p className="text-sm text-muted-foreground" data-testid="means-verification-disabled">
          Verification actions are unavailable{disabledReason ? ` — ${disabledReason}` : ''}.
        </p>
      )}
      {groups.map((group) => (
        <Card key={group.title}>
          <CardHeader>
            <CardTitle>{group.title}</CardTitle>
            <CardDescription>
              Verification records a decision about the submitted fact. It never changes the declared value.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {group.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No facts of this kind in the submitted version.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fact</TableHead>
                    <TableHead>Declared</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Effective</TableHead>
                    <TableHead>Evidence</TableHead>
                    <TableHead>Verification</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.rows.map((row) => {
                    const key = `${row.factKind}:${row.factId}`;
                    const decision = latest.get(key);
                    return (
                      <TableRow key={key} data-testid={`means-fact-${row.factId}`}>
                        <TableCell>{row.label}</TableCell>
                        <TableCell>{row.declaredValue}</TableCell>
                        <TableCell>{row.source}</TableCell>
                        <TableCell>{row.effectivePeriod}</TableCell>
                        <TableCell>{row.evidenceStatus}</TableCell>
                        <TableCell className="space-y-1">
                          {decision ? (
                            <>
                              <Badge variant="outline">{String(decision.outcome)}</Badge>
                              <p className="text-xs text-muted-foreground">
                                {decision.reason_code ? `${String(decision.reason_code)} · ` : ''}
                                {decision.notes ? `${String(decision.notes)} · ` : ''}
                                {decision.verified_by ? `${String(decision.verified_by)} · ` : ''}
                                {decision.verified_at ? String(decision.verified_at) : ''}
                              </p>
                            </>
                          ) : (
                            <Badge variant="secondary">Not verified</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-2">
                            <div className="grid gap-2 sm:grid-cols-2">
                              <div className="space-y-1">
                                <Label htmlFor={`reason-${key}`} className="text-xs">Reason code</Label>
                                <Input
                                  id={`reason-${key}`}
                                  value={reason[key] ?? ''}
                                  disabled={!canVerify || busy}
                                  onChange={(e) => setReason((p) => ({ ...p, [key]: e.target.value }))}
                                />
                              </div>
                              <div className="space-y-1">
                                <Label htmlFor={`note-${key}`} className="text-xs">Note</Label>
                                <Input
                                  id={`note-${key}`}
                                  value={note[key] ?? ''}
                                  disabled={!canVerify || busy}
                                  onChange={(e) => setNote((p) => ({ ...p, [key]: e.target.value }))}
                                />
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {OUTCOME_ACTIONS.map((action) => (
                                <Button
                                  key={action.outcome}
                                  size="sm"
                                  variant={action.outcome === 'VERIFIED' ? 'default' : 'secondary'}
                                  disabled={
                                    !canVerify || busy || (action.needsReason && !(reason[key] ?? '').trim())
                                  }
                                  onClick={() =>
                                    onVerify({
                                      factKind: row.factKind,
                                      factId: row.factId,
                                      outcome: action.outcome,
                                      reasonCode: (reason[key] ?? '').trim() || undefined,
                                      note: (note[key] ?? '').trim() || undefined,
                                    })
                                  }
                                >
                                  {action.label}
                                </Button>
                              ))}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default BnMeansVerificationPanel;
