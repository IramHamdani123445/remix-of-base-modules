import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  Search, 
  Bell, 
  CheckCircle, 
  Circle, 
  ExternalLink,
  Check,
  AlertCircle
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from 'date-fns';
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { useNavigate } from 'react-router-dom';
import { useInAppNotificationRpcClient } from "@/platform/omni-comms/admin/hooks/useInAppNotificationRpcClient";
import {
  isOmniCommsNotification,
  isSafeInternalActionUrl,
  markAllOmniUnread,
  recordEngagement,
  recordEngagementBulk,
  splitBySource,
} from "@/platform/omni-comms/application/inAppNotificationService";

interface NotificationItem {
  id: string;
  user_id: string;
  title: string;
  body: string;
  link: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  source?: string | null;
  action_label?: string | null;
  metadata?: Record<string, unknown> | null;
}

export default function NotificationCenter() {
  const { user } = useSupabaseAuth();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedNotifications, setSelectedNotifications] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const navigate = useNavigate();
  const rpcClient = useInAppNotificationRpcClient();

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ['in-app-notifications', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('in_app_notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as NotificationItem[];
    },
    enabled: !!user?.id,
  });

  // Realtime subscription for live updates
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`notification-center:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'in_app_notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const newNotification = payload.new as NotificationItem;
          queryClient.setQueryData<NotificationItem[]>(
            ['in-app-notifications', user.id],
            (old = []) => [newNotification, ...old]
          );
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
          const updated = payload.new as NotificationItem;
          queryClient.setQueryData<NotificationItem[]>(
            ['in-app-notifications', user.id],
            (old = []) => old.map(n => n.id === updated.id ? { ...n, ...updated } : n)
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, queryClient]);

  /**
   * Omni-Comms notifications are mutated only through the governed engagement
   * RPCs (auth.uid() scoped, idempotent, evidence-producing). Legacy rows keep
   * a clearly separated compatibility path; the two are never merged into one
   * database update.
   */
  const markAsRead = useMutation({
    mutationFn: async (input: string | { id: string; engagement: 'read' | 'action' }) => {
      const id = typeof input === 'string' ? input : input.id;
      const engagement = typeof input === 'string' ? 'read' : input.engagement;
      const target = notifications.find((n) => n.id === id);

      if (isOmniCommsNotification(target)) {
        await recordEngagement(rpcClient, id, engagement);
        return;
      }
      const { error } = await supabase
        .from('in_app_notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['in-app-notifications', user?.id] });
      toast({ title: "Success", description: "Notification marked as read" });
    },
    onError: (error: unknown) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update notification",
        variant: "destructive",
      });
    },
  });

  const markBulkAsRead = useMutation({
    mutationFn: async (ids: string[]) => {
      const selected = notifications.filter((n) => ids.includes(n.id));
      const { omni, legacy } = splitBySource(selected);

      if (omni.length > 0) {
        await recordEngagementBulk(rpcClient, omni.map((n) => n.id));
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
      setSelectedNotifications(new Set());
      toast({ title: "Success", description: "Selected notifications marked as read" });
    },
    onError: (error: unknown) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update notifications",
        variant: "destructive",
      });
    },
  });

  const markAllAsRead = useMutation({
    mutationFn: async () => {
      const unread = notifications.filter((n) => !n.is_read);
      const { omni, legacy } = splitBySource(unread);

      if (omni.length > 0) await markAllOmniUnread(rpcClient);
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
      toast({ title: "Success", description: "All notifications marked as read" });
    },
    onError: (error: unknown) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update notifications",
        variant: "destructive",
      });
    },
  });

  /** Only safe internal portal routes may be opened from a notification. */
  const openTarget = (notification: NotificationItem): string | null =>
    isSafeInternalActionUrl(notification.link) ? (notification.link as string) : null;

  const filteredNotifications = notifications.filter(n => {
    const matchesSearch = searchTerm === '' ||
      n.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      n.body.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === 'all' ||
      (filterStatus === 'read' ? n.is_read : !n.is_read);
    return matchesSearch && matchesStatus;
  });

  const toggleSelectNotification = (id: string) => {
    const newSelected = new Set(selectedNotifications);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedNotifications(newSelected);
  };

  const selectAll = () => {
    const unreadIds = filteredNotifications.filter(n => !n.is_read).map(n => n.id);
    setSelectedNotifications(new Set(unreadIds));
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-64">Loading notifications...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Bell className="h-8 w-8" />
            Notification Center
            {unreadCount > 0 && (
              <Badge variant="destructive" className="ml-2">
                {unreadCount} unread
              </Badge>
            )}
          </h1>
          <p className="text-muted-foreground">Manage your in-app notifications</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Notifications</CardTitle>
              <CardDescription>Your recent notifications and updates</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {selectedNotifications.size > 0 && (
                <Button 
                  onClick={() => markBulkAsRead.mutate(Array.from(selectedNotifications))} 
                  size="sm"
                  disabled={markBulkAsRead.isPending}
                >
                  <Check className="h-4 w-4 mr-2" />
                  Mark Selected as Read ({selectedNotifications.size})
                </Button>
              )}
              {notifications.some((n) => !n.is_read) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => markAllAsRead.mutate()}
                  disabled={markAllAsRead.isPending}
                >
                  <Check className="h-4 w-4 mr-2" />
                  Mark All as Read
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Search notifications..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="unread">Unread</SelectItem>
                <SelectItem value="read">Read</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={selectAll} variant="outline" size="sm">
              Select All Unread
            </Button>
          </div>

          <div className="space-y-2">
            {filteredNotifications.length === 0 ? (
              <div className="text-center py-12">
                <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-medium mb-2">No notifications</h3>
                <p className="text-muted-foreground">
                  {notifications.length === 0
                    ? "You don't have any notifications yet."
                    : "No notifications match your filters."}
                </p>
              </div>
            ) : (
              filteredNotifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`p-4 border rounded-lg transition-colors ${
                    notification.is_read 
                      ? 'bg-muted/30 border-muted' 
                      : 'bg-card border-border shadow-sm'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={selectedNotifications.has(notification.id)}
                      onCheckedChange={() => toggleSelectNotification(notification.id)}
                      className="mt-1"
                    />
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Bell className="h-4 w-4 text-primary" />
                        <h4 className={`font-medium truncate ${!notification.is_read ? 'font-semibold' : ''}`}>
                          {notification.title}
                        </h4>
                        {!notification.is_read && (
                          <Circle className="h-2 w-2 fill-blue-500 text-blue-500" />
                        )}
                      </div>
                      
                      <p className="text-sm text-muted-foreground mb-2">
                        {notification.body}
                      </p>
                      
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                        </span>
                        <div className="flex items-center gap-2">
                          {openTarget(notification) && (
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto p-0 text-xs"
                              onClick={() => {
                                markAsRead.mutate({ id: notification.id, engagement: 'action' });
                                navigate(openTarget(notification) as string);
                              }}
                            >
                              <ExternalLink className="h-3 w-3 mr-1" />
                              {notification.action_label || 'View Details'}
                            </Button>
                          )}
                          {!notification.is_read && (
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto p-0 text-xs"
                              onClick={() => markAsRead.mutate(notification.id)}
                              disabled={markAsRead.isPending}
                            >
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Mark as Read
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
