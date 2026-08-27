/**
 * INTERNAL AUDIT → OMNI-COMMS manual/operator-initiated communication facade
 * (Wave 4 closure, DEF-2A).
 *
 * Operator-initiated Internal Audit communications (communication stage
 * dialogs, document-request emails, ad-hoc notification triggers) used to call
 * the legacy notification edge function or RPC directly. That bypassed every
 * Omni-Comms governance control: template resolution, branding, sender
 * identity, release control, delivery evidence and retry.
 *
 * This module is the ONLY bridge those surfaces may use. It maps the operator
 * concept (an audit "communication stage") onto a catalogued Omni-Comms event
 * and then delegates to the single Internal Audit producer. It never chooses a
 * channel, template, sender or provider, and it never throws.
 */
import {
  emitInternalAuditCommunication,
  type InternalAuditCommunicationInput,
} from './internalAuditCommunicationProducer';
import type { ConfiguredBusinessEventResult } from '../emitConfiguredBusinessEvent';

/** Operator communication-stage code → catalogued Omni-Comms event code. */
export const IA_STAGE_EVENT_MAP: Record<string, string> = {
  PLAN_INTIMATION: 'INTERNAL_AUDIT.ENGAGEMENT.INTIMATION_ISSUED',
  TEAM_AND_SCOPE_NOTICE: 'INTERNAL_AUDIT.ENGAGEMENT.LAUNCHED',
  DOC_REQUEST: 'INTERNAL_AUDIT.REQUEST.ISSUED',
  ENTRANCE_MEETING: 'INTERNAL_AUDIT.ENGAGEMENT.ENTRANCE_MEETING',
  QUERY_CYCLE: 'INTERNAL_AUDIT.REQUEST.ISSUED',
  DRAFT_FINDING_DISCUSSION: 'INTERNAL_AUDIT.REPORT.DRAFT_CIRCULATED',
  EXIT_MEETING: 'INTERNAL_AUDIT.ENGAGEMENT.EXIT_MEETING',
  FINAL_REPORT_ISSUE: 'INTERNAL_AUDIT.REPORT.ISSUED',
  ACTION_PLAN_REMINDER: 'INTERNAL_AUDIT.ACTION.DUE_SOON',
};

/** Reminder-mode overrides, where the catalogue has a dedicated event. */
const IA_STAGE_REMINDER_EVENT_MAP: Record<string, string> = {
  DOC_REQUEST: 'INTERNAL_AUDIT.REQUEST.REMINDER',
  QUERY_CYCLE: 'INTERNAL_AUDIT.REQUEST.REMINDER',
};

export type IaStageMode = 'initial' | 'reminder' | 'reissue';

export function resolveInternalAuditStageEvent(
  stageCode: string,
  mode: IaStageMode = 'initial',
): string | null {
  const code = String(stageCode ?? '').trim().toUpperCase();
  if (mode === 'reminder' && IA_STAGE_REMINDER_EVENT_MAP[code]) {
    return IA_STAGE_REMINDER_EVENT_MAP[code];
  }
  return IA_STAGE_EVENT_MAP[code] ?? null;
}

export interface InternalAuditStageCommunicationInput
  extends Omit<InternalAuditCommunicationInput, 'eventCode'> {
  stageCode: string;
  mode?: IaStageMode;
}

/**
 * Raise an operator-initiated Internal Audit communication obligation.
 *
 * `mode` only influences which catalogued event is chosen and the occurrence
 * key (so a reminder or a reissue is a distinct, non-deduplicated obligation).
 */
export async function emitInternalAuditStageCommunication(
  input: InternalAuditStageCommunicationInput,
): Promise<ConfiguredBusinessEventResult> {
  const mode = input.mode ?? 'initial';
  const eventCode = resolveInternalAuditStageEvent(input.stageCode, mode);

  if (!eventCode) {
    return {
      outcome: 'blocked',
      blockers: ['internal_audit_stage_not_mapped'],
      requestId: null,
      idempotencyKey: null,
      mode: 'queued',
      eventCode: String(input.stageCode ?? ''),
      organizationId: null,
      departmentId: null,
      departmentSource: 'none',
      skippedReason: null,
    };
  }

  const occurrence =
    input.occurrence?.trim() ||
    (mode === 'initial'
      ? `${input.stageCode}`.toLowerCase()
      : `${input.stageCode}`.toLowerCase() + ':' + mode + ':' + new Date().toISOString().slice(0, 10));

  const { stageCode: _stageCode, mode: _mode, ...rest } = input;
  return emitInternalAuditCommunication({ ...rest, eventCode, occurrence });
}
