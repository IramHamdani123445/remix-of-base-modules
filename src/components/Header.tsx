import { useState } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Settings, User, LogOut, CalendarDays } from "lucide-react";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { useSystemSettingsContext } from "@/contexts/SystemSettingsContext";
import { InAppNotificationBell } from "@/components/notifications/InAppNotificationBell";
import { OmniCommsHeaderShortcut } from "@/platform/omni-comms/admin/components/OmniCommsHeaderShortcut";
import { MeetingCalendarModal } from "@/components/meetings/MeetingCalendarModal";
import { ThemeSwitcher } from "@/components/theme/ThemeSwitcher";
import { useTodayMeetingCount } from "@/hooks/useTodayMeetingCount";
import { useNavigate } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export const Header = () => {
  const { user, profile, logout } = useSupabaseAuth();
  const { getSetting } = useSystemSettingsContext();
  const navigate = useNavigate();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const todayMeetingCount = useTodayMeetingCount();
  const appLogoUrl = getSetting('app_logo_url', '/images/ssb-logo.png');

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const userName = profile?.full_name || user?.email?.split('@')[0] || 'User';
  const userEmail = user?.email || '';

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-card px-3 sm:px-6 shadow-sm border-t-4 border-t-[hsl(var(--ssb-green-primary))]">
      <div className="flex items-center gap-4">
        <SidebarTrigger className="text-muted-foreground hover:text-primary" />
        <div className="flex items-center gap-3">
          <img 
            src={appLogoUrl} 
            alt="SSB Logo" 
            className="h-8 w-8 object-contain"
            onError={(e) => { (e.target as HTMLImageElement).src = '/images/ssb-logo.png'; }}
          />
          <div className="flex flex-col">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              SSB Enterprise Portal
            </h1>
            <span className="text-xs text-muted-foreground font-medium hidden sm:block">
              Social Security Board — St. Christopher &amp; Nevis
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Meeting Calendar */}
        {user && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCalendarOpen(true)}
            className="relative text-muted-foreground hover:text-foreground"
            title="My Meeting Calendar"
          >
            <CalendarDays className="h-5 w-5" />
            {todayMeetingCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-accent text-accent-foreground text-[10px] font-bold px-1 leading-none">
                {todayMeetingCount > 9 ? '9+' : todayMeetingCount}
              </span>
            )}
          </Button>
        )}
        <MeetingCalendarModal open={calendarOpen} onOpenChange={setCalendarOpen} />

        {/* Theme Switcher */}
        <ThemeSwitcher />

        {/* Notifications */}
        <InAppNotificationBell />

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-3 px-3 py-2 hover:bg-muted">
              <Avatar className="h-8 w-8">
                <AvatarImage src="/placeholder-avatar.jpg" alt={userName} />
                <AvatarFallback className="text-sm font-medium bg-primary/10 text-primary">
                  {userName.split(' ').map(n => n[0]).join('').toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="text-left hidden sm:block">
                <div className="text-sm font-medium text-foreground">{userName}</div>
                <div className="text-xs text-muted-foreground">{userEmail}</div>
              </div>
            </Button>
          </DropdownMenuTrigger>
          
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium text-foreground">{userName}</p>
                <p className="text-xs text-muted-foreground">{userEmail}</p>
              </div>
            </DropdownMenuLabel>
            
            <DropdownMenuSeparator />
            
            <DropdownMenuItem className="cursor-pointer" onClick={() => navigate('/profile')}>
              <User className="mr-2 h-4 w-4" />
              My Profile
            </DropdownMenuItem>

            <DropdownMenuItem className="cursor-pointer" onClick={() => navigate('/profile/change-password')}>
              <Settings className="mr-2 h-4 w-4" />
              Change Password
            </DropdownMenuItem>
            
            <DropdownMenuSeparator />
            
            <DropdownMenuItem onClick={handleLogout} className="cursor-pointer text-destructive focus:text-destructive">
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};
