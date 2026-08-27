/**
 * Internal Audit Wave-4 — controlled certification persona provisioning.
 *
 * Hard boundaries (permanent):
 *   - Fails closed unless platform_environment_consistency() returns PASS for
 *     this backend's project ref (TEST marker + non_production runtime).
 *   - Creates ONLY sandbox certification identities on the reserved
 *     `certification.invalid` domain. Never touches real stakeholder mailboxes.
 *   - Grants least-privilege Internal Audit roles only. Never grants Admin.
 *   - Sends no Email/SMS. Contacts no provider. Activates no channel.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EXPECTED_PROJECT_REF = 'xynceskeiiisiefqlgxo';
const SANDBOX_DOMAIN = 'certification.invalid';

interface Persona {
  tag: string;
  localPart: string;
  firstName: string;
  lastName: string;
  role: string;
  departmentName?: string;
}

const PERSONAS: Persona[] = [
  { tag: 'W4-CERT-HIA', localPart: 'w4-cert-hia', firstName: 'W4', lastName: 'Cert Head of Internal Audit', role: 'IA_HEAD_OF_INTERNAL_AUDIT' },
  { tag: 'W4-CERT-LEAD', localPart: 'w4-cert-lead', firstName: 'W4', lastName: 'Cert Lead Auditor', role: 'IA_LEAD_AUDITOR' },
  { tag: 'W4-CERT-AUDITOR', localPart: 'w4-cert-auditor', firstName: 'W4', lastName: 'Cert Auditor', role: 'IA_TEAM_MEMBER' },
  { tag: 'W4-CERT-QA', localPart: 'w4-cert-qa', firstName: 'W4', lastName: 'Cert Quality Reviewer', role: 'IA_QUALITY_REVIEWER' },
  { tag: 'W4-CERT-MGMT-BENEFITS', localPart: 'w4-cert-mgmt-benefits', firstName: 'W4', lastName: 'Cert Management Benefits', role: 'IA_MANAGEMENT_RESPONDENT', departmentName: 'Benefits' },
  { tag: 'W4-CERT-MGMT-FINANCE', localPart: 'w4-cert-mgmt-finance', firstName: 'W4', lastName: 'Cert Management Finance', role: 'IA_MANAGEMENT_RESPONDENT', departmentName: 'Finance' },
  { tag: 'W4-CERT-MGMT-ICT', localPart: 'w4-cert-mgmt-ict', firstName: 'W4', lastName: 'Cert Management ICT', role: 'IA_MANAGEMENT_RESPONDENT', departmentName: 'Information Technology' },
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // ---- Fail-closed environment gate -------------------------------------
    const { data: consistency, error: consistencyError } = await admin.rpc(
      'platform_environment_consistency',
      { p_expected_project_ref: EXPECTED_PROJECT_REF },
    );
    if (consistencyError) {
      return json({ ok: false, code: 'ENVIRONMENT_CHECK_FAILED', detail: consistencyError.message }, 500);
    }
    const c = consistency as Record<string, unknown> | null;
    if (!c || c.status !== 'PASS' || c.marker_environment_kind !== 'TEST' || c.allows_controlled_test_activation !== true) {
      return json({ ok: false, code: 'ENVIRONMENT_NOT_CERTIFIED_FOR_PERSONAS', consistency: c }, 403);
    }

    // ---- Reference data ----------------------------------------------------
    const { data: deptRows } = await admin.from('ia_departments').select('id,name');
    const deptByName = new Map<string, string>();
    for (const d of deptRows ?? []) {
      if (!deptByName.has(d.name as string)) deptByName.set(d.name as string, d.id as string);
    }

    const { data: existingUsers } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });

    const results: Array<Record<string, unknown>> = [];

    for (const p of PERSONAS) {
      const email = `${p.localPart}@${SANDBOX_DOMAIN}`;
      const found = existingUsers?.users?.find((u) => (u.email ?? '').toLowerCase() === email);

      let userId: string;
      let status: string;

      if (found) {
        userId = found.id;
        status = 'already_exists';
      } else {
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email,
          password: crypto.randomUUID() + 'Aa1!',
          email_confirm: true,
          user_metadata: { full_name: `${p.firstName} ${p.lastName}`, certification_fixture: true, fixture_tag: p.tag },
        });
        if (createErr || !created?.user) {
          results.push({ tag: p.tag, email, status: 'error', message: createErr?.message ?? 'createUser failed' });
          continue;
        }
        userId = created.user.id;
        status = 'created';
      }

      const departmentId = p.departmentName ? deptByName.get(p.departmentName) ?? null : null;

      const { error: profileErr } = await admin.from('profiles').upsert({
        id: userId,
        email,
        first_name: p.firstName,
        last_name: p.lastName,
        full_name: `${p.firstName} ${p.lastName}`,
        user_code: p.tag,
        is_active: true,
        force_password_change: false,
      });
      if (profileErr) {
        results.push({ tag: p.tag, email, status: 'error', message: `profile: ${profileErr.message}` });
        continue;
      }

      // Least privilege: exactly one Internal Audit role per persona.
      const { data: currentRoles } = await admin.from('user_roles').select('id,role').eq('user_id', userId);
      const wanted = p.role;
      for (const r of currentRoles ?? []) {
        if (r.role !== wanted) await admin.from('user_roles').delete().eq('id', r.id);
      }
      if (!(currentRoles ?? []).some((r) => r.role === wanted)) {
        const { error: roleErr } = await admin.from('user_roles').insert({ user_id: userId, role: wanted });
        if (roleErr && !roleErr.message.includes('duplicate')) {
          results.push({ tag: p.tag, email, status: 'error', message: `role: ${roleErr.message}` });
          continue;
        }
      }

      results.push({
        tag: p.tag,
        email,
        profile_id: userId,
        role: wanted,
        department_id: departmentId,
        status,
      });
    }

    return json({
      ok: results.every((r) => r.status !== 'error'),
      environment: c,
      sandbox_domain: SANDBOX_DOMAIN,
      personas: results,
    });
  } catch (error) {
    return json({ ok: false, code: 'UNEXPECTED', detail: String(error) }, 500);
  }
});
