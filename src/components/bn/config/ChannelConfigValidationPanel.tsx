/**
 * Configuration Health panel — surfaces validateProductChannelConfig results
 * inside the Channels tab so admins see catalogue gaps without leaving the
 * page.
 */
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Loader2, ShieldCheck, AlertTriangle, AlertCircle, Info, RefreshCw } from 'lucide-react';
import {
  validateAllChannelConfigs,
  type ChannelValidationResult,
  type ChannelValidationIssue,
} from '@/services/bn/config/validateProductChannelConfig';

interface Props {
  productVersionId: string | undefined;
}

function IssueLine({ issue }: { issue: ChannelValidationIssue }) {
  const Icon = issue.severity === 'ERROR' ? AlertCircle : issue.severity === 'WARN' ? AlertTriangle : Info;
  const tone =
    issue.severity === 'ERROR'
      ? 'text-destructive'
      : issue.severity === 'WARN'
      ? 'text-amber-600'
      : 'text-muted-foreground';
  return (
    <div className="flex items-start gap-2 text-xs">
      <Icon className={`h-3.5 w-3.5 mt-0.5 ${tone}`} />
      <div className="space-y-0.5">
        <div className={tone}>
          <span className="font-medium">[{issue.code}]</span> {issue.message}
        </div>
        {issue.fixHint && <div className="text-muted-foreground">↳ {issue.fixHint}</div>}
      </div>
    </div>
  );
}

export function ChannelConfigValidationPanel({ productVersionId }: Props) {
  const [results, setResults] = useState<ChannelValidationResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!productVersionId) return;
    setLoading(true);
    setError(null);
    try {
      const out = await validateAllChannelConfigs(productVersionId);
      setResults(out);
    } catch (e: any) {
      setError(e?.message ?? 'Validation failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productVersionId]);

  if (!productVersionId) return null;

  const totalErrors = results.reduce((s, r) => s + r.errors.length, 0);
  const totalWarnings = results.reduce((s, r) => s + r.warnings.length, 0);
  const ok = !loading && totalErrors === 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" /> Configuration Health
            </CardTitle>
            <CardDescription>
              Cross-checks workflow wiring, payment masters, workbaskets, and eligibility rule fact keys.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {!loading && (
              <>
                <Badge variant={totalErrors > 0 ? 'destructive' : 'default'}>
                  {totalErrors} error{totalErrors === 1 ? '' : 's'}
                </Badge>
                <Badge variant="secondary">{totalWarnings} warning{totalWarnings === 1 ? '' : 's'}</Badge>
              </>
            )}
            <Button size="sm" variant="outline" onClick={run} disabled={loading}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              <span className="ml-1">Re-check</span>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Validation failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {!loading && ok && results.length > 0 && (
          <div className="text-xs text-emerald-700 flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" /> All channels are configured cleanly.
          </div>
        )}
        {results.map(r => {
          const items = [...r.errors, ...r.warnings, ...r.infos];
          if (items.length === 0) return null;
          return (
            <div key={r.channelConfigId} className="rounded border p-2 space-y-1.5">
              <div className="text-xs font-medium flex items-center gap-2">
                {r.channelCode} channel
                {/* A disabled channel accepts no applications, so its findings
                    are shown for information only (BUG-54). Saying so on the
                    row stops an administrator chasing a fault that is not one. */}
                {r.channelEnabled === false && (
                  <span className="rounded-full border px-1.5 py-0 text-[10px] font-normal text-muted-foreground">
                    disabled
                  </span>
                )}
              </div>
              {items.map((it, i) => <IssueLine key={i} issue={it} />)}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export default ChannelConfigValidationPanel;
