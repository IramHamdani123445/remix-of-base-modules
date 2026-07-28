/**
 * Rule 4 — OMNI_REACT_RUNTIME_WRITE.
 *
 * React / browser-facing code must NEVER mutate omni-comms runtime tables
 * directly. Detects insert/update/upsert/delete on any runtime table via
 * `.from('table').<mutator>` chains inside .tsx/.jsx files or client hooks
 * under src/hooks or src/components. Plain object-name text does not fire.
 */
import type {
  ArchitectureViolation,
  RepositoryScan,
} from '../architectureCheck.types';
import { RUNTIME_TABLES } from '../architecturePolicy';

const MUTATORS = ['insert', 'update', 'upsert', 'delete'];

function isBrowserFile(filePath: string): boolean {
  const p = filePath.replace(/\\/g, '/');
  if (/\.(tsx|jsx)$/.test(p)) return true;
  if (/^src\/hooks\//.test(p)) return true;
  if (/^src\/components\//.test(p)) return true;
  if (/^src\/pages\//.test(p)) return true;
  if (/^src\/platform\/omni-comms\/admin\//.test(p)) return true;
  return false;
}

export function checkReactRuntimeWrites(scan: RepositoryScan): ArchitectureViolation[] {
  const out: ArchitectureViolation[] = [];
  for (const f of scan.files) {
    if (!isBrowserFile(f.filePath)) continue;
    if (!/\.(ts|tsx|js|jsx)$/.test(f.filePath)) continue;

    for (const table of RUNTIME_TABLES) {
      for (const mut of MUTATORS) {
        const re = new RegExp(
          `\\.from\\(\\s*['"\`]${table}['"\`]\\s*\\)\\s*(?:\\.[^\\n;]*?)?\\.${mut}\\s*\\(`,
          'g',
        );
        let m: RegExpExecArray | null;
        while ((m = re.exec(f.content)) !== null) {
          out.push({
            ruleId: 'OMNI_REACT_RUNTIME_WRITE',
            severity: 'error',
            filePath: f.filePath,
            evidence: m[0],
            message: `Direct browser ${mut} on runtime table "${table}".`,
            remediation:
              'Runtime writes must go through a server-side omni-comms edge function or authorised RPC — never from React/browser code.',
            baselineStatus: 'not_baselined',
          });
        }
      }
    }
  }
  return out;
}
