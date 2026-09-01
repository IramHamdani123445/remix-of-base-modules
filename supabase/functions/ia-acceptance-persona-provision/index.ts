/**
 * Internal Audit — FINAL ACCEPTANCE persona provisioning (MIPL role mailboxes).
 *
 * Hard boundaries (permanent):
 *   - Fails closed unless platform_environment_consistency() returns PASS for
 *     this backend's project ref (TEST marker + non_production runtime).
 *   - Creates ONLY the fixed final-acceptance role identities listed below.
 *     No wildcard domain provisioning.
 *   - Never mutates or renames the historical `certification.invalid` fixtures.
 *   - Grants least-privilege Internal Audit roles only. Never grants Admin.
 *   - Passwords are randomly generated in-process and never returned, logged
 *     or persisted anywhere. Sign-in is established through password recovery.
 *   - Sends no Email/SMS. Contacts no provider. Activates no channel.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EXPECTED_PROJECT_REF = 'xynceskeiiisiefqlgxo';
const ACCEPTANCE_DOMAIN = 'mishainfotech.com';

interface Persona {
  tag: string;
  localPart: string;
  firstName: string;
  lastName: string;
  role: string;
  /** Internal Audit staff register linkage (ia_auditors.role) */
  auditorRole?: string;
  employeeNo?: string;
  /** ia_departments.name for management respondents */
  departmentName?: string;
}

const PERSONAS: Persona[] = [
  {
    tag: 'IA-ACC-ADMIN', localPart: 'audit.admin',
    firstName: 'Audit', lastName: 'System Administrator',
    role: 'IA_AUDIT_ADMIN',
  },
  {
    tag: 'IA-ACC-HIA', localPart: 'audit.hia',
    firstName: 'Head of', lastName: 'Internal Audit',
    role: 'IA_HEAD_OF_INTERNAL_AUDIT',
    auditorRole: 'Head of Internal Audit', employeeNo: 'IA-HIA-100',
  },
  {
    tag: 'IA-ACC-LEAD', localPart: 'audit.lead',
    firstName: 'Lead', lastName: 'Auditor',
    role: 'IA_LEAD_AUDITOR',
    auditorRole: 'Lead Auditor', employeeNo: 'IA-LA-100',
  },
  {
    tag: 'IA-ACC-AUDITOR1', localPart: 'audit.auditor1',
    firstName: 'Audit Team', lastName: 'Member One',
    role: 'IA_TEAM_MEMBER',
    auditorRole: 'Auditor', employeeNo: 'IA-ATM-101',
  },
  {
    tag: 'IA-ACC-AUDITOR2', localPart: 'audit.auditor2',
    firstName: 'Audit Team', lastName: 'Member Two',
    role: 'IA_TEAM_MEMBER',
    auditorRole: 'Auditor', employeeNo: 'IA-ATM-102',
  },
  {
    tag: 'IA-ACC-QA', localPart: 'audit.qa',
    firstName: 'Quality', lastName: 'Reviewer',
    role: 'IA_QUALITY_REVIEWER',
    auditorRole: 'Quality Reviewer', employeeNo: 'IA-QA-100',
  },
  {
    tag: 'IA-ACC-MGMT-BENEFITS', localPart: 'audit.mgmt.benefits',
    firstName: 'Benefits', lastName: 'Management Respondent',
    role: 'IA_MANAGEMENT_RESPONDENT', departmentName: 'Benefits',
  },
  {
    tag: 'IA-ACC-MGMT-COMPLIANCE', localPart: 'audit.mgmt.compliance',
    firstName: 'Compliance', lastName: 'Management Respondent',
    role: 'IA_MANAGEMENT_RESPONDENT', departmentName: 'Compliance',
  },
  {
    tag: 'IA-ACC-MGMT-FINANCE', localPart: 'audit.mgmt.finance',
    firstName: 'Finance', lastName: 'Management Respondent',
    role: 'IA_MANAGEMENT_RESPONDENT', departmentName: 'Finance',
  },
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
    const { data: deptRows } = await admin.from('ia_departments').select('id,name').eq('is_active', true);
    const deptByName = new Map<string, string>();
    for (const d of deptRows ?? []) {
      if (!deptByName.has(d.name as string)) deptByName.set(d.name as string, d.id as string);
    }

    const { data: existingUsers } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });

    const results: Array<Record<string, unknown>> = [];

    for (const p of PERSONAS) {
      const email = `${p.localPart}@${ACCEPTANCE_DOMAIN}`;
      const found = existingUsers?.users?.find((u) => (u.email ?? '').toLowerCase() === email);

      let userId: string;
      let status: string;

      if (found) {
        userId = found.id;
        status = 'already_exists';
      } else {
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email,
          // Random, never returned or stored. Access is established via recovery.
          password: `${crypto.randomUUID()}${crypto.randomUUID()}Aa1!`,
          email_confirm: true,
          user_metadata: {
            full_name: `${p.firstName} ${p.lastName}`,
            acceptance_fixture: true,
            fixture_tag: p.tag,
          },
        });
        if (createErr || !created?.user) {
          results.push({ tag: p.tag, email, status: 'error', message: createErr?.message ?? 'createUser failed' });
          continue;
        }
        userId = created.user.id;
        status = 'created';
      }

      const departmentId = p.departmentName ? deptByName.get(p.departmentName) ?? null : null;
      if (p.departmentName && !departmentId) {
        results.push({ tag: p.tag, email, status: 'error', message: `department_not_found: ${p.departmentName}` });
        continue;
      }

      const { error: profileErr } = await admin.from('profiles').upsert({
        id: userId,
        email,
        first_name: p.firstName,
        last_name: p.lastName,
        full_name: `${p.firstName} ${p.lastName}`,
        user_code: p.tag,
        department_id: departmentId,
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

      // Internal Audit staff register (canonical auditor identity linkage).
      let auditorId: string | null = null;
      if (p.auditorRole) {
        const { data: existingAuditor } = await admin
          .from('ia_auditors').select('id').eq('profile_id', userId).maybeSingle();
        if (existingAuditor) {
          auditorId = existingAuditor.id as string;
          await admin.from('ia_auditors').update({
            name: `${p.firstName} ${p.lastName}`,
            email,
            role: p.auditorRole,
            employment_status: 'Active',
          }).eq('id', auditorId);
        } else {
          const { data: insertedAuditor, error: auditorErr } = await admin
            .from('ia_auditors')
            .insert({
              profile_id: userId,
              user_id: userId,
              employee_no: p.employeeNo,
              name: `${p.firstName} ${p.lastName}`,
              email,
              role: p.auditorRole,
              employment_status: 'Active',
            })
            .select('id')
            .single();
          if (auditorErr) {
            results.push({ tag: p.tag, email, status: 'error', message: `auditor: ${auditorErr.message}` });
            continue;
          }
          auditorId = insertedAuditor.id as string;
        }
      }

      results.push({
        tag: p.tag,
        email,
        profile_id: userId,
        role: wanted,
        auditor_id: auditorId,
        department_id: departmentId,
        department_name: p.departmentName ?? null,
        status,
      });
    }

    return json({
      ok: results.every((r) => r.status !== 'error'),
      environment: c,
      acceptance_domain: ACCEPTANCE_DOMAIN,
      note: 'Passwords are random and are not returned. Establish sign-in through the standard TEST password recovery flow.',
      personas: results,
    });
  } catch (error) {
    return json({ ok: false, code: 'UNEXPECTED', detail: String(error) }, 500);
  }
});
