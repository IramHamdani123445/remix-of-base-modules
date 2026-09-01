import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface PendingApproval {
  id: string;
  instance_id: string;
  workflow_name: string;
  step_name: string;
  source_record_id: string;
  source_record_name: string;
  source_module: string;
  status: string;
  created_at: string;
  due_at: string | null;
  is_overdue: boolean;
  priority: 'High' | 'Medium' | 'Low';
  assigned_role: string | null;
  assigned_designation: string | null;
  assigned_to: string | null;
  submitter_name: string | null;
  /** Why the server considers this user entitled to the task. */
  eligibility_basis?: string;
}


/**
 * Helper function to calculate priority based on due date
 */
function calculatePriority(dueAt: string | null, createdAt: string): 'High' | 'Medium' | 'Low' {
  if (!dueAt) return 'Medium';
  
  const now = new Date();
  const due = new Date(dueAt);
  const hoursUntilDue = (due.getTime() - now.getTime()) / (1000 * 60 * 60);
  
  if (hoursUntilDue < 0) return 'High'; // Overdue
  if (hoursUntilDue < 4) return 'High'; // Due within 4 hours
  if (hoursUntilDue < 24) return 'Medium'; // Due within 24 hours
  return 'Low';
}

/**
 * Helper function to format waiting time
 */
export function formatWaitingTime(createdAt: string): string {
  const now = new Date();
  const created = new Date(createdAt);
  const diffMs = now.getTime() - created.getTime();
  
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  
  return `${hours}h ${minutes}m`;
}

/**
 * Pending workflow approvals for the signed-in user.
 *
 * SECURITY: scoping is decided entirely by the governed server-side projection
 * `workflow_my_pending_tasks()`, which derives the user from the session and
 * applies assignment, role, designation, step-approver configuration and
 * approved delegation itself. The browser never retrieves a wider task
 * population and narrows it locally, so removing any UI filter cannot expose
 * another user's work, and no caller-supplied identity is accepted.
 */
export function useMyPendingApprovals() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['my-pending-approvals', user?.id],
    queryFn: async (): Promise<PendingApproval[]> => {
      const { data, error } = await supabase.rpc('workflow_my_pending_tasks');

      if (error) {
        console.error('Error fetching my workflow tasks:', error);
        throw error;
      }

      return (data ?? []).map((row: any) => ({
        id: row.id,
        instance_id: row.instance_id,
        workflow_name: row.workflow_name,
        step_name: row.step_name,
        source_record_id: row.source_record_id,
        source_record_name: row.source_record_name,
        source_module: row.source_module,
        status: row.status,
        created_at: row.created_at,
        due_at: row.due_at,
        is_overdue: !!row.is_overdue,
        priority: calculatePriority(row.due_at, row.created_at),
        assigned_role: row.assigned_role,
        assigned_designation: row.assigned_designation,
        assigned_to: row.assigned_to,
        submitter_name: row.submitter_name,
        eligibility_basis: row.eligibility_basis,
      }));
    },
    enabled: !!user?.id,
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // Refetch every minute
  });
}


/**
 * Hook to get count of pending approvals for badge display
 */
export function usePendingApprovalCount() {
  const { data: approvals = [], isLoading } = useMyPendingApprovals();
  
  return {
    count: approvals.length,
    overdueCount: approvals.filter(a => a.is_overdue).length,
    highPriorityCount: approvals.filter(a => a.priority === 'High').length,
    isLoading,
  };
}

/**
 * Hook to mark approval-related notifications as read
 */
export function useMarkApprovalNotificationRead() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationKey: ['Workflow', 'workflow_approvals', 'update'],
    mutationFn: async (taskId: string) => {
      if (!user?.id) return;

      // Find and mark notifications related to this task as read
      const { error } = await supabase
        .from('in_app_notifications')
        .update({ 
          is_read: true, 
          read_at: new Date().toISOString() 
        })
        .eq('user_id', user.id)
        .like('link', `%${taskId}%`);

      if (error) {
        console.error('Error marking notification as read:', error);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['in-app-notifications', user?.id] });
    },
  });
}
