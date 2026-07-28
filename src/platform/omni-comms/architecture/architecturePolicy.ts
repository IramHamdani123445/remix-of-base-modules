/**
 * Omni-Comms — Architecture policy constants.
 *
 * Verified Legacy paths, Legacy table names, provider SDK packages, permanent
 * name vocabulary, scan exclusions and repository landmarks used by every
 * architecture check. No I/O.
 */

/** New-system roots (zero-tolerance scope). POSIX-style, trailing slash. */
export const NEW_SYSTEM_ROOTS: readonly string[] = [
  'src/platform/omni-comms/',
  'src/pages/admin/omnichannel-communications/',
];

/** Provider adapter root — the ONLY place provider SDKs may be imported. */
export const PROVIDER_ADAPTER_ROOT = 'src/platform/omni-comms/adapters/providers/';

/**
 * Verified Legacy Communication Hub import roots. Reference substrings are
 * matched against import specifiers (post-alias, e.g. `@/platform/...`) and
 * against absolute POSIX paths for relative imports.
 */
export const LEGACY_IMPORT_PATTERNS: readonly string[] = [
  '@/platform/communication-hub',
  '@/pages/admin/communicationHub',
  '@/adapters/notificationsAdapter',
  '@/modules/benefits/communication/',
  '@/modules/compliance/communication/',
  '@/modules/employerRegistration/communication/',
  '@/modules/insuredPerson/communication/',
  '@/modules/legal/communication/',
  'src/platform/communication-hub/',
  'src/pages/admin/communicationHub/',
];

/** Verified Legacy communication tables prohibited in the new system. */
export const LEGACY_COMMUNICATION_TABLES: readonly string[] = [
  'communication_request',
  'communication_message',
  'communication_event_log',
  'communication_deliveries',
  'communication_delivery_attempts',
  'communication_retry_policies',
  'notification_queue',
  'notification_logs',
  'notification_providers',
  'email_campaigns',
  'in_app_notifications',
  'bn_communication_log',
  'ce_audit_communications',
  'ce_notice_delivery_log',
];

/**
 * Provider SDK package names watched by Rule 3. A leading `@scope/` entry
 * matches any submodule under that scope.
 */
export const PROVIDER_SDK_PACKAGES: readonly string[] = [
  'resend',
  'twilio',
  '@twilio/',
  'firebase-admin',
  '@sendgrid/',
  'nodemailer',
  'whatsapp-web.js',
  'node-mailer',
];

/**
 * Runtime tables React code may NEVER write to directly. Derived from the
 * runtime category of the object registry to keep the two in lock-step.
 */
export const RUNTIME_TABLES: readonly string[] = [
  'omni_comms_batch',
  'omni_comms_request',
  'omni_comms_recipient',
  'omni_comms_message',
  'omni_comms_dispatch_job',
  'omni_comms_delivery_attempt',
  'omni_comms_message_event',
  'omni_comms_webhook_event',
];

/** Forbidden permanent-name segments (matched between `_` or `-` boundaries). */
export const FORBIDDEN_NAME_SEGMENTS: readonly string[] = [
  'advanced',
  'new',
  'next',
  'v2',
  'pilot',
  'controlled',
  'rehearsal',
  'standby',
  'phase',
];

/** Prohibited omni-comms edge-function names (even if a name check would pass). */
export const PROHIBITED_INTEGRATION_NAMES: readonly string[] = [
  'omni-comms-render',
];

/** Prohibited queue names / delivery classes. */
export const PROHIBITED_QUEUE_NAMES: readonly string[] = [
  'omni-comms.render',
  'omni-comms.rendering',
];

/** Repository landmarks. */
export const ROUTE_REGISTRATION_FILE = 'src/components/routing/AppRoutes.tsx';
export const MIGRATIONS_DIR = 'supabase/migrations';
export const FUNCTIONS_DIR = 'supabase/functions';

/** Directories excluded from every scan. */
export const SCAN_EXCLUDE_DIRS: readonly string[] = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
  '.vite',
  '.parcel-cache',
];

/** File suffixes considered by scans. */
export const SCAN_INCLUDE_SUFFIXES: readonly string[] = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.sql',
  '.yml',
  '.yaml',
  '.json',
  '.toml',
];

/** Returns true when a POSIX file path is inside a new-system root. */
export function isInNewSystem(filePath: string): boolean {
  const p = filePath.replace(/\\/g, '/');
  return NEW_SYSTEM_ROOTS.some((root) => p.startsWith(root));
}

/** Returns true when a POSIX file path is inside the provider adapter root. */
export function isInProviderAdapterRoot(filePath: string): boolean {
  return filePath.replace(/\\/g, '/').startsWith(PROVIDER_ADAPTER_ROOT);
}
