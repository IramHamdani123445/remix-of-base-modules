// Event & contract resolution. Deterministic, snapshot-only.
import type { AggregateSnapshot } from "./resolutionTypes.ts";
import { RuntimeResolutionError } from "./runtimeResolutionErrors.ts";

export interface ResolvedEvent {
  eventDefinitionId: string;
  eventContractId: string;
  eventContractVersion: number;
  eventContractChecksum: string;
  jsonSchema: unknown;
}

export function resolveEvent(snap: AggregateSnapshot): ResolvedEvent {
  if (!snap.event) throw new RuntimeResolutionError("event_not_found");
  if (snap.event.status !== "active") {
    throw new RuntimeResolutionError("event_not_active");
  }
  const published = snap.event_contracts.filter((c) => c.status === "published");
  if (published.length === 0) {
    throw new RuntimeResolutionError("event_contract_missing");
  }
  // Highest version wins — but only if unambiguous at the top version.
  const maxVersion = published.reduce((m, c) => Math.max(m, c.version_number), 0);
  const top = published.filter((c) => c.version_number === maxVersion);
  if (top.length !== 1) {
    throw new RuntimeResolutionError("event_contract_ambiguous");
  }
  const c = top[0];
  if (!c.checksum || typeof c.checksum !== "string" || c.checksum.length < 4) {
    throw new RuntimeResolutionError("event_contract_invalid");
  }
  if (!c.json_schema || typeof c.json_schema !== "object") {
    throw new RuntimeResolutionError("event_contract_invalid");
  }
  return {
    eventDefinitionId: snap.event.id,
    eventContractId: c.id,
    eventContractVersion: c.version_number,
    eventContractChecksum: c.checksum,
    jsonSchema: c.json_schema,
  };
}
