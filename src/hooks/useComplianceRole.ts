import { useMemo } from 'react';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import type { ComplianceOperationalRole } from '@/lib/compliance/capabilities';

/**
 * Derives the user's operational role inside the Compliance & Enforcement module.
 * Resolution priority: Admin/ComplianceHead > SeniorInspector > ComplianceInspector > other.
 *
 * Platform administrators (Admin / SuperAdmin / System Administrator) are treated
 * as Compliance Head so they retain the full supervisory action set — assignment,
 * reassignment, verification and reopening — on the Admin Panel.
 */

export function useComplianceRole(): ComplianceOperationalRole {
  const auth = useSupabaseAuth() as any;

  return useMemo<ComplianceOperationalRole>(() => {
    const collected: string[] = [];
    // Top-level roles array (canonical source from auth context)
    if (Array.isArray(auth?.roles)) collected.push(...auth.roles);
    // Profile fallbacks (legacy shapes)
    const profile = auth?.profile;
    if (Array.isArray(profile?.roles)) collected.push(...profile.roles);
    if (Array.isArray(profile?.role_names)) collected.push(...profile.role_names);
    if (typeof profile?.role === 'string') collected.push(profile.role);
    if (typeof profile?.role_name === 'string') collected.push(profile.role_name);

    const names = collected.map((r) => String(r).toLowerCase());

    const isAdmin = names.some(
      (n) =>
        n === 'admin' ||
        n === 'administrator' ||
        n === 'superadmin' ||
        n === 'super admin' ||
        n === 'super_admin' ||
        n === 'systemadmin' ||
        n === 'system administrator' ||
        n.includes('systemadministrator'),
    );
    if (isAdmin) return 'head';
    if (names.some((n) => n.includes('compliancehead') || n === 'compliance head')) return 'head';

    if (names.some((n) => n.includes('seniorinspector') || n === 'senior inspector')) return 'senior';
    if (
      names.some(
        (n) =>
          n.includes('complianceinspector') ||
          n === 'compliance inspector' ||
          n === 'inspector',
      )
    ) {
      return 'inspector';
    }
    return 'other';
  }, [auth?.roles, auth?.profile]);
}
