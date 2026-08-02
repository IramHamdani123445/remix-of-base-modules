// Omni-Comms — shared Svix signature verification (server-only).
//
// Used by the Resend callback receiver for BOTH C5B channel-test evidence and
// C7 business delivery callbacks. The signing secret is read by the caller
// from Edge Function Secrets and is never logged or returned.

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/** Svix: HMAC-SHA256(secret, `${id}.${ts}.${body}`), base64, header "v1,<sig>". */
export async function verifySvixSignature(
  secret: string,
  svixId: string,
  svixTs: string,
  svixSig: string,
  rawBody: string,
): Promise<boolean> {
  if (!secret || !svixId || !svixTs || !svixSig) return false;
  const secretB64 = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  let keyBytes: Uint8Array;
  try {
    keyBytes = b64ToBytes(secretB64);
  } catch {
    return false;
  }
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, enc.encode(`${svixId}.${svixTs}.${rawBody}`)),
  );
  const expected = bytesToB64(sig);
  const tsNum = Number(svixTs);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) return false;
  for (const part of svixSig.split(" ")) {
    const [ver, val] = part.split(",");
    if (ver === "v1" && val && timingSafeEqual(val, expected)) return true;
  }
  return false;
}
