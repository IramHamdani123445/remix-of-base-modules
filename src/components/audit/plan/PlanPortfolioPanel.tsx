import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertTriangle, Briefcase, CalendarRange, GitCompare, Layers, ShieldAlert, Users,
} from 'lucide-react';
import { usePlanCoverage, usePlanPortfolioSummary, usePlanVersionDiff } from '@/hooks/audit/useAuditPortfolio';

interface PlanPortfolioPanelProps {
  planId: string;
}

const RISK_ORDER = ['Critical', 'High', 'Medium', 'Low', 'Unrated'];
const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4', 'Unscheduled'];

function Tile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Executive portfolio view of an Annual Audit Plan.
 *
 * An Annual Plan is a portfolio of audit engagements — this panel makes the
 * composition, capacity position, coverage gaps and version movement explicit.
 * Readiness shown here is display-only; submission truth stays with
 * `ia_annual_plan_readiness` on the server.
 */
export function PlanPortfolioPanel({ planId }: PlanPortfolioPanelProps) {
  const { data: summary, isLoading } = usePlanPortfolioSummary(planId);
  const { data: coverage, isLoading: coverageLoading } = usePlanCoverage(planId);
  const { data: diff, isLoading: diffLoading } = usePlanVersionDiff(planId);

  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (!summary?.success) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          {summary?.error || 'The portfolio summary is not available for this plan.'}
        </AlertDescription>
      </Alert>
    );
  }

  const totals = summary.totals!;
  const gaps = summary.gaps!;
  const readiness = summary.readiness as any;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Tile label="Engagements" value={totals.engagements} />
        <Tile label="Planned Hours" value={Number(totals.planned_hours).toLocaleString()} />
        <Tile label="Planned Days" value={Number(totals.planned_days).toLocaleString()} />
        <Tile
          label="Net Capacity"
          value={`${Number(totals.net_capacity_hours).toLocaleString()}h`}
          hint={`${Number(totals.buffer_hours).toLocaleString()}h buffer`}
        />
        <Tile
          label="Utilisation"
          value={totals.utilisation_pct != null ? `${totals.utilisation_pct}%` : '—'}
        />
        <Tile
          label="Remaining"
          value={`${Number(totals.remaining_capacity_hours).toLocaleString()}h`}
        />
      </div>

      {totals.utilisation_pct != null && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2 text-sm">
              <span className="font-semibold">Capacity utilisation</span>
              <span className="tabular-nums">{totals.utilisation_pct}%</span>
            </div>
            <Progress value={Math.min(100, Number(totals.utilisation_pct))} className="h-2" />
            {Number(totals.utilisation_pct) > 100 && (
              <p className="text-xs text-destructive mt-2">
                Planned effort exceeds available audit capacity.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="composition">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="composition"><Layers className="h-3.5 w-3.5 mr-1" />Composition</TabsTrigger>
          <TabsTrigger value="resourcing"><Users className="h-3.5 w-3.5 mr-1" />Resourcing Gaps</TabsTrigger>
          <TabsTrigger value="coverage"><ShieldAlert className="h-3.5 w-3.5 mr-1" />Coverage</TabsTrigger>
          <TabsTrigger value="versions"><GitCompare className="h-3.5 w-3.5 mr-1" />Version Comparison</TabsTrigger>
        </TabsList>

        <TabsContent value="composition" className="space-y-4 mt-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">By Risk</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {RISK_ORDER.filter((r) => summary.by_risk?.[r]).map((r) => (
                  <div key={r} className="flex items-center justify-between text-sm">
                    <span>{r}</span>
                    <Badge variant={r === 'Critical' || r === 'High' ? 'destructive' : 'secondary'}>
                      {summary.by_risk![r]}
                    </Badge>
                  </div>
                ))}
                {!Object.keys(summary.by_risk || {}).length && (
                  <p className="text-sm text-muted-foreground">No engagements yet.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <CalendarRange className="h-4 w-4" />By Quarter
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {QUARTERS.filter((q) => summary.by_quarter?.[q]).map((q) => (
                  <div key={q} className="flex items-center justify-between text-sm">
                    <span>{q}</span>
                    <Badge variant={q === 'Unscheduled' ? 'outline' : 'secondary'}>{summary.by_quarter![q]}</Badge>
                  </div>
                ))}
                {!Object.keys(summary.by_quarter || {}).length && (
                  <p className="text-sm text-muted-foreground">No engagements yet.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Briefcase className="h-4 w-4" />By Department
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left p-2 font-medium">Department</th>
                    <th className="text-center p-2 font-medium">Engagements</th>
                    <th className="text-right p-2 font-medium">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary.by_department || []).map((d) => (
                    <tr key={`${d.department_id}-${d.department}`} className="border-b last:border-0">
                      <td className="p-2 font-medium">{d.department}</td>
                      <td className="p-2 text-center tabular-nums">{d.engagements}</td>
                      <td className="p-2 text-right tabular-nums">{Number(d.hours).toLocaleString()}</td>
                    </tr>
                  ))}
                  {!summary.by_department?.length && (
                    <tr><td colSpan={3} className="p-3 text-center text-muted-foreground">No engagements yet.</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {!!summary.by_function?.length && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">By Function</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {summary.by_function.map((f) => (
                  <Badge key={`${f.function_id}-${f.function}`} variant="outline">
                    {f.function} · {f.engagements}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="resourcing" className="space-y-4 mt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile label="Unscheduled" value={gaps.unscheduled} />
            <Tile label="Missing Lead" value={gaps.missing_lead} />
            <Tile label="Missing Reviewer" value={gaps.missing_reviewer} />
            <Tile label="Lead = Reviewer" value={gaps.lead_reviewer_conflict} />
          </div>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Engagements needing attention</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left p-2 font-medium">Engagement</th>
                    <th className="text-left p-2 font-medium">Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary.conflict_engagements || []).map((e) => (
                    <tr key={e.id} className="border-b last:border-0">
                      <td className="p-2 font-medium">{e.name}</td>
                      <td className="p-2 space-x-1">
                        {e.missing_lead && <Badge variant="outline">No lead</Badge>}
                        {e.missing_reviewer && <Badge variant="outline">No reviewer</Badge>}
                        {e.lead_reviewer_conflict && <Badge variant="destructive">Lead = Reviewer</Badge>}
                        {e.unscheduled && <Badge variant="outline">Unscheduled</Badge>}
                      </td>
                    </tr>
                  ))}
                  {!summary.conflict_engagements?.length && (
                    <tr><td colSpan={2} className="p-3 text-center text-muted-foreground">Every engagement is scheduled and staffed.</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {readiness && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Readiness (display only — submission is validated server-side):{' '}
                <strong>{readiness.ready === true ? 'Ready to submit' : 'Not ready'}</strong>
                {Array.isArray(readiness.blockers) && readiness.blockers.length > 0 && (
                  <> — {readiness.blockers.length} blocking item(s).</>
                )}
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>

        <TabsContent value="coverage" className="space-y-4 mt-4">
          {coverageLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : !coverage?.success ? (
            <Alert variant="destructive"><AlertDescription>Coverage analysis unavailable.</AlertDescription></Alert>
          ) : (
            <>
              {!!coverage.uncovered_high_risk?.length && (
                <Alert variant="destructive">
                  <ShieldAlert className="h-4 w-4" />
                  <AlertDescription>
                    {coverage.uncovered_high_risk.length} high or critical auditable area(s) are not covered by this plan.
                    This is advisory — audits are never added automatically.
                  </AlertDescription>
                </Alert>
              )}
              {!!coverage.departments_without_audit?.length && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Departments with no planned audit</CardTitle></CardHeader>
                  <CardContent className="flex flex-wrap gap-2">
                    {coverage.departments_without_audit.map((d) => (
                      <Badge key={d} variant="outline">{d}</Badge>
                    ))}
                  </CardContent>
                </Card>
              )}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Coverage analysis</CardTitle></CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground">
                        <th className="text-left p-2 font-medium">Department</th>
                        <th className="text-left p-2 font-medium">Function</th>
                        <th className="text-left p-2 font-medium">Risk</th>
                        <th className="text-center p-2 font-medium">Covered</th>
                        <th className="text-left p-2 font-medium">Engagement</th>
                        <th className="text-center p-2 font-medium">Quarter</th>
                        <th className="text-right p-2 font-medium">Effort</th>
                        <th className="text-left p-2 font-medium">Last Audit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(coverage.rows || []).map((r, i) => (
                        <tr key={`${r.department_id}-${r.function_id}-${i}`} className="border-b last:border-0">
                          <td className="p-2 font-medium">{r.department}</td>
                          <td className="p-2">{r.function || '—'}</td>
                          <td className="p-2">
                            {r.risk_rating ? (
                              <Badge variant={['Critical', 'High'].includes(r.risk_rating) ? 'destructive' : 'secondary'}>
                                {r.risk_rating}
                              </Badge>
                            ) : '—'}
                          </td>
                          <td className="p-2 text-center">
                            <Badge variant={r.covered ? 'default' : 'outline'}>{r.covered ? 'Yes' : 'No'}</Badge>
                          </td>
                          <td className="p-2">{r.engagement || '—'}</td>
                          <td className="p-2 text-center">{r.quarter || '—'}</td>
                          <td className="p-2 text-right tabular-nums">{r.effort_hours ?? '—'}</td>
                          <td className="p-2">{r.last_audit_date || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="versions" className="space-y-4 mt-4">
          {diffLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : !diff?.success ? (
            <Alert variant="destructive"><AlertDescription>Version comparison unavailable.</AlertDescription></Alert>
          ) : !diff.has_baseline ? (
            <Alert><AlertDescription>{diff.message}</AlertDescription></Alert>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Tile label="Baseline" value={`v${diff.baseline?.version_number}`} hint={diff.baseline?.status_at_snapshot} />
                <Tile label="Added" value={diff.added?.length ?? 0} />
                <Tile label="Removed" value={diff.removed?.length ?? 0} />
                <Tile
                  label="Effort Δ"
                  value={`${Number(diff.effort?.delta_hours ?? 0) >= 0 ? '+' : ''}${Number(diff.effort?.delta_hours ?? 0).toLocaleString()}h`}
                  hint={`${Number(diff.effort?.baseline_hours ?? 0).toLocaleString()}h → ${Number(diff.effort?.current_hours ?? 0).toLocaleString()}h`}
                />
              </div>

              {(['added', 'removed'] as const).map((key) => (
                !!diff[key]?.length && (
                  <Card key={key}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm capitalize">{key} engagements</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1.5">
                      {diff[key]!.map((e) => (
                        <div key={e.engagement_id} className="flex items-center justify-between text-sm border-b last:border-0 py-1.5">
                          <span className="font-medium">{e.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {e.quarter || 'Unscheduled'} · {e.risk || 'Unrated'} · {e.hours || 0}h
                          </span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )
              ))}

              {!!diff.modified?.length && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Modified engagements</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    {diff.modified.map((m) => (
                      <div key={m.engagement_id}>
                        <p className="text-sm font-medium">{m.name}</p>
                        <ul className="text-xs text-muted-foreground ml-4 list-disc">
                          {(m.changes || []).map((c, i) => (
                            <li key={i}>
                              <span className="font-mono">{c.field}</span>: {c.from || '—'} → {c.to || '—'}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default PlanPortfolioPanel;
