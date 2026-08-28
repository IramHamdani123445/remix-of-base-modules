// DEF-14 — certification simulation adapters.
//
// A simulation adapter is an INTERNAL delivery path. It contacts no external
// provider, resolves no credential, and transmits nothing outside the
// platform. It exists so a controlled pilot can be certified end to end
// without live sending credentials, and it is only ever selected when the
// database claim resolved a provider whose capability row is marked
// `certification_safe` and `requires_external_credentials = false`.

export const SIMULATION_ADAPTERS: ReadonlySet<string> = new Set([
  "simulation_email",
  "simulation_sms",
  "simulation_inapp",
]);

export function isSimulationAdapter(adapterCode: unknown): boolean {
  return typeof adapterCode === "string" && SIMULATION_ADAPTERS.has(adapterCode);
}

export interface SimulatedOutcome {
  status: "accepted";
  resultCode: "simulated_accepted";
  providerMessageId: string;
  providerStatusCode: number | null;
  providerResponse: Record<string, unknown>;
  errorCode: null;
  errorDetail: null;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Record a deterministic accepted outcome WITHOUT contacting any provider.
 *
 * The simulated provider message id is derived from the deterministic
 * idempotency key, so a safe retry of the same message reproduces exactly the
 * same identifier instead of inventing a second delivery identity.
 */
export async function simulateDelivery(input: {
  adapterCode: string;
  channel: string;
  idempotencyKey: string;
}): Promise<SimulatedOutcome> {
  const fingerprint = await sha256Hex(`${input.adapterCode}:${input.idempotencyKey}`);
  return {
    status: "accepted",
    resultCode: "simulated_accepted",
    providerMessageId: `sim_${fingerprint.slice(0, 24)}`,
    providerStatusCode: null,
    providerResponse: {
      channel: input.channel,
      adapter: input.adapterCode,
      simulated: true,
      provider_contacted: false,
    },
    errorCode: null,
    errorDetail: null,
  };
}
