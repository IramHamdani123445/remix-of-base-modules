/**
 * Full-width, in-page template authoring workspace.
 *
 * Editor on the left, final preview on the right (stacked below xl). Never a
 * modal — authoring an email, letter or WhatsApp message is a working surface,
 * not a dialog. Saving a Draft updates that exact draft with optimistic
 * concurrency; published content is never mutated here.
 */
import React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowLeft, LayoutTemplate, Loader2, Save } from "lucide-react";
import type {
  TemplateVersionGetResult,
} from "@/platform/omni-comms/application/templateCatalogueTypes";
import {
  CHANNEL_LABEL,
} from "@/platform/omni-comms/domain/templateBusinessCatalogue";
import {
  contentForSave,
  missingRequiredFields,
  normaliseContentForChannel,
} from "@/platform/omni-comms/domain/templateAuthoring";
import TemplateContentEditor from "./TemplateContentEditor";
import TemplatePreviewPanel from "./TemplatePreviewPanel";

export interface TemplateAuthoringWorkspaceProps {
  /** Breadcrumb-style context: Module → Object → Event → Action. */
  contextTrail: string[];
  version: TemplateVersionGetResult;
  canAuthor: boolean;
  saving?: boolean;
  onSave: (content: Record<string, string>) => Promise<void> | void;
  onClose: () => void;
  onConfigureLayout?: () => void;
}

export const TemplateAuthoringWorkspace: React.FC<TemplateAuthoringWorkspaceProps> = ({
  contextTrail, version, canAuthor, saving, onSave, onClose, onConfigureLayout,
}) => {
  const readOnly = version.status !== "draft" || !canAuthor;
  const [content, setContent] = React.useState<Record<string, string>>(() =>
    normaliseContentForChannel(version.channel, version.content));

  React.useEffect(() => {
    setContent(normaliseContentForChannel(version.channel, version.content));
  }, [version.id, version.channel, version.content]);

  const missing = missingRequiredFields(version.channel, content);
  const dirty = React.useMemo(
    () => JSON.stringify(contentForSave(version.channel, content))
      !== JSON.stringify(contentForSave(version.channel,
        normaliseContentForChannel(version.channel, version.content))),
    [content, version.channel, version.content],
  );

  return (
    <Card data-testid="template-authoring-workspace">
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base">
              {CHANNEL_LABEL[version.channel]} · {version.status === "draft" ? "Draft" : version.status} v{version.version_number}
            </CardTitle>
            <CardDescription className="truncate">
              {contextTrail.filter(Boolean).join(" → ")} · {version.locale}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{version.status}</Badge>
            {onConfigureLayout && version.status === "draft" && (
              <Button
                variant="outline" size="sm" disabled={!canAuthor}
                onClick={onConfigureLayout}
                data-testid="authoring-configure-layout"
              >
                <LayoutTemplate className="mr-1 h-4 w-4" />Layout
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onClose} data-testid="authoring-close">
              <ArrowLeft className="mr-1 h-4 w-4" />Back to channel
            </Button>
            <Button
              size="sm"
              disabled={readOnly || saving || missing.length > 0 || !dirty}
              onClick={() => void onSave(contentForSave(version.channel, content))}
              data-testid="authoring-save"
            >
              {saving
                ? <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                : <Save className="mr-1 h-4 w-4" />}
              Save draft
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {readOnly && (
          <Alert data-testid="authoring-readonly-notice">
            <AlertTitle className="text-xs">Read-only</AlertTitle>
            <AlertDescription className="text-xs">
              {version.status === "approved"
                ? "Approved content is locked until it is published."
                : version.status === "published"
                  ? "Published content is never edited in place — use Edit to open the next draft."
                  : version.status === "retired"
                    ? "Retired content is read-only."
                    : "You do not have the omni_comms.author_templates capability."}
            </AlertDescription>
          </Alert>
        )}
        {missing.length > 0 && !readOnly && (
          <Alert variant="destructive" data-testid="authoring-missing-fields">
            <AlertDescription className="text-xs">
              Required before saving: {missing.join(", ")}
            </AlertDescription>
          </Alert>
        )}

        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="min-w-0">
            <TemplateContentEditor
              channel={version.channel}
              content={content}
              onChange={setContent}
              disabled={readOnly}
            />
          </div>
          <div className="min-w-0">
            <div className="rounded-md border p-3">
              <div className="mb-2 text-sm font-semibold">Final preview</div>
              <TemplatePreviewPanel
                channel={version.channel}
                content={content}
                caption={`${CHANNEL_LABEL[version.channel]} · ${version.locale} · v${version.version_number}`}
                testId="authoring-preview"
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default TemplateAuthoringWorkspace;
