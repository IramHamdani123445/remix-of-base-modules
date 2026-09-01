import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';

type Diagnostic = {
  rule_id?: string;
  rule_code?: string;
  trigger_event?: string;
  status?: 'ok' | 'configuration_error' | 'not_implemented' | string;
  errors?: string[];
  effective_parameters?: Record<string, unknown>;
  parameter_sources?: Record<string, string>;
  config_updated_at?: string | null;
};

interface Props {
  /** Only show diagnostics whose rule_code starts with this prefix (e.g. 'DR-' or 'CR-'). */
  codePrefix?: string;
}

/**
 * Shows how the last violation scan actually resolved rule parameters at runtime.
 * This is the proof that configuration in the Rule Engine is the authoritative
 * source of business behaviour — rules with unresolved required parameters are
 * skipped by the scanner and surfaced here.
 */
export function RuleRuntimeHealthPanel({ codePrefix }: Props) {
  const { data } = useQuery({
    queryKey: ['ce_rule_runtime_health'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ce_automation_runs')
        .select('id, started_at, status, is_dry_run, execution_log')
        .order('started_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      const run = (data ?? []).find(
        (r: any) => Array.isArray(r?.execution_log?.rule_diagnostics),
      );
      if (!run) return null;
      return {
        startedAt: run.started_at as string,
        isDryRun: Boolean(run.is_dry_run),
        diagnostics: ((run as any).execution_log.rule_diagnostics ?? []) as Diagnostic[],
      };
    },
  });

  if (!data) return null;

  const diagnostics = data.diagnostics.filter(
    (d) => !codePrefix || (d.rule_code ?? '').startsWith(codePrefix),
  );
  if (diagnostics.length === 0) return null;

  const problems = diagnostics.filter((d) => d.status !== 'ok');
  const when = new Date(data.startedAt).toLocaleString();

  return (
    <Alert variant={problems.length > 0 ? 'destructive' : 'default'} className="mb-4">
      {problems.length > 0 ? (
        <AlertTriangle className="h-4 w-4" />
      ) : (
        <CheckCircle2 className="h-4 w-4" />
      )}
      <AlertTitle className="flex items-center gap-2">
        Runtime configuration health
        <Badge variant="outline" className="text-[10px]">
          last scan {when}
          {data.isDryRun ? ' · dry run' : ''}
        </Badge>
      </AlertTitle>
      <AlertDescription className="space-y-2 mt-2">
        {problems.length === 0 ? (
          <p className="text-xs">
            All {diagnostics.length} enabled rules resolved their parameters from configuration.
            No code fallbacks were used.
          </p>
        ) : (
          <div className="space-y-2">
            {problems.map((d) => (
              <div key={`${d.rule_code}-${d.rule_id}`} className="text-xs">
                <span className="font-mono font-medium">{d.rule_code}</span>{' '}
                <Badge variant="outline" className="text-[10px]">
                  {d.status === 'not_implemented' ? 'no runtime implementation' : 'configuration error'}
                </Badge>
                <span className="ml-2 opacity-90">{(d.errors ?? []).join(' · ')}</span>
              </div>
            ))}
            <p className="text-[11px] opacity-80 flex items-center gap-1">
              <Info className="h-3 w-3" /> Rules listed above were skipped by the scanner and
              created no violations.
            </p>
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}

export default RuleRuntimeHealthPanel;
