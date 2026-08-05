/**
 * BN-MENU-S1 — Award Suspension is now a menu-visible, read-only workspace.
 * Operational mutations remain disabled through `app_modules.actions_enabled=false`
 * (enforced via `effectiveActionsEnabled` in the workspace), so the flag is no
 * longer on the production localStorage denylist. These tests lock in the new
 * visibility behavior while confirming other servicing flags remain hidden.
 */
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

const setStoredOverrides = (obj: Record<string, boolean>) => {
  window.localStorage.setItem('bn.featureToggles', JSON.stringify(obj));
};

const reloadModule = async () => {
  vi.resetModules();
  return await import('@/lib/bn/featureToggles');
};

describe('BN-MENU-S1: Award Suspension is menu-visible and read-only', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('defaults bn.servicing.awardSuspension to true', async () => {
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('PROD', 'true' as any);
    const mod = await reloadModule();
    expect(mod.isFeatureEnabled('bn.servicing.awardSuspension')).toBe(true);
  });

  it('route remains mapped to the dedicated feature flag', async () => {
    const mod = await reloadModule();
    expect(mod.ROUTE_FEATURE_MAP['/bn/award-suspension']).toBe(
      'bn.servicing.awardSuspension'
    );
  });

  it('Life Certificates is a registered read-only workspace in production', async () => {
    // BN-LC-NAV: screen visibility is independent of mutation enablement;
    // Life Certificate commands stay dark-launched via app_modules.actions_enabled=false.
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('PROD', 'true' as any);
    const mod = await reloadModule();
    expect(mod.isFeatureEnabled('bn.servicing.lifeCert')).toBe(true);
  });

  it('unreleased servicing flags remain hidden by default in production', async () => {
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('PROD', 'true' as any);
    const mod = await reloadModule();
    expect(mod.isFeatureEnabled('bn.servicing.overpayment')).toBe(false);
  });

  it('medical review is visible read-only, gated server-side not by the flag', async () => {
    // BN-MR-UI: the Medical Review workspace is a registered servicing surface,
    // so it is menu-visible like Life Certificates. Mutations stay dark-launched
    // through app_modules.actions_enabled, never through this toggle.
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('PROD', 'true' as any);
    const mod = await reloadModule();
    expect(mod.isFeatureEnabled('bn.servicing.medicalReview')).toBe(true);
    expect(mod.isFeatureEnabled('bn.servicing.lifeCert')).toBe(true);
  });


  it('localStorage override CAN still enable other servicing flags for dev', async () => {
    setStoredOverrides({ 'bn.servicing.lifeCert': true });
    vi.stubEnv('MODE', 'development');
    vi.stubEnv('PROD', '' as any);
    const mod = await reloadModule();
    expect(mod.isFeatureEnabled('bn.servicing.lifeCert')).toBe(true);
  });

  it('master switches remain on', async () => {
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('PROD', 'true' as any);
    const mod = await reloadModule();
    expect(mod.isFeatureEnabled('bn.enabled')).toBe(true);
    expect(mod.isFeatureEnabled('bn.awards')).toBe(true);
  });
});
