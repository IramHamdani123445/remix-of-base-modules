/**
 * Rule 6 — OMNI_ROUTE_REGISTRY.
 *
 * Scans the route-registration source for `path="/admin/omnichannel-communications..."`
 * occurrences and enforces:
 *  - exactly the seven approved routes exist
 *  - every registered omni-comms route uses OmniCommsAdminRoute
 *  - approved tab names are not promoted to top-level permanent routes
 */
import type {
  ArchitectureViolation,
  RepositoryScan,
} from '../architectureCheck.types';
import { OMNI_COMMS_ROUTE_REGISTRY } from '../../registry/routeRegistry';

const OMNI_PREFIX = '/admin/omnichannel-communications';

export function checkRouteRegistry(scan: RepositoryScan): ArchitectureViolation[] {
  const out: ArchitectureViolation[] = [];
  const src = scan.routeSource;
  if (!src) return out;

  const approved = new Set(OMNI_COMMS_ROUTE_REGISTRY.map((r) => r.path));

  // Extract every <Route ... /> element that mentions our prefix. The
  // element body may contain nested angle brackets (`<Suspense>` etc.) so we
  // match non-greedily until the self-closing `/>`.
  const routeRe = /<Route\b[\s\S]*?\bpath\s*=\s*["']([^"']+)["'][\s\S]*?\/>/g;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = routeRe.exec(src.content)) !== null) {
    const p = m[1];
    if (!p.startsWith(OMNI_PREFIX)) continue;
    found.add(p);

    if (!approved.has(p)) {
      out.push({
        ruleId: 'OMNI_ROUTE_REGISTRY',
        severity: 'error',
        filePath: src.filePath,
        evidence: m[0],
        message: `Unregistered omni-comms route "${p}".`,
        remediation:
          'Remove the route or add it to src/platform/omni-comms/registry/routeRegistry.ts after architecture approval. The seven approved routes are the ceiling.',
        baselineStatus: 'not_baselined',
      });
    }
    if (!/OmniCommsAdminRoute/.test(m[0])) {
      out.push({
        ruleId: 'OMNI_ROUTE_REGISTRY',
        severity: 'error',
        filePath: src.filePath,
        evidence: m[0],
        message: `Route "${p}" is not wrapped in OmniCommsAdminRoute.`,
        remediation: 'Wrap the element in <OmniCommsAdminRoute> to enforce omni_comms.view.',
        baselineStatus: 'not_baselined',
      });
    }
  }

  for (const approvedPath of approved) {
    if (!found.has(approvedPath)) {
      out.push({
        ruleId: 'OMNI_ROUTE_REGISTRY',
        severity: 'error',
        filePath: src.filePath,
        evidence: approvedPath,
        message: `Approved route "${approvedPath}" is missing from route registration.`,
        remediation: 'Restore the route in AppRoutes.tsx.',
        baselineStatus: 'not_baselined',
      });
    }
  }

  return out;
}
