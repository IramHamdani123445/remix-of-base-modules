/**
 * Structured WhatsApp button authoring.
 *
 * The administrator adds quick replies and link buttons as ordinary rows.
 * Provider JSON is never exposed here; the rows are serialised into the
 * canonical string-only `buttons` content key on change.
 */
import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import {
  WHATSAPP_LIMITS,
  parseWhatsAppButtons,
  serialiseWhatsAppButtons,
  type WhatsAppButton,
  type WhatsAppButtonType,
} from "@/platform/omni-comms/domain/whatsappAuthoring";

export interface WhatsAppButtonsEditorProps {
  content: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  disabled?: boolean;
}

export const WhatsAppButtonsEditor: React.FC<WhatsAppButtonsEditorProps> = ({
  content, onChange, disabled,
}) => {
  const buttons = parseWhatsAppButtons(content);
  const commit = (next: WhatsAppButton[]) => onChange(serialiseWhatsAppButtons(content, next));

  const update = (index: number, patch: Partial<WhatsAppButton>) => {
    const next = buttons.map((b, i) => (i === index ? { ...b, ...patch } : b));
    if (patch.type === "quick_reply") next[index] = { type: "quick_reply", label: next[index].label };
    commit(next);
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= buttons.length) return;
    const next = [...buttons];
    [next[index], next[target]] = [next[target], next[index]];
    commit(next);
  };

  const add = (type: WhatsAppButtonType) => {
    if (buttons.length >= WHATSAPP_LIMITS.maxButtons) return;
    commit([...buttons, type === "url" ? { type, label: "", url: "" } : { type, label: "" }]);
  };

  return (
    <div className="min-w-0 space-y-3" data-testid="whatsapp-buttons-editor">
      <Label>Buttons</Label>

      {buttons.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No buttons yet. Up to {WHATSAPP_LIMITS.maxButtons} may be added.
        </p>
      )}

      {buttons.map((button, index) => (
        <div
          key={index}
          className="grid grid-cols-1 gap-2 rounded border p-2 sm:grid-cols-[9rem_1fr_1fr_auto]"
          data-testid={`whatsapp-button-row-${index}`}
        >
          <Select
            value={button.type}
            disabled={disabled}
            onValueChange={(v) => update(index, { type: v as WhatsAppButtonType })}
          >
            <SelectTrigger data-testid={`whatsapp-button-type-${index}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="quick_reply">Quick reply</SelectItem>
              <SelectItem value="url">Link (URL)</SelectItem>
            </SelectContent>
          </Select>

          <Input
            value={button.label}
            placeholder="Button label"
            maxLength={WHATSAPP_LIMITS.buttonLabelMaxLength}
            disabled={disabled}
            onChange={(e) => update(index, { label: e.target.value })}
            data-testid={`whatsapp-button-label-${index}`}
          />

          {button.type === "url" ? (
            <Input
              value={button.url ?? ""}
              placeholder="https://…"
              disabled={disabled}
              onChange={(e) => update(index, { url: e.target.value })}
              data-testid={`whatsapp-button-url-${index}`}
            />
          ) : (
            <p className="self-center text-xs text-muted-foreground">
              Sends the label back as a reply.
            </p>
          )}

          <div className="flex items-center gap-1">
            <Button
              type="button" variant="ghost" size="icon" disabled={disabled || index === 0}
              onClick={() => move(index, -1)} aria-label="Move button up"
            ><ArrowUp className="h-4 w-4" /></Button>
            <Button
              type="button" variant="ghost" size="icon"
              disabled={disabled || index === buttons.length - 1}
              onClick={() => move(index, 1)} aria-label="Move button down"
            ><ArrowDown className="h-4 w-4" /></Button>
            <Button
              type="button" variant="ghost" size="icon" disabled={disabled}
              onClick={() => commit(buttons.filter((_, i) => i !== index))}
              aria-label="Remove button"
              data-testid={`whatsapp-button-remove-${index}`}
            ><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button" variant="outline" size="sm"
          disabled={disabled || buttons.length >= WHATSAPP_LIMITS.maxButtons}
          onClick={() => add("quick_reply")}
          data-testid="whatsapp-add-quick-reply"
        >+ Quick reply</Button>
        <Button
          type="button" variant="outline" size="sm"
          disabled={disabled || buttons.length >= WHATSAPP_LIMITS.maxButtons}
          onClick={() => add("url")}
          data-testid="whatsapp-add-url-button"
        >+ URL</Button>
      </div>
    </div>
  );
};

export default WhatsAppButtonsEditor;
