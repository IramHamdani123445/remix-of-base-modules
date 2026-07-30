/**
 * Rule 12 — OMNI_HEALTH_DIAGNOSTIC_BOUNDARY.
 *
 * The Health surface (Readiness + Live Diagnostics) is a READ-ONLY, bounded
 * diagnostic view. Health files must not:
 *   - read omni_comms_* or provider metadata tables directly (`.from(...)`);
 *   - import runtime mutation internals (sendCommunication / runtime RPC
 *     internals);
 *   - import provider SDKs;
 *   - import the Legacy Communication Hub;
 *   - expose secret material (secret_ref, api keys, JWT / authorization
 *     headers).
 *
 * Additionally guards the permanent route ceiling of SEVEN admin routes:
 * an eighth permanent Omni-Comms admin route is rejected.
 */
import type {
  ArchitectureViolation,
  RepositoryScan,
} from '../architectureCheck.types';
import {
  LEGACY_IMPORT_PATTERNS,
  PROVIDER_SDK_PACKAGES,
  isRuleMetadataFile,
} from '../architecturePolicy';

/** Files that make up the Health surface. */
export function isHealthSurfaceFile(filePath: string): boolean {
  const p = filePath.replace(/\\/g, '/');
  if (/^src\/platform\/omni-comms\/admin\/views\/health\//.test(p)) return true;
  if (/^src\/platform\/omni-comms\/admin\/views\/readiness\//.test(p)) return true;
  if (/^src\/platform\/omni-comms\/admin\/views\/OmniCommsHealthPage\.tsx$/.test(p)) return true;
  if (/^src\/platform\/omni-comms\/application\/healthDiagnostics(Service|Types)\.ts$/.test(p)) return true;
  if (/^src\/platform\/omni-comms\/admin\/hooks\/useOmniCommsEdgeHealthProbe\.ts$/.test(p)) return true;
  if (/^src\/pages\/admin\/omnichannel-communications\/HealthPage\.tsx$/.test(p)) return true;
  return false;
}

const TABLE_READ_RE =
  /\.from\(\s*['"`](omni_comms_[a-z0-9_]+|notification_providers|notification_queue|notification_logs)['"`]\s*\)/g;

const MUTATION_IMPORT_RE =
  /from\s*['"`][^'"`]*(sendCommunication|runtime\/persistence|runtimeMutation|renderStage)['"`]/g;

const SECRET_TOKENS = [
  'secret_ref',
  'service_role_key',
  'SUPABASE_SERVICE_ROLE_KEY',
  'x-provider-api-key',
];

const PERMANENT_ROUTE_RE = /['"`]\/admin\/omnichannel-communications(?:\/[a-z-]+)?['"`]/g;
const APPROVED_ROUTES = new Set([
  '/admin/omnichannel-communications',
  '/admin/omnichannel-communications/operations',
  '/admin/omnichannel-communications/events',
  '/admin/omnichannel-communications/templates',
  '/admin/omnichannel-communications/channels',
  '/admin/omnichannel-communications/preferences',
  '/admin/omnichannel-communications/health',
]);

function push(
  out: ArchitectureViolation[],
  filePath: string,
  evidence: string,
  message: string,
  remediation: string,
): void {
  out.push({
    ruleId: 'OMNI_HEALTH_DIAGNOSTIC_BOUNDARY',
    severity: 'error',
    filePath,
    evidence,
    message,
    remediation,
    baselineStatus: 'not_baselined',
  });
}

export function checkHealthBoundary(scan: RepositoryScan): ArchitectureViolation[] {
  const out: ArchitectureViolation[] = [];

  for (const f of scan.files) {
    if (isRuleMetadataFile(f.filePath)) continue;
    if (!/\.(ts|tsx|js|jsx)$/.test(f.filePath)) continue;

    // Route ceiling — applies to every Omni-Comms file, not only Health.
    PERMANENT_ROUTE_RE.lastIndex = 0;
    let rm: RegExpExecArray | null;
    while ((rm = PERMANENT_ROUTE_RE.exec(f.content)) !== null) {
      const route = rm[0].slice(1, -1);
      if (!APPROVED_ROUTES.has(route)) {
        push(
          out,
          f.filePath,
          rm[0],
          `Unapproved permanent Omni-Comms admin route "${route}" — the ceiling is exactly seven routes.`,
          'Use tabs, panels or query parameters on an existing permanent route instead of adding an eighth route.',
        );
      }
    }

    if (!isHealthSurfaceFile(f.filePath)) continue;

    TABLE_READ_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TABLE_READ_RE.exec(f.content)) !== null) {
      push(
        out,
        f.filePath,
        m[0],
        'Health surface reads a communication table directly.',
        'Read live state only through the bounded omni_comms_health_* RPCs.',
      );
    }

    MUTATION_IMPORT_RE.lastIndex = 0;
    while ((m = MUTATION_IMPORT_RE.exec(f.content)) !== null) {
      push(
        out,
        f.filePath,
        m[0].trim(),
        'Health surface imports runtime mutation internals.',
        'Health must be read-only: never import the send façade or runtime persistence internals.',
      );
    }

    for (const pkg of PROVIDER_SDK_PACKAGES) {
      const clean = pkg.replace(/\/$/, '');
      const re = new RegExp(`from\\s*['"\`]${clean}(?:/[^'"\`]*)?['"\`]`, 'g');
      let pm: RegExpExecArray | null;
      while ((pm = re.exec(f.content)) !== null) {
        push(
          out,
          f.filePath,
          pm[0].trim(),
          `Health surface imports provider SDK "${clean}".`,
          'Health must never contact a provider. Remove the provider import.',
        );
      }
    }

    for (const root of LEGACY_IMPORT_PATTERNS) {
      if (f.content.includes(root)) {
        push(
          out,
          f.filePath,
          root,
          'Health surface references the Legacy Communication Hub.',
          'Omni-Comms Health must not read, import or reference Legacy Hub code.',
        );
      }
    }

    for (const token of SECRET_TOKENS) {
      if (f.content.includes(token)) {
        push(
          out,
          f.filePath,
          token,
          'Health surface references secret material.',
          'Diagnostics may expose counts, statuses, timestamps and availability only.',
        );
      }
    }
  }

  return out;
}
