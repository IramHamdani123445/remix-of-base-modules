import React from 'react';
import { ArrowRight, AlertTriangle, CheckCircle, Clock, FileText, Send, Rocket, Lock, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * IA-POST-UAT-01 — Recommended Actions must never render a dead button.
 *
 * Every derived recommendation carries an `actionKey`. The consuming surface
 * resolves that key through a single dispatcher into the canonical governed
 * command / workspace navigation. No business mutation happens in this panel.
 * A recommendation with no resolvable target is rendered as an informational
 * row, never as a clickable button.
 */
export type NextActionKey =
  | 'LAUNCH_AUDIT'
  | 'BEGIN_FIELDWORK'
  | 'DOCUMENT_FINDINGS'
  | 'REQUEST_MANAGEMENT_RESPONSES'
  | 'FOLLOW_UP_OVERDUE_ACTIONS'
  | 'CLOSE_AUDIT';

interface NextAction {
  actionKey: NextActionKey;
  label: string;
  description?: string;
  icon?: any;
  variant?: 'default' | 'primary' | 'warning' | 'destructive';
  onClick?: () => void;
  disabled?: boolean;
}

interface AuditNextActionsPanelProps {
  actions: NextAction[];
  /** Resolves an action key to its canonical handler. Unresolved keys render informational. */
  onDispatch?: (key: NextActionKey) => void;
  title?: string;
  className?: string;
}

export function AuditNextActionsPanel({ actions, onDispatch, title = 'Recommended Actions', className }: AuditNextActionsPanelProps) {
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
        {actions.map((action) => {
          const Icon = action.icon || ArrowRight;
          const handler = action.onClick ?? (onDispatch ? () => onDispatch(action.actionKey) : undefined);

          // No resolvable target → render as informational, never as a dead button.
          if (!handler) {
            return (
              <div
                key={action.actionKey}
                className="w-full flex items-start gap-2 rounded-md border border-dashed border-border/60 bg-muted/30 py-2.5 px-3"
              >
                <Info className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <span className="text-xs font-medium block text-muted-foreground">{action.label}</span>
                  {action.description && (
                    <span className="text-[10px] opacity-70 block mt-0.5">{action.description}</span>
                  )}
                </div>
              </div>
            );
          }

          const btnVariant = action.variant === 'primary' ? 'default'
            : action.variant === 'warning' ? 'outline'
            : action.variant === 'destructive' ? 'destructive'
            : 'outline';

          return (
            <Button
              key={action.actionKey}
              data-action-key={action.actionKey}
              variant={btnVariant}
              size="sm"
              className={cn(
                'w-full justify-start text-left h-auto py-2.5 px-3',
                action.variant === 'primary' && 'bg-primary text-primary-foreground',
              )}
              disabled={action.disabled}
              onClick={handler}
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
  /** Auditor-side execution recommendations (fieldwork, findings, response requests). */
  canExecuteAudit?: boolean;
  /** Corrective-action oversight recommendations. */
  canManageActions?: boolean;
}

/** Audits in a terminal disposition never receive lifecycle recommendations. */
const TERMINAL_EXECUTION_STATUSES = new Set([
  'Closed',
  'Closed – Actions Pending',
  'Closed - Actions Pending',
  'Cancelled',
  'Archived',
]);

export function deriveNextActions(audit: any, counts: {
  findings: number; openFindings: number; responses: number;
  actions: number; overdueActions: number;
}, entitlements: NextActionEntitlements = {}): NextAction[] {
  const {
    canLaunch = true,
    canClose = true,
    canExecuteAudit = true,
    canManageActions = true,
  } = entitlements;

  const execStatus = audit?.execution_status || 'Planned';
  const actions: NextAction[] = [];

  if (TERMINAL_EXECUTION_STATUSES.has(execStatus)) return actions;

  if (canLaunch && (execStatus === 'Planned' || execStatus === 'Ready for Launch')) {
    actions.push({
      actionKey: 'LAUNCH_AUDIT',
      label: 'Launch Audit',
      description: 'Verify readiness and begin audit execution',
      icon: Rocket,
      variant: 'primary',
    });
  }
  if (canExecuteAudit && (execStatus === 'Notification Sent' || execStatus === 'Opening Meeting Scheduled')) {
    actions.push({
      actionKey: 'BEGIN_FIELDWORK',
      label: 'Begin Fieldwork',
      description: 'Start audit evidence gathering and testing',
      icon: FileText,
      variant: 'primary',
    });
  }
  if (canExecuteAudit && execStatus === 'Fieldwork In Progress' && counts.findings === 0) {
    actions.push({
      actionKey: 'DOCUMENT_FINDINGS',
      label: 'Document Findings',
      description: 'Record issues identified during fieldwork',
      icon: AlertTriangle,
      variant: 'warning',
    });
  }
  if (canExecuteAudit && counts.openFindings > 0 && execStatus === 'Findings Drafting') {
    actions.push({
      actionKey: 'REQUEST_MANAGEMENT_RESPONSES',
      label: 'Request Management Responses',
      description: `${counts.openFindings} finding(s) awaiting response`,
      icon: Send,
      variant: 'warning',
    });
  }
  if (canManageActions && counts.overdueActions > 0) {
    actions.push({
      actionKey: 'FOLLOW_UP_OVERDUE_ACTIONS',
      label: 'Follow Up on Overdue Actions',
      description: `${counts.overdueActions} overdue action item(s)`,
      icon: Clock,
      variant: 'destructive',
    });
  }
  if (canClose && execStatus === 'Follow-up Monitoring' && counts.openFindings === 0) {
    actions.push({
      actionKey: 'CLOSE_AUDIT',
      label: 'Close Audit',
      description: 'All findings resolved — ready for closure',
      icon: Lock,
      variant: 'primary',
    });
  }

  return actions;
}
