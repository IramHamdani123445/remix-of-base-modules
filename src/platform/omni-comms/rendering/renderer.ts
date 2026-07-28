/**
 * Deterministic, platform-neutral Omni-Comms template renderer.
 *
 * Contract:
 *  • Pure function of (content, payload) — no DB/network, no mutation of
 *    inputs, no reliance on shallow freezing.
 *  • Interpolates only {{path}} tokens (grammar mirrored in SQL).
 *  • Payload values are inserted once and never re-parsed as templates.
 *  • HTML-designated fields escape interpolated values; static template HTML
 *    is preserved verbatim (renderer does NOT sanitise static HTML — Story 3
 *    preview UI must use the repository's approved sanitiser).
 *  • Plain-text fields never HTML-escape.
 *  • UTF-8 byte-length bound: 512 KiB per rendered field (measured via
 *    TextEncoder — never Node's Buffer).
 */
import { TemplateChannel, TEMPLATE_CHANNEL_KEYS } from '../application/templateCatalogueTypes';
import { OmniCommsRenderError } from './rendererErrors';
import { parseTemplateSource } from './tokenParser';

const RENDERED_FIELD_MAX_BYTES = 524288;

export interface RenderedTemplate {
  channel: TemplateChannel;
  fields: Record<string, string>;
}

export interface RenderOptions {
  /** Maximum bytes per rendered field (UTF-8). Default 512 KiB. */
  maxFieldBytes?: number;
}

function htmlEscape(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolvePath(payload: unknown, path: string): unknown {
  const parts = path.split('.');
  let cursor: unknown = payload;
  for (const p of parts) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[p];
  }
  return cursor;
}

function coerceScalar(value: unknown, path: string): string {
  if (value === null || value === undefined) {
    throw new OmniCommsRenderError('missing_template_value', `missing_value:${path}`, path);
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new OmniCommsRenderError('unsupported_number', `unsupported_number:${path}`, path);
    }
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  throw new OmniCommsRenderError('non_scalar_template_value', `non_scalar:${path}`, path);
}

export function renderField(
  source: string,
  payload: Record<string, unknown>,
  htmlEscapeValues: boolean,
  maxBytes: number,
): string {
  const segments = parseTemplateSource(source);
  const parts: string[] = [];
  for (const seg of segments) {
    if (seg.kind === 'literal') {
      parts.push(seg.value);
    } else {
      const raw = resolvePath(payload, seg.path);
      const scalar = coerceScalar(raw, seg.path);
      parts.push(htmlEscapeValues ? htmlEscape(scalar) : scalar);
    }
  }
  const out = parts.join('');
  const bytes = new TextEncoder().encode(out).byteLength;
  if (bytes > maxBytes) {
    throw new OmniCommsRenderError('rendered_output_too_large', `output_too_large:${bytes}`);
  }
  return out;
}

export function renderTemplate(
  channel: TemplateChannel,
  content: Record<string, string>,
  payload: Record<string, unknown>,
  options: RenderOptions = {},
): RenderedTemplate {
  const spec = TEMPLATE_CHANNEL_KEYS[channel];
  if (!spec) {
    throw new OmniCommsRenderError('invalid_token_syntax', `channel_unknown:${channel}`);
  }
  const maxBytes = options.maxFieldBytes ?? RENDERED_FIELD_MAX_BYTES;
  const htmlKeys = new Set(spec.html);
  const fields: Record<string, string> = {};
  for (const key of Object.keys(content)) {
    const src = content[key];
    fields[key] = renderField(src, payload, htmlKeys.has(key), maxBytes);
  }
  return { channel, fields };
}
