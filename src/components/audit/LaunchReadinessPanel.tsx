import React from 'react';
import { CheckCircle, XCircle, Loader2, Rocket, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLaunchReadiness, useLaunchEngagement } from '@/hooks/useEngagementExecution';
import { useInternalAuditPermissions } from '@/hooks/useInternalAuditPermissions';
import { cn } from '@/lib/utils';

interface Props {
  engagementId: string;
  currentExecutionStatus?: string;
  onLaunched?: () => void;
}

export function LaunchReadinessPanel({ engagementId, currentExecutionStatus, onLaunched }: Props) {
  const { data: readiness, isLoading } = useLaunchReadiness(engagementId);
  const launchMutation = useLaunchEngagement();
  const { can } = useInternalAuditPermissions();
  const isEntitledToLaunch = can('launch_department_audit');

  const canLaunch = isEntitledToLaunch
    && (currentExecutionStatus === 'Planned' || currentExecutionStatus === 'Ready for Launch');
  const alreadyLaunched = currentExecutionStatus !== undefined
    && currentExecutionStatus !== 'Planned'
    && currentExecutionStatus !== 'Ready for Launch';


  const handleLaunch = async () => {
    await launchMutation.mutateAsync(engagementId);
    onLaunched?.();
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (alreadyLaunched) {
    return (
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex items-center gap-3 py-4">
          <CheckCircle className="h-5 w-5 text-primary shrink-0" />
          <div>
            <p className="text-sm font-medium">Engagement Launched</p>
            <p className="text-xs text-muted-foreground">Current execution status: {currentExecutionStatus}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const checks = readiness?.checks || [];
  const passedCount = checks.filter(c => c.passed).length;
  const totalCount = checks.length;

  return (
    <Card className={cn(
      'border',
      readiness?.ready ? 'border-primary/30' : 'border-amber-300 dark:border-amber-700'
    )}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          {readiness?.ready ? (
            <Rocket className="h-4 w-4 text-primary" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          )}
          Launch Readiness
          <span className={cn(
            'text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-auto',
            readiness?.ready 
              ? 'bg-primary/10 text-primary' 
              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
          )}>
            {passedCount}/{totalCount}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          {checks.map((check, idx) => (
            <div key={idx} className="flex items-center gap-2">
              {check.passed ? (
                <CheckCircle className="h-3.5 w-3.5 text-primary shrink-0" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
              )}
              <span className={cn(
                'text-xs',
                check.passed ? 'text-foreground' : 'text-destructive font-medium'
              )}>
                {check.item}
              </span>
              {check.detail && !check.passed && (
                <span className="text-[10px] text-muted-foreground ml-1">({check.detail})</span>
              )}
            </div>
          ))}
        </div>

        {canLaunch && (
          <Button
            onClick={handleLaunch}
            disabled={!readiness?.ready || launchMutation.isPending}
            className="w-full"
            size="sm"
          >
            {launchMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Launching...</>
            ) : (
              <><Rocket className="h-4 w-4 mr-1" />Launch Engagement</>
            )}
          </Button>
        )}

        {!readiness?.ready && canLaunch && (
          <p className="text-[10px] text-muted-foreground text-center">
            Resolve all items above before launching
          </p>
        )}
      </CardContent>
    </Card>
  );
}
