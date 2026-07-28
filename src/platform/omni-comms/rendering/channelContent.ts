/**
 * Channel-content validator — mirrors the SQL
 * omni_comms_priv_validate_channel_content function.
 */
import { TemplateChannel, TEMPLATE_CHANNEL_KEYS } from '../application/templateCatalogueTypes';
import { extractTokenPaths } from './tokenParser';

export interface ChannelContentValidationError {
  detail: string;
  key?: string;
}

export function validateChannelContent(
  channel: TemplateChannel,
  content: unknown,
): ChannelContentValidationError | null {
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return { detail: 'content_not_object' };
  }
  const spec = TEMPLATE_CHANNEL_KEYS[channel];
  if (!spec) return { detail: 'channel_unknown' };
  const byteLen = new TextEncoder().encode(JSON.stringify(content)).byteLength;
  if (byteLen > 262144) return { detail: 'content_too_large' };
  const obj = content as Record<string, unknown>;
  const allowed = new Set(spec.allowed);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) return { detail: 'content_unknown_key', key };
    const v = obj[key];
    if (v === null || v === undefined) return { detail: 'content_null_value', key };
    if (typeof v !== 'string') return { detail: 'content_non_string_value', key };
    if (v.trim().length === 0) return { detail: 'content_empty_value', key };
    try {
      extractTokenPaths(v);
    } catch (e) {
      return { detail: (e as Error).message || 'invalid_token_syntax', key };
    }
  }
  for (const req of spec.required) {
    if (!(req in obj)) return { detail: 'content_missing_required_key', key: req };
  }
  if (channel === 'email') {
    const html = (obj.html as string | undefined)?.trim() ?? '';
    const text = (obj.text as string | undefined)?.trim() ?? '';
    if (!html && !text) return { detail: 'content_email_body_required' };
  }
  return null;
}
