/**
 * Omni-Comms — read-only module enablement truth.
 *
 * Projects the authorised producer/event bindings into ONE plain statement per
 * business module, so an administrator can never be surprised by which module
 * may actually produce a business Email.
 *
 * Pure projection. Reads nothing, writes nothing, sends nothing.
 */
import type { ProducerEventBinding } from '@/platform/omni-comms/application/producerIntegrationsTypes';

export interface ModuleEnablementRow {
  moduleCode: string;
  eventCode: string;
  status: string;
  modes: string;
  /** Only an ACTIVE binding that permits `queued` can produce a real send. */
  canSendBusinessEmail: boolean;
  statement: string;
}

/** Modules that are known to the platform even before a binding exists. */
export const KNOWN_BUSINESS_MODULES = [
  'BENEFITS',
  'EMPLOYER_REGISTRATION',
  'COMPLIANCE',
  'LEGAL',
  'FINANCE',
  'INSURED_PERSON',
] as const;

export function buildModuleEnablementMatrix(
  bindings: ProducerEventBinding[],
): ModuleEnablementRow[] {
  const rows: ModuleEnablementRow[] = [];

  for (const b of bindings) {
    if (b.status === 'retired') continue;
    const modes = (b.allowed_modes ?? []).map((m) => String(m).toLowerCase());
    const canSend = b.status === 'active' && modes.includes('queued');
    rows.push({
      moduleCode: b.caller_module_code,
      eventCode: b.event_code,
      status: b.status,
      modes: modes.length ? modes.join(', ') : 'none',
      canSendBusinessEmail: canSend,
      statement: canSend
        ? 'Authorised to produce a controlled business Email'
        : b.status !== 'active'
          ? `Not authorised — binding is ${b.status}`
          : `Non-sending only — ${modes.join(', ') || 'no mode'}`,
    });
  }

  const seen = new Set(rows.map((r) => r.moduleCode));
  for (const moduleCode of KNOWN_BUSINESS_MODULES) {
    if (seen.has(moduleCode)) continue;
    rows.push({
      moduleCode,
      eventCode: '—',
      status: 'not_integrated',
      modes: 'none',
      canSendBusinessEmail: false,
      statement:
        'Not integrated — add an active producer binding on Producer Integrations '
        + 'to let this module produce Omni-Comms messages',
    });
  }

  return rows.sort((a, b) =>
    Number(b.canSendBusinessEmail) - Number(a.canSendBusinessEmail)
    || a.moduleCode.localeCompare(b.moduleCode));
}

/** The first production proof authorises exactly one sending module. */
export function sendingModules(rows: ModuleEnablementRow[]): string[] {
  return rows.filter((r) => r.canSendBusinessEmail).map((r) => r.moduleCode);
}
