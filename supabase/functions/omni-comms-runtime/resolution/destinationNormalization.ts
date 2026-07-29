// Pure destination normalization. Deno-safe; no Intl beyond basic tokens.

export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return null;
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1).toLowerCase();
  if (!/^[A-Za-z0-9._%+\-]+$/.test(local)) return null;
  if (!/^[a-z0-9.\-]+\.[a-z]{2,}$/.test(domain)) return null;
  return `${local}@${domain}`;
}

export function normalizePhone(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  // Preserve E.164-style leading + if present, strip other formatting.
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return hasPlus ? `+${digits}` : digits;
}

export function normalizePush(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 512) return null;
  return trimmed;
}

export function normalizeLocale(input: unknown): {
  normalized: string;
  fallbacks: string[];
} {
  const DEFAULT = "en";
  if (typeof input !== "string" || input.trim().length === 0) {
    return { normalized: DEFAULT, fallbacks: [DEFAULT] };
  }
  const raw = input.trim().replace(/_/g, "-");
  const parts = raw.split("-");
  const lang = (parts[0] ?? "").toLowerCase();
  const region = (parts[1] ?? "").toUpperCase();
  if (!/^[a-z]{2,3}$/.test(lang)) {
    return { normalized: DEFAULT, fallbacks: [DEFAULT] };
  }
  if (region && !/^[A-Z]{2}$/.test(region)) {
    // treat as language-only
    return { normalized: lang, fallbacks: [lang, DEFAULT].filter(dedupePreserve()) };
  }
  const normalized = region ? `${lang}-${region}` : lang;
  const fallbacks = [normalized];
  if (region) fallbacks.push(lang);
  if (!fallbacks.includes(DEFAULT)) fallbacks.push(DEFAULT);
  return { normalized, fallbacks };
}

function dedupePreserve() {
  const seen = new Set<string>();
  return (v: string) => {
    if (seen.has(v)) return false;
    seen.add(v);
    return true;
  };
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
