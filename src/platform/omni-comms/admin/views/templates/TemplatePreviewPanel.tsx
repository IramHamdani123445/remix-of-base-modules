/**
 * Shared rendered-preview panel: Rendered | Test data | Source.
 *
 * "Rendered" is the default because a communications administrator inspects
 * the final message, not the payload. Test data stays in component memory and
 * is never persisted or transmitted.
 */
import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { renderTemplate } from "@/platform/omni-comms/rendering";
import {
  TEMPLATE_CHANNEL_KEYS,
  type TemplateChannel,
} from "@/platform/omni-comms/application/templateCatalogueTypes";
import { OmniCommsSandboxedPreview } from "../../components/OmniCommsSandboxedPreview";
import { buildSamplePayload } from "../templateTableUtils";

function escapeHtmlForDisplay(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c] as string));
}

export interface TemplatePreviewPanelProps {
  channel: TemplateChannel;
  content: Record<string, string>;
  /** Caption shown above the rendered output (e.g. "Email · Draft v4"). */
  caption?: string;
  testId?: string;
}

export const TemplatePreviewPanel: React.FC<TemplatePreviewPanelProps> = ({
  channel, content, caption, testId = "template-preview-panel",
}) => {
  const [payloadText, setPayloadText] = React.useState("{}");
  const [touched, setTouched] = React.useState(false);

  // Seed test data from the template's own tokens until the user edits it.
  React.useEffect(() => {
    if (touched) return;
    setPayloadText(JSON.stringify(buildSamplePayload(content), null, 2));
  }, [content, touched]);

  const rendered = React.useMemo(() => {
    try {
      const payload = JSON.parse(payloadText || "{}");
      const out = renderTemplate(channel, content, payload);
      return { ok: true as const, fields: out.fields };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  }, [channel, content, payloadText]);

  const htmlKeys = TEMPLATE_CHANNEL_KEYS[channel].html;

  return (
    <Tabs defaultValue="rendered" className="min-w-0" data-testid={testId}>
      <TabsList>
        <TabsTrigger value="rendered" data-testid={`${testId}-tab-rendered`}>Rendered</TabsTrigger>
        <TabsTrigger value="data" data-testid={`${testId}-tab-data`}>Test data</TabsTrigger>
        <TabsTrigger value="source" data-testid={`${testId}-tab-source`}>Source</TabsTrigger>
      </TabsList>

      <TabsContent value="rendered" className="min-w-0 space-y-3">
        {caption && <p className="text-xs text-muted-foreground">{caption}</p>}
        {rendered.ok === false && (
          <Alert variant="destructive"><AlertDescription>{rendered.error}</AlertDescription></Alert>
        )}
        {rendered.ok && Object.entries(rendered.fields).map(([field, value]) => (
          <div key={field} className="min-w-0 space-y-1">
            <div className="text-xs font-semibold uppercase text-muted-foreground">{field}</div>
            {htmlKeys.includes(field) ? (
              <OmniCommsSandboxedPreview
                html={value}
                title={`${field} preview`}
                testId={`${testId}-rendered-${field}`}
              />
            ) : (
              <pre
                className="whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs"
                data-testid={`${testId}-rendered-${field}`}
              >{value}</pre>
            )}
          </div>
        ))}
      </TabsContent>

      <TabsContent value="data" className="min-w-0 space-y-2">
        <p className="text-xs text-muted-foreground">
          Sample values used to render the preview. Held only in this browser tab.
        </p>
        <Textarea
          value={payloadText}
          onChange={(e) => { setTouched(true); setPayloadText(e.target.value); }}
          rows={16}
          className="font-mono text-xs"
          data-testid={`${testId}-payload`}
        />
      </TabsContent>

      <TabsContent value="source" className="min-w-0 space-y-3">
        {Object.entries(content).map(([field, value]) => (
          <div key={field} className="min-w-0 space-y-1">
            <div className="text-xs font-semibold uppercase text-muted-foreground">{field}</div>
            <pre
              className="whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs"
              data-testid={`${testId}-source-${field}`}
            >{htmlKeys.includes(field) ? escapeHtmlForDisplay(value ?? "") : value}</pre>
          </div>
        ))}
      </TabsContent>
    </Tabs>
  );
};

export default TemplatePreviewPanel;
