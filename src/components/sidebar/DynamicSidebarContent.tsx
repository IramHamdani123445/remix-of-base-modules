import { useSyncExternalStore, useMemo, useEffect, useState } from 'react';
import { useDynamicNavigation, MenuItem } from '@/hooks/useDynamicNavigation';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SidebarMenu } from '@/components/ui/sidebar';
import SidebarMenuGroup from './SidebarMenuGroup';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, RefreshCw, User, KeyRound, Bell, MonitorSmartphone, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { filterComplianceMenuByFeatureFlags } from '@/lib/compliance/menuFeatureFilter';
import { subscribeComplianceDbFlags, hasComplianceDbFlagsLoaded } from '@/lib/compliance/featureFlagCache';
import { ActiveRouteProvider } from '@/lib/navigation/ActiveRouteContext';

interface DynamicSidebarContentProps {
  collapsed: boolean;
}

// Default menu items always visible to all users regardless of permissions
const defaultMenuItems: MenuItem[] = [
  {
    id: 'user-profile-preferences',
    title: 'User Profile & Preferences',
    icon: User,
    description: 'Manage your profile and preferences',
    subItems: [
      { id: 'my-profile', title: 'My Profile', url: '/profile', icon: User, description: 'View and edit your profile' },
      { id: 'change-password', title: 'Change Password', url: '/profile/change-password', icon: KeyRound, description: 'Update your password' },
      { id: 'notification-preferences', title: 'Notification Preferences', url: '/profile/notifications', icon: Bell, description: 'Manage notification settings' },
      { id: 'active-sessions', title: 'Active Sessions', url: '/profile/sessions', icon: MonitorSmartphone, description: 'View and manage active sessions' },
      { id: 'notification-center', title: 'Notification Center', url: '/notifications/center', icon: Mail, description: 'View all your notifications' },
    ],
  },
];

export default function DynamicSidebarContent({ collapsed }: DynamicSidebarContentProps) {
  const { menuItems, isLoading, isError, isEmpty, refetch } = useDynamicNavigation();
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setLoadingTimedOut(false);
      return;
    }

    const timeoutId = window.setTimeout(() => setLoadingTimedOut(true), 10_000);
    return () => window.clearTimeout(timeoutId);
  }, [isLoading]);

  const handleRetry = () => {
    setLoadingTimedOut(false);
    void refetch();
  };

  // Subscribe to compliance feature-flag cache so toggling a flag re-renders
  // the sidebar (the navigation react-query cache is keyed on user.id only).
  useSyncExternalStore(
    subscribeComplianceDbFlags,
    () => (hasComplianceDbFlagsLoaded() ? 'loaded' : 'pending'),
    () => 'pending',
  );

  const visibleMenuItems = useMemo(
    () => filterComplianceMenuByFeatureFlags(menuItems),
    [menuItems],
  );

  return (
    <ActiveRouteProvider menuTrees={[visibleMenuItems, defaultMenuItems]}>
    <ScrollArea className="flex-1 px-3">
      <SidebarMenu className="py-2 space-y-1">
        {/* Loading skeletons */}
        {isLoading && !loadingTimedOut ? (
          <div className="space-y-3 px-1">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-5 w-5 rounded" />
                {!collapsed && <Skeleton className="h-4 flex-1" />}
              </div>
            ))}
          </div>
        ) : isError || loadingTimedOut ? (
          /* Error state with retry */
          <div className="px-4 py-4 text-center">
            <AlertCircle className="h-6 w-6 text-destructive mx-auto mb-2" />
            <p className="text-xs text-muted-foreground mb-2">
              {loadingTimedOut ? 'Menu is taking too long to load' : 'Failed to load menu'}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetry}
              className="gap-2"
            >
              <RefreshCw className="h-3 w-3" />
              Retry
            </Button>
          </div>
        ) : (
          <>
            {/* Dynamic menu items */}
            {visibleMenuItems.map((item: MenuItem) => (
              <SidebarMenuGroup key={item.id} item={item} collapsed={collapsed} />
            ))}

            {/* "No modules assigned" when RPC succeeds with zero items */}
            {isEmpty && (
              <div className="px-4 py-3 text-center">
                <p className="text-xs text-muted-foreground">No modules assigned</p>
              </div>
            )}
          </>
        )}

        {/* Separator between dynamic and default menus */}
        {(visibleMenuItems.length > 0 || (isLoading && !loadingTimedOut)) && (
          <div className="py-2">
            <Separator className="bg-border/50" />
          </div>
        )}

        {/* Default menu items - ALWAYS visible */}
        {defaultMenuItems.map((item: MenuItem) => (
          <SidebarMenuGroup key={item.id} item={item} collapsed={collapsed} />
        ))}
      </SidebarMenu>
    </ScrollArea>
    </ActiveRouteProvider>
  );
}
