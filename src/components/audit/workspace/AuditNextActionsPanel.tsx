import React from 'react';
import { ArrowRight, AlertTriangle, CheckCircle, Clock, FileText, Send, Rocket, Lock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface NextAction {
  label: string;
  description?: string;
  icon?: any;
  variant?: 'default' | 'primary' | 'warning' | 'destructive';
  onClick?: () => void;
  disabled?: boolean;
}

interface AuditNextActionsPanelProps {
  actions: NextAction[];
  title?: string;
  className?: string;
}

export function AuditNextActionsPanel({ actions, title = 'Recommended Actions', className }: AuditNextActionsPanelProps) {
  if (actions.length === 0) return null;

  return (
    <Card className={cn('border-primary/20', className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <ArrowRight className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {actions.map((action, idx) => {
          const Icon = action.icon || ArrowRight;
          const btnVariant = action.variant === 'primary' ? 'default'
            : action.variant === 'warning' ? 'outline'
            : action.variant === 'destructive' ? 'destructive'
            : 'outline';

          return (
            <Button
              key={idx}
              variant={btnVariant}
              size="sm"
              className={cn(
                'w-full justify-start text-left h-auto py-2.5 px-3',
                action.variant === 'primary' && 'bg-primary text-primary-foreground',
              )}
              disabled={action.disabled}
              onClick={action.onClick}
            >
              <Icon className="h-4 w-4 mr-2 shrink-0" />
              <div className="min-w-0">
                <span className="text-xs font-medium block">{action.label}</span>
                {action.description && (
                  <span className="text-[10px] opacity-70 block mt-0.5">{action.description}</span>
                )}
              </div>
            </Button>
          );
        })}
      </CardContent>
    </Card>
  );
}

// Helper to derive recommended actions from audit state
export interface NextActionEntitlements {
  /** Gate for lifecycle-changing recommendations (launch / close). */
  canLaunch?: boolean;
  canClose?: boolean;
}

export function deriveNextActions(audit: any, counts: {
  findings: number; openFindings: number; responses: number;
  actions: number; overdueActions: number;
}, entitlements: NextActionEntitlements = { canLaunch: true, canClose: true }): NextAction[] {
  const execStatus = audit?.execution_status || 'Planned';
  const actions: NextAction[] = [];

  if (entitlements.canLaunch !== false && (execStatus === 'Planned' || execStatus === 'Ready for Launch')) {
    actions.push({
      label: 'Launch Audit',
      description: 'Verify readiness and begin audit execution',
      icon: Rocket,
      variant: 'primary',
    });
  }
  if (execStatus === 'Notification Sent' || execStatus === 'Opening Meeting Scheduled') {
    actions.push({
      label: 'Begin Fieldwork',
      description: 'Start audit evidence gathering and testing',
      icon: FileText,
      variant: 'primary',
    });
  }
  if (execStatus === 'Fieldwork In Progress' && counts.findings === 0) {
    actions.push({
      label: 'Document Findings',
      description: 'Record issues identified during fieldwork',
      icon: AlertTriangle,
      variant: 'warning',
    });
  }
  if (counts.openFindings > 0 && execStatus === 'Findings Drafting') {
    actions.push({
      label: 'Request Management Responses',
      description: `${counts.openFindings} finding(s) awaiting response`,
      icon: Send,
      variant: 'warning',
    });
  }
  if (counts.overdueActions > 0) {
    actions.push({
      label: 'Follow Up on Overdue Actions',
      description: `${counts.overdueActions} overdue action item(s)`,
      icon: Clock,
      variant: 'destructive',
    });
  }
  if (entitlements.canClose !== false && execStatus === 'Follow-up Monitoring' && counts.openFindings === 0) {
    actions.push({
      label: 'Close Audit',
      description: 'All findings resolved — ready for closure',
      icon: Lock,
      variant: 'primary',
    });
  }

  return actions;
}
