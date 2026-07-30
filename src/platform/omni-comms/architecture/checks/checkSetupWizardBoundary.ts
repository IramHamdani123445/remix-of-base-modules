/**
 * Rule 13 — OMNI_SETUP_WIZARD_BOUNDARY.
 *
 * The Setup Wizard is READ-ONLY guidance rendered inside the existing
 * Overview permanent route. Setup Wizard files must not:
 *   - read omni_comms_* / provider metadata tables directly (`.from(...)`);
 *   - call any RPC other than the single bounded `omni_comms_setup_readiness`
 *     aggregate and the event-picker catalogue reads;
 *   - import runtime mutation internals or the send façade;
 *   - import a provider SDK;
 *   - import or reference the Legacy Communication Hub;
 *   - expose secret material;
 *   - perform configuration writes (insert/update/upsert/delete) or enqueue.
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

/** Files that make up the Setup Wizard surface. */
export function isSetupWizardFile(filePath: string): boolean {
  const p = filePath.replace(/\\/g, '/');
  if (/^src\/platform\/omni-comms\/admin\/views\/setup\//.test(p)) return true;
  if (/^src\/platform\/omni-comms\/application\/setupReadiness(Service|Types)\.ts$/.test(p)) {
    return true;
  }
  return false;
}

const TABLE_READ_RE =
  /\.from\(\s*['"`](omni_comms_[a-z0-9_]+|core_comm_[a-z0-9_]+|core_template_[a-z0-9_]+|notification_[a-z0-9_]+)['"`]\s*\)/g;

/** Only these RPC names may appear in Setup Wizard files. */
const ALLOWED_RPCS = new Set([
  'omni_comms_setup_readiness',
  'omni_comms_event_definition_list',
]);

const RPC_LITERAL_RE = /['"`](omni_comms_[a-z0-9_]+)['"`]/g;

const MUTATION_IMPORT_RE =
  /from\s*['"`][^'"`]*(sendCommunication|runtime\/persistence|runtimeMutation|renderStage)['"`]/g;

const WRITE_CALL_RE = /\.(insert|update|upsert|delete)\(/g;

const SECRET_TOKENS = [
  'secret_ref',
  'service_role_key',
  'SUPABASE_SERVICE_ROLE_KEY',
  'x-provider-api-key',
];

function push(
  out: ArchitectureViolation[],
  filePath: string,
  evidence: string,
  message: string,
  remediation: string,
): void {
  out.push({
    ruleId: 'OMNI_SETUP_WIZARD_BOUNDARY',
    severity: 'error',
    filePath,
    evidence,
    message,
    remediation,
    baselineStatus: 'not_baselined',
  });
}

export function checkSetupWizardBoundary(
  scan: RepositoryScan,
): ArchitectureViolation[] {
  const out: ArchitectureViolation[] = [];

  for (const f of scan.files) {
    if (isRuleMetadataFile(f.filePath)) continue;
    if (!/\.(ts|tsx|js|jsx)$/.test(f.filePath)) continue;
    if (!isSetupWizardFile(f.filePath)) continue;

    let m: RegExpExecArray | null;

    TABLE_READ_RE.lastIndex = 0;
    while ((m = TABLE_READ_RE.exec(f.content)) !== null) {
      push(
        out,
        f.filePath,
        m[0],
        'Setup Wizard reads a configuration table directly.',
        'Read setup state only through the bounded omni_comms_setup_readiness RPC.',
      );
    }

    RPC_LITERAL_RE.lastIndex = 0;
    while ((m = RPC_LITERAL_RE.exec(f.content)) !== null) {
      const name = m[1];
      if (ALLOWED_RPCS.has(name)) continue;
      push(
        out,
        f.filePath,
        m[0],
        `Setup Wizard references the non-approved RPC "${name}".`,
        'The Setup Wizard may only call omni_comms_setup_readiness plus the event-definition picker read.',
      );
    }

    MUTATION_IMPORT_RE.lastIndex = 0;
    while ((m = MUTATION_IMPORT_RE.exec(f.content)) !== null) {
      push(
        out,
        f.filePath,
        m[0].trim(),
        'Setup Wizard imports runtime mutation internals.',
        'The wizard must be read-only: never import the send façade or runtime persistence internals.',
      );
    }

    WRITE_CALL_RE.lastIndex = 0;
    while ((m = WRITE_CALL_RE.exec(f.content)) !== null) {
      push(
        out,
        f.filePath,
        m[0],
        'Setup Wizard performs a data write.',
        'The wizard guides and links only. Configuration changes belong on the owning admin screen.',
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
          `Setup Wizard imports provider SDK "${clean}".`,
          'The wizard must never contact a provider. Remove the provider import.',
        );
      }
    }

    for (const root of LEGACY_IMPORT_PATTERNS) {
      if (f.content.includes(root)) {
        push(
          out,
          f.filePath,
          root,
          'Setup Wizard references the Legacy Communication Hub.',
          'Omni-Comms setup guidance must not read, import or reference Legacy Hub code.',
        );
      }
    }

    for (const token of SECRET_TOKENS) {
      if (f.content.includes(token)) {
        push(
          out,
          f.filePath,
          token,
          'Setup Wizard references secret material.',
          'Guidance may expose statuses, timestamps, checksums and availability only.',
        );
      }
    }
  }

  return out;
}
