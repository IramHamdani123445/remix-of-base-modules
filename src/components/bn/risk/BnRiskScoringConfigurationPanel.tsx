/**
 * BN Risk — scoring configuration panel (EPIC 2, restricted).
 *
 * Read-only for ordinary Risk users (current version label only). Users with
 * the Risk administration capability may run the governed configuration
 * lifecycle through `bn_risk_scoring_config_command_v1`. The in-force version
 * is never editable in place: change means new version → validate → activate.
 *
 * No rule, band, threshold or weight is defined in this file — everything is
 * read from the backend contract.
 */
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Settings2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatAuditDate } from '@/lib/dateFormat';
import { riskScoringService } from '@/services/bn/risk/riskScoringService';
import type { BnRiskScoringConfigCommand } from '@/types/bn/risk/riskScoring';

export const BnRiskScoringConfigurationPanel: React.FC = () => {
  const queryClient = useQueryClient();
  const [selected, setSelected] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const config = useQuery({
    queryKey: ['bn-risk-scoring-configuration', selected],
    queryFn: async () => {
      const result = await riskScoringService.scoringConfiguration(selected);
      if (result.status !== 'OK' || !result.data) throw new Error(result.code ?? result.status);
      return result.data;
    },
  });

  const lifecycle = useMutation({
    mutationFn: async (input: {
      command: BnRiskScoringConfigCommand;
      ruleSetId: string;
      rowVersion: number;
      justification?: string;
    }) => {
      const result = await riskScoringService.executeConfig({
        command: input.command,
        ruleSetId: input.ruleSetId,
        expectedRowVersion: input.rowVersion,
        justification: input.justification ?? null,
        payload: {},
      });
      if (result.status === 'FAILED') {
        throw new Error(result.errorMessage ?? 'The configuration could not be changed.');
      }
      return result;
    },
    onSuccess: (result) => {
      setError(null);
      setNotice('The scoring configuration was updated.');
      if (result.ruleSetId) setSelected(result.ruleSetId);
      queryClient.invalidateQueries({ queryKey: ['bn-risk-scoring-configuration'] });
    },
    onError: (e: Error) => { setNotice(null); setError(e.message); },
  });

  if (config.isLoading) return <Skeleton className="h-64 w-full" />;

  if (config.isError || !config.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Scoring configuration is unavailable</AlertTitle>
        <AlertDescription>No configuration change is offered while this cannot be read.</AlertDescription>
      </Alert>
    );
  }

  const data = config.data;
  const detail = data.detail;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" /> Scoring configuration
          </CardTitle>
          <CardDescription>
            The versioned rules and bands used to score risk assessments. Only one version is
            ever in force, and a version in force cannot be edited.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          {notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}
          {!data.can_administer && (
            <Alert>
              <AlertDescription>
                You can see which configuration version is in force. Changing scoring policy
                requires Risk administration permission.
              </AlertDescription>
            </Alert>
          )}

          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Configuration</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Effective</TableHead>
                  <TableHead>Rules</TableHead>
                  <TableHead>Bands</TableHead>
                  <TableHead>Scores produced</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rule_sets.map((rs) => (
                  <TableRow key={rs.rule_set_id}>
                    <TableCell className="font-medium">
                      {rs.name} · version {rs.version_no}
                      <div className="text-xs text-muted-foreground">{rs.rule_set_code}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={rs.is_effective ? 'secondary' : 'outline'}>
                        {rs.status_label}
                      </Badge>
                      {rs.is_effective && (
                        <span className="ml-2 text-xs text-muted-foreground">In force</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {rs.effective_from ? formatAuditDate(rs.effective_from, false) : '—'}
                      {rs.effective_to ? ` → ${formatAuditDate(rs.effective_to, false)}` : ''}
                    </TableCell>
                    <TableCell>{rs.rule_count}</TableCell>
                    <TableCell>{rs.band_count}</TableCell>
                    <TableCell>{rs.score_count}</TableCell>
                    <TableCell className="text-right">
                      {data.can_administer && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelected(rs.rule_set_id)}
                        >
                          View
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {data.rule_sets.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-sm text-muted-foreground">
                      No scoring configuration has been created.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {detail && (
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>{detail.name} · version {detail.version_no}</CardTitle>
              <CardDescription>
                {detail.description ?? 'No description recorded.'} Score scale{' '}
                {detail.score_scale_min}–{detail.score_scale_max}
                {detail.score_scale_label ? ` ${detail.score_scale_label}` : ''}.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {detail.status === 'DRAFT' && (
                <Button
                  size="sm"
                  disabled={lifecycle.isPending}
                  onClick={() => lifecycle.mutate({
                    command: 'VALIDATE_RULE_SET',
                    ruleSetId: detail.rule_set_id,
                    rowVersion: detail.row_version,
                  })}
                >
                  Validate
                </Button>
              )}
              {detail.status === 'VALIDATED' && (
                <Button
                  size="sm"
                  disabled={lifecycle.isPending}
                  onClick={() => lifecycle.mutate({
                    command: 'ACTIVATE_RULE_SET',
                    ruleSetId: detail.rule_set_id,
                    rowVersion: detail.row_version,
                  })}
                >
                  Activate
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={lifecycle.isPending}
                onClick={() => lifecycle.mutate({
                  command: 'CREATE_NEW_VERSION',
                  ruleSetId: detail.rule_set_id,
                  rowVersion: detail.row_version,
                })}
              >
                Create new version
              </Button>
              {detail.status !== 'RETIRED' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={lifecycle.isPending}
                  onClick={() => lifecycle.mutate({
                    command: 'RETIRE_RULE_SET',
                    ruleSetId: detail.rule_set_id,
                    rowVersion: detail.row_version,
                    justification: 'Retired from the scoring configuration screen.',
                  })}
                >
                  Retire
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!detail.is_editable && (
              <Alert>
                <AlertTitle>Read-only</AlertTitle>
                <AlertDescription>
                  This version is in force or closed. To change scoring policy, create a new
                  version, validate it, then activate it.
                </AlertDescription>
              </Alert>
            )}

            {detail.validation.blockers.length > 0 && (
              <Alert variant="destructive">
                <AlertTitle>Validation blockers</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4">
                    {detail.validation.blockers.map((b) => <li key={b}>{b}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {detail.validation.warnings.length > 0 && (
              <Alert>
                <AlertDescription>
                  <ul className="list-disc pl-4">
                    {detail.validation.warnings.map((w) => <li key={w}>{w}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rule</TableHead>
                    <TableHead>Factor</TableHead>
                    <TableHead>Condition</TableHead>
                    <TableHead>Contribution</TableHead>
                    <TableHead>Maximum</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.rules.map((r) => (
                    <TableRow key={r.rule_id}>
                      <TableCell className="font-medium">
                        {r.name}
                        <div className="text-xs text-muted-foreground">{r.rule_code}</div>
                      </TableCell>
                      <TableCell>{r.factor_type_label ?? 'Any factor'}</TableCell>
                      <TableCell className="text-sm">
                        {r.operator_label ?? r.operator}
                        {r.comparison_code ? ` ${r.comparison_code}` : ''}
                        {r.comparison_numeric !== null ? ` ${r.comparison_numeric}` : ''}
                        {r.requires_usable_evidence ? ' · usable evidence required' : ''}
                      </TableCell>
                      <TableCell>{r.contribution > 0 ? '+' : ''}{r.contribution}</TableCell>
                      <TableCell>{r.max_contribution ?? '—'}</TableCell>
                      <TableCell>{r.is_enabled ? 'Enabled' : 'Disabled'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Band</TableHead>
                    <TableHead>Range</TableHead>
                    <TableHead>Review priority</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.bands.map((b) => (
                    <TableRow key={b.band_id}>
                      <TableCell className="font-medium">{b.label}</TableCell>
                      <TableCell>{b.min_score} – {b.max_score}</TableCell>
                      <TableCell>{b.review_priority ?? '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {b.description ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-semibold">Configuration history</h4>
              {detail.history.map((h, i) => (
                <div key={`${h.created_at}-${i}`} className="rounded-md border p-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span>{h.event_code}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatAuditDate(h.created_at, false)}
                    </span>
                  </div>
                  <p className="text-muted-foreground">
                    {h.actor_name ?? 'System'}{h.justification ? ` — ${h.justification}` : ''}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
