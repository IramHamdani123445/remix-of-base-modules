/**
 * WhatsApp-style rendered preview.
 *
 * Shows the message the recipient would see: header, media, body, footer and
 * buttons. It is provider-neutral by construction — ContentSid, account
 * identifiers and provider registration IDs never appear in a message preview.
 */
import React from "react";
import { parseWhatsAppButtons } from "@/platform/omni-comms/domain/whatsappAuthoring";

export interface WhatsAppMessagePreviewProps {
  /** Rendered (token-substituted) content fields. */
  fields: Record<string, string>;
  testId?: string;
}

export const WhatsAppMessagePreview: React.FC<WhatsAppMessagePreviewProps> = ({
  fields, testId = "whatsapp-preview",
}) => {
  const header = (fields.header ?? "").trim();
  const body = fields.body ?? "";
  const footer = (fields.footer ?? "").trim();
  const media = (fields.media_url ?? "").trim();
  const buttons = parseWhatsAppButtons(fields);

  return (
    <div className="rounded-lg bg-muted p-3" data-testid={testId}>
      <div className="max-w-sm rounded-lg border bg-card p-3 shadow-sm">
        {media !== "" && (
          <div
            className="mb-2 flex h-24 items-center justify-center rounded bg-muted text-xs text-muted-foreground"
            data-testid={`${testId}-media`}
          >
            Media attachment
          </div>
        )}
        {header !== "" && (
          <p className="text-sm font-semibold" data-testid={`${testId}-header`}>{header}</p>
        )}
        <p
          className="whitespace-pre-wrap break-words text-sm"
          data-testid={`${testId}-body`}
        >{body}</p>
        {footer !== "" && (
          <p className="mt-2 text-[11px] text-muted-foreground" data-testid={`${testId}-footer`}>
            {footer}
          </p>
        )}
        {buttons.length > 0 && (
          <div className="mt-2 space-y-1 border-t pt-2" data-testid={`${testId}-buttons`}>
            {buttons.map((b, i) => (
              <div
                key={`${b.label}-${i}`}
                className="rounded border border-primary/30 px-2 py-1 text-center text-xs text-primary"
                data-testid={`${testId}-button-${i}`}
              >
                {b.label}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default WhatsAppMessagePreview;
