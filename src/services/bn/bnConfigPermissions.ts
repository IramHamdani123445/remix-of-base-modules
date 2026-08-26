/**
 * Benefits Configuration — governance permission checks.
 *
 * Approving, rejecting and publishing a product rule version is a distinct
 * right (`bn_configuration.approve`), not a side effect of holding edit.
 * The UI hides those controls, and the governance service calls the same
 * check before acting so the rule still holds when the UI is bypassed.
 *
 * Maker-checker (approver must differ from the author) is enforced separately
 * in `rulesAdminService` — this permission is an additional requirement, not a
 * replacement for it.
 */
import { supabase } from '@/integrations/supabase/client';
import { fetchAllUserPermissions } from '@/lib/permissions/fetchAllUserPermissions';

export const BN_CONFIG_MODULE = 'bn_configuration';
export const BN_CONFIG_APPROVE_ACTION = 'approve';

export const BN_CONFIG_APPROVE_DENIED =
  'You do not have approval rights for benefit configuration. Ask a user with the Benefits Configuration "Approve" permission (for example BN_CONFIG_ADMIN) to action this version.';

/** True when the signed-in user may approve / reject / publish rule versions. */
export async function canApproveBnConfiguration(): Promise<boolean> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) return false;

  try {
    const { data: isAdmin } = await (supabase.rpc as any)('is_admin', { _user_id: userId });
    if (isAdmin) return true;
  } catch {
    // fall through to the permission set
  }

  try {
    const permissions = await fetchAllUserPermissions(userId);
    return permissions.some(
      (p) =>
        p.module_name === BN_CONFIG_MODULE &&
        p.action_name === BN_CONFIG_APPROVE_ACTION &&
        p.is_granted !== false
    );
  } catch {
    return false;
  }
}

/**
 * Guard for governance service calls. Returns an error message when the caller
 * lacks the approval right, or `null` when the action may proceed.
 */
export async function assertBnConfigApprovePermission(): Promise<string | null> {
  return (await canApproveBnConfiguration()) ? null : BN_CONFIG_APPROVE_DENIED;
}
