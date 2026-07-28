/**
 * Deterministic {{token}} parser. Produces a list of segments used by the
 * renderer. Rejects the same malformed inputs as the SQL validator.
 */
import {
  DISALLOWED_TOKEN_BODY_PATTERN,
  TOKEN_PATH_PATTERN,
} from './tokenGrammar';
import { OmniCommsRenderError } from './rendererErrors';

export type TemplateSegment =
  | { kind: 'literal'; value: string }
  | { kind: 'token'; path: string };

export function parseTemplateSource(source: string): TemplateSegment[] {
  if (typeof source !== 'string') {
    throw new OmniCommsRenderError('invalid_token_syntax', 'source_must_be_string');
  }
  const segments: TemplateSegment[] = [];
  const len = source.length;
  let i = 0;
  let literalStart = 0;
  while (i < len) {
    const ch = source[i];
    if (ch === '{') {
      if (i + 1 >= len || source[i + 1] !== '{') {
        throw new OmniCommsRenderError('invalid_token_syntax', 'template_token_unmatched_open');
      }
      if (i + 2 < len && source[i + 2] === '{') {
        throw new OmniCommsRenderError('invalid_token_syntax', 'template_token_triple_brace');
      }
      // find the matching }}
      const bodyStart = i + 2;
      const closeIndex = source.indexOf('}}', bodyStart);
      if (closeIndex === -1) {
        throw new OmniCommsRenderError('invalid_token_syntax', 'template_token_unmatched_open');
      }
      const rawBody = source.slice(bodyStart, closeIndex);
      if (DISALLOWED_TOKEN_BODY_PATTERN.test(rawBody)) {
        throw new OmniCommsRenderError('invalid_token_syntax', 'template_token_disallowed_syntax');
      }
      const body = rawBody.trim();
      if (body.length === 0) {
        throw new OmniCommsRenderError('invalid_token_syntax', 'template_token_empty');
      }
      if (!TOKEN_PATH_PATTERN.test(body)) {
        throw new OmniCommsRenderError('invalid_token_syntax', 'template_token_path_invalid');
      }
      if (i > literalStart) segments.push({ kind: 'literal', value: source.slice(literalStart, i) });
      segments.push({ kind: 'token', path: body });
      i = closeIndex + 2;
      literalStart = i;
    } else if (ch === '}') {
      if (i + 1 < len && source[i + 1] === '}') {
        throw new OmniCommsRenderError('invalid_token_syntax', 'template_token_unmatched_close');
      }
      i += 1;
    } else {
      i += 1;
    }
  }
  if (literalStart < len) segments.push({ kind: 'literal', value: source.slice(literalStart) });
  return segments;
}

export function extractTokenPaths(source: string): string[] {
  const seen = new Set<string>();
  for (const seg of parseTemplateSource(source)) {
    if (seg.kind === 'token') seen.add(seg.path);
  }
  return [...seen];
}
