import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, ShieldAlert, Info, RefreshCw, CheckCircle2 } from 'lucide-react';
import { useConflictDetection } from '@/hooks/bn/useConflictDetection';
import type { Conflict, ConflictSeverity } from '@/services/bn/config/conflictDetectionService';

const sevIcon = (s: ConflictSeverity) =>
  s === 'ERROR' ? <ShieldAlert className="h-4 w-4 text-destructive" />
  : s === 'WARNING' ? <AlertTriangle className="h-4 w-4 text-amber-500" />
  : <Info className="h-4 w-4 text-muted-foreground" />;

const sevVariant = (s: ConflictSeverity): 'destructive' | 'secondary' | 'outline' =>
  s === 'ERROR' ? 'destructive' : s === 'WARNING' ? 'secondary' : 'outline';

interface Props {
  versionId?: string;
  onJumpToTab?: (tab: string) => void;
  compact?: boolean;
}

export function ConflictDetectionPanel({ versionId, onJumpToTab, compact }: Props) {
  const { data, isLoading, refetch, isFetching } = useConflictDetection(versionId);

  if (!versionId) return null;

  const total = (data?.errors ?? 0) + (data?.warnings ?? 0) + (data?.info ?? 0);

  return (
    <Card className={compact ? 'border-l-4 ' + (data?.errors ? 'border-l-destructive' : data?.warnings ? 'border-l-amber-500' : 'border-l-emerald-500') : undefined}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" /> Cross-Tab Consistency Checks
            {data && (
              <>
                <Badge variant="destructive" className="text-[10px]">{data.errors} error</Badge>
                <Badge variant="secondary" className="text-[10px]">{data.warnings} warn</Badge>
                <Badge variant="outline" className="text-[10px]">{data.info} info</Badge>
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
          <p className="text-xs text-muted-foreground">Analysing configuration…</p>
        ) : total === 0 ? (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription className="text-xs">
              No cross-tab conflicts detected. This does not by itself mean the version can be
              published — see Version Readiness above for publish eligibility.
            </AlertDescription>

          </Alert>
        ) : (
          <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {data!.conflicts.map((c: Conflict) => (
              <li key={c.id} className="rounded-md border bg-card/50 p-2 text-xs">
                <div className="flex items-start gap-2">
                  {sevIcon(c.severity)}
                  <div className="flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant={sevVariant(c.severity)} className="text-[9px]">{c.severity}</Badge>
                      <Badge variant="outline" className="text-[9px]">{c.tab}</Badge>
                      <span className="text-[10px] text-muted-foreground">{c.conflict_type}</span>
                      {onJumpToTab && (
                        <Button
                          size="sm" variant="link"
                          className="ml-auto h-auto p-0 text-[10px]"
                          onClick={() => onJumpToTab(c.tab.toLowerCase())}
                        >Go to {c.tab} →</Button>
                      )}
                    </div>
                    <p className="leading-snug">{c.message}</p>
                    <p className="text-muted-foreground"><span className="font-medium">Fix:</span> {c.suggested_fix}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
