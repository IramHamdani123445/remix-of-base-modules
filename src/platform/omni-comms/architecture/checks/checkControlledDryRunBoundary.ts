/**
 * Rule 14 — OMNI_CONTROLLED_DRY_RUN_BOUNDARY.
 *
 * The Controlled Dry-Run Test Surface is an ADMINISTRATION test path. It may
 * create exactly one Omni-Comms runtime request in `dry_run` mode through the
 * canonical façade, and nothing else.
 *
 * Dry-run surface files must not:
 *   - import or reference a provider SDK;
 *   - import runtime internals (`src/platform/omni-comms/runtime/**`) or
 *     invoke the Edge Function directly (`functions.invoke`);
 *   - call a private (`omni_comms_priv_*`) RPC;
 *   - call an RPC outside the approved bounded set;
 *   - read or write any table directly (`.from(...)`);
 *   - reference dispatch/queue/delivery/live-send vocabulary
 *     (enqueue, dispatch job creation, delivery attempt creation,
 *      shadow mode, queued mode, live delivery, cutover);
 *   - reference the Legacy Communication Hub;
 *   - hardcode a non-example.com recipient address;
 *   - submit any mode other than `dry_run`.
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

/** Files that make up the Controlled Dry-Run surface. */
export function isControlledDryRunFile(filePath: string): boolean {
  const p = filePath.replace(/\\/g, '/');
  if (/^src\/platform\/omni-comms\/admin\/views\/dryrun\//.test(p)) return true;
  if (
    /^src\/platform\/omni-comms\/application\/controlledDryRun(Service|Types)\.ts$/.test(p)
  ) {
    return true;
  }
  return false;
}

/** The ONLY RPC names the dry-run surface may reference. */
const ALLOWED_RPCS = new Set([
  'omni_comms_controlled_dry_run_gate',
  'omni_comms_validate_dry_run_payload',
  'omni_comms_setup_readiness',
  'omni_comms_event_definition_list',
  'omni_comms_event_contract_list',
  'omni_comms_event_contract_get',
  'omni_comms_ops_request_detail',
]);

const RPC_LITERAL_RE = /['"`](omni_comms_[a-z0-9_]+)['"`]/g;
const PRIVATE_RPC_RE = /omni_comms_priv_[a-z0-9_]+/g;
const TABLE_ACCESS_RE = /\.from\(\s*['"`][a-z0-9_]+['"`]\s*\)/g;
const EDGE_INVOKE_RE = /functions\s*\.\s*invoke\s*\(/g;
const RUNTIME_IMPORT_RE =
  /from\s*['"`](?:@\/platform\/omni-comms\/runtime|\.\.\/runtime|\.\/runtime|src\/platform\/omni-comms\/runtime)[^'"`]*['"`]/g;
const NON_DRY_RUN_MODE_RE = /\bmode\s*:\s*['"`](?!dry_run)([a-z_]+)['"`]/g;
const LIVE_DELIVERY_RE = /\blive_delivery\b(?!_enabled)/g;
const EMAIL_LITERAL_RE = /['"`][A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})['"`]/g;

/** Escalation vocabulary that must never appear on this surface. */
const FORBIDDEN_TOKENS = [
  'enqueueDispatch',
  'createDispatchJob',
  'createDeliveryAttempt',
  'shadow_mode',
  'shadowMode',
  'queued_mode',
  'queuedMode',
  'liveDelivery',
  'production_cutover',
  'productionCutover',
];

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
    ruleId: 'OMNI_CONTROLLED_DRY_RUN_BOUNDARY',
    severity: 'error',
    filePath,
    evidence,
    message,
    remediation,
    baselineStatus: 'not_baselined',
  });
}

export function checkControlledDryRunBoundary(
  scan: RepositoryScan,
): ArchitectureViolation[] {
  const out: ArchitectureViolation[] = [];

  for (const f of scan.files) {
    if (isRuleMetadataFile(f.filePath)) continue;
    if (!/\.(ts|tsx|js|jsx)$/.test(f.filePath)) continue;
    if (!isControlledDryRunFile(f.filePath)) continue;

    let m: RegExpExecArray | null;

    PRIVATE_RPC_RE.lastIndex = 0;
    while ((m = PRIVATE_RPC_RE.exec(f.content)) !== null) {
      push(
        out,
        f.filePath,
        m[0],
        'Dry-run surface references a private runtime RPC.',
        'The dry-run surface may only use the canonical façade and the approved read RPCs.',
      );
    }

    RPC_LITERAL_RE.lastIndex = 0;
    while ((m = RPC_LITERAL_RE.exec(f.content)) !== null) {
      const name = m[1];
      if (ALLOWED_RPCS.has(name)) continue;
      if (name.startsWith('omni_comms_priv_')) continue; // already reported
      push(
        out,
        f.filePath,
        m[0],
        `Dry-run surface references the non-approved RPC "${name}".`,
        'Extend the approved bounded RPC set only with a governed amendment.',
      );
    }

    TABLE_ACCESS_RE.lastIndex = 0;
    while ((m = TABLE_ACCESS_RE.exec(f.content)) !== null) {
      push(
        out,
        f.filePath,
        m[0],
        'Dry-run surface accesses a table directly.',
        'All reads must go through the approved bounded RPCs.',
      );
    }

    EDGE_INVOKE_RE.lastIndex = 0;
    while ((m = EDGE_INVOKE_RE.exec(f.content)) !== null) {
      push(
        out,
        f.filePath,
        m[0],
        'Dry-run surface invokes an Edge Function directly.',
        'Submit only through the canonical sendCommunication() façade.',
      );
    }

    RUNTIME_IMPORT_RE.lastIndex = 0;
    while ((m = RUNTIME_IMPORT_RE.exec(f.content)) !== null) {
      push(
        out,
        f.filePath,
        m[0].trim(),
        'Dry-run surface imports runtime internals.',
        'Import the canonical façade only; runtime internals stay server-trusted.',
      );
    }

    NON_DRY_RUN_MODE_RE.lastIndex = 0;
    while ((m = NON_DRY_RUN_MODE_RE.exec(f.content)) !== null) {
      push(
        out,
        f.filePath,
        m[0].trim(),
        `Dry-run surface submits mode "${m[1]}".`,
        'The administration test surface may only submit mode: "dry_run".',
      );
    }

    EMAIL_LITERAL_RE.lastIndex = 0;
    while ((m = EMAIL_LITERAL_RE.exec(f.content)) !== null) {
      if (m[1].toLowerCase() === 'example.com') continue;
      push(
        out,
        f.filePath,
        m[0],
        `Dry-run surface hardcodes a non-example.com address ("${m[1]}").`,
        'Administration test recipients must always use the example.com domain.',
      );
    }

    // `live_delivery` is forbidden EXCEPT as the read-only gate status field
    // `live_delivery_enabled`, which reports that delivery is switched off.
    LIVE_DELIVERY_RE.lastIndex = 0;
    while ((m = LIVE_DELIVERY_RE.exec(f.content)) !== null) {
      push(
        out,
        f.filePath,
        m[0],
        'Dry-run surface references live delivery.',
        'The controlled dry run must never queue, dispatch, shadow-send or go live.',
      );
    }

    for (const token of FORBIDDEN_TOKENS) {
      if (f.content.includes(token)) {
        push(
          out,
          f.filePath,
          token,
          `Dry-run surface references escalation vocabulary "${token}".`,
          'The controlled dry run must never queue, dispatch, shadow-send or go live.',
        );
      }
    }

    for (const token of SECRET_TOKENS) {
      if (f.content.includes(token)) {
        push(
          out,
          f.filePath,
          token,
          'Dry-run surface references secret material.',
          'Show statuses, checksums, counts and timestamps only.',
        );
      }
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
          `Dry-run surface imports provider SDK "${clean}".`,
          'A controlled dry run must never contact a provider.',
        );
      }
    }

    for (const root of LEGACY_IMPORT_PATTERNS) {
      if (f.content.includes(root)) {
        push(
          out,
          f.filePath,
          root,
          'Dry-run surface references the Legacy Communication Hub.',
          'The controlled dry run must not read, import or modify Legacy Hub code.',
        );
      }
    }
  }

  return out;
}
