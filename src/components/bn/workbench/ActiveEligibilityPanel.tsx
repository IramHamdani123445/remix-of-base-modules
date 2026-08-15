/**
 * Active Eligibility Panel
 *
 * Shows the latest eligibility check with a full rule trace and exposes
 * Run / Re-run buttons. Each failed rule gets a "Request Override" action
 * which opens the policy-driven maker-checker dialog (unified handler).
 */
import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Play, RefreshCw, CheckCircle2, XCircle, AlertCircle, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { runClaimEligibility } from '@/services/bn/claimActionRunner';
import { formatDateForDisplay } from '@/lib/format-config';
import { BnEmptyState } from '@/components/bn/shared/BnEmptyState';
import { OverrideEligibilityDialog } from './OverrideEligibilityDialog';
import { EligibilityOverridesPanel } from './EligibilityOverridesPanel';
import { usePolicy } from '@/hooks/bn/usePolicy';


interface Props {
  claimId: string;
  userCode: string;
  eligibility: any[];
  userRoles?: string[];
  productVersionId?: string | null;
  claimStatus?: string;
}

export const ActiveEligibilityPanel: React.FC<Props> = ({
  claimId,
  userCode,
  eligibility,
  userRoles,
  productVersionId,
  claimStatus,
}) => {
  const [running, setRunning] = useState(false);
  const qc = useQueryClient();
  const latest = eligibility?.[0];

  // Single policy-driven gating source
  const { data: approvalPolicy } = usePolicy(productVersionId || undefined, 'ELIGIBILITY');

  const roles = userRoles ?? [];
  const normalizedRoles = roles.map((r) => String(r || '').toUpperCase());
  const requiredApproverRole = approvalPolicy?.approval_role?.toUpperCase();

  const canRequest = !!approvalPolicy?.is_enabled;
  const canReview =
    !!approvalPolicy?.is_enabled &&
    (!requiredApproverRole || normalizedRoles.includes(requiredApproverRole));

  const allowedRules = approvalPolicy?.allowed_rule_codes ?? [];
  const blockedRules = approvalPolicy?.blocked_rule_codes ?? [];

  // Returns null when the rule is overrideable, or a short denial reason.
  const overrideDenialReason = useMemo(
    () => (ruleCode: string): string | null => {
      if (!productVersionId) return 'No product version on claim';
      if (!approvalPolicy) return 'No approval policy configured for this product';
      if (!approvalPolicy.is_enabled) return 'Eligibility overrides are disabled for this product';
      if (blockedRules.includes(ruleCode)) return `Rule ${ruleCode} is blocked from override`;
      if (allowedRules.length > 0 && !allowedRules.includes(ruleCode))
        return `Rule ${ruleCode} is not in the allowed list (${allowedRules.join(', ')})`;
      return null;
    },
    [approvalPolicy, allowedRules, blockedRules, productVersionId],
  );

  const [overrideRule, setOverrideRule] = useState<any | null>(null);

  const handleRun = async () => {
    if (!userCode) {
      toast.error('No user context — please sign in again.');
      return;
    }
    setRunning(true);
    try {
      const res = await runClaimEligibility(claimId, userCode);
      toast.success(
        res.overallResult
          ? `Eligibility passed (${res.rules.length} rules)`
          : `Eligibility failed (${res.rules.filter((r) => !r.passed).length} of ${res.rules.length} rules)`,
      );
      qc.invalidateQueries({ queryKey: ['bn', 'claim-eligibility', claimId] });
      qc.invalidateQueries({ queryKey: ['bn', 'claim-events', claimId] });
    } catch (err: any) {
      toast.error('Eligibility run failed', { description: err?.message });
    } finally {
      setRunning(false);
    }
  };

  if (!latest) {
    return (
      <Card>
        <CardContent className="py-10 flex flex-col items-center gap-4">
          <BnEmptyState
            type="empty"
            title="No eligibility checks yet"
            description="Run the eligibility engine against this claim's product rules. Results are recorded with a full rule trace."
          />
          <Button onClick={handleRun} disabled={running} className="gap-2">
            <Play className="h-4 w-4" />
            {running ? 'Running…' : 'Run Eligibility Check'}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const passed = latest.overall_result || latest.override_applied;
  const rules: any[] = Array.isArray(latest.rule_results) ? latest.rule_results : [];
  const overallLabel = latest.override_applied
    ? 'PASSED WITH OVERRIDE'
    : passed
      ? 'PASSED'
      : 'FAILED';

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              {passed ? (
                <CheckCircle2 className={`h-5 w-5 ${latest.override_applied ? 'text-amber-600' : 'text-emerald-600'}`} />
              ) : (
                <XCircle className="h-5 w-5 text-destructive" />
              )}
              Eligibility {overallLabel}
              <Badge variant="outline" className="ml-2 text-xs font-mono">
                {formatDateForDisplay(latest.check_date)}
              </Badge>
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={handleRun} disabled={running} className="gap-1">
                <RefreshCw className={`h-3.5 w-3.5 ${running ? 'animate-spin' : ''}`} />
                Re-run
              </Button>
            </div>

          </div>
        </CardHeader>
        <CardContent>
          {latest.override_applied && latest.override_reason && (
            <p className="text-sm text-amber-700 bg-amber-500/10 border border-amber-300 rounded px-3 py-2 mb-3">
              Override by {latest.override_by}: {latest.override_reason}
            </p>
          )}
          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rule trace recorded.</p>
          ) : (
            <div className="rounded border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Rule</TableHead>
                    <TableHead>Field</TableHead>
                    <TableHead>Actual</TableHead>
                    <TableHead>Op</TableHead>
                    <TableHead>Required</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead className="w-[110px] text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((r: any, i: number) => {
                    const isOverridden = r.result_state === 'OVERRIDDEN' || r.status === 'OVERRIDDEN';
                    const denialReason = !r.passed ? overrideDenialReason(r.rule_code) : null;
                    const showOverride =
                      !r.passed &&
                      canRequest &&
                      !!productVersionId &&
                      denialReason === null;
                    return (
                      <TableRow key={i} className={!r.passed ? 'bg-destructive/5' : isOverridden ? 'bg-amber-500/5' : undefined}>
                        <TableCell>
                          {isOverridden ? (
                            <ShieldAlert className="h-4 w-4 text-amber-600" />
                          ) : r.passed ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          ) : r.fail_action === 'WARN' ? (
                            <AlertCircle className="h-4 w-4 text-amber-600" />
                          ) : (
                            <XCircle className="h-4 w-4 text-destructive" />
                          )}
                        </TableCell>
                        <TableCell className="font-medium">
                          <div className="text-sm">{r.rule_name}</div>
                          <div className="text-xs text-muted-foreground font-mono">{r.rule_code}</div>
                        </TableCell>
                        <TableCell className="text-xs font-mono">{r.field_key ?? '—'}</TableCell>
                        <TableCell className="text-xs">{formatVal(r.actual_value)}</TableCell>
                        <TableCell className="text-xs font-mono">{r.operator ?? '—'}</TableCell>
                        <TableCell className="text-xs">{formatVal(r.expected_value)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.source ?? '—'}</TableCell>
                        <TableCell className="text-xs">{r.message}</TableCell>
                        <TableCell className="text-right">
                          {showOverride && (
                            <Button size="sm" variant="outline" className="h-7 text-xs"
                              onClick={() => setOverrideRule({ ...r, eligibility_result_id: latest.id })}>
                              Request Override
                            </Button>
                          )}
                          {!r.passed && !showOverride && denialReason && (
                            <span className="text-[10px] text-muted-foreground" title={denialReason}>
                              {denialReason}
                            </span>
                          )}
                          {isOverridden && (
                            <Badge className="bg-amber-500/15 text-amber-700 border-amber-300 text-[10px]" variant="outline">
                              Overridden
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <EligibilityOverridesPanel
        claimId={claimId}
        userCode={userCode}
        userRoles={roles}
        canReview={canReview}
      />

      {eligibility.length > 1 && (
        <p className="text-xs text-muted-foreground">
          {eligibility.length} historical checks — only latest shown. Earlier runs preserved in bn_claim_eligibility.
        </p>
      )}

      {overrideRule && productVersionId && (
        <OverrideEligibilityDialog
          open={!!overrideRule}
          onOpenChange={(o) => !o && setOverrideRule(null)}
          claimId={claimId}
          productVersionId={productVersionId}
          eligibilityResultId={overrideRule.eligibility_result_id}
          rule={overrideRule}
          userCode={userCode}
          userRoles={roles}
          claimStatus={claimStatus}
        />
      )}

    </div>
  );
};

function formatVal(v: any): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
