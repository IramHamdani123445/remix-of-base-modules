import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { isComplianceDbFlagEnabled } from '@/lib/compliance/featureToggles';

export interface ComplianceJob {
  id: string;
  job_code: string;
  name: string;
  description: string | null;
  job_type: string;
  schedule_cron: string | null;
  frequency: string | null;
  is_enabled: boolean | null;
  last_run_at: string | null;
  last_run_status: string | null;
  next_scheduled_at: string | null;
  parameters: Record<string, any> | null;
}

export interface JobRun {
  id: string;
  job_id: string;
  run_status: string;
  is_dry_run: boolean;
  triggered_by: string | null;
  records_processed: number | null;
  records_affected: number | null;
  errors_count: number | null;
  error_details: any;
  summary: any;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
}

export function useComplianceJobs() {
  return useQuery({
    queryKey: ['ce_employer_compliance_jobs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ce_automation_jobs')
        .select('*')
        .eq('job_type', 'employer_compliance')
        .order('job_code');
      if (error) throw error;
      return (data || []) as unknown as ComplianceJob[];
    },
  });
}

export function useJobRunHistory(jobId: string | null) {
  return useQuery({
    queryKey: ['ce_job_runs', jobId],
    queryFn: async () => {
      if (!jobId) return [];
      const { data, error } = await supabase
        .from('ce_automation_job_runs')
        .select('*')
        .eq('job_id', jobId)
        .order('started_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data || []) as unknown as JobRun[];
    },
    enabled: !!jobId,
  });
}

/** Sentinel thrown when the scan is still progressing when polling gives up. */
export const RUN_STILL_PROGRESSING = 'RUN_STILL_PROGRESSING';

/**
 * Polls a background automation run until it leaves "Running".
 *
 * The violation scan processes employers in chained slices, so it can legally
 * run for many minutes on a full-tenant scan. Progress is reported through
 * `execution_log.progress_percent`; a run that is still making progress is
 * never treated as an error — the caller downgrades it to an informational
 * "still running in the background" message.
 */
async function pollAutomationRun(
  runId: string,
  timeoutMs = 12 * 60_000,
  onProgress?: (pct: number, done: number, total: number) => void,
): Promise<any> {
  const start = Date.now();
  let delay = 1500;
  while (Date.now() - start < timeoutMs) {
    const { data, error } = await supabase
      .from('ce_automation_runs')
      .select('id, status, execution_log, records_processed, records_affected, completed_at')
      .eq('id', runId)
      .maybeSingle();
    if (error) throw error;
    if (data && data.status && data.status !== 'Running') {
      return data;
    }
    const log: any = data?.execution_log || {};
    if (onProgress && typeof log.progress_percent === 'number') {
      onProgress(log.progress_percent, log.employers_done ?? 0, log.employers_total ?? 0);
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay + 500, 4000);
  }
  const err = new Error(RUN_STILL_PROGRESSING);
  err.name = RUN_STILL_PROGRESSING;
  throw err;
}


export function useRunComplianceJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ jobCode, dryRun, force }: { jobCode: string; dryRun: boolean; force?: boolean }) => {
      if (!isComplianceDbFlagEnabled('compliance.risk.automation_jobs')) {
        throw new Error('Automation Jobs is disabled in Setup → Feature Toggles.');
      }
      const { data, error } = await supabase.functions.invoke('run-compliance-job', {
        body: { job_code: jobCode, dry_run: dryRun, force: force ?? false },
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.error || 'Job execution failed');

      // If the edge function deferred the work (status: Running + run_id), poll
      // ce_automation_runs until the background scan completes.
      const isAsync = data?.result?.status === 'Running' || data?.status === 'Running' || data?.accepted === true;
      if (isAsync && data?.run_id) {
        const finished = await pollAutomationRun(data.run_id);
        const log = finished.execution_log || {};
        if (finished.status === 'Failed') {
          throw new Error(log.error || 'Detection job failed');
        }
        return {
          run_id: finished.id,
          scan_details: {
            total_employers_scanned: log.total_employers_scanned,
            rules_evaluated: log.rules_evaluated,
            violations_detected: log.violations_detected,
            violations_created: log.violations_created,
            violations_skipped_dedupe: log.violations_skipped_dedupe,
            by_rule: log.by_rule,
            sample_violations: log.sample_violations,
            dry_run: log.dry_run,
          },
          result: {
            processed: finished.records_processed ?? 0,
            affected: finished.records_affected ?? 0,
          },
        };
      }
      return data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['ce_employer_compliance_jobs'] });
      queryClient.invalidateQueries({ queryKey: ['ce_job_runs'] });

      const scan = data?.scan_details;
      if (scan) {
        const isDry = scan.dry_run ?? variables.dryRun;
        const label = isDry ? '🔍 Dry Run Complete' : '✅ Job Completed';
        const desc = isDry
          ? `Scanned ${scan.total_employers_scanned} employers. Would create ${(scan.violations_detected || 0) - (scan.violations_skipped_dedupe || 0)} violations. No data changed.`
          : `Scanned ${scan.total_employers_scanned} employers. Created ${scan.violations_created} violations.`;
        toast.success(label, { description: desc, duration: 8000 });
      } else if (data?.already_completed) {
        toast.info('Already completed for today', { description: 'Use force re-run if needed.' });
      } else {
        const label = variables.dryRun ? 'Dry run' : 'Job';
        toast.success(`${label} completed`, {
          description: `Processed: ${data?.result?.processed ?? 0}, Affected: ${data?.result?.affected ?? 0}`,
        });
      }
    },
    onError: (error: any) => {
      toast.error('Job execution failed', { description: error.message });
    },
  });
}


export function useToggleJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, is_enabled }: { id: string; is_enabled: boolean }) => {
      const { error } = await supabase
        .from('ce_automation_jobs')
        .update({ is_enabled } as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ce_employer_compliance_jobs'] });
      toast.success('Job status updated');
    },
  });
}
