/**
 * VersionReadinessPanel — the authoritative "can this version go live?" verdict.
 *
 * It runs the same publish gate that guards Submit / Approve / Publish in Rule
 * Version Governance, so the Product Editor and Governance can never disagree.
 * Cross-tab conflict detection answers a narrower question and is shown
 * separately.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle2, ShieldAlert, RefreshCw, AlertTriangle } from 'lucide-react';
import { useVersionReadiness } from '@/hooks/bn/useVersionReadiness';

/** Map a gate error message to the Product Editor tab that fixes it. */
function tabForIssue(issue: string): { tab: string; label: string } | null {
  const t = issue.toLowerCase();
  if (t.includes('formula binding') || t.includes('calculation')) return { tab: 'calculation', label: 'Calculation' };
  if (t.includes('eligibility')) return { tab: 'eligibility', label: 'Eligibility' };
  if (t.includes('workflow')) return { tab: 'workflow', label: 'Workflow' };
  if (t.includes('screen')) return { tab: 'screens', label: 'Screens' };
  if (t.includes('document')) return { tab: 'documents', label: 'Documents' };
  if (t.includes('channel')) return { tab: 'channels', label: 'Channels' };
  return null;
}

interface Props {
  versionId?: string;
  onJumpToTab?: (tab: string) => void;
}

export function VersionReadinessPanel({ versionId, onJumpToTab }: Props) {
  const { data, isLoading, isError, error, refetch, isFetching } = useVersionReadiness(versionId);

  if (!versionId) return null;

  const errors = data?.errors ?? [];
  const warnings = data?.warnings ?? [];

  return (
    <Card className={'border-l-4 ' + (errors.length ? 'border-l-destructive' : 'border-l-emerald-500')}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" /> Version Readiness
            {data && (
              <>
                <Badge variant={errors.length ? 'destructive' : 'outline'} className="text-[10px]">
                  {errors.length} blocking
                </Badge>
                <Badge variant="secondary" className="text-[10px]">{warnings.length} advisory</Badge>
              </>
            )}
          </span>
          <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3 w-3 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Checking publish readiness…</p>
        ) : isError ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Readiness could not be checked: {(error as Error)?.message}
            </AlertDescription>
          </Alert>
        ) : errors.length === 0 ? (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Ready to submit and publish. No blocking issues found by the publish gate.
            </AlertDescription>
          </Alert>
        ) : (
          <ul className="space-y-2">
            {errors.map((issue, i) => {
              const target = tabForIssue(issue);
              return (
                <li key={i} className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
                  <div className="flex items-start gap-2">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    <p className="flex-1 leading-snug">{issue}</p>
                    {target && onJumpToTab && (
                      <Button
                        size="sm"
                        variant="link"
                        className="h-auto p-0 text-[10px]"
                        onClick={() => onJumpToTab(target.tab)}
                      >Go to {target.label} →</Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {warnings.length > 0 && (
          <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
            {warnings.map((w, i) => <li key={i}>• {w}</li>)}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
