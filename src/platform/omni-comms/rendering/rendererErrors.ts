/**
 * Pure renderer error model. Distinct from Template Catalogue RPC errors —
 * these are TypeScript errors surfaced by the deterministic renderer and must
 * never be conflated with database errors.
 */
export const OMNI_COMMS_RENDER_ERROR_CODES = [
  'missing_template_value',
  'non_scalar_template_value',
  'rendered_output_too_large',
  'invalid_token_syntax',
  'unsupported_number',
] as const;

export type OmniCommsRenderErrorCode = (typeof OMNI_COMMS_RENDER_ERROR_CODES)[number];

export class OmniCommsRenderError extends Error {
  readonly code: OmniCommsRenderErrorCode;
  readonly path?: string;
  constructor(code: OmniCommsRenderErrorCode, message: string, path?: string) {
    super(message);
    this.name = 'OmniCommsRenderError';
    this.code = code;
    this.path = path;
  }
}
