import { routeClaimAfterStatusChange } from '@/services/bn/workflow/routeClaimAfterStatusChange';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { toast } from 'sonner';
import { applyBusinessObjectFieldUpdates } from '@/hooks/useBusinessObjectRoot';
import { getCorrelationId } from '@/services/correlationIdService';
import { resolveReportingManagerForTask } from '@/services/resolveReportingManager';

export type NextStepType = 'next_step' | 'specific_step' | 'end_workflow' | 'send_back_to_applicant';
export type EndState = 'Approved' | 'Rejected' | null;

export interface WorkflowAction {
  id: string;
  action_name: string;
  action_type: string;
  next_step_id: string | null;
  next_step_type: NextStepType;
  end_state: EndState;
  is_final_action: boolean;
  display_order: number;
  remarks_required: boolean;
  result_status: string | null;
}

export interface WorkflowContext {
  hasWorkflow: boolean;
  instanceId: string | null;
  workflowId: string | null;
  taskId: string | null;
  currentStepId: string | null;
  currentStepName: string | null;
  workflowName: string | null;
  workflowStatus: string | null;
  actions: WorkflowAction[];
  canPerformActions: boolean;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

interface WorkflowTask {
  id: string;
  instance_id: string;
  step_id: string;
  step_name: string;
  assigned_to: string | null;
  assigned_role: string | null;
  assigned_designation: string | null;
  status: string;
}

interface WorkflowInstance {
  id: string;
  workflow_id: string;
  workflow_name: string;
  source_module: string;
  source_record_id: string;
  current_step_id: string | null;
  status: string;
  started_by: string | null;
}

/**
 * Hook to fetch workflow context for a specific record.
 * Determines if a workflow is attached, the current step, available actions,
 * and whether the current user can perform actions.
 * 
 * @param sourceModule - The module identifier (e.g., 'insured_person_registration')
 * @param sourceRecordId - The unique record identifier (e.g., unique_uuid)
 */
export function useWorkflowActions(
  sourceModule: string,
  sourceRecordId: string | null
): WorkflowContext {
  const { user: supabaseUser, roles: supabaseRoles, isAuthReady, isAuthenticated } = useSupabaseAuth();
  const queryClient = useQueryClient();

  const userId = supabaseUser?.id ?? null;
  const contextRoleNames = supabaseRoles?.length ? supabaseRoles : undefined;

  const query = useQuery({
    queryKey: ['workflow-actions', sourceModule, sourceRecordId, userId],
    queryFn: async (): Promise<Omit<WorkflowContext, 'isLoading' | 'error' | 'refetch'>> => {
      const noWorkflow: Omit<WorkflowContext, 'isLoading' | 'error' | 'refetch'> = {
        hasWorkflow: false, instanceId: null, workflowId: null, taskId: null,
        currentStepId: null, currentStepName: null, workflowName: null,
        workflowStatus: null, actions: [], canPerformActions: false,
      };

      if (!sourceRecordId || !userId) return noWorkflow;

      // Step 1: Find workflow instance for this record
      const { data: instances, error: instanceError } = await supabase
        .from('workflow_instances')
        .select('*')
        .eq('source_module', sourceModule)
        .eq('source_record_id', sourceRecordId)
        .not('status', 'in', '("Completed","Rejected","Cancelled")')
        .order('started_at', { ascending: false })
        .limit(1);

      if (instanceError) throw instanceError;
      if (!instances || instances.length === 0) return noWorkflow;

      const instance = instances[0] as WorkflowInstance;

      // Step 2: Fetch tasks AND user roles in parallel
      const [tasksResult, userRolesResult] = await Promise.all([
        supabase
          .from('workflow_tasks')
          .select('*')
          .eq('instance_id', instance.id)
          .in('status', ['Pending', 'InProgress'])
          .order('created_at', { ascending: false })
          .limit(1),
        supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', userId),
      ]);

      if (tasksResult.error) throw tasksResult.error;

      if (!tasksResult.data || tasksResult.data.length === 0) {
        return {
          hasWorkflow: true, instanceId: instance.id, workflowId: instance.workflow_id,
          taskId: null, currentStepId: instance.current_step_id, currentStepName: null,
          workflowName: instance.workflow_name, workflowStatus: instance.status,
          actions: [], canPerformActions: false,
        };
      }

      const task = tasksResult.data[0] as WorkflowTask;
      const dbRoleNames = userRolesResult.data?.map(r => r.role as string).filter(Boolean) || [];
      const combinedRoleNames = Array.from(
        new Set([...(contextRoleNames || []), ...dbRoleNames].filter(Boolean))
      );
      const userRoleName = dbRoleNames.length > 0 ? dbRoleNames[0] : (combinedRoleNames[0] ?? 'user');

      // Step 3: Check permission (optimized - passes pre-fetched roles)
      const canPerformActions = await checkUserPermissionOptimized(
        userId, task.assigned_to, task.assigned_role, task.assigned_designation,
        task.step_id, userRoleName, combinedRoleNames, dbRoleNames
      );

      // Step 4: If permitted, fetch actions and check maker-checker in parallel
      let actions: WorkflowAction[] = [];
      
      if (canPerformActions) {
        const [makerCheckerBlocked, actionsResult] = await Promise.all([
          checkMakerCheckerRestriction(
            instance.workflow_id, instance.started_by, userId,
            sourceModule, sourceRecordId, dbRoleNames
          ),
          supabase
            .from('workflow_step_actions')
            .select('*')
            .eq('step_id', task.step_id)
            .order('display_order', { ascending: true }),
        ]);

        if (makerCheckerBlocked) {
          return {
            hasWorkflow: true, instanceId: instance.id, workflowId: instance.workflow_id,
            taskId: task.id, currentStepId: task.step_id, currentStepName: task.step_name,
            workflowName: instance.workflow_name, workflowStatus: instance.status,
            actions: [], canPerformActions: false,
          };
        }

        if (!actionsResult.error && actionsResult.data) {
          actions = actionsResult.data.map(a => ({
            id: a.id, action_name: a.action_name, action_type: a.action_type,
            next_step_id: a.next_step_id, next_step_type: a.next_step_type as NextStepType,
            end_state: a.end_state as EndState, is_final_action: a.is_final_action,
            display_order: a.display_order, remarks_required: (a as any).remarks_required ?? false,
            result_status: (a as any).result_status || null,
          }));
        }
      }

      return {
        hasWorkflow: true, instanceId: instance.id, workflowId: instance.workflow_id,
        taskId: task.id, currentStepId: task.step_id, currentStepName: task.step_name,
        workflowName: instance.workflow_name, workflowStatus: instance.status,
        actions, canPerformActions,
      };
    },
    enabled: isAuthReady && isAuthenticated && !!sourceRecordId && !!userId,
    staleTime: 60000, // 60 seconds - reduce refetch frequency
    gcTime: 300000, // 5 minutes cache
  });

  return {
    hasWorkflow: query.data?.hasWorkflow ?? false,
    instanceId: query.data?.instanceId ?? null,
    workflowId: query.data?.workflowId ?? null,
    taskId: query.data?.taskId ?? null,
    currentStepId: query.data?.currentStepId ?? null,
    currentStepName: query.data?.currentStepName ?? null,
    workflowName: query.data?.workflowName ?? null,
    workflowStatus: query.data?.workflowStatus ?? null,
    actions: query.data?.actions ?? [],
    canPerformActions: query.data?.canPerformActions ?? false,
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}

/**
 * Optimized permission check - accepts pre-fetched user roles to avoid redundant DB queries.
 */
async function checkUserPermissionOptimized(
  userId: string,
  assignedTo: string | null,
  assignedRole: string | null,
  assignedDesignation: string | null,
  stepId: string,
  userRole?: string,
  userRoleNames?: string[],
  prefetchedDbRoles?: string[]
): Promise<boolean> {
  // If task is assigned to this specific user
  if (assignedTo && assignedTo === userId) return true;

  // Get workflow step config
  const { data: step } = await supabase
    .from('workflow_steps')
    .select('approver_type, approver_role_ids, approver_designation_ids, approver_user_ids, assigned_role, assigned_designation')
    .eq('id', stepId)
    .single();

  if (!step) {
    return checkTaskLevelAssignmentOptimized(userId, assignedRole, assignedDesignation, userRole, userRoleNames, prefetchedDbRoles);
  }

  const approverType = step.approver_type || 'role';

  if (approverType === 'user' || approverType === 'specific_users') {
    if (step.approver_user_ids && step.approver_user_ids.length > 0) {
      return (step.approver_user_ids as string[]).includes(userId);
    }
    return false;
  }

  if (approverType === 'role') {
    if (!step.approver_role_ids || step.approver_role_ids.length === 0) return false;

    const allowedRoleIds = step.approver_role_ids as string[];
    
    // Fetch allowed role names ONCE
    const { data: rolesTableData } = await supabase
      .from('roles')
      .select('id, role_name')
      .in('id', allowedRoleIds);

    if (!rolesTableData || rolesTableData.length === 0) return false;
    
    const allowedRoleNames = rolesTableData.map(r => r.role_name.toLowerCase().trim());

    // Check against pre-fetched DB roles (no extra query needed)
    const dbRoles = prefetchedDbRoles || [];
    if (dbRoles.length > 0) {
      const hasAccess = dbRoles.some(userRoleName => 
        allowedRoleNames.some(allowedName => 
          allowedName === userRoleName.toLowerCase().trim() ||
          allowedName.replace(/_/g, ' ') === userRoleName.toLowerCase().replace(/_/g, ' ').trim()
        )
      );
      if (hasAccess) return true;
    }

    // Check against context role names
    if (userRoleNames && userRoleNames.length > 0) {
      const hasAccess = userRoleNames.some(name => {
        if (!name) return false;
        const normalized = name.toLowerCase().replace(/_/g, ' ').trim();
        return allowedRoleNames.some(a => a === normalized || a.replace(/_/g, ' ') === normalized);
      });
      if (hasAccess) return true;
    }

    // Check context role
    if (userRole) {
      const normalized = userRole.toLowerCase().replace(/_/g, ' ').trim();
      if (allowedRoleNames.some(a => a === normalized || a.replace(/_/g, ' ') === normalized || a.replace(/ /g, '_') === userRole.toLowerCase().trim())) {
        return true;
      }
      if (userRole.toLowerCase() === 'admin') return true;
    }

    return false;
  }

  if (approverType === 'designation') {
    if (!step.approver_designation_ids || step.approver_designation_ids.length === 0) return false;
    const { data: profile } = await supabase
      .from('profiles')
      .select('designation_id')
      .eq('id', userId)
      .single();
    if (profile?.designation_id) {
      return (step.approver_designation_ids as string[]).includes(profile.designation_id);
    }
    return false;
  }

  // For reporting_manager, the task is assigned to the resolved manager at task creation time.
  // The existing assigned_to check at line 228 handles this case.
  if (approverType === 'reporting_manager') {
    return false; // If not matched via assigned_to above, user is not the reporting manager
  }

  return false;
}

/**
 * Optimized task-level assignment check using pre-fetched roles.
 */
async function checkTaskLevelAssignmentOptimized(
  userId: string,
  assignedRole: string | null,
  assignedDesignation: string | null,
  userRole?: string,
  userRoleNames?: string[],
  prefetchedDbRoles?: string[]
): Promise<boolean> {
  if (userRole?.toLowerCase() === 'admin') return true;
  
  const dbRoles = prefetchedDbRoles || [];
  
  if (!assignedRole && !assignedDesignation) {
    if (dbRoles.some(r => r.toLowerCase() === 'admin')) return true;
    return false;
  }

  if (assignedRole) {
    const normalizedAssigned = assignedRole.toLowerCase().replace(/_/g, ' ').trim();
    
    // Check pre-fetched roles first
    if (dbRoles.some(r => r.toLowerCase().replace(/_/g, ' ').trim() === normalizedAssigned || r.toLowerCase().trim() === assignedRole.toLowerCase().trim())) {
      return true;
    }
    if (userRoleNames && userRoleNames.some(r => r && (r.toLowerCase().replace(/_/g, ' ').trim() === normalizedAssigned || r.toLowerCase().trim() === assignedRole.toLowerCase().trim()))) {
      return true;
    }
    if (userRole) {
      const normalizedUser = userRole.toLowerCase().replace(/_/g, ' ').trim();
      if (normalizedUser === normalizedAssigned || userRole.toLowerCase() === assignedRole.toLowerCase()) return true;
    }
  }

  if (assignedDesignation) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('designation_id')
      .eq('id', userId)
      .single();
    if (profile?.designation_id === assignedDesignation) return true;
  }

  return false;
}

// Keep old function signature for backward compatibility
async function checkUserPermission(
  userId: string,
  assignedTo: string | null,
  assignedRole: string | null,
  assignedDesignation: string | null,
  stepId: string,
  userRole?: string,
  userRoleNames?: string[]
): Promise<boolean> {
  return checkUserPermissionOptimized(userId, assignedTo, assignedRole, assignedDesignation, stepId, userRole, userRoleNames);
}

async function checkTaskLevelAssignment(
  userId: string,
  assignedRole: string | null,
  assignedDesignation: string | null,
  userRole?: string,
  userRoleNames?: string[]
): Promise<boolean> {
  return checkTaskLevelAssignmentOptimized(userId, assignedRole, assignedDesignation, userRole, userRoleNames);
}

/**
 * Check if maker-checker restriction blocks the current user.
 * Accepts optional pre-fetched roles to avoid redundant queries.
 */
async function checkMakerCheckerRestriction(
  workflowId: string | null,
  instanceStartedBy: string | null,
  currentUserId: string,
  sourceModule: string,
  sourceRecordId: string,
  prefetchedDbRoles?: string[]
): Promise<boolean> {
  if (!workflowId) return false;

  const { data: workflowDef, error } = await supabase
    .from('workflow_definitions')
    .select('maker_checker_enabled')
    .eq('id', workflowId)
    .single();

  if (error || !workflowDef || !(workflowDef as any).maker_checker_enabled) return false;

  // Admin exception - use pre-fetched roles if available
  const dbRoles = prefetchedDbRoles || (await supabase.from('user_roles').select('role').eq('user_id', currentUserId)).data?.map(r => r.role as string) || [];
  if (dbRoles.some(r => r.toLowerCase() === 'admin')) return false;

  if (instanceStartedBy && instanceStartedBy === currentUserId) return true;

  try {
    const creatorCheckMap: Record<string, { table: string; idCol: string; creatorCols: string[] }> = {
      'insured_person_registration': { table: 'ip_master', idCol: 'unique_uuid', creatorCols: ['entered_by'] },
      'employer_registration': { table: 'er_master', idCol: 'unique_uuid', creatorCols: ['entered_by'] },
    };
    const config = creatorCheckMap[sourceModule];
    if (config) {
      const [recordResult, profileResult] = await Promise.all([
        supabase.from(config.table as any).select(config.creatorCols.join(', ')).eq(config.idCol, sourceRecordId).maybeSingle(),
        supabase.from('profiles').select('user_code').eq('id', currentUserId).maybeSingle(),
      ]);
      if (recordResult.data && profileResult.data?.user_code) {
        for (const col of config.creatorCols) {
          if ((recordResult.data as any)[col] === profileResult.data.user_code) return true;
        }
      }
    }
  } catch (err) {
    // Don't block on error
  }
  return false;
}

export function useExecuteWorkflowAction() {
  const queryClient = useQueryClient();
  // Prefer real authenticated user
  const { user: supabaseUser } = useSupabaseAuth();

  return useMutation({
    mutationKey: ['Workflow', 'workflow_actions', 'mutation'],
    mutationFn: async ({
      taskId,
      actionId,
      comments,
      sourceModule,
      sourceRecordId,
    }: {
      taskId: string;
      actionId: string;
      comments?: string;
      sourceModule: string;
      sourceRecordId: string;
    }) => {
      const userId = supabaseUser?.id;
      if (!userId) {
        throw new Error('Not authenticated');
      }

      // Get user profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, user_code')
        .eq('id', userId)
        .maybeSingle();

      // Get the action configuration
      const { data: action, error: actionError } = await supabase
        .from('workflow_step_actions')
        .select('*')
        .eq('id', actionId)
        .single();

      if (actionError || !action) {
        throw new Error('Action not found');
      }

      // Server-side enforcement: check if remarks are required
      if ((action as any).remarks_required && (!comments || !comments.trim())) {
        throw new Error('Reviewer comments are mandatory for this action');
      }

      // Get the task with workflow instance
      const { data: task, error: taskError } = await supabase
        .from('workflow_tasks')
        .select('*, workflow_instance:workflow_instances(*)')
        .eq('id', taskId)
        .single();

      if (taskError || !task) {
        throw new Error('Task not found');
      }

      const workflowInstance = task.workflow_instance as any;

      // Server-side maker-checker enforcement (defense in depth)
      const makerCheckerBlocked = await checkMakerCheckerRestriction(
        workflowInstance?.workflow_id,
        workflowInstance?.started_by,
        userId,
        sourceModule,
        sourceRecordId
      );

      if (makerCheckerBlocked) {
        // Log the blocked attempt
        await supabase.from('system_audit_trail').insert({
          action: 'maker_checker_blocked',
          entity_type: 'workflow_action',
          entity_id: actionId,
          module: sourceModule,
          user_id: userId,
          user_name: profile?.user_code || 'UNKNOWN',
          timestamp: new Date().toISOString(),
          severity: 'warn',
          payload_json: {
            workflow_id: workflowInstance?.workflow_id,
            workflow_name: workflowInstance?.workflow_name,
            source_record_id: sourceRecordId,
            action_name: action.action_name,
            reason: 'Maker-checker restriction: creator cannot execute workflow actions on own record',
          },
        }).then(() => {}, (err) => console.error('[Audit] Failed to log maker-checker block:', err));

        throw new Error('You cannot perform this action on a record you created or submitted (maker-checker policy).');
      }

      // workflowInstance already declared above

      // Update task as completed
      const { error: updateError } = await supabase
        .from('workflow_tasks')
        .update({
          status: 'Completed',
          action_taken: action.action_name,
          comments,
          completed_at: new Date().toISOString(),
        })
        .eq('id', taskId);

      if (updateError) throw updateError;

      // Log the action with configured result_status for audit
      const configuredStatus = (action as any).result_status || null;
      await supabase
        .from('workflow_logs')
        .insert({
          instance_id: task.instance_id,
          step_id: task.step_id,
          step_name: task.step_name,
          action: action.action_name,
          performed_by: userId,
          performed_by_name: profile?.full_name || 'System',
          details: comments,
          metadata: configuredStatus ? { result_status: configuredStatus } : undefined,
        });

      // Apply configured field updates for this action
      try {
        const fieldUpdatesApplied = await applyBusinessObjectFieldUpdates(
          task.instance_id,
          actionId,
          userId,
          profile?.full_name || 'System'
        );
        
        if (fieldUpdatesApplied && fieldUpdatesApplied.length > 0) {
          console.log('Field updates applied:', fieldUpdatesApplied);
        }
      } catch (fieldUpdateError) {
        console.error('Error applying field updates:', fieldUpdateError);
        // Don't throw - field updates are non-blocking
      }

      // Execute configured API call for this workflow action
      let apiWarning: string | undefined;
      try {
        const apiResult = await executeWorkflowActionApi(
          workflowInstance?.workflow_id,
          task.step_id,
          task.instance_id,
          taskId,
          action.action_type,
          sourceModule,
          sourceRecordId,
          profile?.user_code || profile?.full_name || userId,
          comments
        );
        
        if (apiResult.warning) {
          apiWarning = apiResult.warning;
          console.warn('Workflow API warning:', apiWarning);
        }
      } catch (apiError) {
        console.error('Error executing workflow action API (non-blocking):', apiError);
        apiWarning = 'External API notification failed. The workflow action completed but external sync may be pending.';
      }

      // Get current step info
      const { data: currentStep } = await supabase
        .from('workflow_steps')
        .select('*')
        .eq('id', task.step_id)
        .single();

      // Handle routing based on action configuration
      const nextStepType = action.next_step_type as NextStepType;
      const endState = action.end_state as EndState;
      // Use admin-configured result_status if set, otherwise derive from endState
      const configuredResultStatus = (action as any).result_status || null;

      if (nextStepType === 'end_workflow') {
        // End the workflow
        const finalStatus = endState === 'Rejected' ? 'Rejected' : 'Completed';
        await supabase
          .from('workflow_instances')
          .update({
            status: finalStatus,
            completed_at: new Date().toISOString(),
          })
          .eq('id', task.instance_id);

        // Update source record status based on module
        await updateSourceRecordStatus(
          sourceModule,
          sourceRecordId,
          endState,
          userId,
          comments,
          configuredResultStatus
        );

        // Notify via configurable notification engine (fire-and-forget)
        supabase.functions.invoke('workflow-process-notifications', {
          body: {
            instance_id: task.instance_id,
            step_id: task.step_id,
            action_id: actionId,
            trigger: 'action_taken',
            action_label: endState === 'Rejected' ? 'Rejected' : 'Approved',
            action_by: profile?.user_code || 'System',
            action_by_name: profile?.full_name || profile?.user_code || 'System',
            comments,
          },
        }).then(({ error }) => {
          if (error) console.error('Notification processing failed (non-blocking):', error);
        });
      } else if (nextStepType === 'send_back_to_applicant') {
        // Put workflow in Query state
        const existingMetadata = workflowInstance?.metadata || {};
        await supabase
          .from('workflow_instances')
          .update({
            status: 'Query',
            metadata: {
              ...existingMetadata,
              awaiting_applicant_info: true,
              restart_step_id: action.next_step_id,
            },
          })
          .eq('id', task.instance_id);

        // Update source record to Query status
        await updateSourceRecordStatus(
          sourceModule,
          sourceRecordId,
          'Query' as any,
          userId,
          comments,
          configuredResultStatus
        );
      } else if (nextStepType === 'specific_step' && action.next_step_id) {
        // Go to specific step
        await createNextStepTask(task.instance_id, action.next_step_id);
      } else {
        // Default: next sequential step or complete
        if (currentStep?.is_final_step) {
          await supabase
            .from('workflow_instances')
            .update({
              status: 'Completed',
              completed_at: new Date().toISOString(),
            })
            .eq('id', task.instance_id);

          await updateSourceRecordStatus(
            sourceModule,
            sourceRecordId,
            'Approved',
            userId,
            comments,
            configuredResultStatus
          );

          // Notify via configurable notification engine (fire-and-forget)
          supabase.functions.invoke('workflow-process-notifications', {
            body: {
              instance_id: task.instance_id,
              step_id: task.step_id,
              action_id: actionId,
              trigger: 'action_taken',
              action_label: 'Approved',
              action_by: profile?.user_code || 'System',
              action_by_name: profile?.full_name || profile?.user_code || 'System',
              comments,
            },
          }).then(({ error }) => {
            if (error) console.error('Notification processing failed (non-blocking):', error);
          });
        } else {
          // Find next step
          const { data: nextStep } = await supabase
            .from('workflow_steps')
            .select('*')
            .eq('workflow_id', workflowInstance?.workflow_id)
            .eq('step_number', (currentStep?.step_number || 0) + 1)
            .single();

          if (nextStep) {
            await createNextStepTask(task.instance_id, nextStep.id);
          }
        }
      }

      return {
        success: true,
        action: action.action_name,
        endState,
        apiWarning,
      };
    },
    onSuccess: (result, variables) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['workflow-actions', variables.sourceModule, variables.sourceRecordId] });
      queryClient.invalidateQueries({ queryKey: ['ip-records'] });
      queryClient.invalidateQueries({ queryKey: ['applications-for-review'] });
      queryClient.invalidateQueries({ queryKey: ['my-workflow-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['application-workflow-status'] });
      queryClient.invalidateQueries({ queryKey: ['online-applications'] });
      
      if (result.apiWarning) {
        toast.warning(`Action "${result.action}" executed with warning`, {
          description: result.apiWarning,
        });
      } else {
        toast.success(`Action "${result.action}" executed successfully`);
      }
    },
    onError: (error: Error) => {
      console.error('Workflow action error:', error);
      toast.error(`Failed to execute action: ${error.message}`);
    },
  });
}

/**
 * Execute configured API call for a workflow action.
 * This function is non-blocking - failures won't break the workflow.
 */
async function executeWorkflowActionApi(
  workflowId: string | undefined,
  stepId: string,
  instanceId: string,
  taskId: string,
  actionType: string,
  sourceModule: string,
  sourceRecordId: string,
  userCode: string,
  comments?: string
): Promise<{ success: boolean; warning?: string }> {
  if (!workflowId) {
    return { success: true }; // No workflow ID, skip
  }

  // Normalize action code for API lookup
  const actionCode = normalizeActionCode(actionType);

  // Fetch application data based on source module
  const applicationData = await fetchApplicationData(sourceModule, sourceRecordId);

  // Fetch meeting data if applicable (for Schedule-Meeting actions)
  let meetingData: Record<string, any> = {};
  if (actionCode === 'ScheduleMeeting' || actionCode === 'SCHEDULE_MEETING') {
    meetingData = await fetchMeetingData(instanceId);
  }

  // Build workflow context
  const workflowContext = {
    action_code: actionCode,
    instance_id: instanceId,
    step_id: stepId,
    task_id: taskId,
    source_module: sourceModule,
    source_record_id: sourceRecordId,
    user_remarks: comments || '',
  };

  try {
    const { data, error } = await supabase.functions.invoke('workflow-action-api', {
      body: {
        action: 'execute',
        workflowId,
        workflowStepId: stepId,
        workflowInstanceId: instanceId,
        taskId,
        actionCode,
        applicationData,
        meetingData,
        workflowContext,
      },
    });

    if (error) {
      console.error('Workflow API execution error:', error);
      return { success: false, warning: error.message };
    }

    if (data?.skipped) {
      return { success: true }; // No API configured, that's fine
    }

    if (data?.warning) {
      return { success: data.success, warning: data.warning };
    }

    return { success: data?.success ?? true };
  } catch (error) {
    console.error('Failed to invoke workflow action API:', error);
    return { 
      success: false, 
      warning: error instanceof Error ? error.message : 'Unknown API error' 
    };
  }
}

/**
 * Normalize action type to standard action code.
 */
function normalizeActionCode(actionType: string): string {
  const normalized = actionType.toLowerCase().replace(/[\s_-]/g, '');
  
  if (normalized.includes('approve')) return 'Approve';
  if (normalized.includes('reject')) return 'Reject';
  if (normalized.includes('schedulemeeting') || normalized.includes('meeting')) return 'ScheduleMeeting';
  if (normalized.includes('sendback')) return 'SendBack';
  if (normalized.includes('query')) return 'Query';
  
  // Return as-is for custom action types
  return actionType;
}

/**
 * Fetch application data based on source module.
 */
async function fetchApplicationData(
  sourceModule: string,
  sourceRecordId: string
): Promise<Record<string, any>> {
  try {
    if (sourceModule === 'insured_person_registration') {
      const { data } = await supabase
        .from('ip_master')
        .select('*')
        .eq('unique_uuid', sourceRecordId)
        .single();
      
      if (data) {
        const record = data as Record<string, any>;
        return {
          application_reference_no: record.ip_ref_no || record.application_id || record.unique_uuid,
          application_reference_number: record.ip_ref_no || record.application_id || record.unique_uuid,
          ssn: record.ssn,
          first_name: record.first_name,
          last_name: record.last_name,
          full_name: `${record.first_name || ''} ${record.last_name || ''}`.trim(),
          email: record.email,
          status: record.status,
          ...record,
        };
      }
    }
    
    if (sourceModule === 'employer_registration') {
      // Query employer data - use any to avoid type issues with dynamic table
      const { data } = await supabase
        .from('bema_registrations')
        .select('*')
        .eq('id', sourceRecordId)
        .eq('registration_type', 'employer')
        .single();
      
      if (data) {
        const record = data as Record<string, any>;
        return {
          application_reference_no: record.registration_number || sourceRecordId,
          application_reference_number: record.registration_number || sourceRecordId,
          employer_name: record.employer_name,
          tax_id: record.tax_id,
          email: record.email,
          status: record.status,
          ...record,
        };
      }
    }

    // Handle online application modules by reading workflow instance metadata
    if (sourceModule.startsWith('online-')) {
      const { data: instance } = await supabase
        .from('workflow_instances')
        .select('metadata, source_record_id, source_record_name')
        .eq('source_module', sourceModule)
        .eq('source_record_id', sourceRecordId)
        .maybeSingle();

      if (instance) {
        const meta = (instance.metadata || {}) as Record<string, any>;
        return {
          application_reference_no: instance.source_record_id,
          application_reference_number: instance.source_record_id,
          reference_number: instance.source_record_id,
          full_name: instance.source_record_name || meta.applicant_name,
          email: meta.email,
          phone: meta.phone,
          application_id: meta.application_id,
          status: meta.status,
          ...meta,
        };
      }
    }

    // Generic fallback - try to fetch from the module's primary table
    console.log(`Unknown source module: ${sourceModule}, using generic fetch`);
    return { source_record_id: sourceRecordId };
  } catch (error) {
    console.error('Error fetching application data:', error);
    return { source_record_id: sourceRecordId };
  }
}

/**
 * Fetch meeting data for a workflow instance.
 */
async function fetchMeetingData(instanceId: string): Promise<Record<string, any>> {
  try {
    const { data } = await supabase
      .from('meetings')
      .select('*')
      .eq('workflow_instance_id', instanceId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (data) {
      return {
        meeting_reference_no: data.meeting_reference,
        meeting_reference_number: data.meeting_reference,
        date: data.meeting_date,
        meeting_date: data.meeting_date,
        time: data.meeting_time,
        meeting_time: data.meeting_time,
        office_address: data.office_address,
        remarks: data.remarks,
        contact_person: data.contact_person,
        contact_person_name: data.contact_person_name,
        status: data.status,
        ...data,
      };
    }
  } catch (error) {
    console.error('Error fetching meeting data:', error);
  }
  
  return {};
}

/**
 * Create a task for the next step.
 * Assignment is based on approver_type and corresponding approver fields.
 */
async function createNextStepTask(instanceId: string, stepId: string) {
  const { data: step, error: stepError } = await supabase
    .from('workflow_steps')
    .select('*')
    .eq('id', stepId)
    .single();

  if (stepError || !step) {
    throw new Error('Next step not found');
  }

  const dueAt = new Date();
  dueAt.setHours(dueAt.getHours() + (step.sla_hours || 24));

  // Determine task assignment based on approver_type
  const taskAssignment: {
    assigned_role?: string | null;
    assigned_designation?: string | null;
    assigned_to?: string | null;
  } = {};

  const approverType = step.approver_type || 'role';
  
  if (approverType === 'role' && step.approver_role_ids && step.approver_role_ids.length > 0) {
    // For role-based assignment, get role name from first role ID if single role
    const roleIds = step.approver_role_ids as string[];
    if (roleIds.length === 1) {
      const { data: roleData } = await supabase
        .from('roles')
        .select('role_name')
        .eq('id', roleIds[0])
        .single();
      
      if (roleData) {
        taskAssignment.assigned_role = roleData.role_name;
      }
    }
  } else if (approverType === 'designation' && step.approver_designation_ids && step.approver_designation_ids.length > 0) {
    const designationIds = step.approver_designation_ids as string[];
    if (designationIds.length === 1) {
      taskAssignment.assigned_designation = designationIds[0];
    }
  } else if ((approverType === 'user' || approverType === 'specific_users') && step.approver_user_ids && step.approver_user_ids.length > 0) {
    const userIds = step.approver_user_ids as string[];
    if (userIds.length === 1) {
      taskAssignment.assigned_to = userIds[0];
    }
  } else if (approverType === 'reporting_manager') {
    // Resolve the reporting manager of the workflow initiator
    const { data: inst } = await supabase
      .from('workflow_instances')
      .select('started_by')
      .eq('id', instanceId)
      .single();
    if (inst?.started_by) {
      const resolved = await resolveReportingManagerForTask(inst.started_by, instanceId, stepId, step.step_name);
      if (resolved) {
        taskAssignment.assigned_to = resolved.managerId;
      }
    }
  }

  // Get instance info for notification
  const { data: instance } = await supabase
    .from('workflow_instances')
    .select('workflow_name, source_module, source_record_name')
    .eq('id', instanceId)
    .single();

  const { data: taskData } = await supabase
    .from('workflow_tasks')
    .insert({
      instance_id: instanceId,
      step_id: step.id,
      step_name: step.step_name,
      assigned_role: taskAssignment.assigned_role || null,
      assigned_designation: taskAssignment.assigned_designation || null,
      assigned_to: taskAssignment.assigned_to || null,
      status: 'Pending',
      due_at: dueAt.toISOString(),
    })
    .select('id')
    .single();

  await supabase
    .from('workflow_instances')
    .update({ 
      current_step_id: step.id,
      status: 'InProgress',
    })
    .eq('id', instanceId);

  // Notify via configurable notification engine (step_entry trigger)
  if (taskData?.id && instance) {
    try {
      await supabase.functions.invoke('workflow-process-notifications', {
        body: {
          instance_id: instanceId,
          step_id: step.id,
          trigger: 'step_entry',
        },
      });
      console.log('Next step notification processing completed');
    } catch (notifyError) {
      console.error('Failed to process step notifications (non-critical):', notifyError);
    }
  }
}

/**
 * Update the source record status based on workflow action result.
 */
async function updateSourceRecordStatus(
  sourceModule: string,
  sourceRecordId: string,
  endState: EndState | 'Query',
  userId?: string,
  comments?: string,
  configuredResultStatus?: string | null
) {
  // Resolve user_code for audit fields (per project convention: store UserCode, not UUID)
  let userCode = 'SYSTEM';
  if (userId) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('user_code')
      .eq('id', userId)
      .maybeSingle();
    userCode = (profile as any)?.user_code || 'SYSTEM';
  }
  if (sourceModule === 'insured_person_registration') {
    let newStatus: string;
    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString(),
      updated_by: userCode,
    };

    if (configuredResultStatus) {
      // Admin-configured status override
      newStatus = configuredResultStatus;
      updateData.status = newStatus;
    } else if (endState === 'Approved') {
      newStatus = 'V'; // Verified
      updateData.status = newStatus;
      updateData.verified_by = userCode;
      updateData.date_verified = new Date().toISOString();
    } else if (endState === 'Rejected') {
      newStatus = 'R'; // Rejected
      updateData.status = newStatus;
      updateData.rejected_by = userCode;
      updateData.date_rejected = new Date().toISOString();
      updateData.rejection_reason = comments || 'Rejected via workflow';
    } else if (endState === 'Query') {
      newStatus = 'Q'; // Query status (if exists)
      updateData.status = newStatus;
    } else {
      return; // No status update needed
    }

    const { error } = await supabase
      .from('ip_master')
      .update(updateData)
      .eq('unique_uuid', sourceRecordId);

    if (error) {
      console.error('Error updating IP record status:', error);
      throw error;
    }

    // Log audit entry
    await supabase.from('ip_audit_log').insert({
      table_name: 'ip_master',
      record_id: sourceRecordId,
      unique_uuid: sourceRecordId,
      action: endState === 'Approved' ? 'VERIFY' : endState === 'Rejected' ? 'REJECT' : 'QUERY',
      changed_by: userId,
      new_value: newStatus,
      field_name: 'status',
    });

    // ── DMS Document Transfer: trigger only when status becomes "V" ──
    if (newStatus === 'V') {
      // Fetch the SSN and user_code for the DMS transfer
      const { data: ipRec } = await supabase
        .from('ip_master')
        .select('ssn')
        .eq('unique_uuid', sourceRecordId)
        .single();

      if (ipRec?.ssn) {
        // Get user_code from profiles
        let transferUserCode = 'SYSTEM';
        if (userId) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('user_code')
            .eq('id', userId)
            .single();
          transferUserCode = profile?.user_code || 'SYSTEM';
        }

        // Fire DMS transfer with correlation tracking (non-blocking to approval flow)
        const dmsCorrelationId = getCorrelationId();
        try {
          const { data: dmsResult, error: dmsError } = await supabase.functions.invoke('dms-transfer', {
            body: {
              ssn: ipRec.ssn,
              userCode: transferUserCode,
              userId: userId || '',
              ipMasterUniqueUuid: sourceRecordId,
              correlationId: dmsCorrelationId,
            },
          });

          if (dmsError) {
            console.error('[DMS Transfer] Edge function invocation error:', dmsError);
            toast.error('DMS Transfer Error', {
              description: `Document transfer failed: ${dmsError.message || 'Unknown error'}. Check audit logs for details.`,
            });
          } else if (dmsResult?.failCount > 0) {
            console.warn(`[DMS Transfer] Partial success: ${dmsResult.successCount} transferred, ${dmsResult.failCount} failed`);
            toast.warning('DMS Transfer Partial', {
              description: `${dmsResult.successCount} document(s) transferred, ${dmsResult.failCount} failed. Check audit logs (correlation: ${dmsResult.correlationId}).`,
            });
          } else {
            console.log(`[DMS Transfer] All ${dmsResult?.successCount || 0} documents transferred successfully`);
            if (dmsResult?.successCount > 0) {
              toast.success('DMS Transfer Complete', {
                description: `${dmsResult.successCount} document(s) transferred successfully.`,
              });
            }
          }
        } catch (dmsErr) {
          // DMS transfer failure must NOT block the approval
          console.error('[DMS Transfer] Unexpected error (non-blocking):', dmsErr);
          toast.error('DMS Transfer Error', {
            description: 'Unexpected error during document transfer. Check audit logs for details.',
          });
        }
      }
    }
  } else if (
    sourceModule === 'c3_er_submission' ||
    sourceModule === 'c3_se_submission' ||
    sourceModule === 'c3_vc_submission'
  ) {
    // C3 submission workflow: update posting_status on cn_c3_reported and ip_wages
    const updateData: Record<string, any> = {
      modified_date: new Date().toISOString(),
      modified_by: userCode,
    };

    let newPostingStatus: string | null = null;

    if (configuredResultStatus) {
      newPostingStatus = configuredResultStatus;
    } else if (endState === 'Approved') {
      newPostingStatus = 'VAC';
    } else if (endState === 'Rejected') {
      newPostingStatus = 'REJ';
    } else if (endState === 'Query') {
      newPostingStatus = 'PEN'; // Back to pending on query
    }

    if (newPostingStatus) {
      updateData.posting_status = newPostingStatus;

      // Set verification audit fields when approving (status → VAC)
      if (newPostingStatus === 'VAC') {
        updateData.verified_by = userCode;
        updateData.date_verified = new Date().toISOString();
      }

      // Update cn_c3_reported
      const { error: c3Error } = await supabase
        .from('cn_c3_reported')
        .update(updateData)
        .eq('id', sourceRecordId);

      if (c3Error) {
        console.error('Error updating C3 record posting_status:', c3Error);
        throw c3Error;
      }

      // Also update all related ip_wages rows to the same posting_status
      const wagesUpdateData: Record<string, any> = {
        posting_status: newPostingStatus,
        date_modified: new Date().toISOString(),
        modified_by: userCode,
      };
      
      // Set verification audit fields on wages too when approving
      if (newPostingStatus === 'VAC') {
        wagesUpdateData.verified_by = userCode;
        wagesUpdateData.date_verified = new Date().toISOString();
      }

      const { error: wagesError } = await supabase
        .from('ip_wages')
        .update(wagesUpdateData)
        .eq('c3_id', sourceRecordId);

      if (wagesError) {
        console.error('Error updating ip_wages posting_status:', wagesError);
        // Non-blocking for wages - log but don't throw
      }

      console.log(`C3 record ${sourceRecordId} posting_status updated to ${newPostingStatus}`);
    }
  } else if (sourceModule === 'batch_card_machine_change') {
    // Card machine change request workflow
    let newStatus: string | null = null;

    if (configuredResultStatus) {
      newStatus = configuredResultStatus;
    } else if (endState === 'Approved') {
      newStatus = 'Approved';
    } else if (endState === 'Rejected') {
      newStatus = 'Rejected';
    }

    if (newStatus) {
      const { error } = await supabase
        .from('cn_card_machine_change_requests')
        .update({
          status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sourceRecordId);

      if (error) {
        console.error('Error updating card machine change request status:', error);
        throw error;
      }

      console.log(`Card machine change request ${sourceRecordId} status updated to ${newStatus}`);
    }
  } else if (sourceModule === 'receipt_cancellation') {
    // Receipt cancellation request workflow
    let newStatus: string | null = null;

    if (configuredResultStatus) {
      newStatus = configuredResultStatus;
    } else if (endState === 'Approved') {
      newStatus = 'Approved';
    } else if (endState === 'Rejected') {
      newStatus = 'Rejected';
    }

    if (newStatus) {
      const { error } = await supabase
        .from('cn_receipt_cancel_requests')
        .update({
          status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sourceRecordId);

      if (error) {
        console.error('Error updating receipt cancel request status:', error);
        throw error;
      }

      console.log(`Receipt cancel request ${sourceRecordId} status updated to ${newStatus}`);
    }
  } else if (sourceModule === 'bn_claim') {
    // Benefit claim workflow
    let newStatus: string | null = null;

    if (configuredResultStatus) {
      newStatus = configuredResultStatus;
    } else if (endState === 'Approved') {
      newStatus = 'APPROVED';
    } else if (endState === 'Rejected') {
      newStatus = 'DENIED';
    } else if (endState === 'Query') {
      newStatus = 'PENDING_INFO';
    }

    if (newStatus) {
      const { error } = await (supabase as any)
        .from('bn_claim')
        .update({
          status: newStatus,
          modified_by: userCode,
          modified_at: new Date().toISOString(),
          ...(endState === 'Approved' ? { decision_date: new Date().toISOString() } : {}),
        })
        .eq('id', sourceRecordId);

      if (error) {
        console.error('Error updating bn_claim status:', error);
        throw error;
      }

      // Keep the work queue in step with the engine's status write-back.
      await routeClaimAfterStatusChange(sourceRecordId, userCode);

      console.log(`BN claim ${sourceRecordId} status updated to ${newStatus}`);
    }
  }

  // ── Employer Registration ──
  else if (sourceModule === 'employers') {
    let newStatus: string | null = null;

    if (configuredResultStatus) {
      newStatus = configuredResultStatus;
    } else if (endState === 'Approved') {
      newStatus = 'V';
    } else if (endState === 'Rejected') {
      newStatus = 'R';
    } else if (endState === 'Query') {
      newStatus = 'Q';
    }

    if (newStatus) {
      const auditFields: Record<string, any> = {
        status: newStatus,
        date_modified: new Date().toISOString().split('T')[0],
        modified_by: userCode,
      };

      if (newStatus === 'V') {
        auditFields.date_verified = new Date().toISOString().split('T')[0];
        auditFields.verified_by = userCode;
      }

      const { error } = await supabase
        .from('er_master')
        .update(auditFields)
        .eq('regno', sourceRecordId);

      if (error) {
        console.error('Error updating er_master status:', error);
        throw error;
      }

      console.log(`Employer ${sourceRecordId} status updated to ${newStatus}`);

      // Audit trail
      try {
        await supabase.from('system_audit_trail').insert({
          action: 'workflow_status_change',
          entity_type: 'er_master',
          entity_id: sourceRecordId,
          performed_by: userId,
          details: { old_status: 'P', new_status: newStatus, workflow_action: endState },
        });
      } catch (auditErr) {
        console.error('Audit trail insert failed (non-critical):', auditErr);
      }
    }
  }
  // Add other module handlers as needed
}
