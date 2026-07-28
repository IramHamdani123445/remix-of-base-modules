import type { PermissionSourceDefinition } from './permissionTypes';

/**
 * Omnichannel Communications capability definitions.
 *
 * This is the parallel replacement for Communication Hub — Legacy. Capability
 * keys are namespaced `omni_comms.*` and are registered through the existing
 * permission-registry pattern (see `permissionRegistry.ts` +
 * `syncPermissionsFromRegistry`). No new roles are created here.
 *
 * Epic 1 — Story 1: only `omni_comms.view` is mapped (to the existing Admin
 * system role) via the accompanying DB seed. The remaining five capabilities
 * are registered as `PLANNED` and remain unmapped until later stories.
 */

const SF = 'src/platform/rbac/omniComms.permissions.ts';

export const OMNI_COMMS_PERMISSIONS = {
  view: 'omni_comms.view',
  operate: 'omni_comms.operate',
  configure: 'omni_comms.configure',
  authorTemplates: 'omni_comms.author_templates',
  approveTemplates: 'omni_comms.approve_templates',
  viewSensitiveContent: 'omni_comms.view_sensitive_content',
} as const;

export const OMNI_COMMS_PERMISSION_DEFINITIONS: PermissionSourceDefinition[] = [
  {
    permission_key: OMNI_COMMS_PERMISSIONS.view,
    permission_name: 'View Omnichannel Communications',
    description: 'Access the Omnichannel Communications admin shell and its subpages.',
    module_code: 'OMNI_COMMS',
    domain_code: 'COMMUNICATIONS',
    permission_scope: 'PAGE',
    action_code: 'view',
    is_platform_permission: true,
    is_admin_permission: true,
    is_sensitive_permission: false,
    risk_level: 'LOW',
    lifecycle_status: 'ACTIVE',
    source_file: SF,
  },
  {
    permission_key: OMNI_COMMS_PERMISSIONS.operate,
    permission_name: 'Operate Omnichannel Communications',
    description: 'Perform operational actions (retry, resend, cancel, suppress) inside Omnichannel Communications. Reserved for future stories.',
    module_code: 'OMNI_COMMS',
    domain_code: 'COMMUNICATIONS',
    permission_scope: 'ACTION',
    action_code: 'operate',
    is_platform_permission: true,
    is_admin_permission: true,
    is_sensitive_permission: true,
    risk_level: 'HIGH',
    lifecycle_status: 'PLANNED',
    source_file: SF,
  },
  {
    permission_key: OMNI_COMMS_PERMISSIONS.configure,
    permission_name: 'Configure Omnichannel Communications',
    description: 'Manage channels, providers, preferences and other configuration inside Omnichannel Communications. Reserved for future stories.',
    module_code: 'OMNI_COMMS',
    domain_code: 'COMMUNICATIONS',
    permission_scope: 'ADMIN',
    action_code: 'configure',
    is_platform_permission: true,
    is_admin_permission: true,
    is_sensitive_permission: true,
    risk_level: 'HIGH',
    lifecycle_status: 'PLANNED',
    source_file: SF,
  },
  {
    permission_key: OMNI_COMMS_PERMISSIONS.authorTemplates,
    permission_name: 'Author Omni-Comms Templates',
    description: 'Draft and edit Omnichannel Communications templates. Reserved for future stories.',
    module_code: 'OMNI_COMMS',
    domain_code: 'COMMUNICATIONS',
    permission_scope: 'ACTION',
    action_code: 'author_templates',
    is_platform_permission: true,
    is_admin_permission: true,
    is_sensitive_permission: true,
    risk_level: 'MEDIUM',
    lifecycle_status: 'PLANNED',
    source_file: SF,
  },
  {
    permission_key: OMNI_COMMS_PERMISSIONS.approveTemplates,
    permission_name: 'Approve Omni-Comms Templates',
    description: 'Approve Omnichannel Communications templates for controlled or production use. Reserved for future stories.',
    module_code: 'OMNI_COMMS',
    domain_code: 'COMMUNICATIONS',
    permission_scope: 'ACTION',
    action_code: 'approve_templates',
    is_platform_permission: true,
    is_admin_permission: true,
    is_sensitive_permission: true,
    risk_level: 'HIGH',
    lifecycle_status: 'PLANNED',
    source_file: SF,
  },
  {
    permission_key: OMNI_COMMS_PERMISSIONS.viewSensitiveContent,
    permission_name: 'View Sensitive Omni-Comms Content',
    description: 'Unmask PII / sensitive payload content in Omnichannel Communications trace and audit views. Reserved for future stories.',
    module_code: 'OMNI_COMMS',
    domain_code: 'COMMUNICATIONS',
    permission_scope: 'FIELD',
    action_code: 'view_sensitive_content',
    is_platform_permission: true,
    is_admin_permission: true,
    is_sensitive_permission: true,
    risk_level: 'HIGH',
    lifecycle_status: 'PLANNED',
    source_file: SF,
  },
];
