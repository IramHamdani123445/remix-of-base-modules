/**
 * Omni-Comms Operations — rendered message content viewer.
 *
 * Content is fetched on demand via `omni_comms_ops_message_content`, which
 * enforces `omni_comms.view_sensitive_content` server-side. HTML is only ever
 * displayed inside the hardened sandboxed iframe — never inserted into the parent
 * document.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import OmniCommsSandboxedPreview from "../../components/OmniCommsSandboxedPreview";
import OmniCommsEmptyState from "../../components/OmniCommsEmptyState";
import { useOmniCommsRpcClient } from "../../hooks/useOmniCommsRpcClient";
import {
  getOpsMessageContent,
  type OpsMessageContent,
} from "@/platform/omni-comms/application/operationsService";

export interface MessageContentDialogProps {
  messageId: string | null;
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const MessageContentDialog: React.FC<MessageContentDialogProps> = ({
  messageId,
  organizationId,
  open,
  onOpenChange,
}) => {
  const client = useOmniCommsRpcClient();
  const [content, setContent] = useState<OpsMessageContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!messageId) return;
    setLoading(true);
    setError(null);
    setContent(null);
    try {
      const res = await getOpsMessageContent(client, {
        messageId,
        organizationId,
        revealSensitive: true,
      });
      setContent(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unable to load message content");
    } finally {
      setLoading(false);
    }
  }, [client, messageId, organizationId]);

  useEffect(() => {
    if (open && messageId) void load();
  }, [open, messageId, load]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl" data-testid="omni-comms-ops-message-content">
        <DialogHeader>
          <DialogTitle>Rendered message content</DialogTitle>
          <DialogDescription>
            Read-only. Requires the sensitive-content capability; HTML is shown
            inside an isolated sandbox with no scripting or network access.
          </DialogDescription>
        </DialogHeader>

        {loading && <OmniCommsEmptyState variant="loading" title="Loading content…" />}
        {error && (
          <OmniCommsEmptyState
            variant="error"
            title="Content unavailable"
            description={error}
            actionLabel="Retry"
            onAction={() => void load()}
          />
        )}

        {content && !loading && !error && (
          <Tabs defaultValue="html">
            <TabsList>
              <TabsTrigger value="html">HTML</TabsTrigger>
              <TabsTrigger value="text">Text</TabsTrigger>
              <TabsTrigger value="meta">Metadata</TabsTrigger>
            </TabsList>
            <TabsContent value="html">
              {content.rendered_subject ? (
                <p className="text-sm mb-2">
                  <span className="text-muted-foreground">Subject: </span>
                  {content.rendered_subject}
                </p>
              ) : null}
              {content.rendered_html ? (
                <OmniCommsSandboxedPreview
                  html={content.rendered_html}
                  title="Rendered message"
                  heightPx={480}
                  testId="omni-comms-ops-message-preview"
                />
              ) : (
                <OmniCommsEmptyState title="No HTML body" />
              )}
            </TabsContent>
            <TabsContent value="text">
              <ScrollArea className="h-[420px] rounded border">
                <pre className="p-3 text-xs whitespace-pre-wrap break-words">
                  {content.rendered_text ?? "No text body"}
                </pre>
              </ScrollArea>
            </TabsContent>
            <TabsContent value="meta">
              <ScrollArea className="h-[420px] rounded border">
                <pre className="p-3 text-xs whitespace-pre-wrap break-words">
                  {JSON.stringify(
                    {
                      rendered_checksum: content.rendered_checksum,
                      destination_snapshot: content.destination_snapshot,
                      channel_setting_snapshot: content.channel_setting_snapshot,
                      resolved_asset_manifest: content.resolved_asset_manifest,
                      blockers: content.blockers,
                    },
                    null,
                    2,
                  )}
                </pre>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default MessageContentDialog;
