/**
 * BN Life Certificates — read boundary.
 *
 * All reads go through secured query RPCs (`*_worklist_v1`, `*_detail_v1`,
 * `*_timeline_v1`). No direct `bn_life_certificate` table selects, no direct
 * `core_audit_log` reads, capped page sizes and masked confidential evidence.
 */
import { supabase } from '@/integrations/supabase/client';
import { describeLifeCertificateFailure, LifeCertificateCommandError } from './lifeCertificateCommandService';

const rpc = (name: string, args: Record<string, unknown>) =>
  (supabase as unknown as {
    rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  }).rpc(name, args);

export type LifeCertificateBucket =
  | 'ALL'
  | 'DUE'
  | 'GRACE'
  | 'OVERDUE'
  | 'AWAITING_REVIEW'
  | 'REJECTED'
  | 'VERIFIED'
  | 'WAIVED_DEFERRED'
  | 'SUSPENSIONS'
  | 'REINSTATEMENTS';

export const LIFE_CERTIFICATE_BUCKETS: { key: LifeCertificateBucket; label: string }[] = [
  { key: 'ALL', label: 'All obligations' },
  { key: 'DUE', label: 'Due' },
  { key: 'GRACE', label: 'In grace period' },
  { key: 'OVERDUE', label: 'Overdue' },
  { key: 'AWAITING_REVIEW', label: 'Received — awaiting review' },
  { key: 'REJECTED', label: 'Rejected / resubmission' },
  { key: 'VERIFIED', label: 'Verified' },
  { key: 'WAIVED_DEFERRED', label: 'Waived / deferred' },
  { key: 'SUSPENSIONS', label: 'Suspensions initiated' },
  { key: 'REINSTATEMENTS', label: 'Reinstatements initiated' },
];

export interface LifeCertificateWorklistRow {
  id: string;
  bn_award_id: string;
  award_number: string | null;
  ssn: string;
  benefit_code: string | null;
  award_status: string;
  obligation_period: string | null;
  due_date: string | null;
  grace_end_date: string | null;
  escalation_date: string | null;
  obligation_status: string;
  evidence_status: string;
  verification_status: string;
  escalation_status: string;
  communication_status: string;
  reminder_count: number;
  suspension_event_id: string | null;
  reinstatement_event_id: string | null;
  row_version: number;
}

export interface LifeCertificateWorklist {
  rows: LifeCertificateWorklistRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface LifeCertificateEvidence {
  masked: boolean;
  document_id?: string | null;
  document_name?: string | null;
  evidence_type?: string | null;
  evidence_version?: number | null;
  checksum?: string | null;
  issuing_authority?: string | null;
  certificate_date?: string | null;
}

export interface LifeCertificateDetail {
  obligation: Record<string, unknown> & {
    id: string;
    obligation_status: string;
    evidence_status: string;
    verification_status: string;
    escalation_status: string;
    communication_status: string;
    row_version: number;
    evidence: LifeCertificateEvidence | null;
  };
  award: {
    id: string;
    award_number: string | null;
    ssn: string;
    benefit_code: string | null;
    status: string;
    start_date: string;
  };
  suspension: { id: string; status: string; execution_status: string; suspended_from: string; reason_code: string | null } | null;
  reinstatement: { id: string; status: string; execution_status: string; suspended_from: string; reason_code: string | null } | null;
}

export interface LifeCertificateTimelineEvent {
  id: string;
  event_type: string;
  from_state: string | null;
  to_state: string | null;
  actor_user_code: string | null;
  reason_code: string | null;
  narrative: string | null;
  correlation_id: string | null;
  created_at: string;
}

export interface LifeCertificateCommunication {
  id: string;
  event_code: string;
  delivery_status: string;
  attempts: number;
  last_error_code: string | null;
  created_at: string;
}

export interface LifeCertificateTimeline {
  events: LifeCertificateTimelineEvent[];
  communications: LifeCertificateCommunication[];
}

async function query<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(name, args);
  if (error) {
    const message = error.message ?? '';
    const code = message.includes('E_FORBIDDEN')
      ? 'E_FORBIDDEN'
      : message.includes('E_UNAUTHENTICATED')
        ? 'E_UNAUTHENTICATED'
        : message.includes('E_OBLIGATION_NOT_FOUND')
          ? 'E_OBLIGATION_NOT_FOUND'
          : 'E_UNKNOWN';
    throw new LifeCertificateCommandError(code, describeLifeCertificateFailure(code));
  }
  return data as T;
}

export function fetchWorklist(input: {
  bucket: LifeCertificateBucket;
  search?: string | null;
  limit?: number;
  offset?: number;
}): Promise<LifeCertificateWorklist> {
  return query('bn_life_certificate_worklist_v1', {
    p_bucket: input.bucket,
    p_search: input.search ?? null,
    p_limit: Math.min(input.limit ?? 50, 200),
    p_offset: input.offset ?? 0,
  });
}

export function fetchDetail(lifeCertificateId: string): Promise<LifeCertificateDetail> {
  return query('bn_life_certificate_detail_v1', { p_life_certificate_id: lifeCertificateId });
}

export function fetchTimeline(lifeCertificateId: string, limit = 100): Promise<LifeCertificateTimeline> {
  return query('bn_life_certificate_timeline_v1', {
    p_life_certificate_id: lifeCertificateId,
    p_limit: limit,
  });
}
