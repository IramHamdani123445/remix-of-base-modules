/**
 * BN Feature Toggles
 *
 * Central registry of BN module feature flags. Routes and menus must honor
 * these toggles so no visible menu item routes to a placeholder/mock screen.
 *
 * Override per-environment via Vite env vars: VITE_BN_<DOT_FLAG_UPPERCASED>
 *   e.g. bn.servicing.lifeCert -> VITE_BN_SERVICING_LIFECERT=true
 * Or at runtime via localStorage key `bn.featureToggles` (JSON object).
 */

import React from "react";
import { Navigate } from "react-router-dom";

export type BnFeatureFlag =
  | "bn.enabled"
  | "bn.person360"
  | "bn.claim360"
  | "bn.claims.intake"
  | "bn.claims.workbench"
  | "bn.legacyRouting"
  | "bn.historicalInquiry"
  | "bn.awards"
  | "bn.payments"
  | "bn.servicing.lifeCert"
  | "bn.servicing.overpayment"
  | "bn.servicing.medicalReview"
  | "bn.servicing.awardSuspension"
  | "bn.config.rules"
  | "bn.config.products"
  | "bn.simulation"
  | "bn.gap.mortality"
  | "bn.gap.appeals"
  | "bn.gap.meansTests"
  | "bn.gap.risk"
  | "bn.gap.uprating";

/**
 * Defaults. Servicing flags stay OFF until the real bn_* servicing pipelines
 * (life cert reminders, overpayment recovery posting, medical review outcomes)
 * are wired end-to-end. Toggle on per-environment when ready.
 */
const DEFAULTS: Record<BnFeatureFlag, boolean> = {
  "bn.enabled": true,
  "bn.person360": true,
  "bn.claim360": true,
  "bn.claims.intake": true,
  "bn.claims.workbench": true,
  "bn.legacyRouting": true,
  "bn.historicalInquiry": true,
  "bn.awards": true,
  "bn.payments": true,
  // BN-LC-NAV: default true — registered servicing workspace, read-only.
  // Life Certificate mutations remain dark-launched server-side via
  // app_modules.actions_enabled=false; screen visibility is independent.
  "bn.servicing.lifeCert": true,
  "bn.servicing.overpayment": false,
  // BN-MR-UI: default true — registered servicing workspace, read-only.
  // Medical Review mutations remain dark-launched server-side via
  // app_modules.actions_enabled=false; screen visibility is independent.
  "bn.servicing.medicalReview": true,
  // BN-MENU-S1: default true — screen/menu visibility only.
  // Operational mutations are still gated by app_modules.actions_enabled=false
  // and by `effectiveActionsEnabled` composition in the workspace.
  "bn.servicing.awardSuspension": true,
  "bn.config.rules": true,
  "bn.config.products": true,
  "bn.simulation": true,
  // BN-GAP-MENU: read-only landing shells are safe to expose by default.
  // Server-side actions_enabled=false keeps mutations disabled.
  "bn.gap.mortality": true,
  "bn.gap.appeals": true,
  "bn.gap.meansTests": true,
  "bn.gap.risk": true,
  "bn.gap.uprating": true,
};

const envKey = (flag: BnFeatureFlag): string =>
  "VITE_BN_" + flag.replace(/^bn\./, "").replace(/\./g, "_").toUpperCase();

const parseBool = (v: unknown): boolean | undefined => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "no") return false;
  }
  return undefined;
};

let runtimeOverrides: Partial<Record<BnFeatureFlag, boolean>> = {};
try {
  if (typeof window !== "undefined") {
    const raw = window.localStorage?.getItem("bn.featureToggles");
    if (raw) runtimeOverrides = JSON.parse(raw) ?? {};
  }
} catch {
  runtimeOverrides = {};
}

/**
 * Flags that must never be enabled by casual localStorage overrides in
 * production builds. BN-MENU-S1: Award Suspension is now a read-only workspace
 * (operational mutations remain disabled at the database via
 * `app_modules.actions_enabled=false`), so it is no longer denylisted here.
 */
const PROD_LOCALSTORAGE_DENYLIST: ReadonlySet<BnFeatureFlag> = new Set<BnFeatureFlag>([]);

const isProdBuild = (): boolean => {
  try {
    const env = (import.meta as any)?.env;
    if (env?.PROD === true || env?.PROD === "true") return true;
    return env?.MODE === "production";
  } catch {
    return false;
  }
};


export function isFeatureEnabled(flag: BnFeatureFlag): boolean {
  // Master switch
  if (flag !== "bn.enabled" && !isFeatureEnabled("bn.enabled")) return false;

  // Production dark-launch guard: ignore localStorage overrides for sensitive
  // unfinished flags. Env-var overrides still apply below.
  const denyLocalStorage = isProdBuild() && PROD_LOCALSTORAGE_DENYLIST.has(flag);

  if (!denyLocalStorage && flag in runtimeOverrides) return !!runtimeOverrides[flag];

  const env = (import.meta as any)?.env?.[envKey(flag)];
  const parsed = parseBool(env);
  if (parsed !== undefined) return parsed;

  return DEFAULTS[flag];
}


export function setFeatureOverride(flag: BnFeatureFlag, value: boolean | null): void {
  if (value === null) {
    delete runtimeOverrides[flag];
  } else {
    runtimeOverrides[flag] = value;
  }
  try {
    window.localStorage?.setItem("bn.featureToggles", JSON.stringify(runtimeOverrides));
  } catch {
    /* noop */
  }
}

export function getAllFlags(): Record<BnFeatureFlag, boolean> {
  const out = {} as Record<BnFeatureFlag, boolean>;
  (Object.keys(DEFAULTS) as BnFeatureFlag[]).forEach((f) => {
    out[f] = isFeatureEnabled(f);
  });
  return out;
}

/**
 * Route-to-feature map. Keep in sync with src/components/routing/AppRoutes.tsx
 * and src/components/sidebar/menuItems/bnMenuItems.ts.
 */
export const ROUTE_FEATURE_MAP: Record<string, BnFeatureFlag> = {
  "/bn/dashboard": "bn.enabled",
  "/bn/person-360": "bn.person360",
  "/bn/config/products": "bn.config.products",
  "/bn/claims": "bn.claims.workbench",
  "/bn/claims/:id": "bn.claims.workbench",
  "/bn/claims/:id/legacy": "bn.claim360",
  "/bn/claims/:id/determination": "bn.claims.workbench",
  "/bn/claims/:id/eligibility": "bn.claims.workbench",
  "/bn/claims/:id/calculation": "bn.claims.workbench",
  "/bn/claims/:id/recommendation": "bn.claims.workbench",
  "/bn/engine": "bn.config.rules",
  "/bn/intake/register": "bn.claims.intake",
  "/bn/queue": "bn.claims.workbench",
  "/bn/approval": "bn.claims.workbench",
  "/bn/approval/queue": "bn.claims.workbench",
  "/bn/approval/workspace/:claimId": "bn.claims.workbench",
  "/bn/entitlements": "bn.awards",
  "/bn/payables": "bn.payments",
  "/bn/schedules": "bn.payments",
  "/bn/batches": "bn.payments",
  "/bn/issue": "bn.payments",
  "/bn/post-issue": "bn.payments",
  "/bn/history": "bn.historicalInquiry",
  "/bn/exceptions": "bn.payments",
  "/bn/post-issue-enhanced": "bn.payments",
  "/bn/worklist": "bn.claims.workbench",
  "/bn/payment-history": "bn.payments",
  "/bn/audit-history": "bn.enabled",
  "/bn/life-certificates": "bn.servicing.lifeCert",
  "/bn/medical-reviews": "bn.servicing.medicalReview",
  "/bn/overpayments": "bn.servicing.overpayment",
  "/bn/award-suspension": "bn.servicing.awardSuspension",
  "/bn/survivors": "bn.awards",
  "/bn/awards": "bn.awards",
  "/bn/awards/survivors": "bn.awards",
  "/bn/awards/adjustments": "bn.awards",
  "/bn/awards/:id": "bn.awards",
  "/bn/config/reason-codes": "bn.config.rules",
  "/bn/config/transitions": "bn.config.rules",
  "/bn/config/workbaskets": "bn.config.rules",
  "/bn/config/escalation": "bn.config.rules",
  "/bn/config/service-doc-types": "bn.config.rules",
  "/bn/config/country-master": "bn.config.rules",
  "/bn/config/country": "bn.config.rules",
  "/bn/config/country/id-rules": "bn.config.rules",
  "/bn/config/country/address-model": "bn.config.rules",
  "/bn/config/country/participant-types": "bn.config.rules",
  "/bn/config/country/payment-config": "bn.config.rules",
  "/bn/config/country/legal-refs": "bn.config.rules",
  "/bn/config/rules": "bn.config.rules",
  "/bn/config/rules-admin": "bn.config.rules",
  "/bn/config/formulas": "bn.config.rules",
  "/bn/config/document-setup": "bn.config.rules",
  "/bn/config/screen-setup": "bn.config.rules",
  "/bn/config/medical": "bn.config.rules",
  "/bn/config/medical/procedures": "bn.config.rules",
  "/bn/config/medical/facility-availability": "bn.config.rules",
  "/bn/config/medical/referral-rules": "bn.config.rules",
  "/bn/config/medical/reimbursement-limits": "bn.config.rules",
  "/bn/config/medical/expense-types": "bn.config.rules",
  "/bn/config/medical/review-rules": "bn.config.rules",
  "/bn/config/medical/documents": "bn.config.rules",
  "/bn/simulation": "bn.simulation",
  "/bn/simulation/new": "bn.simulation",
  "/bn/simulation/edit/:id": "bn.simulation",
  "/bn/simulation/:id": "bn.simulation",
  "/bn/simulation/:id/run/:runId": "bn.simulation",
  "/bn/mortality": "bn.gap.mortality",
  "/bn/appeals": "bn.gap.appeals",
  "/bn/means-tests": "bn.gap.meansTests",
  "/bn/risk-management": "bn.gap.risk",
  "/bn/uprating": "bn.gap.uprating",
};

/**
 * Route guard. When the flag is off, redirect to the BN dashboard (or root if
 * BN itself is disabled). Use as: <BnFeatureGate flag="bn.payments"><Page/></BnFeatureGate>
 */
export const BnFeatureGate: React.FC<{
  flag: BnFeatureFlag;
  children: React.ReactNode;
  fallback?: string;
}> = ({ flag, children, fallback }) => {
  if (isFeatureEnabled(flag)) return React.createElement(React.Fragment, null, children);
  const target = fallback ?? (isFeatureEnabled("bn.enabled") ? "/bn/dashboard" : "/");
  return React.createElement(Navigate, { to: target, replace: true });
};

/**
 * Workspace guard for *registered* BN servicing workspaces.
 *
 * Unlike `BnFeatureGate`, this never silently redirects: a registered
 * workspace whose flag is off renders an explicit, explainable unavailable
 * state so operators are not bounced to the dashboard without reason.
 */
export const BnWorkspaceGate: React.FC<{
  flag: BnFeatureFlag;
  title: string;
  children: React.ReactNode;
}> = ({ flag, title, children }) => {
  if (isFeatureEnabled(flag)) return React.createElement(React.Fragment, null, children);
  return React.createElement(
    "div",
    { className: "p-6", "data-testid": "bn-workspace-unavailable" },
    React.createElement(
      "div",
      { className: "rounded-lg border bg-card p-6 max-w-2xl" },
      React.createElement("h1", { className: "text-xl font-semibold" }, title),
      React.createElement(
        "p",
        { className: "mt-2 text-sm text-muted-foreground" },
        "This workspace is registered but has been switched off for this environment. " +
          "No data is shown and no action is available. Contact Benefits administration if you " +
          "expected access here.",
      ),
    ),
  );
};

/**
 * Recursively filter a menu tree, dropping items whose `feature` flag is off
 * and pruning parent groups whose entire subItems become empty.
 */
type MenuLike = {
  url?: string;
  feature?: BnFeatureFlag;
  subItems?: MenuLike[];
  [k: string]: any;
};

export function filterMenuByFeatures<T extends MenuLike>(items: T[]): T[] {
  const result: T[] = [];
  for (const item of items) {
    const flag: BnFeatureFlag | undefined =
      item.feature ?? (item.url ? ROUTE_FEATURE_MAP[item.url] : undefined);
    if (flag && !isFeatureEnabled(flag)) continue;

    if (item.subItems && item.subItems.length) {
      const sub = filterMenuByFeatures(item.subItems);
      if (sub.length === 0 && !item.url) continue;
      result.push({ ...item, subItems: sub });
    } else {
      result.push(item);
    }
  }
  return result;
}
