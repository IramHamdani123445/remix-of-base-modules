import {
  getActionReadySession,
  type ActionReadySessionEvidence,
} from './authSession';

export interface OperatorIdentityProbe {
  allowed: boolean;
  actor_id: string | null;
  actor_source: string | null;
  resolved_role: string | null;
  role_source: string | null;
  claims_present: boolean;
  token_expires_at: string | null;
  token_remaining_seconds: number | null;
}

export interface OperatorAuthDiagnostic {
  stage: 'AUTH_SERVER' | 'POSTGREST_OPERATOR_PROBE' | 'REFRESH';
  session: ActionReadySessionEvidence;
  probe: OperatorIdentityProbe;
  actorMatch: boolean;
}

export async function refreshAndProbeOperator(): Promise<OperatorAuthDiagnostic> {
  const ready = await getActionReadySession({ minValiditySeconds: 300, forceRefresh: true });
  const backendUrl = import.meta.env.VITE_SUPABASE_URL;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const response = await fetch(`${backendUrl}/rest/v1/rpc/probe_comm_hub_operator_identity`, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${ready.session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`OPERATOR_JWT_NOT_PROPAGATED_TO_POSTGREST: HTTP ${response.status}`);
  }
  const probe = data as OperatorIdentityProbe;
  if (!probe?.allowed || !probe.actor_id) {
    throw new Error('OPERATOR_JWT_NOT_PROPAGATED_TO_POSTGREST');
  }
  if (probe.actor_id !== ready.evidence.userId) {
    throw new Error('OPERATOR_IDENTITY_MISMATCH');
  }
  return {
    stage: 'REFRESH',
    session: ready.evidence,
    probe,
    actorMatch: true,
  };
}