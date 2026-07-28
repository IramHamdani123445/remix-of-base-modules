/**
 * Token grammar — mirrored exactly by the SQL validator
 * (omni_comms_priv_extract_tokens).
 *
 * Rules:
 *   • Only {{path}} interpolation is allowed.
 *   • Path is dotted identifier segments: [A-Za-z_][A-Za-z0-9_]*
 *   • No sections (#/^), no partials (>), no helpers, no comments (!), no
 *     triple braces, no nested braces, no array indexes.
 *   • Unmatched braces are rejected on either side.
 */
export const TOKEN_PATH_PATTERN =
  /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

export const DISALLOWED_TOKEN_BODY_PATTERN = /[{}#/^!>@=]/;
