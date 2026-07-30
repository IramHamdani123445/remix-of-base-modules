// Omni-Comms Runtime — Slice 2c-iii token resolution.
//
// Grammar (deterministic, no evaluation, no regex backtracking hazards):
//   {{path.to.value}}   → REQUIRED token. Unresolved ⇒ blocks the message.
//   {{path.to.value?}}  → OPTIONAL token. Unresolved ⇒ recorded, renders "".
//
// Paths address the validated request payload plus a bounded context
// namespace (recipient.*, sender.*). Nothing else is reachable. Values are
// never re-parsed and objects/arrays never interpolate.

const TOKEN_RE = /\{\{\s*([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)(\?)?\s*\}\}/g;

export interface TokenContext {
  payload: Record<string, unknown>;
  recipient: Record<string, unknown>;
  sender: Record<string, unknown>;
}

export interface TokenResolutionResult {
  output: string;
  unresolvedRequired: string[];
  unresolvedOptional: string[];
}

function lookup(context: TokenContext, path: string): unknown {
  const parts = path.split(".");
  const head = parts[0];
  let cursor: unknown;
  if (head === "recipient") cursor = context.recipient;
  else if (head === "sender") cursor = context.sender;
  else if (head === "payload") cursor = context.payload;
  else return undefined;

  for (const part of parts.slice(1)) {
    if (cursor === null || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function scalarToString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return null;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Resolve every token in `source`. `htmlEscape` applies only to HTML fields. */
export function resolveTokens(
  source: string,
  context: TokenContext,
  htmlEscape: boolean,
): TokenResolutionResult {
  const unresolvedRequired = new Set<string>();
  const unresolvedOptional = new Set<string>();

  TOKEN_RE.lastIndex = 0;
  const output = source.replace(TOKEN_RE, (_full, path: string, optional?: string) => {
    const raw = scalarToString(lookup(context, path));
    if (raw === null) {
      if (optional === "?") unresolvedOptional.add(path);
      else unresolvedRequired.add(path);
      return "";
    }
    return htmlEscape ? escapeHtml(raw) : raw;
  });

  return {
    output,
    unresolvedRequired: [...unresolvedRequired].sort(),
    unresolvedOptional: [...unresolvedOptional].sort(),
  };
}
