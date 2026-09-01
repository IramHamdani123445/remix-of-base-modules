import { supabase } from '@/integrations/supabase/client';
import type { BnWorkbasket, BnClaimQueueAssignment } from '@/types/bn';
import { auditConfigChange } from '@/services/bn/audit/bnAuditService';
import { getCurrentUserCode } from '@/services/bn/audit/getCurrentUserCode';

const db = supabase as any;

const safeAudit = async (i: Parameters<typeof auditConfigChange>[0]) => {
  try {
    const performedBy = i.performedBy || (await getCurrentUserCode()) || 'SYSTEM';
    await auditConfigChange({ ...i, performedBy });
  } catch (e) {
    console.warn('[workbasketService] audit failed (non-blocking):', e);
  }
};

export async function fetchWorkbaskets(): Promise<BnWorkbasket[]> {
  const { data, error } = await db
    .from('bn_workbasket')
    .select('*')
    .eq('is_active', true)
    .order('basket_name');
  if (error) throw error;
  return (data || []) as BnWorkbasket[];
}

export async function fetchWorkbasketsByRole(role: string): Promise<BnWorkbasket[]> {
  const { data, error } = await db
    .from('bn_workbasket')
    .select('*')
    .eq('is_active', true)
    .eq('assigned_role', role)
    .order('basket_name');
  if (error) throw error;
  return (data || []) as BnWorkbasket[];
}

export async function createWorkbasket(basket: Partial<BnWorkbasket>): Promise<BnWorkbasket> {
  const { data, error } = await db.from('bn_workbasket').insert(basket).select().single();
  if (error) throw error;
  await safeAudit({
    entityType: 'bn_workbasket',
    entityId: (data as any)?.id ?? null,
    action: 'CREATE',
    performedBy: '',
    afterValue: data as any,
  });
  return data as BnWorkbasket;
}

export async function updateWorkbasket(id: string, updates: Partial<BnWorkbasket>): Promise<BnWorkbasket> {
  const { data: before } = await db.from('bn_workbasket').select('*').eq('id', id).maybeSingle();
  const { data, error } = await db.from('bn_workbasket').update({ ...updates, modified_at: new Date().toISOString() }).eq('id', id).select().single();
  if (error) throw error;
  await safeAudit({
    entityType: 'bn_workbasket',
    entityId: id,
    action: 'UPDATE',
    performedBy: '',
    beforeValue: before ?? null,
    afterValue: data as any,
  });
  return data as BnWorkbasket;
}

export async function fetchQueueClaims(workbasketId: string): Promise<BnClaimQueueAssignment[]> {
  const { data, error } = await db
    .from('bn_claim_queue_assignment')
    .select('*, bn_claim(*, bn_product(benefit_code, benefit_name, category)), bn_workbasket(*)')
    .eq('workbasket_id', workbasketId)
    .eq('is_active', true)
    .is('completed_at', null)
    .order('priority', { ascending: true })
    .order('assigned_at', { ascending: true });
  if (error) throw error;
  return (data || []) as BnClaimQueueAssignment[];
}

export async function fetchMyQueue(userCode: string): Promise<BnClaimQueueAssignment[]> {
  const { data, error } = await db
    .from('bn_claim_queue_assignment')
    .select('*, bn_claim(*, bn_product(benefit_code, benefit_name, category)), bn_workbasket(*)')
    .eq('assigned_to', userCode)
    .eq('is_active', true)
    .is('completed_at', null)
    .order('priority', { ascending: true });
  if (error) throw error;
  return (data || []) as BnClaimQueueAssignment[];
}

export async function assignClaimToQueue(params: {
  claimId: string;
  workbasketId: string;
  assignedTo?: string;
  priority?: number;
  dueAt?: string;
}): Promise<BnClaimQueueAssignment> {
  const { data, error } = await db
    .from('bn_claim_queue_assignment')
    .insert({
      claim_id: params.claimId,
      workbasket_id: params.workbasketId,
      assigned_to: params.assignedTo || null,
      priority: params.priority || 5,
      due_at: params.dueAt || null,
    })
    .select()
    .single();
  if (error) throw error;
  await safeAudit({
    entityType: 'bn_claim_queue_assignment',
    entityId: (data as any)?.id ?? null,
    action: 'ASSIGN_CLAIM',
    performedBy: '',
    afterValue: data as any,
  });
  return data as BnClaimQueueAssignment;
}

export async function pickClaim(assignmentId: string, userCode: string): Promise<void> {
  const { error } = await db
    .from('bn_claim_queue_assignment')
    .update({ assigned_to: userCode, picked_at: new Date().toISOString() })
    .eq('id', assignmentId);
  if (error) throw error;
  await safeAudit({
    entityType: 'bn_claim_queue_assignment',
    entityId: assignmentId,
    action: 'PICK_CLAIM',
    performedBy: userCode,
    afterValue: { assigned_to: userCode },
  });
}

export async function releaseClaim(assignmentId: string): Promise<void> {
  const { error } = await db
    .from('bn_claim_queue_assignment')
    .update({ assigned_to: null, picked_at: null })
    .eq('id', assignmentId);
  if (error) throw error;
  await safeAudit({
    entityType: 'bn_claim_queue_assignment',
    entityId: assignmentId,
    action: 'RELEASE_CLAIM',
    performedBy: '',
  });
}

export async function completeClaim(assignmentId: string): Promise<void> {
  const { error } = await db
    .from('bn_claim_queue_assignment')
    .update({ completed_at: new Date().toISOString(), is_active: false })
    .eq('id', assignmentId);
  if (error) throw error;
  await safeAudit({
    entityType: 'bn_claim_queue_assignment',
    entityId: assignmentId,
    action: 'COMPLETE_CLAIM',
    performedBy: '',
  });
}

export interface BasketClaimCount {
  total: number;
  overdue: number;
}

/** Active, uncompleted assignment counts per workbasket. */
export async function fetchBasketClaimCounts(
  basketIds: string[],
): Promise<Record<string, BasketClaimCount>> {
  if (basketIds.length === 0) return {};
  const { data, error } = await db
    .from('bn_claim_queue_assignment')
    .select('workbasket_id, due_at')
    .in('workbasket_id', basketIds)
    .eq('is_active', true)
    .is('completed_at', null);
  if (error) throw error;

  const now = Date.now();
  const out: Record<string, BasketClaimCount> = {};
  for (const row of (data || []) as { workbasket_id: string; due_at: string | null }[]) {
    const bucket = (out[row.workbasket_id] ||= { total: 0, overdue: 0 });
    bucket.total += 1;
    if (row.due_at && new Date(row.due_at).getTime() < now) bucket.overdue += 1;
  }
  return out;
}
