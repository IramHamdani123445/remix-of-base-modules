import React from 'react';
import { AccessDenied } from '@/components/auth/AccessDenied';
import { useInternalAuditPermissions } from '@/hooks/useInternalAuditPermissions';
import { Skeleton } from '@/components/ui/skeleton';

export interface AuditEntitlementRequirement {
  module: string;
  action: string;
}

interface AuditEntitlementGateProps {
  /** User must hold at least ONE of these registry entitlements. */
  anyOf: AuditEntitlementRequirement[];
  message?: string;
  children: React.ReactNode;
}

/**
 * Server-aligned entitlement gate for Internal Audit administration screens.
 *
 * Feature flags say whether a capability EXISTS. This gate says whether the
 * signed-in persona is ENTITLED to it, so unentitled personas (Lead Auditor,
 * Auditor, Management) never see administration surfaces or their controls.
 * Data itself remains protected by RLS — this removes the UI advertisement.
 */
export function AuditEntitlementGate({ anyOf, message, children }: AuditEntitlementGateProps) {
  const { isLoading, has } = useInternalAuditPermissions();

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const entitled = anyOf.some((req) => has(req.module, req.action));

  if (!entitled) {
    return (
      <AccessDenied
        message={
          message ??
          'This is an Internal Audit administration screen. Your role does not hold the required configuration entitlement.'
        }
      />
    );
  }

  return <>{children}</>;
}

/** Canonical entitlement set for Internal Audit configuration / reference data. */
export const AUDIT_ADMIN_ENTITLEMENTS: AuditEntitlementRequirement[] = [
  { module: 'audit_configuration', action: 'configure' },
  { module: 'internal_audit_configuration', action: 'view' },
];
