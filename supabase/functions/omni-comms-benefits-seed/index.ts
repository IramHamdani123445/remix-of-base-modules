/**
 * Omni-Comms — Benefits email catalogue seeder.
 *
 * Registers (idempotently) every Email-capable Benefits communication in the
 * existing Omni-Comms registries: event definition → published event
 * contract → event-scoped template family → published Email template version
 * → enabled Email route → active BENEFITS producer binding.
 *
 * It creates NO new communication system: it only fills the canonical
 * registries the Omni-Comms runtime already resolves against. It never sends
 * anything and never touches delivery state.
 *
 * Admin-only. Content-addressed: re-running with unchanged content is a
 * no-op; changed content publishes the next version and retires the previous.
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  BENEFITS_SEED_ROWS,
  SEED_ACTOR_ID,
  SEED_DEPT_ID,
  SEED_EMAIL_LAYOUT_ID,
  SEED_EMAIL_LAYOUT_VERSION_ID,
  SEED_EMAIL_SENDER_IDENTITY_ID,
  SEED_LOCALE,
  SEED_ORG_ID,
} from "./catalogue.generated.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY) {
    return json({ ok: false, error: "supabase_env_missing" }, 503);
  }

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ ok: false, error: "missing_authorization" }, 401);

  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userRes, error: userErr } = await authClient.auth.getUser();
  if (userErr || !userRes?.user) return json({ ok: false, error: "invalid_token" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: isAdmin } = await admin.rpc("has_role", {
    _user_id: userRes.user.id,
    _role: "Admin",
  });
  if (isAdmin !== true) return json({ ok: false, error: "forbidden_admin_only" }, 403);

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const dryRun = body?.dry_run === true;
  const onlyCode = typeof body?.event_code === "string" ? body.event_code : null;

  const rows = onlyCode
    ? BENEFITS_SEED_ROWS.filter((r) => r.code === onlyCode)
    : BENEFITS_SEED_ROWS;

  const summary = {
    events_total: rows.length,
    events_created: 0,
    contracts_published: 0,
    families_created: 0,
    template_versions_published: 0,
    routes_created: 0,
    routes_updated: 0,
    bindings_created: 0,
    bindings_updated: 0,
    unchanged: 0,
    failures: [] as { code: string; step: string; message: string }[],
  };

  if (dryRun) return json({ ok: true, dry_run: true, summary });

  const now = () => new Date().toISOString();

  for (const row of rows) {
    let changed = false;
    try {
      // 1. Event definition.
      const { data: existingEvent } = await admin
        .from("omni_comms_event_definition")
        .select("id")
        .eq("code", row.code)
        .maybeSingle();

      let eventId = existingEvent?.id as string | undefined;
      if (!eventId) {
        const { data: inserted, error } = await admin
          .from("omni_comms_event_definition")
          .insert({
            code: row.code,
            module_code: "BENEFITS",
            entity_type: row.entityType,
            name: row.name,
            description: row.description,
            communication_class: row.communicationClass,
            default_priority: row.priority,
            status: "draft",
            created_at: now(),
            created_by: SEED_ACTOR_ID,
            updated_at: now(),
            updated_by: SEED_ACTOR_ID,
          })
          .select("id")
          .single();
        if (error) throw new Error(`event_definition:${error.message}`);
        eventId = inserted!.id as string;
        // Governance: rows are born as drafts and transition to active.
        await admin
          .from("omni_comms_event_definition")
          .update({ status: "active", updated_at: now(), updated_by: SEED_ACTOR_ID })
          .eq("id", eventId);
        summary.events_created += 1;
        changed = true;
      } else {
        await admin
          .from("omni_comms_event_definition")
          .update({
            name: row.name,
            description: row.description,
            communication_class: row.communicationClass,
            default_priority: row.priority,
            status: "active",
            updated_at: now(),
            updated_by: SEED_ACTOR_ID,
          })
          .eq("id", eventId);
      }

      // 2. Published event contract (content-addressed).
      const { data: liveContract } = await admin
        .from("omni_comms_event_contract")
        .select("id, checksum")
        .eq("event_definition_id", eventId)
        .eq("status", "published")
        .maybeSingle();

      if (!liveContract || liveContract.checksum !== row.schemaChecksum) {
        if (liveContract) {
          await admin
            .from("omni_comms_event_contract")
            .update({
              status: "retired",
              retired_at: now(),
              retired_by: SEED_ACTOR_ID,
              updated_at: now(),
              updated_by: SEED_ACTOR_ID,
            })
            .eq("id", liveContract.id);
        }
        const { data: maxContract } = await admin
          .from("omni_comms_event_contract")
          .select("version_number")
          .eq("event_definition_id", eventId)
          .order("version_number", { ascending: false })
          .limit(1);
        const nextVersion = (maxContract?.[0]?.version_number ?? 0) + 1;
        const { data: draftContract, error } = await admin
          .from("omni_comms_event_contract")
          .insert({
            event_definition_id: eventId,
            version_number: nextVersion,
            json_schema: row.schema,
            sample_payload: row.samplePayload,
            status: "draft",
            created_at: now(),
            created_by: SEED_ACTOR_ID,
            updated_at: now(),
            updated_by: SEED_ACTOR_ID,
          })
          .select("id")
          .single();
        if (error) throw new Error(`event_contract:${error.message}`);
        const { error: pubErr } = await admin
          .from("omni_comms_event_contract")
          .update({
            status: "published",
            checksum: row.schemaChecksum,
            published_at: now(),
            published_by: SEED_ACTOR_ID,
            updated_at: now(),
            updated_by: SEED_ACTOR_ID,
          })
          .eq("id", draftContract!.id);
        if (pubErr) throw new Error(`event_contract_publish:${pubErr.message}`);
        summary.contracts_published += 1;
        changed = true;
      }

      // 3. Event-scoped template family.
      const { data: existingFamily } = await admin
        .from("omni_comms_template_family")
        .select("id")
        .eq("event_definition_id", eventId)
        .eq("status", "active")
        .limit(1);

      let familyId = existingFamily?.[0]?.id as string | undefined;
      if (!familyId) {
        const { data: inserted, error } = await admin
          .from("omni_comms_template_family")
          .insert({
            code: row.familyCode,
            name: row.name,
            description: row.description,
            scope_type: "event",
            organization_id: SEED_ORG_ID,
            department_id: null,
            event_definition_id: eventId,
            status: "draft",
            created_at: now(),
            created_by: SEED_ACTOR_ID,
            updated_at: now(),
            updated_by: SEED_ACTOR_ID,
          })
          .select("id")
          .single();
        if (error) throw new Error(`template_family:${error.message}`);
        familyId = inserted!.id as string;
        await admin
          .from("omni_comms_template_family")
          .update({
            status: "active",
            activated_at: now(),
            activated_by: SEED_ACTOR_ID,
            updated_at: now(),
            updated_by: SEED_ACTOR_ID,
          })
          .eq("id", familyId);
        summary.families_created += 1;
        changed = true;
      }

      // 4. Published Email template version (content-addressed).
      const { data: liveVersion } = await admin
        .from("omni_comms_template_version")
        .select("id, checksum")
        .eq("template_family_id", familyId)
        .eq("channel", "email")
        .eq("locale", SEED_LOCALE)
        .eq("status", "published")
        .maybeSingle();

      if (!liveVersion || liveVersion.checksum !== row.contentChecksum) {
        if (liveVersion) {
          await admin
            .from("omni_comms_template_version")
            .update({
              status: "retired",
              retired_at: now(),
              retired_by: SEED_ACTOR_ID,
              retirement_reason:
                "Superseded by the generated Benefits letter library",
              updated_at: now(),
              updated_by: SEED_ACTOR_ID,
            })
            .eq("id", liveVersion.id);
        }
        const { data: maxVersion } = await admin
          .from("omni_comms_template_version")
          .select("version_number")
          .eq("template_family_id", familyId)
          .eq("channel", "email")
          .eq("locale", SEED_LOCALE)
          .order("version_number", { ascending: false })
          .limit(1);
        const nextVersion = (maxVersion?.[0]?.version_number ?? 0) + 1;
        const { data: draftVersion, error } = await admin
          .from("omni_comms_template_version")
          .insert({
            template_family_id: familyId,
            version_number: nextVersion,
            channel: "email",
            locale: SEED_LOCALE,
            content: row.content,
            status: "draft",
            created_at: now(),
            // created_by stays null so the independent-approver rule holds.
            created_by: null,
            updated_at: now(),
            updated_by: SEED_ACTOR_ID,
            layout_selection_mode: "pinned",
            layout_id: SEED_EMAIL_LAYOUT_ID,
            pinned_layout_version_id: SEED_EMAIL_LAYOUT_VERSION_ID,
          })
          .select("id")
          .single();
        if (error) throw new Error(`template_version:${error.message}`);
        const { error: apprErr } = await admin
          .from("omni_comms_template_version")
          .update({
            status: "approved",
            checksum: row.contentChecksum,
            approved_at: now(),
            approved_by: SEED_ACTOR_ID,
            updated_at: now(),
            updated_by: SEED_ACTOR_ID,
          })
          .eq("id", draftVersion!.id);
        if (apprErr) throw new Error(`template_version_approve:${apprErr.message}`);
        const { error: pubVerErr } = await admin
          .from("omni_comms_template_version")
          .update({
            status: "published",
            published_at: now(),
            published_by: SEED_ACTOR_ID,
            updated_at: now(),
            updated_by: SEED_ACTOR_ID,
          })
          .eq("id", draftVersion!.id);
        if (pubVerErr) throw new Error(`template_version_publish:${pubVerErr.message}`);
        summary.template_versions_published += 1;
        changed = true;
      }

      // 5. Department-scoped Email route.
      const { data: existingRoute } = await admin
        .from("omni_comms_event_route")
        .select("id")
        .eq("event_definition_id", eventId)
        .eq("channel", "email")
        .eq("organization_id", SEED_ORG_ID)
        .eq("department_id", SEED_DEPT_ID)
        .maybeSingle();

      if (!existingRoute) {
        const routeInsert = {
          organization_id: SEED_ORG_ID,
          department_id: SEED_DEPT_ID,
          event_definition_id: eventId,
          channel: "email",
          is_required: true,
          is_enabled: true,
          priority: 100,
          template_family_id: familyId,
          sender_identity_id: SEED_EMAIL_SENDER_IDENTITY_ID,
          sender_resolution_policy: "explicit",
          preference_policy: "honour",
          lifecycle_state: "draft",
          created_at: now(),
          created_by: SEED_ACTOR_ID,
          updated_at: now(),
          updated_by: SEED_ACTOR_ID,
        };
        const { data: draftRoute, error } = await admin
          .from("omni_comms_event_route")
          .insert(routeInsert)
          .select("id")
          .single();
        if (error) throw new Error(`event_route:${error.message}`);
        const { error: routeActErr } = await admin
          .from("omni_comms_event_route")
          .update({
            lifecycle_state: "active",
            activated_at: now(),
            activated_by: SEED_ACTOR_ID,
            updated_at: now(),
            updated_by: SEED_ACTOR_ID,
          })
          .eq("id", draftRoute!.id);
        if (routeActErr) throw new Error(`event_route_activate:${routeActErr.message}`);
        summary.routes_created += 1;
        changed = true;
      } else {
        await admin
          .from("omni_comms_event_route")
          .update({
            template_family_id: familyId,
            is_enabled: true,
            lifecycle_state: "active",
            updated_at: now(),
            updated_by: SEED_ACTOR_ID,
          })
          .eq("id", existingRoute.id);
        summary.routes_updated += 1;
      }

      // 6. Active BENEFITS producer binding (queued only).
      const { data: existingBinding } = await admin
        .from("omni_comms_producer_event_binding")
        .select("id")
        .eq("event_definition_id", eventId)
        .eq("caller_module_code", "BENEFITS")
        .eq("organization_id", SEED_ORG_ID)
        .eq("department_id", SEED_DEPT_ID)
        .maybeSingle();

      if (!existingBinding) {
        const { data: draftBinding, error } = await admin
          .from("omni_comms_producer_event_binding")
          .insert({
            organization_id: SEED_ORG_ID,
            department_id: SEED_DEPT_ID,
            caller_module_code: "BENEFITS",
            event_definition_id: eventId,
            allowed_modes: ["queued"],
            status: "draft",
            integration_reference: "emitBenefitsCommunication",
            created_at: now(),
            created_by: SEED_ACTOR_ID,
            updated_at: now(),
            updated_by: SEED_ACTOR_ID,
          })
          .select("id")
          .single();
        if (error) throw new Error(`producer_binding:${error.message}`);
        const { error: bindActErr } = await admin
          .from("omni_comms_producer_event_binding")
          .update({
            status: "active",
            activated_at: now(),
            activated_by: SEED_ACTOR_ID,
            updated_at: now(),
            updated_by: SEED_ACTOR_ID,
          })
          .eq("id", draftBinding!.id);
        if (bindActErr) throw new Error(`producer_binding_activate:${bindActErr.message}`);
        summary.bindings_created += 1;
        changed = true;
      } else {
        await admin
          .from("omni_comms_producer_event_binding")
          .update({
            status: "active",
            allowed_modes: ["queued"],
            updated_at: now(),
            updated_by: SEED_ACTOR_ID,
          })
          .eq("id", existingBinding.id);
        summary.bindings_updated += 1;
      }

      if (!changed) summary.unchanged += 1;
    } catch (err) {
      summary.failures.push({
        code: row.code,
        step: "seed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return json({ ok: summary.failures.length === 0, summary });
});
