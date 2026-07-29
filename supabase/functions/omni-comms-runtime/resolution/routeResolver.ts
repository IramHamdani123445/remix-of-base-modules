// Route resolution: department overrides organization per channel.
// The DB snapshot already applied precedence via ROW_NUMBER but we re-derive
// deterministically here so this resolver is unit-testable on any snapshot
// and safe against snapshot drift.
import type { AggregateSnapshot } from "./resolutionTypes.ts";

export interface WinningRoute {
  id: string;
  channel: string;
  isRequired: boolean;
  priority: number;
  templateFamilyId: string | null;
  senderIdentityId: string | null;
  inheritedFrom: "department" | "organization";
  organizationId: string;
  departmentId: string | null;
  eventDefinitionId: string;
}

export function resolveRoutes(
  snap: AggregateSnapshot,
  organizationId: string,
  departmentId: string | null,
  requestedChannels: string[],
): WinningRoute[] {
  const active = snap.routes.filter(
    (r) =>
      r.is_enabled &&
      r.lifecycle_state === "active" &&
      r.organization_id === organizationId &&
      (r.department_id === null || r.department_id === departmentId),
  );

  const byChannel = new Map<string, typeof active>();
  for (const r of active) {
    if (!byChannel.has(r.channel)) byChannel.set(r.channel, []);
    byChannel.get(r.channel)!.push(r);
  }

  const winners: WinningRoute[] = [];
  for (const [channel, candidates] of byChannel) {
    candidates.sort((a, b) => {
      // Dept precedence
      const aDept = a.department_id === departmentId && a.department_id !== null ? 0 : 1;
      const bDept = b.department_id === departmentId && b.department_id !== null ? 0 : 1;
      if (aDept !== bDept) return aDept - bDept;
      // Priority ASC
      if (a.priority !== b.priority) return a.priority - b.priority;
      // id ASC deterministic
      return a.id < b.id ? -1 : 1;
    });
    const winner = candidates[0];
    winners.push({
      id: winner.id,
      channel,
      isRequired: winner.is_required,
      priority: winner.priority,
      templateFamilyId: winner.template_family_id,
      senderIdentityId: winner.sender_identity_id,
      inheritedFrom:
        winner.department_id === departmentId && winner.department_id !== null
          ? "department"
          : "organization",
      organizationId: winner.organization_id,
      departmentId: winner.department_id,
      eventDefinitionId: winner.event_definition_id,
    });
  }

  if (requestedChannels.length > 0) {
    return winners.filter((w) => requestedChannels.includes(w.channel));
  }
  return winners;
}
