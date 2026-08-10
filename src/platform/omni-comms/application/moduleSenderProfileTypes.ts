/**
 * Omni-Comms — Module → Sender Profile assignment model.
 *
 * Configuration layer answering: "for module X on channel Y, which sender
 * profiles are authorised, and which is the default?"
 *
 * Boundaries (permanent):
 *   - Configuration only. Nothing here sends, enqueues, dispatches, binds a
 *     provider, or rewrites a persisted event route.
 *   - Runtime delivery stays deterministic: an event route keeps its own
 *     persisted sender_identity_id. Module assignments govern configuration,
 *     validation and route authorisation — never send-time substitution.
 */

export type ModuleSenderProfileStatus = 'draft' | 'active' | 'disabled' | 'retired';
export type ModuleSenderProfileRole = 'default' | 'transactional' | 'legal' | 'service';
export type ModuleSenderProfileOrigin = 'system_seed' | 'user';

export const MODULE_SENDER_PROFILE_ROLES: ModuleSenderProfileRole[] = [
  'default',
  'transactional',
  'legal',
  'service',
];

export interface ModuleSenderAssignment {
  id: string;
  organization_id: string;
  department_id: string | null;
  department_name: string | null;
  caller_module_code: string;
  channel: string;
  sender_identity_id: string;
  sender_code: string;
  sender_display_name: string | null;
  sender_status: string;
  from_address: string | null;
  domain_name: string | null;
  domain_ready: boolean;
  provider_account_code: string | null;
  provider_account_name: string | null;
  provider_account_status: string | null;
  profile_role: ModuleSenderProfileRole;
  communication_class: string | null;
  is_default: boolean;
  allow_event_override: boolean;
  allow_organization_fallback: boolean;
  status: ModuleSenderProfileStatus;
  data_origin: ModuleSenderProfileOrigin;
  created_at: string;
  updated_at: string;
  activated_at: string | null;
}

export interface ModuleSenderCoverageRow {
  module_code: string;
  permission_module: string | null;
  module_active: boolean;
  notes: string | null;
  assignments: ModuleSenderAssignment[];
  routes_total: number;
  routes_using_default: number;
  routes_with_override: number;
}

export interface AssignableSenderOption {
  id: string;
  code: string;
  display_name: string | null;
  status: string;
  department_id: string | null;
  from_address: string | null;
  domain_ready: boolean;
}

export interface ModuleSenderProfileSummary {
  organization_id: string;
  channel: string;
  can_manage: boolean;
  modules: ModuleSenderCoverageRow[];
  assignable_senders: AssignableSenderOption[];
  generated_at: string;
}

export interface ModuleSenderImpact {
  id?: string;
  active_routes: number;
  draft_routes: number;
  total_routes: number;
  messages: number;
  can_hard_delete: boolean;
}

export interface ModuleSenderResolution {
  module_code: string;
  channel: string;
  persisted_route_sender_identity_id: string | null;
  /** Configuration precedence outcome. */
  source: 'persisted_route' | 'module_default' | 'blocked';
  sender_identity_id: string | null;
  module_default_sender_identity_id: string | null;
  allow_event_override: boolean;
  allow_organization_fallback: boolean;
  organisation_fallback_sender_identity_id: string | null;
  allowed_senders: Array<{
    sender_identity_id: string;
    sender_code: string;
    sender_display_name: string | null;
    is_default: boolean;
    profile_role: ModuleSenderProfileRole;
    allow_event_override: boolean;
  }>;
  generated_at: string;
}

export interface ModuleSenderBootstrapEntry {
  caller_module_code: string;
  /** Multi-role catalogue: a module may hold several role-scoped profiles. */
  profile_role: ModuleSenderProfileRole;
  is_default: boolean;
  sender_code: string | null;
  status: 'created' | 'will_create' | 'existing' | 'blocked' | 'not_required';
  detail: string | null;
  assignment_id: string | null;
  sender_identity_id: string | null;
  department_id: string | null;
}

export interface ModuleSenderBootstrapResult {
  organization_id: string;
  channel: string;
  applied: boolean;
  created: number;
  existing: number;
  blocked: number;
  /** Technical callers that legitimately need no business sender. */
  not_required: number;
  plan: ModuleSenderBootstrapEntry[];
  generated_at: string;
}


/** Coverage label for the module dashboard. */
export type ModuleCoverageStatus =
  | 'CONFIGURED'
  | 'DEFAULT NOT ACTIVE'
  | 'NO DEFAULT SENDER'
  | 'MODULE INACTIVE';

export function moduleDefaultAssignment(
  row: ModuleSenderCoverageRow,
  role: ModuleSenderProfileRole = 'default',
): ModuleSenderAssignment | null {
  return (
    row.assignments.find(
      (a) => a.is_default && a.profile_role === role && a.status === 'active',
    ) ??
    row.assignments.find((a) => a.is_default && a.profile_role === role) ??
    null
  );
}

export function moduleCoverageStatus(row: ModuleSenderCoverageRow): ModuleCoverageStatus {
  if (!row.module_active) return 'MODULE INACTIVE';
  const def = moduleDefaultAssignment(row);
  if (!def) return 'NO DEFAULT SENDER';
  return def.status === 'active' ? 'CONFIGURED' : 'DEFAULT NOT ACTIVE';
}

/**
 * Module Email profile readiness. Deliberately narrower than event-route
 * readiness and provider-delivery readiness: a ready module profile never
 * implies that an event can be delivered.
 */
export function moduleProfileReadiness(row: ModuleSenderCoverageRow): {
  ready: boolean;
  label: 'MODULE EMAIL PROFILE READY' | 'NOT READY';
  blocker: string | null;
} {
  if (!row.module_active) {
    return { ready: false, label: 'NOT READY', blocker: 'Caller module is not active' };
  }
  const def = moduleDefaultAssignment(row);
  if (!def) {
    return { ready: false, label: 'NOT READY', blocker: 'No default sender assigned' };
  }
  if (def.status !== 'active') {
    return { ready: false, label: 'NOT READY', blocker: 'Default assignment is not active' };
  }
  if (def.sender_status !== 'active') {
    return { ready: false, label: 'NOT READY', blocker: 'Sender address is not active' };
  }
  if (!def.domain_ready) {
    return { ready: false, label: 'NOT READY', blocker: 'Sending domain is not ready' };
  }
  if (!def.provider_account_code || def.provider_account_status !== 'active') {
    return { ready: false, label: 'NOT READY', blocker: 'Provider account is not ready' };
  }
  return { ready: true, label: 'MODULE EMAIL PROFILE READY', blocker: null };
}

/** Senders an operator may pick for a module: same org, same channel, usable. */
export function selectableSendersForModule(
  summary: ModuleSenderProfileSummary,
  row: ModuleSenderCoverageRow,
): AssignableSenderOption[] {
  const taken = new Set(
    row.assignments.filter((a) => a.status !== 'retired').map((a) => a.sender_identity_id),
  );
  return summary.assignable_senders.filter(
    (s) => s.status !== 'retired' && !taken.has(s.id),
  );
}

export function senderOptionLabel(s: AssignableSenderOption): string {
  const name = s.display_name?.trim() || s.code;
  return s.from_address ? `${name} — ${s.from_address}` : name;
}

export function assignmentLabel(a: ModuleSenderAssignment): string {
  return a.sender_display_name?.trim() || a.sender_code;
}
