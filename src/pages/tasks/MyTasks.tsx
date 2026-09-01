/**
 * My Tasks — the single personal surface for work the signed-in user must DO.
 *
 * Deliberate separation of concerns:
 *   * My Communications  — messages the user must READ (Omni-Comms inbox).
 *   * My Tasks           — work the user must ACT on (this page).
 *   * Omni-Comms Ops     — administrator surface for delivery operations.
 *
 * This page is a READ-ONLY PROJECTION. It never approves, rejects, assigns or
 * mutates anything: every action is performed on the owning module's screen,
 * which keeps that module's governance, maker/checker rules and audit trail
 * authoritative. Nothing here bypasses a module's own authorisation.
 *
 * Work queues remain owned by their modules. This page lists the approvals the
 * platform workflow engine already scopes to the user, and links out to each
 * module queue rather than re-implementing (and potentially widening) the
 * module's own visibility rules.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Clock,
  ExternalLink,
  ListTodo,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  useMyPendingApprovals,
  formatWaitingTime,
  type PendingApproval,
} from '@/hooks/useWorkflowPendingApprovals';

export const MY_TASKS_ROUTE = '/my-tasks';

/**
 * Module work queues. Each entry points at the module's OWN queue screen,
 * which enforces that module's access rules. A user who is not entitled to a
 * queue simply cannot open it.
 */
const MODULE_QUEUES: ReadonlyArray<{
  key: string;
  title: string;
  description: string;
  route: string;
}> = [
  {
    key: 'workflow',
    title: 'Workflow approvals',
    description: 'Every approval step assigned to you across the platform workflow engine.',
    route: '/workflow/my-tasks',
  },
  {
    key: 'benefits',
    title: 'Benefits workbaskets',
    description: 'Claims routed to the workbaskets your role serves.',
    route: '/bn/approval/workbaskets',
  },
  {
    key: 'benefits-claims',
    title: 'Benefits claim queue',
    description: 'Claims waiting at intake, eligibility, calculation and award stages.',
    route: '/bn/claims',
  },
  {
    key: 'compliance',
    title: 'Compliance work queue',
    description: 'Violations, cases, notices, arrangements, waivers and findings assigned to you.',
    route: '/compliance/my-work-queue',
  },
  {
    key: 'legal',
    title: 'Legal workbench',
    description: 'Judicial matters and tasks in your personal and team workbaskets.',
    route: '/legal/workbench?tab=my-work',
  },
  {
    key: 'audit',
    title: 'Internal Audit action centre',
    description: 'Audit actions, recommendations and follow-ups you own.',
    route: '/audit/action-centre',
  },
];

const priorityTone = (priority: PendingApproval['priority']) =>
  priority === 'High' ? 'destructive' : priority === 'Medium' ? 'secondary' : 'outline';

const ApprovalRow: React.FC<{ approval: PendingApproval; onOpen: () => void }> = ({
  approval,
  onOpen,
}) => (
  <div
    className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border p-3"
    data-testid="my-tasks-approval-row"
  >
    <div className="min-w-0 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium truncate">{approval.workflow_name}</p>
        <Badge variant={priorityTone(approval.priority)} className="text-[10px]">
          {approval.priority}
        </Badge>
        {approval.is_overdue && (
          <Badge variant="destructive" className="text-[10px]">
            Overdue
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {approval.step_name}
        {approval.source_record_name ? ` — ${approval.source_record_name}` : ''}
      </p>
      <p className="text-[11px] text-muted-foreground flex items-center gap-1">
        <Clock className="h-3 w-3" />
        Waiting {formatWaitingTime(approval.created_at)}
        {approval.source_module ? ` · ${approval.source_module}` : ''}
      </p>
    </div>
    <Button size="sm" variant="outline" onClick={onOpen}>
      Open
      <ArrowRight className="ml-2 h-3.5 w-3.5" />
    </Button>
  </div>
);

export const MyTasks: React.FC = () => {
  const navigate = useNavigate();
  const { data: approvals, isLoading, error } = useMyPendingApprovals();

  const items = approvals ?? [];
  const overdue = items.filter((a) => a.is_overdue).length;

  return (
    <div className="space-y-6 p-4 sm:p-6" data-testid="my-tasks-page">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ListTodo className="h-6 w-6 text-primary" />
          My Tasks
        </h1>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Work waiting for your decision. Messages you only need to read are in
          My Communications; this page is for action. Each item opens on the
          screen that owns it, where the normal approval rules apply.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Awaiting your decision</p>
            <p className="text-2xl font-semibold tabular-nums" data-testid="my-tasks-total">
              {isLoading ? '—' : items.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Overdue</p>
            <p className="text-2xl font-semibold tabular-nums" data-testid="my-tasks-overdue">
              {isLoading ? '—' : overdue}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Module queues</p>
            <p className="text-2xl font-semibold tabular-nums">{MODULE_QUEUES.length}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="h-4 w-4" />
            Approvals assigned to you
          </CardTitle>
          <CardDescription>
            From the platform workflow engine. Opening an item takes you to the
            approval screen — decisions are never taken from this page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </>
          ) : error ? (
            <p className="text-sm text-destructive" data-testid="my-tasks-error">
              Your tasks could not be loaded. Please refresh and try again.
            </p>
          ) : items.length === 0 ? (
            <div
              className="flex items-center gap-2 text-sm text-muted-foreground"
              data-testid="my-tasks-empty"
            >
              <CheckCircle2 className="h-4 w-4 text-primary" />
              Nothing is waiting for your decision right now.
            </div>
          ) : (
            items.map((a) => (
              <ApprovalRow
                key={a.id}
                approval={a}
                onOpen={() => navigate('/workflow/my-tasks')}
              />
            ))
          )}
        </CardContent>
      </Card>

      <Separator />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Module work queues</CardTitle>
          <CardDescription>
            Each module keeps its own queue and its own access rules. These links
            take you straight there.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {MODULE_QUEUES.map((q) => (
            <button
              key={q.key}
              type="button"
              onClick={() => navigate(q.route)}
              className="text-left rounded-md border border-border p-3 hover:bg-muted transition-colors"
              data-testid={`my-tasks-queue-${q.key}`}
            >
              <p className="text-sm font-medium flex items-center gap-2">
                {q.title}
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
              </p>
              <p className="text-xs text-muted-foreground mt-1">{q.description}</p>
            </button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
};

export default MyTasks;
