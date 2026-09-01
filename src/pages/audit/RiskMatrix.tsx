import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/common';
import { Layers, Building2, ShieldAlert } from 'lucide-react';
import { useIARiskAssessments } from '@/hooks/useAuditDataPhase2';
import { supabase } from '@/integrations/supabase/client';
import { calculateRiskLevel, getRiskColor } from '@/lib/audit/riskEngine';
import { useRiskRatingCalculator } from '@/hooks/useRiskConfig';
import { formatDepartmentLabel } from '@/lib/audit/departmentLabel';

function getLevelClasses(level: string) {
  switch (level) {
    case 'Critical':
      return 'bg-destructive text-destructive-foreground border-destructive/40';
    case 'High':
      return 'bg-destructive/15 text-foreground border-destructive/30';
    case 'Medium':
      return 'bg-accent text-accent-foreground border-border';
    default:
      return 'bg-secondary text-secondary-foreground border-border';
  }
}

export default function RiskMatrix() {
  const { data: assessments = [], isLoading } = useIARiskAssessments();
  const [selectedCell, setSelectedCell] = useState<{ likelihood: number; impact: number } | null>(null);
  const { bands } = useRiskRatingCalculator();

  const { data: functions = [] } = useQuery({
    queryKey: ['ia_department_functions_all_for_matrix'],
    queryFn: async () => {
      const { data, error } = await supabase.from('ia_department_functions' as any).select('*').eq('is_active', true);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['v_ia_departments_for_matrix'],
    queryFn: async () => {
      const { data, error } = await (supabase.from('v_ia_departments' as any) as any).select('*').eq('is_active', true).order('display_label');
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const functionMap = useMemo(() => Object.fromEntries(functions.map((fn: any) => [fn.id, fn])), [functions]);
  const departmentMap = useMemo(() => new Map(departments.map((dept: any) => [dept.id, dept])), [departments]);

  const cells = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (let likelihood = 1; likelihood <= 5; likelihood++) {
      for (let impact = 1; impact <= 5; impact++) {
        map[`${likelihood}-${impact}`] = [];
      }
    }

    assessments.forEach((item: any) => {
      const likelihood = Math.min(5, Math.max(1, Number(item.likelihood_score) || 1));
      const impact = Math.min(5, Math.max(1, Number(item.impact_score) || 1));
      map[`${likelihood}-${impact}`].push(item);
    });

    return map;
  }, [assessments]);

  const selectedItems = selectedCell ? cells[`${selectedCell.likelihood}-${selectedCell.impact}`] ?? [] : [];

  const topRiskFunctions = useMemo(() => {
    return [...assessments]
      .sort((a: any, b: any) => (Number(b.overall_risk_score) || 0) - (Number(a.overall_risk_score) || 0))
      .slice(0, 5);
  }, [assessments]);

  return (
    <PageShell
      title="Risk Matrix"
      subtitle="5×5 impact versus likelihood view for department functions"
      breadcrumbs={[{ label: 'Internal Audit', href: '/audit/dashboard' }, { label: 'Risk Matrix' }]}
      isLoading={isLoading}
    >
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-4 w-4 text-primary" />
              Function Risk Heatmap
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-6 gap-2 text-xs">
              <div className="flex items-end justify-center p-2 text-center text-muted-foreground">Likelihood ↓ / Impact →</div>
              {[1, 2, 3, 4, 5].map((impact) => (
                <div key={impact} className="rounded-md border bg-muted/40 p-2 text-center font-medium">{impact}</div>
              ))}

              {[5, 4, 3, 2, 1].map((likelihood) => (
                <div key={likelihood} className="contents">
                  <div className="flex items-center justify-center rounded-md border bg-muted/40 p-2 text-center font-medium">{likelihood}</div>
                  {[1, 2, 3, 4, 5].map((impact) => {
                    const score = likelihood * impact;
                    const level = calculateRiskLevel(score, bands);
                    const items = cells[`${likelihood}-${impact}`] ?? [];
                    const isSelected = selectedCell?.likelihood === likelihood && selectedCell?.impact === impact;

                    return (
                      <button
                        key={`${likelihood}-${impact}`}
                        type="button"
                        onClick={() => setSelectedCell({ likelihood, impact })}
                        className={`min-h-20 rounded-lg border p-3 text-left transition hover:opacity-90 ${getLevelClasses(level)} ${isSelected ? 'ring-2 ring-ring' : ''}`}
                      >
                        <div className="text-xs opacity-80">{level}</div>
                        <div className="text-2xl font-semibold">{items.length}</div>
                        <div className="text-xs opacity-80">Score {score}</div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4 text-primary" />
              Top Risk Functions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {topRiskFunctions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No risk assessments available yet.</p>
            ) : (
              topRiskFunctions.map((item: any) => {
                const fn = functionMap[item.function_id];
                const dept = fn ? departmentMap.get(fn.department_id) : null;
                const score = Number(item.overall_risk_score) || (Number(item.impact_score) || 0) * (Number(item.likelihood_score) || 0);
                const level = item.risk_level || calculateRiskLevel(score, bands);

                return (
                  <div key={item.id} className="rounded-lg border bg-card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{fn?.function_name || 'Unknown Function'}</p>
                        <p className="text-xs text-muted-foreground">{dept ? formatDepartmentLabel(dept) : 'Unassigned Department'}</p>
                      </div>
                      <Badge className={getLevelClasses(level)}>{level}</Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">Impact {item.impact_score || 0} × Likelihood {item.likelihood_score || 0} = {score}</p>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      {selectedCell && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4 text-primary" />
              Functions in selected cell ({selectedCell.likelihood} × {selectedCell.impact})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {selectedItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">No functions fall into this risk cell.</p>
            ) : (
              <div className="space-y-3">
                {selectedItems.map((item: any) => {
                  const fn = functionMap[item.function_id];
                  const dept = fn ? departmentMap.get(fn.department_id) : null;
                  const score = Number(item.overall_risk_score) || (Number(item.impact_score) || 0) * (Number(item.likelihood_score) || 0);
                  const level = item.risk_level || calculateRiskLevel(score, bands);

                  return (
                    <div key={item.id} className="flex flex-col gap-2 rounded-lg border bg-card p-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-sm font-medium">{fn?.function_name || 'Unknown Function'}</p>
                        <p className="text-xs text-muted-foreground">{(dept ? formatDepartmentLabel(dept) : 'Unassigned Department')} • {item.risk_category || 'General Risk'}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">Score {score}</Badge>
                        <Badge className={getLevelClasses(level)}>{level}</Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
