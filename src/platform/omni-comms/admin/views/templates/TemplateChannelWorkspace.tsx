/**
 * Omni-Comms Templates — Communication Action workspace.
 *
 * One workspace per Communication Action showing EVERY supported channel.
 * Selecting a channel reveals that channel's current published content, its
 * draft, and its version history — version history is channel-specific and is
 * no longer a separate top-level "Versions" tab. Preview and final assembly
 * are reached from inside the selected channel.
 *
 * Presentation only: every mutation is delegated to the parent page, which
 * continues to use the existing governed template RPCs.
 */
import React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Archive, CheckCircle2, Eye, LayoutTemplate, Loader2, Plus, Upload, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  TemplateChannel,
  TemplateVersionListItem,
} from "@/platform/omni-comms/application/templateCatalogueTypes";
import {
  CATALOGUE_CHANNEL_ORDER,
  CHANNEL_LABEL,
  CHANNEL_STATE_GLYPH,
  CHANNEL_STATE_LABEL,
  channelState,
  scopeSourceLabel,
  type CatalogueAction,
} from "@/platform/omni-comms/domain/templateBusinessCatalogue";

export interface TemplateChannelWorkspaceProps {
  action: CatalogueAction;
  eventName?: string | null;
  versions: TemplateVersionListItem[];
  loading?: boolean;
  channel: TemplateChannel;
  onSelectChannel: (channel: TemplateChannel) => void;
  onClose: () => void;
  canAuthor: boolean;
  canApprove: boolean;
  onCreateDraft: (channel: TemplateChannel) => void;
  onPreviewVersion: (versionId: string) => void;
  onConfigureLayout: (versionId: string) => void;
  onApproveVersion: (versionId: string) => void;
  onPublishVersion: (versionId: string) => void;
  onRetireVersion: (versionId: string) => void;
  onPreviewFinal: () => void;
}

export const TemplateChannelWorkspace: React.FC<TemplateChannelWorkspaceProps> = ({
  action, eventName, versions, loading, channel, onSelectChannel, onClose,
  canAuthor, canApprove, onCreateDraft, onPreviewVersion, onConfigureLayout,
  onApproveVersion, onPublishVersion, onRetireVersion, onPreviewFinal,
}) => {
  const forChannel = versions.filter((v) => v.channel === channel);
  const current = forChannel.find((v) => v.status === "published") ?? null;
  const approved = forChannel.filter((v) => v.status === "approved");
  const drafts = forChannel.filter((v) => v.status === "draft");
  const history = [...forChannel].sort((a, b) => b.version_number - a.version_number);

  return (
    <Card data-testid="template-channel-workspace">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">
            {eventName ? `${eventName} — ` : ""}{action.name}
          </CardTitle>
          <CardDescription>
            <span className="font-mono text-[11px]">{action.code}</span>
            {" · "}{scopeSourceLabel(action.scope_type)}
          </CardDescription>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close workspace">
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Every supported channel is always visible here. */}
        <div className="flex flex-wrap gap-1" data-testid="workspace-channel-rail">
          {CATALOGUE_CHANNEL_ORDER.map((c) => {
            const state = channelState(action, c);
            const active = c === channel;
            return (
              <button
                key={c}
                type="button"
                onClick={() => onSelectChannel(c)}
                data-testid={`workspace-channel-${c}`}
                data-state={state}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm",
                  active ? "bg-primary text-primary-foreground border-primary"
                    : "hover:bg-muted",
                  state === "missing" && !active ? "border-dashed text-muted-foreground" : "",
                )}
              >
                <span aria-hidden="true">{CHANNEL_STATE_GLYPH[state]}</span>
                {CHANNEL_LABEL[c]}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" data-testid="workspace-channel-state">
            {CHANNEL_LABEL[channel]} — {CHANNEL_STATE_LABEL[channelState(action, channel)]}
          </Badge>
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            onClick={onPreviewFinal}
            data-testid="workspace-preview-final"
          >
            <Eye className="mr-1 h-4 w-4" />Preview final {CHANNEL_LABEL[channel]}
          </Button>
          <Button
            size="sm"
            disabled={!canAuthor}
            onClick={() => onCreateDraft(channel)}
            data-testid={`workspace-create-${channel}`}
          >
            <Plus className="mr-1 h-4 w-4" />
            {forChannel.length === 0
              ? `Create ${CHANNEL_LABEL[channel]}`
              : `New ${CHANNEL_LABEL[channel]} draft`}
          </Button>
        </div>

        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading channel…
          </p>
        ) : forChannel.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
             data-testid="workspace-channel-empty">
            {CHANNEL_LABEL[channel]} is not configured for this communication action.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Current</div>
                <div className="text-sm" data-testid="workspace-current">
                  {current ? `Published v${current.version_number}` : "Nothing published"}
                </div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">In progress</div>
                <div className="text-sm" data-testid="workspace-inprogress">
                  {drafts.length === 0 && approved.length === 0
                    ? "No draft"
                    : [
                        drafts.length ? `${drafts.length} draft` : null,
                        approved.length ? `${approved.length} approved` : null,
                      ].filter(Boolean).join(" · ")}
                </div>
              </div>
            </div>

            <Table data-testid="workspace-history">
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead>Locale</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((v) => (
                  <TableRow key={v.id} data-testid={`workspace-version-${v.id}`}>
                    <TableCell>v{v.version_number}</TableCell>
                    <TableCell>{v.locale}</TableCell>
                    <TableCell><Badge variant="outline">{v.status}</Badge></TableCell>
                    <TableCell className="text-xs">
                      {new Date(v.updated_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" aria-label="Preview"
                          onClick={() => onPreviewVersion(v.id)}
                          data-testid={`workspace-preview-${v.id}`}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        {v.status === "draft" && (
                          <Button variant="ghost" size="icon" aria-label="Configure layout"
                            disabled={!canAuthor}
                            onClick={() => onConfigureLayout(v.id)}
                            data-testid={`workspace-layout-${v.id}`}>
                            <LayoutTemplate className="h-4 w-4" />
                          </Button>
                        )}
                        {v.status === "draft" && (
                          <Button variant="ghost" size="icon" aria-label="Approve"
                            disabled={!canApprove}
                            onClick={() => onApproveVersion(v.id)}
                            data-testid={`workspace-approve-${v.id}`}>
                            <CheckCircle2 className="h-4 w-4" />
                          </Button>
                        )}
                        {v.status === "approved" && (
                          <Button variant="ghost" size="icon" aria-label="Publish"
                            disabled={!canApprove}
                            onClick={() => onPublishVersion(v.id)}
                            data-testid={`workspace-publish-${v.id}`}>
                            <Upload className="h-4 w-4" />
                          </Button>
                        )}
                        {(v.status === "approved" || v.status === "published") && (
                          <Button variant="ghost" size="icon" aria-label="Retire"
                            disabled={!canApprove}
                            onClick={() => onRetireVersion(v.id)}
                            data-testid={`workspace-retire-${v.id}`}>
                            <Archive className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default TemplateChannelWorkspace;
