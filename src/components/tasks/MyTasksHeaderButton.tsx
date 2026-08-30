/**
 * My Tasks — application-header entry point for NORMAL users.
 *
 * Badge = work awaiting the signed-in user's DECISION. It deliberately never
 * counts communications (My Communications owns that), legacy notifications,
 * or Omni-Comms operational attention (an administrator concern).
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ListTodo } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { usePendingApprovalCount } from '@/hooks/useWorkflowPendingApprovals';

export const MY_TASKS_ROUTE = '/my-tasks';

export const MyTasksHeaderButton: React.FC = () => {
  const navigate = useNavigate();
  const { isAuthenticated, isAuthReady } = useSupabaseAuth();
  const { count, overdueCount } = usePendingApprovalCount();

  if (!isAuthReady || !isAuthenticated) return null;

  const label =
    count > 0
      ? `My Tasks — ${count} awaiting your decision${
          overdueCount > 0 ? `, ${overdueCount} overdue` : ''
        }`
      : 'My Tasks';

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      data-testid="my-tasks-header-button"
      onClick={() => navigate(MY_TASKS_ROUTE)}
      className="relative text-muted-foreground hover:text-foreground"
    >
      <ListTodo className="h-5 w-5" />
      {count > 0 && (
        <Badge
          data-testid="my-tasks-pending-badge"
          className={`absolute -top-1 -right-1 h-5 min-w-[20px] flex items-center justify-center p-0 px-1 text-[10px] ${
            overdueCount > 0
              ? 'bg-destructive text-destructive-foreground'
              : 'bg-primary text-primary-foreground'
          }`}
        >
          {count > 9 ? '9+' : count}
        </Badge>
      )}
    </Button>
  );
};

export default MyTasksHeaderButton;
