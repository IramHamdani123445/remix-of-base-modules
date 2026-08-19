import { useState, useEffect, useCallback, useRef } from "react";
import { Bell, CheckCheck, ExternalLink, Clock, AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { formatDistanceToNow } from "date-fns";
import { useNavigate } from "react-router-dom";

import { usePendingApprovalCount } from "@/hooks/useWorkflowPendingApprovals";

interface InAppNotification {
  id: string;
  title: string;
  body: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
  action_label?: string | null;
  source?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Severity badge styling for Omni-Comms in-app notifications. */
const SEVERITY_STYLES: Record<string, string> = {
  info: "bg-muted text-muted-foreground",
  success: "bg-primary/10 text-primary",
  warning: "bg-accent/30 text-accent-foreground",
  critical: "bg-destructive/10 text-destructive",
};

function severityOf(notification: InAppNotification): string | null {
  const value = (notification.metadata as { severity?: unknown } | null)?.severity;
  return typeof value === "string" && value in SEVERITY_STYLES ? value : null;
}

export function InAppNotificationBell() {
  const [open, setOpen] = useState(false);
  const [popupNotification, setPopupNotification] = useState<InAppNotification | null>(null);
  const popupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { user } = useSupabaseAuth();
  
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  // Get pending approval count
  const { count: pendingApprovalCount, overdueCount } = usePendingApprovalCount();

  const { data: notifications = [] } = useQuery({
    queryKey: ['in-app-notifications', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('in_app_notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as InAppNotification[];
    },
    enabled: !!user?.id,
  });

  // Show popup for a new notification
  const showPopup = useCallback((notification: InAppNotification) => {
    // Clear existing timer
    if (popupTimerRef.current) clearTimeout(popupTimerRef.current);
    setPopupNotification(notification);
    popupTimerRef.current = setTimeout(() => {
      setPopupNotification(null);
    }, 5000);
  }, []);

  const dismissPopup = useCallback(() => {
    if (popupTimerRef.current) clearTimeout(popupTimerRef.current);
    setPopupNotification(null);
  }, []);

  // Realtime subscription
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`in-app-notifications:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'in_app_notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const newNotification = payload.new as InAppNotification;
          // Prepend to query cache
          queryClient.setQueryData<InAppNotification[]>(
            ['in-app-notifications', user.id],
            (old = []) => [newNotification, ...old].slice(0, 20)
          );
          // Show popup
          showPopup(newNotification);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'in_app_notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const updated = payload.new as InAppNotification;
          queryClient.setQueryData<InAppNotification[]>(
            ['in-app-notifications', user.id],
            (old = []) => old.map(n => n.id === updated.id ? { ...n, ...updated } : n)
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, queryClient, showPopup]);

  // Cleanup popup timer on unmount
  useEffect(() => {
    return () => {
      if (popupTimerRef.current) clearTimeout(popupTimerRef.current);
    };
  }, []);

  const unreadCount = notifications.filter(n => !n.is_read).length;
  
  // Combined count: unread notifications + pending approvals
  const totalBadgeCount = unreadCount + pendingApprovalCount;

  // Omni-Comms notifications are mutated ONLY through the governed engagement
  // RPCs so the read / action becomes delivery evidence on the originating
  // message. There is deliberately no direct-write fallback for them: if the
  // governed call fails we surface the error and leave the state unchanged.
  const markAsRead = useMutation({
    mutationFn: async (
      input: string | { id: string; engagement: 'read' | 'action' },
    ) => {
      const notificationId = typeof input === 'string' ? input : input.id;
      const engagement = typeof input === 'string' ? 'read' : input.engagement;
      const target = notifications.find((n) => n.id === notificationId);

      if (isOmniCommsNotification(target)) {
        await recordEngagement(rpcClient, notificationId, engagement);
        return;
      }

      const { error } = await supabase
        .from('in_app_notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', notificationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['in-app-notifications', user?.id] });
    },
    onError: (error: unknown) => {
      toast({
        variant: 'destructive',
        title: 'Notification not updated',
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    },
  });

  const markAllAsRead = useMutation({
    mutationFn: async () => {
      if (!user?.id) return;
      const unread = notifications.filter((n) => !n.is_read);
      const { omni, legacy } = splitBySource(unread);

      if (omni.length > 0) {
        // Server resolves the owner's unread Omni set from auth.uid().
        await markAllOmniUnread(rpcClient);
      }
      if (legacy.length > 0) {
        const { error } = await supabase
          .from('in_app_notifications')
          .update({ is_read: true, read_at: new Date().toISOString() })
          .in('id', legacy.map((n) => n.id));
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['in-app-notifications', user?.id] });
    },
    onError: (error: unknown) => {
      toast({
        variant: 'destructive',
        title: 'Notifications not updated',
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    },
  });

  /** Only safe internal portal routes may be opened from a notification. */
  const openTarget = (notification: InAppNotification): string | null =>
    isSafeInternalActionUrl(notification.link) ? (notification.link as string) : null;

  const handleNotificationClick = (notification: InAppNotification) => {
    const target = openTarget(notification);
    markAsRead.mutate({
      id: notification.id,
      engagement: target ? 'action' : 'read',
    });
    if (target) {
      setOpen(false);
      navigate(target);
    }
  };

  const handlePopupClick = () => {
    if (popupNotification) {
      markAsRead.mutate({
        id: popupNotification.id,
        engagement: popupNotification.link ? 'action' : 'read',
      });
      if (popupNotification.link) {
        navigate(popupNotification.link);
      }
      dismissPopup();
    }
  };

  return (
    <div className="relative">
      {/* Popup notification card */}
      {popupNotification && (
        <div
          className="absolute right-0 top-full mt-2 z-50 w-80 animate-in fade-in slide-in-from-top-2 duration-300"
        >
          <div className="rounded-lg border border-border bg-card shadow-lg p-3">
            <div className="flex items-start gap-2">
              <Bell className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
              <div
                className="flex-1 min-w-0 cursor-pointer"
                onClick={handlePopupClick}
              >
                <p className="text-sm font-medium text-foreground truncate">
                  {popupNotification.title}
                </p>
                <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                  {popupNotification.body}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 flex-shrink-0 text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  dismissPopup();
                }}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="relative text-muted-foreground hover:text-foreground"
          >
            <Bell className="h-5 w-5" />
            {totalBadgeCount > 0 && (
              <Badge
                className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
                style={{ backgroundColor: overdueCount > 0 ? 'hsl(var(--destructive))' : 'hsl(var(--accent))' }}
              >
                {totalBadgeCount > 9 ? '9+' : totalBadgeCount}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="end">
          <div className="flex items-center justify-between p-4 border-b">
            <h4 className="font-semibold">Notifications</h4>
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => markAllAsRead.mutate()}
                disabled={markAllAsRead.isPending}
              >
                <CheckCheck className="h-4 w-4 mr-1" />
                Mark all read
              </Button>
            )}
          </div>
          
          {/* Pending Approvals Section */}
          {pendingApprovalCount > 0 && (
            <>
              <div
                className="p-4 bg-accent/20 cursor-pointer hover:bg-accent/30 transition-colors"
                onClick={() => {
                  setOpen(false);
                  navigate('/workflow/approvals');
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-accent/30 flex items-center justify-center">
                    {overdueCount > 0 ? (
                      <AlertCircle className="h-5 w-5 text-destructive" />
                    ) : (
                      <Clock className="h-5 w-5 text-accent-foreground" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-sm">
                      {pendingApprovalCount} Pending Approval{pendingApprovalCount !== 1 ? 's' : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {overdueCount > 0 
                        ? `${overdueCount} overdue - requires immediate attention`
                        : 'Workflow tasks awaiting your action'
                      }
                    </p>
                  </div>
                  <ExternalLink className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
              <Separator />
            </>
          )}
          
          <ScrollArea className="h-64">
            {notifications.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground">
                No notifications
              </div>
            ) : (
              <div className="divide-y">
                {notifications.map((notification) => (
                  <div
                    key={notification.id}
                    className={`p-4 cursor-pointer hover:bg-muted/50 transition-colors ${
                      !notification.is_read ? 'bg-primary/5' : ''
                    }`}
                    onClick={() => handleNotificationClick(notification)}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`font-medium text-sm truncate ${!notification.is_read ? 'text-foreground' : 'text-muted-foreground'}`}>
                            {notification.title}
                          </p>
                          {!notification.is_read && (
                            <div className="h-2 w-2 rounded-full bg-primary flex-shrink-0" />
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                          {notification.body}
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                          </span>
                          {severityOf(notification) && (
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${
                                SEVERITY_STYLES[severityOf(notification) as string]
                              }`}
                            >
                              {severityOf(notification)}
                            </span>
                          )}
                          {notification.link && (
                            <span className="inline-flex items-center gap-1 text-xs text-primary">
                              {notification.action_label || 'Open'}
                              <ExternalLink className="h-3 w-3" />
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
          <Separator />
          <div className="p-2">
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => {
                setOpen(false);
                navigate('/notifications/center');
              }}
            >
              View all notifications
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
