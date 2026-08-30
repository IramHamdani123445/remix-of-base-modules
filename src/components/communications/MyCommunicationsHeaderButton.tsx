/**
 * My Communications — application-header entry point for NORMAL users.
 *
 * Badge = unread Omni-Comms in-app communications addressed to the signed-in
 * user. It deliberately never counts workflow approvals, legacy notifications
 * or Omni operational attention: those are separate concerns with separate
 * indicators.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { MessagesSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { useMyCommunicationsUnreadCount } from '@/hooks/useMyCommunications';

export const MY_COMMUNICATIONS_ROUTE = '/my-communications';

export const MyCommunicationsHeaderButton: React.FC = () => {
  const navigate = useNavigate();
  const { isAuthenticated, isAuthReady } = useSupabaseAuth();
  const { data: unread = 0 } = useMyCommunicationsUnreadCount();

  if (!isAuthReady || !isAuthenticated) return null;

  const label =
    unread > 0
      ? `My Communications — ${unread} unread`
      : 'My Communications';

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      data-testid="my-communications-header-button"
      onClick={() => navigate(MY_COMMUNICATIONS_ROUTE)}
      className="relative text-muted-foreground hover:text-foreground"
    >
      <MessagesSquare className="h-5 w-5" />
      {unread > 0 && (
        <Badge
          data-testid="my-communications-unread-badge"
          className="absolute -top-1 -right-1 h-5 min-w-[20px] flex items-center justify-center p-0 px-1 text-[10px] bg-primary text-primary-foreground"
        >
          {unread > 9 ? '9+' : unread}
        </Badge>
      )}
    </Button>
  );
};

export default MyCommunicationsHeaderButton;
