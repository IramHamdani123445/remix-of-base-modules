// Recipient normalization + deterministic fingerprint + dedupe.
import type { NormalizedRecipient, RecipientInput } from "./resolutionTypes.ts";
import {
  normalizeEmail,
  normalizeLocale,
  normalizePhone,
  sha256Hex,
} from "./destinationNormalization.ts";

export async function normalizeRecipients(
  inputs: RecipientInput[],
): Promise<NormalizedRecipient[]> {
  const results: NormalizedRecipient[] = [];
  const seen = new Map<string, number>(); // fingerprint -> index in results

  for (let i = 0; i < inputs.length; i++) {
    const inp = inputs[i] ?? {};
    const blockers: string[] = [];
    const email = normalizeEmail(inp.destinations?.email);
    const phone = normalizePhone(inp.destinations?.phone);
    const locale = normalizeLocale(inp.locale);

    if (
      inp.destinations?.email !== undefined && inp.destinations.email !== null &&
      email === null && String(inp.destinations.email).trim() !== ""
    ) {
      blockers.push("recipient_destination_invalid");
    }
    if (
      inp.destinations?.phone !== undefined && inp.destinations.phone !== null &&
      phone === null && String(inp.destinations.phone).trim() !== ""
    ) {
      blockers.push("recipient_destination_invalid");
    }

    // Physical postal destination for Print / Correspondence. It is carried
    // verbatim (already canonicalised upstream) and never normalised as a
    // digital destination.
    const print = typeof inp.destinations?.print === "string" &&
        inp.destinations.print.trim() !== ""
      ? inp.destinations.print.trim()
      : null;

    // No `push` key: a device token is never a business-supplied recipient
    // destination. Push resolves through governed registrations instead.
    const normalizedDestinations: Record<string, string | null> = {
      email,
      phone,
      print,
    };

    const fp = await sha256Hex(
      JSON.stringify([
        inp.recipientType ?? "person",
        inp.recipientReference ?? null,
        locale.normalized,
        normalizedDestinations,
      ]),
    );

    if (seen.has(fp)) continue; // dedupe — preserve first occurrence order.
    seen.set(fp, results.length);

    results.push({
      inputIndex: i,
      fingerprint: fp,
      recipientType: (inp.recipientType ?? "person") as string,
      recipientReference: inp.recipientReference ?? null,
      displayName: inp.displayName ?? null,
      normalizedLocale: locale.normalized,
      localeFallbackCandidates: locale.fallbacks,
      normalizedDestinations,
      blockers,
    });
  }
  return results;
}
