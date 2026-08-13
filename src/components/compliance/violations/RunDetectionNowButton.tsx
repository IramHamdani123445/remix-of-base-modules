import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, Play, ScanSearch } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useRunComplianceJob } from '@/hooks/compliance/useComplianceJobs';
import { isComplianceDbFlagEnabled } from '@/lib/compliance/featureToggles';

/**
 * Manual trigger for the JOB-VIOLATION-SCAN automation job.
 *
 * The detection engine is wired but not yet on a schedule. This button
 * exposes the same `run-compliance-job` edge function used by the
 * Automation Jobs admin screen, so admins can fire the scan from where
 * they look (All Violations) without hunting for the admin route.
 */
export function RunDetectionNowButton({ employerId }: { employerId?: string | null } = {}) {
  const [open, setOpen] = useState(false);
  const runJob = useRunComplianceJob();
  const queryClient = useQueryClient();

  // Hide entirely when the automation feature flag is off — matches the
  // gate on /compliance/admin/automation/jobs.
  if (!isComplianceDbFlagEnabled('compliance.risk.automation_jobs')) return null;

  const handleRun = async (dryRun: boolean) => {
    try {
      await runJob.mutateAsync({
        jobCode: 'JOB-VIOLATION-SCAN',
        dryRun,
        // A tenant-wide scan is processed in chained slices and can stop part
        // way through, which left late-sorting employers (e.g. newly created
        // ones) without any violations even though the rule simulator matched
        // them. When the screen is scoped to an employer, scan just that
        // employer so detection always reaches them, and bypass the per-day
        // idempotency key so the scoped run is never skipped.
        force: employerId ? true : undefined,
        params: employerId ? { employer_id: employerId } : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ['ce_violations_page'] });
      queryClient.invalidateQueries({ queryKey: ['ce_violations_counts'] });
      queryClient.invalidateQueries({ queryKey: ['ce_violations_rule_detected'] });
      if (!dryRun) setOpen(false);
    } catch {
      // toast handled inside the hook
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-2"
      >
        <ScanSearch className="h-4 w-4" />
        {employerId ? 'Run Detection for this Employer' : 'Run Detection Now'}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {employerId ? `Run violation detection for ${employerId}` : 'Run violation detection'}
            </DialogTitle>
            <DialogDescription>
              This runs the same detection rules that the scheduled scan uses
              (<code className="text-xs">JOB-VIOLATION-SCAN</code>) and creates
              new auto-generated violations for any rules that match.
              {employerId ? ' Only this employer is scanned, so it finishes in seconds.' : ''}
              <br /><br />
              Choose <strong>Dry Run</strong> to preview how many would be
              created without writing anything, or <strong>Run Now</strong> to
              persist them. Existing violations for the same employer/period
              are skipped automatically.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => handleRun(true)}
              disabled={runJob.isPending}
            >
              {runJob.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <ScanSearch className="h-4 w-4 mr-2" />
              )}
              Dry Run
            </Button>
            <Button
              onClick={() => handleRun(false)}
              disabled={runJob.isPending}
            >
              {runJob.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Run Now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
