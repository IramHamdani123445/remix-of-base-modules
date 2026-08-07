/**
 * BN Risk — factors panel for the assessment workspace (EPIC 1).
 *
 * Factors are observations, not scores. Availability of every button comes
 * from `bn_risk_assessment_actions_v1`; this panel never decides for itself
 * whether an action is permitted.
 */
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatAuditDate } from '@/lib/dateFormat';
import type {
  BnRiskAssessmentActionCode,
  BnRiskAssessmentSignalRow,
  BnRiskFactorRow,
} from '@/types/bn/risk/riskAssessment';
import { BnRiskFactorDialog } from './BnRiskFactorDialog';
import { BnRiskVoidFactorDialog } from './BnRiskVoidFactorDialog';

interface Props {
  assessmentId: string;
  rowVersion: number;
  factors: readonly BnRiskFactorRow[];
  signals: readonly BnRiskAssessmentSignalRow[];
  isActionEnabled: (action: BnRiskAssessmentActionCode) => boolean;
  onChanged: () => void;
}

function factorValue(factor: BnRiskFactorRow): string {
  switch (factor.value_kind) {
    case 'AMOUNT':
      return factor.value_numeric ?? '—';
    case 'DATE':
      return factor.value_date ? formatAuditDate(factor.value_date, false) : '—';
    case 'TRISTATE':
    case 'DECISION':
      return factor.value_code ?? '—';
    default:
      return factor.value_text ?? '—';
  }
}

export const BnRiskFactorsSection: React.FC<Props> = ({
  assessmentId, rowVersion, factors, signals, isActionEnabled, onChanged,
}) => {
  const [showHistoric, setShowHistoric] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<BnRiskFactorRow | null>(null);
  const [voiding, setVoiding] = React.useState<BnRiskFactorRow | null>(null);

  const visible = showHistoric ? factors : factors.filter((f) => f.status === 'ACTIVE');
  const activeCount = factors.filter((f) => f.status === 'ACTIVE').length;
  const outstanding = factors.filter(
    (f) => f.status === 'ACTIVE' && f.evidence_requirement_code === 'REQUIRED' && !f.evidence_satisfied,
  ).length;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Factors</CardTitle>
          <CardDescription>
            {activeCount} active factor{activeCount === 1 ? '' : 's'}
            {outstanding > 0 && ` — ${outstanding} still need usable evidence`}
          </CardDescription>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="risk-factor-history"
              checked={showHistoric}
              onCheckedChange={setShowHistoric}
            />
            <Label htmlFor="risk-factor-history" className="text-sm">Show corrected and voided</Label>
          </div>
          <Button
            size="sm"
            disabled={!isActionEnabled('ADD_FACTOR')}
            onClick={() => { setEditing(null); setDialogOpen(true); }}
          >
            Record factor
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Factor</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Direction</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Evidence</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    No factors recorded yet.
                  </TableCell>
                </TableRow>
              )}
              {visible.map((f) => (
                <TableRow key={f.factor_id}>
                  <TableCell className="font-medium">{f.factor_reference}</TableCell>
                  <TableCell>
                    {f.factor_type_label}
                    {f.reason && (
                      <span className="block text-xs text-muted-foreground">{f.reason}</span>
                    )}
                  </TableCell>
                  <TableCell>{factorValue(f)}</TableCell>
                  <TableCell>{f.direction_label}</TableCell>
                  <TableCell>
                    {f.provenance_label}
                    {f.provenance_reference && (
                      <span className="block text-xs text-muted-foreground">
                        {f.provenance_reference}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {f.evidence_requirement_code === 'REQUIRED'
                      ? (
                        <Badge variant={f.evidence_satisfied ? 'secondary' : 'destructive'}>
                          {f.evidence_satisfied ? 'Evidenced' : 'Evidence needed'}
                        </Badge>
                      )
                      : <span className="text-xs text-muted-foreground">Not required</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={f.status === 'ACTIVE' ? 'secondary' : 'outline'}>
                      {f.status === 'ACTIVE' ? 'Active'
                        : f.status === 'SUPERSEDED' ? 'Corrected' : 'Voided'}
                    </Badge>
                    {f.void_justification && (
                      <span className="block text-xs text-muted-foreground">
                        {f.void_justification}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="space-x-2 text-right whitespace-nowrap">
                    <Button
                      size="sm" variant="outline"
                      disabled={f.status !== 'ACTIVE' || !isActionEnabled('CORRECT_FACTOR')}
                      onClick={() => { setEditing(f); setDialogOpen(true); }}
                    >
                      Correct
                    </Button>
                    <Button
                      size="sm" variant="ghost"
                      disabled={f.status !== 'ACTIVE' || !isActionEnabled('VOID_FACTOR')}
                      onClick={() => setVoiding(f)}
                    >
                      Void
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <BnRiskFactorDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        assessmentId={assessmentId}
        rowVersion={rowVersion}
        signals={signals}
        factor={editing}
        onCompleted={onChanged}
      />
      <BnRiskVoidFactorDialog
        open={!!voiding}
        onOpenChange={(open) => { if (!open) setVoiding(null); }}
        assessmentId={assessmentId}
        rowVersion={rowVersion}
        factor={voiding}
        onCompleted={onChanged}
      />
    </Card>
  );
};
