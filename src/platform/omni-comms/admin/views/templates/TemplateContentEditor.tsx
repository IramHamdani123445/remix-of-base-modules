/**
 * Channel-specific template content editor.
 *
 * Business users author labelled fields (Subject, Body, Message…) per channel.
 * The raw JSON representation is available only under "Advanced (technical)".
 */
import React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import type { TemplateChannel } from "@/platform/omni-comms/application/templateCatalogueTypes";
import {
  CHANNEL_AUTHORING,
  smsMetrics,
} from "@/platform/omni-comms/domain/templateAuthoring";
import { extractTokenPaths } from "@/platform/omni-comms/rendering";
import { validateWhatsAppContent } from "@/platform/omni-comms/domain/whatsappAuthoring";
import { WhatsAppButtonsEditor } from "./WhatsAppButtonsEditor";

export interface TemplateContentEditorProps {
  channel: TemplateChannel;
  content: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  disabled?: boolean;
}

function collectVariables(content: Record<string, string>): string[] {
  const found = new Set<string>();
  for (const value of Object.values(content)) {
    if (!value) continue;
    try {
      for (const p of extractTokenPaths(value)) found.add(p);
    } catch {
      /* invalid token syntax is surfaced by the preview panel */
    }
  }
  return [...found].sort();
}

export const TemplateContentEditor: React.FC<TemplateContentEditorProps> = ({
  channel, content, onChange, disabled,
}) => {
  const spec = CHANNEL_AUTHORING[channel];
  const variables = collectVariables(content);
  const [jsonText, setJsonText] = React.useState(() => JSON.stringify(content, null, 2));
  const [jsonError, setJsonError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setJsonText(JSON.stringify(content, null, 2));
  }, [content]);

  const set = (key: string, value: string) => onChange({ ...content, [key]: value });

  return (
    <div className="min-w-0 space-y-4" data-testid={`template-content-editor-${channel}`}>
      <div>
        <h3 className="text-sm font-semibold">{spec.title}</h3>
        <p className="text-xs text-muted-foreground">{spec.description}</p>
      </div>

      {spec.fields.map((f) => (
        <div key={f.key} className="min-w-0 space-y-1">
          <Label htmlFor={`tpl-${channel}-${f.key}`}>
            {f.label}{f.required ? " *" : ""}
          </Label>
          {f.kind === "text" ? (
            <Input
              id={`tpl-${channel}-${f.key}`}
              value={content[f.key] ?? ""}
              placeholder={f.placeholder}
              disabled={disabled}
              onChange={(e) => set(f.key, e.target.value)}
              data-testid={`field-${channel}-${f.key}`}
            />
          ) : (
            <Textarea
              id={`tpl-${channel}-${f.key}`}
              value={content[f.key] ?? ""}
              placeholder={f.placeholder}
              disabled={disabled}
              rows={f.kind === "html" ? 12 : 6}
              className={f.kind === "html" ? "font-mono text-xs" : undefined}
              onChange={(e) => set(f.key, e.target.value)}
              data-testid={`field-${channel}-${f.key}`}
            />
          )}
          {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
        </div>
      ))}

      {channel === "whatsapp" && (
        <>
          <WhatsAppButtonsEditor content={content} onChange={onChange} disabled={disabled} />
          {(() => {
            const issues = validateWhatsAppContent(content);
            return issues.length === 0 ? null : (
              <Alert variant="destructive" data-testid="whatsapp-content-issues">
                <AlertDescription>
                  <ul className="list-disc pl-4 text-xs">
                    {issues.map((i) => <li key={i}>{i}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            );
          })()}
        </>
      )}

      {channel === "sms" && (() => {
        const m = smsMetrics(content.body ?? "");
        return (
          <div className="flex flex-wrap gap-2 text-xs" data-testid="sms-metrics">
            <Badge variant="outline">{m.characters} characters</Badge>
            <Badge variant="outline">{m.encoding}</Badge>
            <Badge variant={m.segments > 2 ? "destructive" : "outline"}>
              {m.segments} segment{m.segments === 1 ? "" : "s"}
            </Badge>
            <Badge variant="outline">{m.charactersRemainingInSegment} left</Badge>
          </div>
        );
      })()}

      <div className="space-y-1">
        <Label>Variables</Label>
        {variables.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No variables used yet. Insert values with {"{{"}business.field{"}}"}.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1" data-testid="template-variables">
            {variables.map((v) => (
              <Badge key={v} variant="secondary" className="font-mono text-[11px]">{`{{${v}}}`}</Badge>
            ))}
          </div>
        )}
      </div>

      {spec.presentationNotes.length > 0 && (
        <Alert data-testid={`presentation-notes-${channel}`}>
          <AlertTitle className="text-xs">Presentation</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4 text-xs">
              {spec.presentationNotes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Accordion type="single" collapsible>
        <AccordionItem value="advanced">
          <AccordionTrigger className="text-xs" data-testid="advanced-json-toggle">
            Advanced (technical) — raw content JSON
          </AccordionTrigger>
          <AccordionContent>
            <Textarea
              value={jsonText}
              rows={10}
              disabled={disabled}
              className="font-mono text-xs"
              data-testid="advanced-json"
              onChange={(e) => {
                setJsonText(e.target.value);
                try {
                  const parsed = JSON.parse(e.target.value);
                  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
                    setJsonError("Content must be a JSON object");
                    return;
                  }
                  setJsonError(null);
                  onChange(parsed as Record<string, string>);
                } catch (err) {
                  setJsonError((err as Error).message);
                }
              }}
            />
            {jsonError && (
              <p className="mt-1 text-xs text-destructive" data-testid="advanced-json-error">
                {jsonError}
              </p>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
};

export default TemplateContentEditor;
