/**
 * Deterministic assembly composer for the Build 1 render manifest.
 *
 * Given a RenderManifest returned by omni_comms_resolve_render_manifest and
 * the template's rendered subject/html/text, produce the final assembled
 * subject, HTML, plain text, and a stable checksum. Pure function — no I/O,
 * no time, no randomness.
 */
import type { LayoutSlot, RenderManifest, ResolvedAsset } from '../application/sharedAssetsTypes';

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  const arr = Array.from(new Uint8Array(buf));
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface AssemblyResult {
  rendered_subject: string;
  rendered_html: string;
  rendered_text: string;
  unresolved_tokens: string[];
  unresolved_required_slots: string[];
  rendered_checksum: string;
  resolved_assets: ResolvedAsset[];
  layout_id: string | null;
  layout_version_id: string | null;
  layout_inheritance_source: string | null;
}

export interface AssemblyInput {
  manifest: RenderManifest;
  templateRendered: {
    subject?: string;
    html?: string;
    text?: string;
    unresolved_tokens?: string[];
  };
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function composeAssembledEmail(input: AssemblyInput): Promise<AssemblyResult> {
  const { manifest, templateRendered } = input;
  const slots: LayoutSlot[] = (manifest.layout_slots ?? []).slice().sort((a, b) => a.order - b.order);
  const bySlot = new Map<string, ResolvedAsset>();
  for (const r of manifest.resolved_assets) bySlot.set(r.slot, r);

  const htmlParts: string[] = [];
  const textParts: string[] = [];
  const unresolvedRequired: string[] = [];

  for (const slot of slots) {
    if (slot.code === 'content_body') {
      htmlParts.push(templateRendered.html ?? '');
      textParts.push(templateRendered.text ?? '');
      continue;
    }
    const r = bySlot.get(slot.code);
    if (!r || !r.asset_id) {
      if (slot.required) unresolvedRequired.push(slot.code);
      continue;
    }
    if (r.content_html) htmlParts.push(r.content_html);
    if (r.content_text) textParts.push(r.content_text);
    else if (r.content_html) textParts.push(r.content_html.replace(/<[^>]+>/g, ''));
  }

  const html = htmlParts.join('\n');
  const text = textParts.join('\n');
  const subject = templateRendered.subject ?? '';
  const canonical = JSON.stringify({
    layout_version_id: manifest.layout_version_id,
    resolved_slots: manifest.resolved_assets.map((r) => ({
      slot: r.slot,
      asset_version_id: r.asset_version_id,
      checksum: r.checksum ?? null,
    })),
    subject,
    html_len: html.length,
    text_len: text.length,
    template_version_id: manifest.template_version_id,
  });
  const checksum = await sha256Hex(canonical);

  return {
    rendered_subject: subject,
    rendered_html: html || `<pre>${escapeHtml(text)}</pre>`,
    rendered_text: text,
    unresolved_tokens: templateRendered.unresolved_tokens ?? [],
    unresolved_required_slots: unresolvedRequired,
    rendered_checksum: checksum,
    resolved_assets: manifest.resolved_assets,
    layout_id: manifest.layout_id,
    layout_version_id: manifest.layout_version_id,
    layout_inheritance_source: manifest.layout_inheritance_source,
  };
}
