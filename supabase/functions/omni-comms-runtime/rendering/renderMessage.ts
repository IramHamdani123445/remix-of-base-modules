// Omni-Comms Runtime — Slice 2c-iii single-message deterministic renderer.
//
// Inputs are EXACT persisted snapshots. There is no clock read, no random
// value, no browser API, no provider SDK, no network request, and no
// current-configuration lookup anywhere in this pipeline.

import { computeRenderChecksum, utf8ByteLength } from "./checksum.ts";
import { renderLayout } from "./layoutRenderer.ts";
import { RenderingError } from "./renderingErrors.ts";
import { renderSlots } from "./slotRenderer.ts";
import { resolveTokens } from "./tokenResolver.ts";
import {
  RENDER_LIMITS,
  type LayoutSnapshot,
  type PersistedChannelResolution,
  type RenderedOutput,
  type SenderSnapshot,
  type TemplateSnapshot,
} from "./renderingTypes.ts";

export interface RenderMessageInput {
  channel: string;
  resolution: PersistedChannelResolution;
  template: TemplateSnapshot | null;
  layout: LayoutSnapshot | null;
  sender: SenderSnapshot | null;
  payload: Record<string, unknown>;
  recipientContext: Record<string, unknown>;
}

function contentString(content: Record<string, unknown>, key: string): string | null {
  const raw = content[key];
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") {
    throw new RenderingError("template_snapshot_invalid", `content.${key} must be a string`);
  }
  return raw;
}

export async function renderMessage(input: RenderMessageInput): Promise<RenderedOutput> {
  const blockers: string[] = [];
  const unresolvedRequired = new Set<string>();
  const unresolvedOptional = new Set<string>();

  const template = input.template;
  if (!template) throw new RenderingError("template_snapshot_invalid", "template version missing");
  if (template.content === null || typeof template.content !== "object" || Array.isArray(template.content)) {
    throw new RenderingError("template_snapshot_invalid", "content must be an object");
  }

  const senderContext: Record<string, unknown> = input.sender
    ? {
      code: input.sender.code,
      from_name: input.sender.from_name,
      from_address: input.sender.from_address,
      reply_to_address: input.sender.reply_to_address,
    }
    : {};

  const tokenContext = {
    payload: input.payload,
    recipient: input.recipientContext,
    sender: senderContext,
  };

  const subjectSource = contentString(template.content, "subject");
  const htmlSource = contentString(template.content, "html") ?? contentString(template.content, "body");
  const textSource = contentString(template.content, "text");

  const collect = (r: { unresolvedRequired: string[]; unresolvedOptional: string[] }) => {
    for (const t of r.unresolvedRequired) unresolvedRequired.add(t);
    for (const t of r.unresolvedOptional) unresolvedOptional.add(t);
  };

  const subjectResult = subjectSource === null ? null : resolveTokens(subjectSource, tokenContext, false);
  if (subjectResult) collect(subjectResult);
  const bodyResult = htmlSource === null ? null : resolveTokens(htmlSource, tokenContext, true);
  if (bodyResult) collect(bodyResult);
  const textResult = textSource === null ? null : resolveTokens(textSource, tokenContext, false);
  if (textResult) collect(textResult);

  // Slots + layout (exact persisted layout-version snapshot).
  let unresolvedRequiredSlots: string[] = [];
  let html = bodyResult ? bodyResult.output : null;
  if (input.layout && html !== null) {
    const slots = renderSlots({ layout: input.layout, assets: input.resolution.assets ?? [] });
    unresolvedRequiredSlots = slots.unresolvedRequiredSlots;
    html = renderLayout({
      layout: input.layout,
      bodyHtml: html,
      slotValues: slots.slotValues,
      slotOrder: slots.slotOrder,
    });
  } else if (input.layout) {
    const slots = renderSlots({ layout: input.layout, assets: input.resolution.assets ?? [] });
    unresolvedRequiredSlots = slots.unresolvedRequiredSlots;
  }

  const subject = subjectResult ? subjectResult.output : null;
  const text = textResult ? textResult.output : null;

  if (unresolvedRequired.size > 0) blockers.push("unresolved_required_token");
  if (unresolvedRequiredSlots.length > 0) blockers.push("unresolved_required_slot");

  if (subject !== null && subject.length > RENDER_LIMITS.subjectMaxChars) {
    blockers.push("rendered_subject_too_large");
  }
  if (html !== null && utf8ByteLength(html) > RENDER_LIMITS.htmlMaxBytes) {
    blockers.push("rendered_html_too_large");
  }
  if (text !== null && utf8ByteLength(text) > RENDER_LIMITS.textMaxBytes) {
    blockers.push("rendered_text_too_large");
  }

  const oversize = blockers.some((b) => b.endsWith("_too_large"));

  const checksum = await computeRenderChecksum({
    templateVersionId: input.resolution.template_version_id,
    templateChecksum: input.resolution.template_version_checksum,
    layoutVersionId: input.resolution.layout_version_id,
    layoutChecksum: input.resolution.layout_checksum,
    assets: (input.resolution.assets ?? []).map((a) => ({
      assetVersionId: a.asset_version_id,
      checksum: a.asset_checksum,
    })),
    senderIdentityId: input.resolution.sender_identity_id,
    renderedSubject: subject,
    renderedHtml: html,
    renderedText: text,
  });

  return {
    // Oversized output is never persisted; the blocker carries the reason.
    subject: oversize ? null : subject,
    html: oversize ? null : html,
    text: oversize ? null : text,
    unresolvedTokens: [...new Set([...unresolvedRequired, ...unresolvedOptional])].sort(),
    unresolvedRequiredSlots,
    checksum,
    blockers: [...new Set(blockers)].sort(),
  };
}
