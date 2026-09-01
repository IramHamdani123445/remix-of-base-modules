/**
 * EPIC-06C Phase 1 — Rule-based judicial notification engine.
 *
 * Every judicial mutation dispatches a single event code. This engine
 * resolves the rule row and fans out to configured channels:
 *   - inform a person → Omni-Comms Hub (governed producer), plus a legacy
 *     `in_app_notifications` compatibility record until Legal in-app delivery
 *     is certified live
 *   - email    → owned by the Hub; this engine never contacts a provider
 *   - doc queue → resolves via template registry; no-op if unconfigured
 *   - task queue → creates a follow-up entry in `lg_case_task`
 *
 * Idempotency: (event_code, source_id) is deduped within a single call.
 * All failures are swallowed so the caller mutation is never blocked.
 */
import { supabase } from "@/integrations/supabase/client";
import { resolveTemplate, type JudicialTemplateCode } from "./lgTemplateRegistryService";
import { emitJudicialEventNotice } from "@/platform/omni-comms/integrations/business/legalCommunicationProducer";

const sb = supabase as any;

export type JudicialEventCode =
  | "ORDER_CREATED"
  | "ORDER_GRANTED"
  | "COMPLIANCE_DUE"
  | "COMPLIANCE_BREACHED"
  | "APPEAL_FILED"
  | "APPEAL_DECISION"
  | "ENFORCEMENT_STARTED"
  | "ENFORCEMENT_COMPLETED"
  | "RECOVERY_COMPLETED"
  | "MATTER_CLOSED";

export interface DispatchContext {
  lg_case_id: string;
  entity_type?: string | null;
  entity_id?: string | null;
  actor_user_code?: string | null;
  title?: string;
  description?: string;
  payload?: Record<string, unknown>;
  /** Optional user IDs to notify in-app directly. */
  recipient_user_ids?: string[];
}

interface NotificationRule {
  event_code: string;
  event_label: string;
  in_app: boolean;
  email: boolean;
  doc_queue: boolean;
  task_queue: boolean;
  template_code: string | null;
  recipients_json: any;
  active: boolean;
}

let ruleCache: Map<string, NotificationRule> | null = null;
let ruleCacheAt = 0;
const TTL_MS = 60_000;

async function loadRules(): Promise<Map<string, NotificationRule>> {
  const now = Date.now();
  if (ruleCache && now - ruleCacheAt < TTL_MS) return ruleCache;
  try {
    const { data } = await sb.from("lg_notification_rule").select("*").eq("active", true);
    const m = new Map<string, NotificationRule>();
    (data ?? []).forEach((r: any) => m.set(r.event_code, r));
    ruleCache = m;
    ruleCacheAt = now;
    return m;
  } catch {
    return new Map();
  }
}

export function invalidateNotificationRuleCache(): void {
  ruleCache = null;
  ruleCacheAt = 0;
}

/**
 * Governed leg: hand the "inform a person" part of the judicial event to the
 * Omni-Comms Hub. The Hub decides template, branding, channel and whether the
 * message may leave. This engine keeps ownership of rule evaluation, the
 * document queue and case tasks.
 */
async function fanoutHub(rule: NotificationRule, ctx: DispatchContext) {
  const recipients = ctx.recipient_user_ids ?? [];
  if (recipients.length === 0) return;
  try {
    await emitJudicialEventNotice({
      matterId: ctx.lg_case_id,
      judicialEventCode: rule.event_code,
      sourceRecordId: ctx.entity_id ?? null,
      title: ctx.title ?? rule.event_label,
      body: ctx.description ?? rule.event_label,
      recipients: recipients.map((uid) => ({ userId: uid })),
    });
  } catch { /* fire-and-forget: never block the judicial mutation */ }
}

/**
 * Compatibility record ONLY.
 *
 * The Hub emission above is evaluate-only until Legal is certified for live
 * delivery, so this row keeps the existing in-app experience working. It is
 * retired the moment Legal in-app delivery goes live in the Hub.
 */
async function fanoutInApp(rule: NotificationRule, ctx: DispatchContext) {
  const recipients = ctx.recipient_user_ids ?? [];
  if (recipients.length === 0) return;
  const rows = recipients.map((uid) => ({
    user_id: uid,
    notification_type: `LEGAL.${rule.event_code}`,
    title: ctx.title ?? rule.event_label,
    message: ctx.description ?? rule.event_label,
    entity_type: ctx.entity_type ?? "LG_CASE",
    entity_id: ctx.entity_id ?? ctx.lg_case_id,
    payload: ctx.payload ?? null,
    is_read: false,
  }));
  try {
    await sb.from("in_app_notifications").insert(rows);
  } catch { /* fire-and-forget */ }
}

async function fanoutDocQueue(rule: NotificationRule, ctx: DispatchContext) {
  if (!rule.template_code) return;
  const tpl = await resolveTemplate(rule.template_code as JudicialTemplateCode);
  if (!tpl.configured) return; // silently skip when template not configured
  // Enqueue a generated-document request; the doc generation pipeline picks it up.
  try {
    await sb.from("core_generated_document").insert({
      owner_entity_table: "lg_case",
      owner_entity_id: ctx.lg_case_id,
      document_type_code: rule.template_code,
      template_id: tpl.core_template_id,
      status: "QUEUED",
      generated_by: ctx.actor_user_code ?? null,
      payload: ctx.payload ?? null,
    });
  } catch { /* fire-and-forget */ }
}

async function fanoutTaskQueue(rule: NotificationRule, ctx: DispatchContext) {
  try {
    await sb.from("lg_case_task").insert({
      lg_case_id: ctx.lg_case_id,
      title: ctx.title ?? `Follow-up: ${rule.event_label}`,
      description: ctx.description ?? null,
      task_type_code: `EVENT_${rule.event_code}`,
      task_kind: "AUTO",
      priority_code: "MEDIUM",
      status: "OPEN",
      sla_status: "ON_TRACK",
      created_by: ctx.actor_user_code ?? null,
    });
  } catch { /* fire-and-forget */ }
}

/**
 * Dispatch a judicial event through all configured channels.
 * Never throws — safe to await from any mutation path.
 */
export async function dispatch(
  eventCode: JudicialEventCode,
  ctx: DispatchContext,
): Promise<void> {
  try {
    const rules = await loadRules();
    const rule = rules.get(eventCode);
    if (!rule) return;
    const tasks: Promise<unknown>[] = [];
    if (rule.in_app || rule.email) tasks.push(fanoutHub(rule, ctx));
    if (rule.in_app) tasks.push(fanoutInApp(rule, ctx));
    if (rule.doc_queue) tasks.push(fanoutDocQueue(rule, ctx));
    if (rule.task_queue) tasks.push(fanoutTaskQueue(rule, ctx));
    await Promise.all(tasks);
  } catch {
    /* engine is fire-and-forget */
  }
}
