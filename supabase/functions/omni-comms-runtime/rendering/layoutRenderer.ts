// Omni-Comms Runtime — Slice 2c-iii layout rendering.
//
// The layout wrapper is an EXACT persisted layout-version snapshot. Slot
// markers are substituted in a stable, declared slot order; the template body
// is substituted into {{content}}.

import { RenderingError } from "./renderingErrors.ts";
import type { LayoutSnapshot } from "./renderingTypes.ts";

export interface LayoutRenderInput {
  layout: LayoutSnapshot | null;
  bodyHtml: string;
  slotValues: Record<string, string>;
  slotOrder: string[];
}

const SLOT_TOKEN_RE = /\{\{\s*slot:([A-Za-z0-9_\-.]+)\s*\}\}/g;
const CONTENT_TOKEN_RE = /\{\{\s*content\s*\}\}/g;

export function renderLayout(input: LayoutRenderInput): string {
  if (!input.layout) return input.bodyHtml;

  const wrapper = input.layout.wrapper_html;
  if (wrapper === null || wrapper === undefined) return input.bodyHtml;
  if (typeof wrapper !== "string") {
    throw new RenderingError("layout_snapshot_invalid", "wrapper_html must be a string");
  }

  // 1. Slot substitution in declared order (stable, order-independent output).
  let html = wrapper;
  for (const code of input.slotOrder) {
    const value = input.slotValues[code] ?? "";
    html = html.split(`{{slot:${code}}}`).join(value);
  }

  // 2. Any remaining slot token that the layout declares but the manifest
  //    never produced collapses to empty — never left as raw markup.
  SLOT_TOKEN_RE.lastIndex = 0;
  html = html.replace(SLOT_TOKEN_RE, "");

  // 3. Body injection.
  CONTENT_TOKEN_RE.lastIndex = 0;
  if (CONTENT_TOKEN_RE.test(html)) {
    CONTENT_TOKEN_RE.lastIndex = 0;
    html = html.replace(CONTENT_TOKEN_RE, input.bodyHtml);
  } else {
    html = `${html}${input.bodyHtml}`;
  }

  return html;
}
