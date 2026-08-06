/**
 * BN Mortality — Server-authorised Command Executor (BN-MORT-2B.1).
 *
 * Enforcement chain, in order, all server-side:
 *   1. Envelope structural validation (JSON, UUIDs, ISO-8601 dates,
 *      commandVersion, allowed age, actorUserCode).
 *   2. Bearer JWT validation via getClaims(); actorUserId is the token sub.
 *   3. Command registration + capability + maker-checker matrix lookup.
 *   4. Server-side permission walk via bn_mortality_check_actor_permission,
 *      which requires:
 *        - app_modules.is_enabled = true
 *        - app_modules.routes_enabled = true
 *        - app_modules.actions_enabled = true (for MUTATION commands only)
 *        - module_actions.is_enabled = true for the specific action
 *        - role_permissions.is_granted = true for at least one of the actor's roles
 *      Admin does NOT bypass actions_enabled=false.
 *   5. Justification enforcement when required by the command spec.
 *   6. Command-specific payload contract validation.
 *   7. Idempotency reservation via INSERT … ON CONFLICT DO NOTHING with
 *      the tuple (idempotency_key, command_name). Distinguishes three
 *      cases atomically:
 *        - Row inserted (PENDING) → proceed to execute.
 *        - Row exists, COMPLETED, same payload hash → REPLAYED.
 *        - Row exists, COMPLETED, different payload hash → IDEMPOTENCY_PAYLOAD_MISMATCH.
 *        - Row exists, PENDING → CONFLICT (concurrent execution in progress).
 *   8. Maker-checker: resolve the canonical maker for the checker command
 *      from bn_mortality_command_maker (fallback: matching history entry).
 *      Never compare against "most recent history actor" blindly.
 *   9. Transactional execution via bn_mortality_execute_command RPC.
 *  10. Idempotency row promoted to COMPLETED with result JSON + audit id.
 *  11. Audit row into bn_module_events.
 */
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  COMMAND_MATRIX,
  CHECKER_MAKER_ROLES,
  validateEnvelope,
  validateCommandPayload,
  isMutationCapability,
  extractActionName,
  payloadHash,
} from './_shared.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function fail(status: string, code: string, message: string, envelope: any, http = 200, extra: Record<string, unknown> = {}) {
  return {
    body: {
      success: false,
      commandId: crypto.randomUUID(),
      correlationId: envelope?.correlationId ?? null,
      entityId: envelope?.entityId ?? null,
      entityVersion: null,
      status,
      warnings: [],
      validationErrors: status === 'INVALID' ? [{ code, message }] : [],
      businessErrors: status === 'INVALID' ? [] : [{ code, message }],
      auditEventId: null,
      data: null,
      ...extra,
    },
    http,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  let envelope: any;
  try { envelope = await req.json(); }
  catch {
    const r = fail('INVALID', 'ENVELOPE_JSON', 'Body is not JSON.', {}, 400);
    return respond(r.body, r.http);
  }

  // --- 1. Envelope structural validation ---------------------------------
  const envErrors = validateEnvelope(envelope);
  if (envErrors.length) {
    const r = fail('INVALID', 'ENVELOPE_STRUCTURE', envErrors.join('; '), envelope, 400);
    return respond(r.body, r.http);
  }

  // --- 2. Bearer JWT -----------------------------------------------------
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    const r = fail('DENIED', 'UNAUTHENTICATED', 'Bearer token required.', envelope, 401);
    return respond(r.body, r.http);
  }
  const jwt = authHeader.slice(7);
  const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: claims, error: claimsErr } = await anon.auth.getClaims(jwt);
  if (claimsErr || !claims?.claims?.sub) {
    const r = fail('DENIED', 'UNAUTHENTICATED', 'Invalid token.', envelope, 401);
    return respond(r.body, r.http);
  }
  const actorUserId = claims.claims.sub as string;

  // --- 2b. Internal rollout-administration commands ---------------------
  // NOT part of the 26-command business catalogue. Same JWT-derived actor
  // identity, correlation and audit path are reused, but the flow does NOT
  // pass through COMMAND_MATRIX and is NOT gated by
  // bn_mortality.actions_enabled=false. Full module/routes/admin-action/
  // is_granted walk is enforced inside the target RPC.
  if (envelope.commandName === 'BN_MORTALITY_ADMIN_SET_INTEGRATION_READINESS') {
    const out = await handleAdminSetIntegrationReadiness(envelope, actorUserId);
    return respond(out.body, out.http);
  }


  // --- 3. Command matrix -------------------------------------------------
  const spec = COMMAND_MATRIX[envelope.commandName];
  if (!spec) {
    const r = fail('DENIED', 'COMMAND_UNKNOWN', 'Command not registered on server.', envelope, 403);
    return respond(r.body, r.http);
  }
  if (spec.requiresJustification && !envelope.justification) {
    const r = fail('INVALID', 'JUSTIFICATION_REQUIRED', 'Justification is required.', envelope, 400);
    return respond(r.body, r.http);
  }

  // --- 6. Payload contract -----------------------------------------------
  const payloadErrors = validateCommandPayload(envelope.commandName, envelope.payload, envelope.entityId);
  if (payloadErrors.length) {
    const r = fail('INVALID', 'PAYLOAD_INVALID', payloadErrors.join('; '), envelope, 400);
    return respond(r.body, r.http);
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // --- 4. Server-side permission enforcement -----------------------------
  const isMutation = isMutationCapability(spec.capability);
  const actionName = extractActionName(spec.capability);
  const { data: perm, error: permErr } = await admin.rpc('bn_mortality_check_actor_permission', {
    p_actor_user_id: actorUserId,
    p_action_name: actionName,
    p_is_mutation: isMutation,
  });
  if (permErr) {
    const r = fail('FAILED', 'PERMISSION_LOOKUP_FAILED', permErr.message, envelope, 500);
    return respond(r.body, r.http);
  }
  const decision = perm as any;
  if (!decision?.ok) {
    const code = decision?.code ?? 'CAPABILITY_DENIED';
    const http = code === 'ACTIONS_DISABLED' ? 403 : code === 'CAPABILITY_DENIED' ? 403 : 403;
    const r = fail('DENIED', code, `Denied by server policy: ${code}`, envelope, http);
    return respond(r.body, r.http);
  }

  // --- 7. Atomic idempotency reservation ---------------------------------
  const hash = await payloadHash(envelope.payload);
  const { data: reservation, error: resErr } = await admin
    .from('bn_mortality_command_idempotency')
    .insert({
      idempotency_key: envelope.idempotencyKey,
      command_name: envelope.commandName,
      payload_hash: hash,
      status: 'PENDING',
      actor_user_id: actorUserId,
      result_json: {},
    })
    .select('*')
    .maybeSingle();

  let reserved = !!reservation;
  if (resErr) {
    // Unique-violation (23505) → key already exists. Distinguish replay states.
    const code = String((resErr as any).code ?? '');
    if (code !== '23505') {
      const r = fail('FAILED', 'IDEMPOTENCY_STORE_FAILED', resErr.message, envelope, 500);
      return respond(r.body, r.http);
    }
    reserved = false;
  }

  if (!reserved) {
    const { data: existing } = await admin
      .from('bn_mortality_command_idempotency')
      .select('*')
      .eq('idempotency_key', envelope.idempotencyKey)
      .eq('command_name', envelope.commandName)
      .maybeSingle();
    if (!existing) {
      const r = fail('FAILED', 'IDEMPOTENCY_STORE_FAILED', 'Race resolving reservation.', envelope, 500);
      return respond(r.body, r.http);
    }
    if (existing.payload_hash !== hash) {
      const r = fail('REJECTED', 'IDEMPOTENCY_PAYLOAD_MISMATCH',
        'The same idempotency key was replayed with a different payload.', envelope);
      return respond(r.body, r.http);
    }
    if (existing.status === 'PENDING') {
      const r = fail('CONFLICT', 'IDEMPOTENCY_IN_FLIGHT',
        'A concurrent execution for this idempotency key is in progress.', envelope, 409);
      return respond(r.body, r.http);
    }
    if (existing.status === 'COMPLETED') {
      return respond({ ...(existing.result_json as any), status: 'REPLAYED' });
    }
    // FAILED → allow retry by clearing and re-reserving.
    await admin.from('bn_mortality_command_idempotency')
      .update({ status: 'PENDING', payload_hash: hash, actor_user_id: actorUserId })
      .eq('idempotency_key', envelope.idempotencyKey)
      .eq('command_name', envelope.commandName);
  }

  // --- 8. Maker-checker (real maker resolution) --------------------------
  if (spec.makerChecker && envelope.entityId) {
    const makerRole = CHECKER_MAKER_ROLES[envelope.commandName];
    let makerUserId: string | null = null;
    if (makerRole) {
      // First: explicit maker registry.
      const { data: mk } = await admin
        .from('bn_mortality_command_maker')
        .select('maker_user_id')
        .eq('event_id', envelope.entityId)
        .eq('maker_role', makerRole)
        .maybeSingle();
      if (mk?.maker_user_id) makerUserId = mk.maker_user_id;
      // Fallback: scan history for the canonical maker command_type.
      if (!makerUserId) {
        const makerCommand = MAKER_ROLE_TO_COMMAND[makerRole];
        if (makerCommand) {
          const { data: h } = await admin
            .from('bn_mortality_event_history')
            .select('actor_user_id, occurred_at')
            .eq('event_id', envelope.entityId)
            .eq('event_type', makerCommand)
            .order('occurred_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (h?.actor_user_id) makerUserId = h.actor_user_id;
        }
      }
    }
    if (makerUserId && makerUserId === actorUserId) {
      // Free the reservation so a different actor can retry.
      await admin.from('bn_mortality_command_idempotency')
        .update({ status: 'FAILED' })
        .eq('idempotency_key', envelope.idempotencyKey)
        .eq('command_name', envelope.commandName);
      const r = fail('REJECTED', 'MAKER_CHECKER',
        `A different user must perform ${envelope.commandName} (maker=${makerRole}).`, envelope);
      return respond(r.body, r.http);
    }
  }

  // --- 9. Transactional execution ---------------------------------------
  // v2 is the governed entry point: it re-enforces the dark-launch/permission
  // gate, replay protection, maker-checker + self-approval prohibition inside
  // the database transaction, and owns evidence persistence, governed
  // cross-module handoffs and the closure gate. The unguarded v1 function is
  // no longer executable by browser roles.
  const { data: rpcData, error: rpcErr } = await admin.rpc('bn_mortality_execute_command_v2', {
    p_command_name: envelope.commandName,
    p_entity_id: envelope.entityId,
    p_actor_user_id: actorUserId,
    p_actor_user_code: envelope.actorUserCode,
    p_correlation_id: envelope.correlationId,
    p_expected_row_version: envelope.expectedRowVersion ? Number(envelope.expectedRowVersion) : null,
    p_reason_code: envelope.reasonCode ?? null,
    p_justification: envelope.justification ?? null,
    p_payload: envelope.payload ?? {},
    p_payload_hash: hash,
    p_idempotency_key: envelope.idempotencyKey,
  });

  if (rpcErr) {
    // Roll idempotency row back to FAILED so the client can retry.
    await admin.from('bn_mortality_command_idempotency')
      .update({ status: 'FAILED' })
      .eq('idempotency_key', envelope.idempotencyKey)
      .eq('command_name', envelope.commandName);
    const msg = String((rpcErr as any).message ?? '');
    if (msg.includes('ROW_VERSION_CONFLICT')) {
      const r = fail('CONFLICT', 'ROW_VERSION_CONFLICT', msg, envelope, 409);
      return respond(r.body, r.http);
    }
    for (const known of ['STATE_INVALID_TRANSITION','STATE_TERMINAL','ENTITY_NOT_FOUND','COMMAND_UNKNOWN','ENTITY_REQUIRED']) {
      if (msg.includes(known)) {
        const r = fail('REJECTED', known, msg, envelope);
        return respond(r.body, r.http);
      }
    }
    const r = fail('FAILED', 'HANDLER_FAILED', 'Server error.', envelope, 500);
    return respond(r.body, r.http);
  }

  const data = rpcData as any;

  // Record the actor as the maker for this stage, when applicable.
  const madeRole = COMMAND_TO_MAKER_ROLE[envelope.commandName as string];
  if (madeRole && data?.entity_id) {
    await admin.from('bn_mortality_command_maker').upsert({
      event_id: data.entity_id,
      maker_role: madeRole,
      maker_user_id: actorUserId,
      correlation_id: envelope.correlationId,
    }, { onConflict: 'event_id,maker_role' });
  }

  const finalResult = {
    success: true,
    commandId: crypto.randomUUID(),
    correlationId: envelope.correlationId,
    entityId: data.entity_id,
    entityVersion: data.entity_version != null ? String(data.entity_version) : null,
    status: 'EXECUTED' as const,
    warnings: [] as string[],
    validationErrors: [] as any[],
    businessErrors: [] as any[],
    auditEventId: null as string | null,
    data,
  };

  // Audit row — canonical bn_module_events columns.
  try {
    const { data: audit, error: auditErr } = await admin
      .from('bn_module_events')
      .insert({
        event_type: 'bn.mortality.command.executed',
        entity_type: 'bn_mortality_event',
        entity_id: String(data.entity_id ?? envelope.entityId ?? ''),
        published_by: actorUserId,
        payload: {
          commandName: envelope.commandName,
          commandVersion: envelope.commandVersion,
          correlationId: envelope.correlationId,
          idempotencyKey: envelope.idempotencyKey,
          entityVersion: data.entity_version ?? null,
          reasonCode: envelope.reasonCode ?? null,
          payloadHash: hash,
        },
        consumed: false,
      })
      .select('id')
      .maybeSingle();
    if (auditErr) {
      console.error('[bn-mortality-command] audit insert failed:', auditErr.message);
      finalResult.warnings.push('COMMAND_AUDIT_PUBLICATION_FAILED');
    } else if (audit?.id) {
      finalResult.auditEventId = audit.id as string;
    } else {
      finalResult.warnings.push('COMMAND_AUDIT_PUBLICATION_FAILED');
    }
  } catch (auditEx) {
    console.error('[bn-mortality-command] audit insert threw:', auditEx);
    finalResult.warnings.push('COMMAND_AUDIT_PUBLICATION_FAILED');
  }

  // Promote reservation → COMPLETED with final result.
  await admin.from('bn_mortality_command_idempotency')
    .update({
      status: 'COMPLETED',
      completed_at: new Date().toISOString(),
      entity_id: data.entity_id,
      entity_version: data.entity_version,
      result_json: finalResult as any,
    })
    .eq('idempotency_key', envelope.idempotencyKey)
    .eq('command_name', envelope.commandName);


  return respond(finalResult);
});

// Reverse-lookup tables for maker-checker resolution.
const MAKER_ROLE_TO_COMMAND: Record<string, string> = {
  submitter: 'BN_MORTALITY_SUBMIT_FOR_VERIFICATION',
  reporter: 'BN_MORTALITY_REGISTER_REPORT',
  preparer: 'BN_MORTALITY_PREPARE_IMPACT',
  impact_submitter: 'BN_MORTALITY_SUBMIT_IMPACT',
  approver: 'BN_MORTALITY_APPROVE_IMPACT',
  confirmer: 'BN_MORTALITY_CONFIRM_VERIFICATION',
};

const COMMAND_TO_MAKER_ROLE: Record<string, string> = {
  BN_MORTALITY_REGISTER_REPORT: 'reporter',
  BN_MORTALITY_SUBMIT_FOR_VERIFICATION: 'submitter',
  BN_MORTALITY_PREPARE_IMPACT: 'preparer',
  BN_MORTALITY_SUBMIT_IMPACT: 'impact_submitter',
  BN_MORTALITY_APPROVE_IMPACT: 'approver',
  BN_MORTALITY_CONFIRM_VERIFICATION: 'confirmer',
};

// =====================================================================
// Internal rollout-admin command handler (NOT part of the 26-command
// business catalogue). Reused JWT identity, structured audit + envelope.
// =====================================================================
const INTEGRATION_CODES = new Set(['awards','dms','overpayments','survivor','funeral','legal']);
const CERT_STATUSES = new Set(['NOT_CERTIFIED','IN_PROGRESS','CERTIFIED','REVOKED']);

async function handleAdminSetIntegrationReadiness(envelope: any, actorUserId: string): Promise<{ body: any; http: number }> {
  const p = envelope.payload ?? {};
  const errs: string[] = [];
  if (typeof p.integrationCode !== 'string' || !INTEGRATION_CODES.has(p.integrationCode)) errs.push('integrationCode invalid');
  if (typeof p.certificationStatus !== 'string' || !CERT_STATUSES.has(p.certificationStatus)) errs.push('certificationStatus invalid');
  if (typeof p.isReady !== 'boolean') errs.push('isReady must be boolean');
  if (!Number.isInteger(p.expectedRowVersion) || p.expectedRowVersion < 1) errs.push('expectedRowVersion must be positive integer');
  if (typeof p.justification !== 'string' || !p.justification.trim()) errs.push('justification required');
  if (p.certificationReference !== undefined && p.certificationReference !== null && typeof p.certificationReference !== 'string') errs.push('certificationReference must be string');
  if (p.notes !== undefined && p.notes !== null && typeof p.notes !== 'string') errs.push('notes must be string');
  if (errs.length) {
    return { body: fail('INVALID','PAYLOAD_STRUCTURE', errs.join('; '), envelope, 400).body, http: 400 };
  }
  // Actor spoofing prevention — payload actorUserId (if present) must match JWT sub.
  if (p.actorUserId !== undefined && p.actorUserId !== null && p.actorUserId !== actorUserId) {
    return { body: fail('DENIED','ACTOR_IDENTITY_MISMATCH','payload.actorUserId does not match JWT subject', envelope, 403).body, http: 403 };
  }

  const srv = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data, error } = await srv.rpc('bn_mortality_set_integration_readiness', {
    p_integration_code: p.integrationCode,
    p_certification_status: p.certificationStatus,
    p_is_ready: p.isReady,
    p_certification_reference: p.certificationReference ?? null,
    p_notes: p.notes ?? null,
    p_expected_row_version: p.expectedRowVersion,
    p_actor_user_id: actorUserId,           // JWT-derived — never trusted from payload
    p_justification: p.justification,
    p_correlation_id: envelope.correlationId,
  });
  if (error) {
    return { body: fail('FAILED','RPC_ERROR', error.message ?? 'rpc failed', envelope, 500).body, http: 500 };
  }
  const result = data as any;
  const status = result?.status;
  const code = result?.code ?? 'UNKNOWN';

  // Audit into bn_module_events using canonical columns. Do not fail the
  // response if publication fails — surface it as a warning instead.
  let auditEventId: string | null = null;
  const auditWarnings: string[] = [];
  try {
    const { data: audit, error: auditErr } = await srv
      .from('bn_module_events')
      .insert({
        event_type: status === 'OK'
          ? 'bn.mortality.integration_readiness.updated'
          : 'bn.mortality.integration_readiness.rejected',
        entity_type: 'bn_mortality_integration_readiness',
        entity_id: String(p.integrationCode),
        published_by: actorUserId,
        payload: {
          commandName: envelope.commandName,
          correlationId: envelope.correlationId,
          certificationStatus: p.certificationStatus,
          isReady: p.isReady,
          expectedRowVersion: p.expectedRowVersion,
          resultCode: code,
          historyId: result?.historyId ?? null,
          previousRowVersion: result?.previousRowVersion ?? null,
          rowVersion: result?.rowVersion ?? null,
        },
        consumed: false,
      })
      .select('id')
      .maybeSingle();
    if (auditErr) {
      console.error('[bn-mortality-command] admin audit insert failed:', auditErr.message);
      auditWarnings.push('ADMIN_AUDIT_PUBLICATION_FAILED');
    } else if (audit?.id) {
      auditEventId = audit.id as string;
    } else {
      auditWarnings.push('ADMIN_AUDIT_PUBLICATION_FAILED');
    }
  } catch (auditEx) {
    console.error('[bn-mortality-command] admin audit insert threw:', auditEx);
    auditWarnings.push('ADMIN_AUDIT_PUBLICATION_FAILED');
  }

  if (status === 'OK') {
    return {
      body: {
        status: 'OK',
        code: 'EXECUTED',
        message: 'Integration readiness updated.',
        commandName: envelope.commandName,
        commandVersion: envelope.commandVersion,
        idempotencyKey: envelope.idempotencyKey,
        correlationId: envelope.correlationId,
        entityType: 'bn_mortality_integration_readiness',
        entityId: String(p.integrationCode),
        rowVersion: result.rowVersion,
        previousRowVersion: result.previousRowVersion,
        occurredAtUtc: new Date().toISOString(),
        businessErrors: [],
        warnings: auditWarnings,
        auditEventId,
        data: result,
      },
      http: 200,
    };
  }
  const http = code === 'ACTOR_NOT_AUTHORISED' ? 403
             : code === 'CONCURRENCY_CONFLICT' ? 409
             : code === 'NOT_FOUND' ? 404
             : 422;
  const rej = fail('REJECTED', code, `readiness update rejected: ${code}`, envelope, http);
  return { body: { ...rej.body, warnings: auditWarnings, auditEventId, data: result }, http };
}

