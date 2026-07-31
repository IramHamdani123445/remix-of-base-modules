/**
 * Rule 15 — OMNI_TEMPLATE_LAYOUT_BOUNDARY.
 *
 * Template layout selection is a GOVERNED configuration decision persisted on
 * the template version by the database. The administration surface may only
 * present the persisted selection and submit a change through the single
 * authorised RPC.
 *
 * Layout-selection surface files must not:
 *   - read or write `core_template_layout*`, `core_comm_*` or
 *     `omni_comms_template_version*` tables directly (`.from(...)`);
 *   - reference a private (`omni_comms_priv_*`) RPC;
 *   - reference an RPC outside the approved bounded set;
 *   - invoke an Edge Function directly;
 *   - import runtime internals;
 *   - import a provider SDK or reference the Legacy Communication Hub;
 *   - persist a layout selection without optimistic concurrency
 *     (`expectedUpdatedAt`);
 *   - re-implement the approval gate as a client-side bypass
 *     (no direct approve call from the layout dialog).
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

/** Files that make up the template layout-selection surface. */
export function isTemplateLayoutFile(filePath: string): boolean {
  const p = filePath.replace(/\\/g, '/');
  if (p === 'src/platform/omni-comms/admin/components/OmniCommsLayoutSelectionDialog.tsx') return true;
  if (p === 'src/platform/omni-comms/application/templateLayoutSelection.ts') return true;
  return false;
}

/** The ONLY RPC names the layout-selection surface may reference. */
export const TEMPLATE_LAYOUT_ALLOWED_RPCS = new Set([
  'core_template_layout_list_active',
  'core_template_layout_version_list_published',
  'omni_comms_template_version_set_layout_selection',
  'omni_comms_template_version_get',
]);

// Only true string literals count; backticked prose in comments does not.
const RPC_LITERAL_RE = /['"](core_template_[a-z0-9_]+|omni_comms_[a-z0-9_]+)['"]/g;
const PRIVATE_RPC_RE = /omni_comms_priv_[a-z0-9_]+/g;
const TABLE_ACCESS_RE = /\.from\(\s*['"`][a-z0-9_]+['"`]\s*\)/g;
const EDGE_INVOKE_RE = /functions\s*\.\s*invoke\s*\(/g;
const RUNTIME_IMPORT_RE =
  /from\s*['"`](?:@\/platform\/omni-comms\/runtime|\.\.\/runtime|\.\/runtime|src\/platform\/omni-comms\/runtime)[^'"`]*['"`]/g;
const APPROVE_CALL_RE = /\bapproveTemplateVersion\s*\(/g;
const SET_LAYOUT_CALL_RE = /setTemplateVersionLayoutSelection\s*\(/g;

function push(
  out: ArchitectureViolation[],
  filePath: string,
  evidence: string,
  message: string,
  remediation: string,
): void {
  out.push({
    ruleId: 'OMNI_TEMPLATE_LAYOUT_BOUNDARY',
    severity: 'error',
    filePath,
    evidence,
    message,
    remediation,
    baselineStatus: 'not_baselined',
  });
}

export function checkTemplateLayoutBoundary(
  scan: RepositoryScan,
): ArchitectureViolation[] {
  const out: ArchitectureViolation[] = [];

  for (const f of scan.files) {
    if (isRuleMetadataFile(f.filePath)) continue;
    if (!/\.(ts|tsx|js|jsx)$/.test(f.filePath)) continue;
    if (!isTemplateLayoutFile(f.filePath)) continue;

    let m: RegExpExecArray | null;

    PRIVATE_RPC_RE.lastIndex = 0;
    while ((m = PRIVATE_RPC_RE.exec(f.content)) !== null) {
      push(out, f.filePath, m[0],
        'Layout-selection surface references a private RPC.',
        'Use only the approved bounded layout RPC set.');
    }

    RPC_LITERAL_RE.lastIndex = 0;
    while ((m = RPC_LITERAL_RE.exec(f.content)) !== null) {
      const name = m[1];
      if (TEMPLATE_LAYOUT_ALLOWED_RPCS.has(name)) continue;
      if (name.startsWith('omni_comms_priv_')) continue; // already reported
      push(out, f.filePath, m[0],
        `Layout-selection surface references the non-approved RPC "${name}".`,
        'Extend the approved bounded RPC set only with a governed amendment.');
    }

    TABLE_ACCESS_RE.lastIndex = 0;
    while ((m = TABLE_ACCESS_RE.exec(f.content)) !== null) {
      push(out, f.filePath, m[0],
        'Layout-selection surface accesses a table directly.',
        'All layout reads and writes must go through the authorised RPC adapters.');
    }

    EDGE_INVOKE_RE.lastIndex = 0;
    while ((m = EDGE_INVOKE_RE.exec(f.content)) !== null) {
      push(out, f.filePath, m[0],
        'Layout-selection surface invokes an Edge Function directly.',
        'Layout selection is a configuration RPC, never a runtime invocation.');
    }

    RUNTIME_IMPORT_RE.lastIndex = 0;
    while ((m = RUNTIME_IMPORT_RE.exec(f.content)) !== null) {
      push(out, f.filePath, m[0].trim(),
        'Layout-selection surface imports runtime internals.',
        'Keep runtime internals server-trusted and out of the administration surface.');
    }

    APPROVE_CALL_RE.lastIndex = 0;
    while ((m = APPROVE_CALL_RE.exec(f.content)) !== null) {
      push(out, f.filePath, m[0],
        'Layout-selection surface performs template approval.',
        'Approval stays on the Versions surface; the layout dialog only persists the selection.');
    }

    // Optimistic concurrency is mandatory whenever the selection is persisted.
    SET_LAYOUT_CALL_RE.lastIndex = 0;
    if (SET_LAYOUT_CALL_RE.test(f.content) && !/expectedUpdatedAt/.test(f.content)) {
      push(out, f.filePath, 'setTemplateVersionLayoutSelection(',
        'Layout selection is persisted without optimistic concurrency.',
        'Always pass expectedUpdatedAt so concurrent draft edits cannot be overwritten.');
    }

    for (const pkg of PROVIDER_SDK_PACKAGES) {
      if (f.content.includes(`'${pkg}`) || f.content.includes(`"${pkg}`)) {
        push(out, f.filePath, pkg,
          'Layout-selection surface imports a provider SDK.',
          'Providers are contacted only by server-trusted runtime code.');
      }
    }

    for (const pattern of LEGACY_IMPORT_PATTERNS) {
      if (f.content.includes(pattern)) {
        push(out, f.filePath, pattern,
          'Layout-selection surface references the Legacy Communication Hub.',
          'The Omni-Comms layout surface must not depend on Legacy Hub modules.');
      }
    }
  }

  return out;
}

export default checkTemplateLayoutBoundary;
