import { supabase } from '@/integrations/supabase/client';
import { auditConfigChange } from '@/services/bn/audit/bnAuditService';
import { getCurrentUserCode } from '@/services/bn/audit/getCurrentUserCode';

const db = supabase as any;


export interface BnWorkbasketRole {
  id: string;
  workbasket_id: string;
  role_name: string;
  is_primary: boolean;
  created_at: string;
  created_by: string | null;
}

export interface WorkbasketForUser {
  workbasket_id: string;
  basket_code: string;
  basket_name: string;
  role_name: string;
  is_primary: boolean;
}

/** All role rows for a workbasket. */
export async function fetchRolesForWorkbasket(workbasketId: string): Promise<BnWorkbasketRole[]> {
  const { data, error } = await db
    .from('bn_workbasket_role')
    .select('*')
    .eq('workbasket_id', workbasketId)
    .order('is_primary', { ascending: false });
  if (error) throw error;
  return (data || []) as BnWorkbasketRole[];
}

/** Replace the role set for a workbasket. The first role becomes primary. */
export async function setWorkbasketRoles(
  workbasketId: string,
  roles: string[],
  userCode?: string,
): Promise<void> {
  const cleaned = Array.from(new Set(roles.filter(Boolean)));
  if (cleaned.length === 0) throw new Error('At least one role is required');

  const { data: before } = await db
    .from('bn_workbasket_role')
    .select('role_name, is_primary')
    .eq('workbasket_id', workbasketId);

  const { error: delErr } = await db
    .from('bn_workbasket_role')
    .delete()
    .eq('workbasket_id', workbasketId);
  if (delErr) throw delErr;

  const rows = cleaned.map((role_name, idx) => ({
    workbasket_id: workbasketId,
    role_name,
    is_primary: idx === 0,
    created_by: userCode || null,
  }));
  const { error: insErr } = await db.from('bn_workbasket_role').insert(rows);
  if (insErr) throw insErr;

  // Keep legacy assigned_role in sync with the primary role
  const { error: updErr } = await db
    .from('bn_workbasket')
    .update({ assigned_role: cleaned[0], modified_at: new Date().toISOString() })
    .eq('id', workbasketId);
  if (updErr) throw updErr;

  try {
    await auditConfigChange({
      entityType: 'bn_workbasket_role',
      entityId: workbasketId,
      action: 'UPDATE',
      performedBy: userCode || (await getCurrentUserCode()) || 'SYSTEM',
      beforeValue: { roles: before ?? [] },
      afterValue: { roles: rows },
    });
  } catch (e) {
    console.warn('[workbasketRoleService] audit failed (non-blocking):', e);
  }
}


/**
 * Returns workbaskets visible to a user via direct, bundle, or delegated roles.
 *
 * The RPC only sees baskets that have `bn_workbasket_role` rows. Legacy baskets
 * carry the role on `bn_workbasket.assigned_role` only, so they are merged in
 * here rather than silently disappearing from the user's queue.
 */
export async function fetchWorkbasketsForUser(userId: string): Promise<WorkbasketForUser[]> {
  const { data, error } = await db.rpc('bn_workbaskets_for_user', { p_user_id: userId });
  if (error) throw error;
  const primary = (data || []) as WorkbasketForUser[];

  const legacy = await fetchLegacyRoleBaskets(userId);
  const seen = new Set(primary.map((b) => b.workbasket_id));
  return [...primary, ...legacy.filter((b) => !seen.has(b.workbasket_id))];
}

/** Active baskets whose only role link is the legacy `assigned_role` column. */
async function fetchLegacyRoleBaskets(userId: string): Promise<WorkbasketForUser[]> {
  const { data: roleRows, error: roleErr } = await db
    .from('v_bn_user_effective_roles')
    .select('role_name')
    .eq('user_id', userId);
  if (roleErr) return [];
  const roles = Array.from(
    new Set(((roleRows || []) as { role_name: string }[]).map((r) => r.role_name)),
  );
  if (roles.length === 0) return [];

  const { data: baskets, error: bErr } = await db
    .from('bn_workbasket')
    .select('id, basket_code, basket_name, assigned_role')
    .eq('is_active', true)
    .in('assigned_role', roles);
  if (bErr || !baskets?.length) return [];

  const ids = (baskets as { id: string }[]).map((b) => b.id);
  const { data: linked } = await db
    .from('bn_workbasket_role')
    .select('workbasket_id')
    .in('workbasket_id', ids);
  const hasRoleRow = new Set(
    ((linked || []) as { workbasket_id: string }[]).map((r) => r.workbasket_id),
  );

  return (baskets as { id: string; basket_code: string; basket_name: string; assigned_role: string }[])
    .filter((b) => !hasRoleRow.has(b.id))
    .map((b) => ({
      workbasket_id: b.id,
      basket_code: b.basket_code,
      basket_name: b.basket_name,
      role_name: b.assigned_role,
      is_primary: false,
    }));
}


/** Map of workbasket_id → role[] for many baskets at once. */
export async function fetchRolesForWorkbaskets(
  ids: string[],
): Promise<Record<string, string[]>> {
  if (ids.length === 0) return {};
  const { data, error } = await db
    .from('bn_workbasket_role')
    .select('workbasket_id, role_name')
    .in('workbasket_id', ids);
  if (error) throw error;
  const out: Record<string, string[]> = {};
  for (const row of (data || []) as { workbasket_id: string; role_name: string }[]) {
    (out[row.workbasket_id] ||= []).push(row.role_name);
  }
  return out;
}
