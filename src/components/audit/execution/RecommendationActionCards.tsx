import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Lightbulb, ArrowRight, CheckCircle2, Loader2 } from 'lucide-react';
import { formatDateForDisplay } from '@/lib/format-config';
import {
  useEngagementRecommendations,
  useCreateActionFromRecommendation,
  type EngagementRecommendation,
} from '@/hooks/useAuditPhase3';
import { useInternalAuditPermissions } from '@/hooks/useInternalAuditPermissions';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

interface Props {
  auditId: string;
  auditActions: any[];
  disabled?: boolean;
}

export function RecommendationActionCards({ auditId, auditActions, disabled }: Props) {
  const { data: recommendations = [], isLoading } = useEngagementRecommendations(auditId);
  const convert = useCreateActionFromRecommendation();
  const { can } = useInternalAuditPermissions();
  const canRaise = can('progress_audit_actions');

  const [target, setTarget] = useState<EngagementRecommendation | null>(null);
  const [form, setForm] = useState({ responsible_person: '', target_date: '' });

  const trackedIds = new Set(
    auditActions.map((a: any) => a.recommendation_id).filter(Boolean) as string[],
  );
  const pending = recommendations.filter((r) => !trackedIds.has(r.id));

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading recommendations...
        </CardContent>
      </Card>
    );
  }

  if (recommendations.length === 0) return null;

  const openDialog = (rec: EngagementRecommendation) => {
    setTarget(rec);
    setForm({
      responsible_person: rec.responsible_party || '',
      target_date: rec.official_target_date || rec.suggested_target_date || '',
    });
  };

  const submit = () => {
    if (!target) return;
    convert.mutate(
      {
        recommendationId: target.id,
        responsiblePerson: form.responsible_person || null,
        targetDate: form.target_date || null,
      },
      { onSuccess: () => setTarget(null) },
    );
  };

  return (
    <>
      <Card className="border-amber-500/30">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              Recommendations
            </h3>
            <Badge variant={pending.length > 0 ? 'destructive' : 'secondary'}>
              {pending.length > 0 ? `${pending.length} not yet tracked` : 'All tracked'}
            </Badge>
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            {recommendations.map((rec) => {
              const tracked = trackedIds.has(rec.id);
              return (
                <div
                  key={rec.id}
                  className={`rounded-lg border p-3 space-y-2 ${tracked ? 'border-border/50 bg-muted/30' : 'border-amber-500/40'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs text-muted-foreground truncate">{rec.finding_title || 'Finding'}</p>
                    {rec.priority && <Badge variant="outline" className="text-[10px]">{rec.priority}</Badge>}
                  </div>
                  <p className="text-sm leading-snug">{rec.recommendation_text || '—'}</p>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] text-muted-foreground">
                      {rec.responsible_party || 'Unassigned'}
                      {(rec.official_target_date || rec.suggested_target_date) &&
                        ` · due ${formatDateForDisplay(rec.official_target_date || rec.suggested_target_date!)}`}
                    </p>
                    {tracked ? (
                      <span className="text-[11px] text-primary flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Action raised
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canRaise || disabled}
                        onClick={() => openDialog(rec)}
                      >
                        Create action <ArrowRight className="h-3.5 w-3.5 ml-1" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create action from recommendation</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{target?.recommendation_text}</p>
            <div>
              <Label>Assigned To</Label>
              <Input
                value={form.responsible_person}
                onChange={(e) => setForm((f) => ({ ...f, responsible_person: e.target.value }))}
              />
            </div>
            <div>
              <Label>Target Date</Label>
              <Input
                type="date"
                value={form.target_date}
                onChange={(e) => setForm((f) => ({ ...f, target_date: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>Cancel</Button>
            <Button onClick={submit} disabled={convert.isPending}>
              {convert.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Create action
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
