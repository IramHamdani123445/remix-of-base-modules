import { COMPLIANCE_FEATURE_FLAG_RULES, type Rule } from '@/lib/compliance/menuFeatureFilter';
import { getComplianceDbFlag, hasComplianceDbFlagsLoaded } from '@/lib/compliance/featureFlagCache';

export type ComplianceMatchType = 'exact' | 'dynamic' | 'parent-prefix';
export type ComplianceDecision = 'render' | 'access-denied' | 'feature-disabled' | 'fail-closed';

export interface ComplianceModuleRow {
  id: string;
  name: string;
  display_name: string | null;
  route: string | null;
  parent_id: string | null;
  sort_order?: number | null;
  is_enabled?: boolean | null;
  show_in_menu?: boolean | null;
  routes_enabled?: boolean | null;
}

export interface CompliancePermissionRow {
  module_name: string;
  action_name: string;
  is_granted?: boolean;
}

export interface ComplianceRouteCandidate {
  module: ComplianceModuleRow;
  matchType: ComplianceMatchType;
  score: number;
  routeLength: number;
  selected: boolean;
  hasViewPermission: boolean;
  rpcReturnsModule: boolean;
}

export interface ComplianceAccessResolution {
  pathname: string;
  requiredAction: 'view';
  candidates: ComplianceRouteCandidate[];
  selectedCandidates: ComplianceRouteCandidate[];
  selectedModule: ComplianceModuleRow | null;
  hasPermission: boolean;
  permissionSkippedByAdmin: boolean;
  matchedFeatureRule: Rule | null;
  featureFlagLoaded: boolean;
  featureFlagValue: boolean | undefined;
  featureGateEvaluated: boolean;
  finalDecision: ComplianceDecision;
  reason: string;
}

export function normalizeCompliancePath(path: string): string {
  const parsed = path.trim().startsWith('http') ? new URL(path.trim()).pathname : path.trim();
  const cleaned = (parsed || '/').split('?')[0].split('#')[0].replace(/\/+$/, '');
  return cleaned || '/';
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dynamicRouteMatches(pathname: string, route: string): boolean {
  if (!route.includes(':') && !route.includes('*')) return false;
  const pattern = route
    .split('/')
    .map((part) => {
      if (part === '*') return '.*';
      if (part.startsWith(':')) return '[^/]+';
      return escapeRegex(part);
    })
    .join('/');
  return new RegExp(`^${pattern}$`).test(pathname);
}

export function classifyComplianceRouteMatch(pathname: string, route?: string | null): { type: ComplianceMatchType; score: number; routeLength: number } | null {
  if (!route) return null;
  const path = normalizeCompliancePath(pathname);
  const modRoute = normalizeCompliancePath(route);
  const routeLength = modRoute.length;

  if (path === modRoute) {
    return { type: 'exact', score: 30_000 + routeLength, routeLength };
  }

  if (dynamicRouteMatches(path, modRoute)) {
    const staticSegments = modRoute.split('/').filter((s) => s && !s.startsWith(':') && s !== '*').length;
    return { type: 'dynamic', score: 20_000 + staticSegments * 100 + routeLength, routeLength };
  }

  if (path.startsWith(`${modRoute}/`)) {
    return { type: 'parent-prefix', score: 10_000 + routeLength, routeLength };
  }

  return null;
}

export function findComplianceFeatureRule(pathname: string, selectedRoute?: string | null): Rule | null {
  const path = normalizeCompliancePath(pathname);
  const route = selectedRoute ? normalizeCompliancePath(selectedRoute) : '';
  const sorted = [...COMPLIANCE_FEATURE_FLAG_RULES].sort((a, b) => b.prefix.length - a.prefix.length);
  return sorted.find((rule) => {
    const prefix = normalizeCompliancePath(rule.prefix);
    return path === prefix || path.startsWith(`${prefix}/`) || route === prefix || route.startsWith(`${prefix}/`);
  }) ?? null;
}

/**
 * Legacy / alias compliance routes that are reachable in AppRoutes but have no
 * dedicated `app_modules` row. Each alias resolves to the canonical registered
 * route so the gate evaluates the SAME permission as the canonical screen
 * instead of falling closed for every non-admin persona.
 *
 * Longest alias prefix wins. Only the permission lookup is affected — routing,
 * navigation and rendering are untouched.
 */
export const COMPLIANCE_ROUTE_ALIASES: Record<string, string> = {
  '/compliance/settings': '/compliance/admin/settings',
  '/compliance/settings/risk-config': '/compliance/admin/settings/risk-policy',
  '/compliance/settings/legal-escalation-policy': '/compliance/legal-escalation-policy',
  '/compliance/staff': '/compliance/admin/staff',
  '/compliance/staff/link-legacy': '/compliance/admin/staff/officers',
  '/compliance/admin/staff/link-legacy': '/compliance/admin/staff/officers',
  '/compliance/geography': '/compliance/admin/geography',
  '/compliance/automation': '/compliance/admin/automation',
  '/compliance/tools': '/compliance/admin/tools',
  '/compliance/templates': '/compliance/admin/settings/templates',
  '/compliance/admin/comm-trigger-rules': '/compliance/admin/communication-templates',
  '/compliance/admin/feature-toggle-diagnostics': '/compliance/admin/feature-toggles',
  '/compliance/admin/risk-scoring': '/compliance/admin/settings/risk-policy',
  '/compliance/admin/risk-operations': '/compliance/admin/settings/risk-policy',
  '/compliance/audits': '/compliance/field/audit-management',
  '/compliance/employer': '/compliance/field/employer-360',
  '/compliance/employer-statements': '/compliance/field/employer-statements',
  '/compliance/employers/findings': '/compliance/field/findings',
  '/compliance/inspections/field-execution': '/compliance/field/execution',
  '/compliance/inspector-plans': '/compliance/field/my-plans',
  '/compliance/field/plan-builder-v2': '/compliance/field/plan-builder',
  '/compliance/audit-planning/all-reports': '/compliance/field/all-reports',
  '/compliance/audit-planning/monthly-candidates': '/compliance/field/sampling/candidates',
  '/compliance/audit-planning/my-plans': '/compliance/field/my-plans',
  '/compliance/audit-planning/pending-review': '/compliance/field/pending-review',
  '/compliance/audit-planning/sampling-dashboard': '/compliance/field/sampling',
  '/compliance/audit-planning/settings': '/compliance/admin/settings/sampling',
  '/compliance/audit-planning/weekly-plan-builder': '/compliance/field/plan-builder',
  '/compliance/audit-planning/weekly-reports': '/compliance/field/weekly-reports',
  '/compliance/sampling': '/compliance/field/sampling',
  '/compliance/sampling/candidates': '/compliance/field/sampling/candidates',
  '/compliance/sampling/settings': '/compliance/admin/settings/sampling',
  '/compliance/legal-referral': '/compliance/enforcement/legal-referral',
  '/compliance/legal/queue': '/compliance/enforcement/legal-queue',
  '/compliance/legal/proceedings': '/compliance/enforcement/proceedings',
  '/compliance/enforcement/partial-payments': '/compliance/enforcement/arrangements',
  '/compliance/waivers': '/compliance/enforcement/waivers',
  '/compliance/arrangements/breaches': '/compliance/enforcement/breaches',
  '/compliance/payment-arrangements': '/compliance/arrangements',
  '/compliance/monitoring': '/compliance/workbench/monitoring',
  '/compliance/operations/queues': '/compliance/workbench/queues',
  '/compliance/operations/reassignment': '/compliance/workbench/reassignment',
  '/compliance/operations/review-queue': '/compliance/workbench/review-queue',
  '/compliance/my-work': '/compliance/my-work-queue',
  '/compliance/work-queue': '/compliance/my-work-queue',
  '/compliance/reports/case-analytics': '/compliance/reports/violations/summary',
  '/compliance/reports/violations-analytics': '/compliance/reports/violations/summary',
  '/compliance/reports/employer-status': '/compliance/reports/arrears',
};

export function canonicalizeCompliancePath(pathname: string): string {
  const path = normalizeCompliancePath(pathname);
  const aliases = Object.keys(COMPLIANCE_ROUTE_ALIASES).sort((a, b) => b.length - a.length);
  for (const alias of aliases) {
    if (path === alias) return normalizeCompliancePath(COMPLIANCE_ROUTE_ALIASES[alias]);
    if (path.startsWith(`${alias}/`)) {
      return normalizeCompliancePath(COMPLIANCE_ROUTE_ALIASES[alias] + path.slice(alias.length));
    }
  }
  return path;
}

export function resolveComplianceAccess(input: {
  pathname: string;
  modules: ComplianceModuleRow[];
  permissions: CompliancePermissionRow[];
  accessibleModuleNames?: Set<string>;
  isAdmin: boolean;
}): ComplianceAccessResolution {
  const pathname = canonicalizeCompliancePath(input.pathname);
  const grantedViewModules = new Set(
    input.permissions
      .filter((p) => p.action_name === 'view' && p.is_granted !== false)
      .map((p) => p.module_name),
  );


  const rawCandidates = input.modules
    .filter((m) => m.is_enabled !== false && m.routes_enabled !== false)
    .map((module) => {
      const match = classifyComplianceRouteMatch(pathname, module.route);
      if (!match) return null;
      return {
        module,
        matchType: match.type,
        score: match.score,
        routeLength: match.routeLength,
        selected: false,
        hasViewPermission: input.isAdmin || grantedViewModules.has(module.name),
        rpcReturnsModule: input.isAdmin || Boolean(input.accessibleModuleNames?.has(module.name)),
      } satisfies ComplianceRouteCandidate;
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (Number(b.module.show_in_menu === true) !== Number(a.module.show_in_menu === true)) {
        return Number(b.module.show_in_menu === true) - Number(a.module.show_in_menu === true);
      }
      return (a.module.sort_order ?? 0) - (b.module.sort_order ?? 0);
    });

  const bestScore = rawCandidates[0]?.score ?? 0;
  const candidates = rawCandidates.map((candidate) => ({
    ...candidate,
    selected: candidate.score === bestScore,
  }));
  const selectedCandidates = candidates.filter((candidate) => candidate.selected);
  const selectedModule = selectedCandidates.find((c) => c.hasViewPermission)?.module ?? selectedCandidates[0]?.module ?? null;

  if (!selectedModule) {
    return {
      pathname,
      requiredAction: 'view',
      candidates,
      selectedCandidates,
      selectedModule: null,
      hasPermission: input.isAdmin,
      permissionSkippedByAdmin: input.isAdmin,
      matchedFeatureRule: null,
      featureFlagLoaded: hasComplianceDbFlagsLoaded(),
      featureFlagValue: undefined,
      featureGateEvaluated: false,
      finalDecision: input.isAdmin ? 'render' : 'fail-closed',
      reason: input.isAdmin
        ? 'No app_modules route row matched; admin bypass renders the page.'
        : 'No app_modules route row matched; non-admin compliance access is fail-closed.',
    };
  }

  const hasPermission = input.isAdmin || selectedCandidates.some((candidate) => candidate.hasViewPermission);
  const matchedFeatureRule = findComplianceFeatureRule(pathname, selectedModule.route);
  const featureFlagLoaded = hasComplianceDbFlagsLoaded();
  const featureFlagValue = matchedFeatureRule ? getComplianceDbFlag(matchedFeatureRule.flag) : undefined;

  if (!hasPermission) {
    return {
      pathname,
      requiredAction: 'view',
      candidates,
      selectedCandidates,
      selectedModule,
      hasPermission: false,
      permissionSkippedByAdmin: false,
      matchedFeatureRule,
      featureFlagLoaded,
      featureFlagValue,
      featureGateEvaluated: false,
      finalDecision: 'access-denied',
      reason: `No granted view permission exists for the selected route module(s): ${selectedCandidates.map((c) => c.module.name).join(', ')}.`,
    };
  }

  if (matchedFeatureRule && featureFlagLoaded && featureFlagValue === false) {
    return {
      pathname,
      requiredAction: 'view',
      candidates,
      selectedCandidates,
      selectedModule,
      hasPermission: true,
      permissionSkippedByAdmin: input.isAdmin,
      matchedFeatureRule,
      featureFlagLoaded,
      featureFlagValue,
      featureGateEvaluated: true,
      finalDecision: 'feature-disabled',
      reason: `Permission passed, but feature flag ${matchedFeatureRule.flag} is OFF.`,
    };
  }

  return {
    pathname,
    requiredAction: 'view',
    candidates,
    selectedCandidates,
    selectedModule,
    hasPermission: true,
    permissionSkippedByAdmin: input.isAdmin,
    matchedFeatureRule,
    featureFlagLoaded,
    featureFlagValue,
    featureGateEvaluated: Boolean(matchedFeatureRule),
    finalDecision: 'render',
    reason: matchedFeatureRule
      ? `View permission passed and feature flag ${matchedFeatureRule.flag} is not OFF.`
      : 'View permission passed and no feature flag rule applies.',
  };
}