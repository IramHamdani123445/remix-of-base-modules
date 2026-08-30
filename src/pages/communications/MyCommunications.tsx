/**
 * My Communications — the user-facing Omni-Comms inbox.
 *
 * Shows only communications delivered to the SIGNED-IN user. Ownership is
 * resolved server-side by the governed RPCs; this page never sends a user id.
 * Engagement (read / action) is recorded through the governed Omni engagement
 * RPCs so every open and click becomes delivery evidence on the originating
 * message. No provider, dispatch or operational data is exposed here.
 */
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MessagesSquare,
  CheckCheck,
  ExternalLink,
  Paperclip,
  Inbox,
  AlertTriangle,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { useInAppNotificationRpcClient } from '@/platform/omni-comms/admin/hooks/useInAppNotificationRpcClient';
import {
  isSafeInternalActionUrl,
  markAllOmniUnread,
  recordEngagement,
} from '@/platform/omni-comms/application/inAppNotificationService';
import {
  categoryLabel,
  moduleLabel,
  type MyCommunication,
} from '@/platform/omni-comms/application/myCommunicationsService';
import {
  MY_COMMUNICATIONS_KEY,
  MY_COMMUNICATIONS_UNREAD_KEY,
  useMyCommunications,
} from '@/hooks/useMyCommunications';

const PAGE_SIZE = 20;

const SEVERITY_STYLES: Record<string, string> = {
  info: 'bg-muted text-muted-foreground',
  success: 'bg-primary/10 text-primary',
  warning: 'bg-accent/40 text-accent-foreground',
  critical: 'bg-destructive/10 text-destructive',
};

function CommunicationRow({
  item,
  onOpen,
  busy,
}: {
  item: MyCommunication;
  onOpen: (item: MyCommunication) => void;
  busy: boolean;
}) {
  const target = isSafeInternalActionUrl(item.link) ? item.link : null;
  const module = moduleLabel(item.moduleCode);

  return (
    <li>
      <button
        type="button"
        disabled={busy}
        onClick={() => onOpen(item)}
        aria-label={`${item.isRead ? 'Read' : 'Unread'} communication: ${item.title}`}
        className={`w-full text-left p-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          item.isRead ? '' : 'bg-primary/5'
        }`}
      >
        <div className="flex items-start gap-3">
          {!item.isRead && (
            <span
              aria-hidden
              className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-primary"
            />
          )}
          <div className="min-w-0 flex-1">
            <p
              className={`truncate text-sm ${
                item.isRead ? 'text-muted-foreground' : 'font-semibold text-foreground'
              }`}
            >
              {item.title}
            </p>
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.body}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span title={format(new Date(item.receivedAt), 'PPpp')}>
                {formatDistanceToNow(new Date(item.receivedAt), { addSuffix: true })}
              </span>
              <Badge variant="outline" className="text-[10px] font-normal">
                {categoryLabel(item.category)}
              </Badge>
              {module && (
                <Badge variant="outline" className="text-[10px] font-normal">
                  {module}
                </Badge>
              )}
              {item.severity !== 'info' && (
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${
                    SEVERITY_STYLES[item.severity] ?? SEVERITY_STYLES.info
                  }`}
                >
                  {item.severity}
                </span>
              )}
              {item.hasAttachment && (
                <span className="inline-flex items-center gap-1">
                  <Paperclip className="h-3 w-3" aria-hidden />
                  Attachment
                </span>
              )}
              {item.actedAt && <span>Actioned</span>}
              {item.isRead && item.readAt && (
                <span title={format(new Date(item.readAt), 'PPpp')}>
                  Read {formatDistanceToNow(new Date(item.readAt), { addSuffix: true })}
                </span>
              )}
              {target && (
                <span className="inline-flex items-center gap-1 text-primary">
                  {item.actionLabel || 'Open'}
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </span>
              )}
            </div>
          </div>
        </div>
      </button>
    </li>
  );
}

export default function MyCommunications() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(0);
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useSupabaseAuth();
  const rpcClient = useInAppNotificationRpcClient();

  const { data, isLoading, isError, error, isFetching } = useMyCommunications({
    page,
    pageSize: PAGE_SIZE,
    unreadOnly,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const unreadOnPage = useMemo(() => items.filter((i) => !i.isRead).length, [items]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [MY_COMMUNICATIONS_KEY, user?.id] });
    queryClient.invalidateQueries({ queryKey: [MY_COMMUNICATIONS_UNREAD_KEY, user?.id] });
  };

  const open = useMutation({
    mutationFn: async (item: MyCommunication) => {
      const target = isSafeInternalActionUrl(item.link) ? (item.link as string) : null;
      await recordEngagement(rpcClient, item.id, target ? 'action' : 'read');
      return target;
    },
    onSuccess: (target) => {
      refresh();
      if (target) navigate(target);
    },
    onError: (err: unknown) => {
      toast({
        variant: 'destructive',
        title: 'We could not open that communication',
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    },
  });

  const markAll = useMutation({
    mutationFn: () => markAllOmniUnread(rpcClient),
    onSuccess: () => {
      refresh();
      toast({ title: 'All communications marked as read' });
    },
    onError: (err: unknown) => {
      toast({
        variant: 'destructive',
        title: 'We could not update your communications',
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    },
  });

  return (
    <div className="container mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <MessagesSquare className="h-6 w-6" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              My Communications
            </h1>
            <p className="text-sm text-muted-foreground">
              Messages sent to you by the Social Security Board.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => markAll.mutate()}
          disabled={markAll.isPending || (unreadOnPage === 0 && unreadOnly)}
        >
          {markAll.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <CheckCheck className="mr-2 h-4 w-4" aria-hidden />
          )}
          Mark all as read
        </Button>
      </header>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
          <CardTitle className="text-base">
            {unreadOnly ? 'Unread' : 'All'} communications
            {total > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">({total})</span>
            )}
          </CardTitle>
          <Tabs
            value={unreadOnly ? 'unread' : 'all'}
            onValueChange={(value) => {
              setUnreadOnly(value === 'unread');
              setPage(0);
            }}
          >
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="unread">Unread</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <Separator />
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading your communications…
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center">
              <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
              <p className="text-sm font-medium text-foreground">
                We could not load your communications
              </p>
              <p className="text-sm text-muted-foreground">
                {error instanceof Error ? error.message : 'Please try again in a moment.'}
              </p>
              <Button variant="outline" size="sm" onClick={refresh}>
                Try again
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center">
              <Inbox className="h-6 w-6 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium text-foreground">
                {unreadOnly ? 'No unread communications' : 'No new communications'}
              </p>
              <p className="text-sm text-muted-foreground">
                Anything sent to you will appear here.
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((item) => (
                <CommunicationRow
                  key={item.id}
                  item={item}
                  busy={open.isPending}
                  onOpen={(target) => open.mutate(target)}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {pageCount > 1 && (
        <nav className="flex items-center justify-between" aria-label="Communication history">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0 || isFetching}
          >
            <ChevronLeft className="mr-1 h-4 w-4" aria-hidden />
            Newer
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page + 1} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={page >= pageCount - 1 || isFetching}
          >
            Older
            <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
          </Button>
        </nav>
      )}
    </div>
  );
}
