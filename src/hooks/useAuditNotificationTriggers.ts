/**
 * Hooks for IA Auto-Notification Triggers and Notification Log.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

// ============= Types =============

export interface NotificationTrigger {
  id: string;
  event_code: string;
  event_label: string;
  description: string | null;
  is_enabled: boolean;
  auto_fire: boolean;
  target_roles: string[];
  notify_auditee: boolean;
  notify_team_lead: boolean;
  notify_all_team: boolean;
  default_template_category: string | null;
  default_priority: string;
  created_at: string;
  updated_at: string;
}

export interface AutoNotificationLogEntry {
  id: string;
  event_code: string;
  engagement_id: string | null;
  plan_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  recipient_user_id: string | null;
  recipient_email: string | null;
  recipient_name: string | null;
  template_name: string | null;
  subject: string | null;
  body: string | null;
  channel: string;
  delivery_status: string;
  sent_at: string | null;
  failure_reason: string | null;
  created_at: string;
}

// ============= Notification Triggers =============

export function useNotificationTriggers() {
  return useQuery({
    queryKey: ['ia_notification_triggers'],
    queryFn: async (): Promise<NotificationTrigger[]> => {
      const { data, error } = await supabase
        .from('ia_notification_triggers' as any)
        .select('*')
        .order('event_code');
      if (error) throw error;
      return (data as unknown as NotificationTrigger[]) || [];
    },
  });
}

export function useUpdateNotificationTrigger() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationKey: ['InternalAudit', 'ia_notification_triggers', 'update'],
    mutationFn: async (params: { id: string; updates: Partial<NotificationTrigger> }) => {
      const { error } = await supabase
        .from('ia_notification_triggers' as any)
        .update({ ...params.updates, updated_at: new Date().toISOString() })
        .eq('id', params.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ia_notification_triggers'] });
      toast({ title: 'Trigger Updated', description: 'Notification trigger configuration saved.' });
    },
    onError: (e: any) => {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    },
  });
}

// ============= Notification Log =============

export function useAutoNotificationLog(engagementId?: string, planId?: string, eventCode?: string) {
  return useQuery({
    queryKey: ['ia_auto_notification_log', engagementId, planId, eventCode],
    queryFn: async (): Promise<AutoNotificationLogEntry[]> => {
      const { data, error } = await supabase.rpc('ia_get_notification_log' as any, {
        p_engagement_id: engagementId || null,
        p_plan_id: planId || null,
        p_event_code: eventCode || null,
        p_limit: 100,
      });
      if (error) throw error;
      return (data as unknown as AutoNotificationLogEntry[]) || [];
    },
    enabled: !!(engagementId || planId || eventCode),
  });
}

// ============= Fire Notification Programmatically =============

export function useFireNotification() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationKey: ['InternalAudit', 'ia_notification_triggers', 'mutation'],
    mutationFn: async (params: {
      eventCode: string;
      engagementId?: string;
      planId?: string;
      entityType?: string;
      entityId?: string;
      recipientUserId?: string;
      recipientEmail?: string;
      subject?: string;
      body?: string;
      metadata?: Record<string, any>;
    }) => {
      // Wave 4 closure (DEF-2A): fired notifications are raised as governed
      // Omni-Comms obligations, never through the legacy direct-send RPC.
      const result = await emitInternalAuditCommunication({
        eventCode: params.eventCode,
        entityId: params.entityId || params.engagementId || params.planId || '',
        recipientName: params.metadata?.recipient_name || 'Recipient',
        recipientEmail: params.recipientEmail || null,
        recipientUserId: params.recipientUserId || null,
        reference:
          params.metadata?.reference ||
          params.entityId ||
          params.engagementId ||
          params.planId ||
          '',
        values: { ...(params.metadata ?? {}) },
      });
      if (result.outcome === 'blocked') {
        throw new Error(result.blockers.join(', ') || 'Failed to raise notification');
      }
      return result;

    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ia_auto_notification_log'] });
      toast({ title: 'Notification Sent', description: 'Notification has been queued.' });
    },
    onError: (e: any) => {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    },
  });
}
