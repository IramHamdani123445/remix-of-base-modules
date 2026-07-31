/**
 * Omni-Comms administration UI redesign — source-level gate.
 *
 * Verifies the presentation contract only: shared shell/header composition,
 * the multi-facet posture model, centralised navigation (7 permanent routes,
 * Preferences marked as planned), the Safe test surface wording, and the
 * three Health views. No runtime, database or security behaviour is asserted
 * here — those remain covered by their own suites.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { OMNI_COMMS_ROUTE_REGISTRY } from '@/platform/omni-comms/registry/routeRegistry';

const REPO = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');

const SHELL = 'src/platform/omni-comms/admin/components/OmniCommsShell.tsx';
const HEADER = 'src/platform/omni-comms/admin/components/OmniCommsModuleHeader.tsx';
const POSTURE = 'src/platform/omni-comms/admin/posture/omniCommsPosture.ts';
const NAV = 'src/platform/omni-comms/admin/navigation/omniCommsNavigation.ts';
const DRY_RUN = 'src/platform/omni-comms/admin/views/dryrun/ControlledDryRunPanel.tsx';
const HEALTH = 'src/platform/omni-comms/admin/views/OmniCommsHealthPage.tsx';

describe('Omni-Comms admin UI redesign', () => {
  it('shell composes the shared module header', () => {
    expect(fs.existsSync(path.join(REPO, HEADER))).toBe(true);
    const src = read(SHELL);
    expect(src).toContain('OmniCommsModuleHeader');
    expect(src).toContain('<OmniCommsModuleHeader');
  });

  it('posture model replaces the binary status badge', () => {
    const src = read(POSTURE);
    for (const facet of ['runtime', 'certification', 'delivery', 'legacy']) {
      expect(src.toLowerCase()).toContain(facet);
    }
  });

  it('navigation is centralised and matches the 7 permanent routes', () => {
    const src = read(NAV);
    for (const entry of OMNI_COMMS_ROUTE_REGISTRY) {
      expect(src, `nav must reference ${entry.path}`).toContain(entry.path);
    }
    expect(src).toMatch(/Planned|planned/);
  });

  it('safe test surface uses staged, plain-language wording', () => {
    const src = read(DRY_RUN);
    expect(src).toContain('Safe test');
    expect(src).toContain('Step 1 · Test scope');
    expect(src).toContain('Step 2 · Synthetic payload');
    expect(src).toContain('Step 3 · Run the safe test');
    expect(src).toContain('Step 4 · Result');
    // Tenant selection is owned by the shared header, not duplicated here.
    expect(src).not.toContain('<OmniCommsTenantSelector');
  });

  it('health page exposes operational, certification and engineering views', () => {
    const src = read(HEALTH);
    for (const view of ['operational', 'certification', 'engineering']) {
      expect(src).toContain(view);
    }
    expect(src).toContain('useOmniCommsViewParam');
  });

  it('module views do not re-declare their own page container', () => {
    const dir = 'src/platform/omni-comms/admin/views';
    for (const file of fs.readdirSync(path.join(REPO, dir)).filter((f) => f.endsWith('.tsx'))) {
      expect(read(`${dir}/${file}`), `${file} must rely on the shell layout`)
        .not.toContain('container mx-auto p-6');
    }
  });
});

// ── Final acceptance corrections ─────────────────────────────────────────

describe('Omni-Comms admin UI acceptance corrections', () => {
  it('the canonical view parser resolves every Safe test deep link', async () => {
    const nav = await import('@/platform/omni-comms/admin/navigation/omniCommsNavigation');
    expect(nav.resolveOverviewView('safe-test')).toBe('safe-test');
    expect(nav.resolveOverviewView('dry-run')).toBe('safe-test');
    expect(nav.resolveOverviewView('SAFE-TEST')).toBe('safe-test');
    // Reference data is a real surface, not an alias of Setup.
    expect(nav.resolveOverviewView('reference-data')).toBe('reference-data');
    expect(nav.resolveOverviewView('nonsense')).toBe('dashboard');
    expect(nav.resolveOverviewView(null)).toBe('dashboard');
  });

  it('reference data highlights Setup in the module navigation', async () => {
    const nav = await import('@/platform/omni-comms/admin/navigation/omniCommsNavigation');
    const active = nav.resolveActiveNavItem(
      '/admin/omnichannel-communications',
      'reference-data',
    );
    expect(active.id).toBe('setup');
    expect(
      nav.resolveActiveNavItem('/admin/omnichannel-communications', 'dry-run').id,
    ).toBe('safe-test');
  });

  it('Safe test is withheld from navigation in production', async () => {
    const nav = await import('@/platform/omni-comms/admin/navigation/omniCommsNavigation');
    expect(nav.omniCommsNavItems('non_production').map((i) => i.id)).toContain('safe-test');
    expect(nav.omniCommsNavItems('production').map((i) => i.id)).not.toContain('safe-test');
    expect(nav.omniCommsNavItems('unknown').map((i) => i.id)).not.toContain('safe-test');
  });

  it('the Overview page renders no Safe test surface in production', () => {
    const src = read('src/platform/omni-comms/admin/views/OmniCommsLandingPage.tsx');
    expect(src).toContain('resolveOverviewView');
    // Deep link falls back to the Dashboard rather than rendering the tab.
    expect(src).toMatch(/requested === "safe-test"[\s\S]*?"dashboard"/);
    expect(src).toContain('nonProduction ? (');
  });

  it('certification posture is derived in exactly one place and fails closed', async () => {
    const posture = await import('@/platform/omni-comms/admin/posture/omniCommsPosture');
    const SHA = 'a'.repeat(40);
    const OTHER = 'b'.repeat(40);
    const base = {
      recordedState: 'pending',
      certifiedCommit: null as string | null,
      deployedRevision: SHA,
      edgeCertificationState: 'pending',
      edgeAvailable: true,
      environment: 'non_production' as const,
    };
    expect(posture.deriveCertificationPosture(base).state).toBe('pending');
    // Pending certification must NEVER permit the safe dry test.
    expect(posture.deriveCertificationPosture(base).safeTestPermitted).toBe(false);

    expect(
      posture.deriveCertificationPosture({ ...base, environment: 'production' })
        .safeTestPermitted,
    ).toBe(false);
    expect(
      posture.deriveCertificationPosture({ ...base, environment: 'unknown' })
        .safeTestPermitted,
    ).toBe(false);
    expect(
      posture.deriveCertificationPosture({ ...base, recordedState: 'failed' }).state,
    ).toBe('failed');
    expect(
      posture.deriveCertificationPosture({ ...base, recordedState: 'failed' })
        .safeTestPermitted,
    ).toBe(false);
    expect(
      posture.deriveCertificationPosture({ ...base, edgeAvailable: false }).state,
    ).toBe('unknown');
    expect(
      posture.deriveCertificationPosture({ ...base, edgeAvailable: false })
        .safeTestPermitted,
    ).toBe(false);

    const certifiedBase = {
      ...base,
      recordedState: 'certified',
      edgeCertificationState: 'certified',
      certifiedCommit: SHA,
      deployedRevision: SHA,
    };

    // Missing certified commit.
    expect(
      posture.deriveCertificationPosture({ ...certifiedBase, certifiedCommit: null })
        .safeTestPermitted,
    ).toBe(false);
    // Missing deployed revision.
    expect(
      posture.deriveCertificationPosture({ ...certifiedBase, deployedRevision: null })
        .safeTestPermitted,
    ).toBe(false);
    // Shortened revision — prefix matching must NOT be accepted.
    const shortened = posture.deriveCertificationPosture({
      ...certifiedBase,
      deployedRevision: SHA.slice(0, 12),
    });
    expect(shortened.revision).toBe('unknown');
    expect(shortened.safeTestPermitted).toBe(false);
    // Malformed revision.
    expect(
      posture.deriveCertificationPosture({
        ...certifiedBase,
        deployedRevision: 'not-a-sha',
      }).safeTestPermitted,
    ).toBe(false);
    // Exact full-SHA mismatch.
    const mismatch = posture.deriveCertificationPosture({
      ...certifiedBase,
      deployedRevision: OTHER,
    });
    expect(mismatch.revision).toBe('mismatch');
    expect(mismatch.state).toBe('pending');
    expect(mismatch.safeTestPermitted).toBe(false);

    // Only certified + non-production + exact full-SHA match is permitted.
    const certified = posture.deriveCertificationPosture(certifiedBase);
    expect(certified.revision).toBe('match');
    expect(certified.state).toBe('certified');
    expect(certified.safeTestPermitted).toBe(true);

    // Case-insensitive equality, still full length.
    expect(posture.compareRevision(SHA.toUpperCase(), SHA)).toBe('match');
    expect(posture.compareRevision(SHA, SHA.slice(0, 39))).toBe('unknown');
  });

  it('every certification surface consumes the shared derivation', () => {
    const files = [
      'src/platform/omni-comms/admin/components/OmniCommsModuleHeader.tsx',
      'src/platform/omni-comms/admin/views/OmniCommsLandingPage.tsx',
      'src/platform/omni-comms/admin/views/health/CertificationEvidenceTab.tsx',
      'src/platform/omni-comms/admin/views/dryrun/ControlledDryRunPanel.tsx',
    ];
    for (const f of files) {
      expect(read(f), `${f} must use the shared certification posture hook`)
        .toContain('useOmniCommsCertificationPosture');
    }
    // No screen may hardcode a certification verdict.
    expect(read('src/platform/omni-comms/admin/components/OmniCommsModuleHeader.tsx'))
      .not.toContain("certification: 'pending'");
  });

  it('the Edge health contract keeps revision separate from the build tag', () => {
    const types = read('src/platform/omni-comms/application/healthDiagnosticsTypes.ts');
    expect(types).toContain('revision: string | null;');
    expect(types).toContain('revisionVerified: boolean | null;');

    const hook = read('src/platform/omni-comms/admin/hooks/useOmniCommsEdgeHealthProbe.ts');
    expect(hook).toContain('body.revision');
    expect(hook).toContain('body.revisionVerified');

    const cert = read('src/platform/omni-comms/admin/views/health/CertificationEvidenceTab.tsx');
    // The build tag must never masquerade as the deployed revision.
    expect(cert).not.toContain('result?.buildTag');
    expect(cert).toContain('edge?.revision');

    const edge = read('supabase/functions/omni-comms-runtime/index.ts');
    // Certification is read from the authoritative database posture, never
    // from an independently-trusted function secret.
    expect(edge).not.toContain('OMNI_COMMS_CERTIFICATION_STATE');
    expect(edge).toContain('omni_comms_priv_runtime_health_posture');
    expect(edge).toContain('safeTestPermitted');
    expect(edge).not.toContain('certificationState: "certified"');
  });

  it('Safe test execution is decided by the server, not the browser', () => {
    const service = read('src/platform/omni-comms/application/controlledDryRunService.ts');
    expect(service).toContain('gate.execution_permitted !== true');
    expect(service).toContain('executionBlockedMessage');

    const panel = read('src/platform/omni-comms/admin/views/dryrun/ControlledDryRunPanel.tsx');
    expect(panel).toContain('omni-comms-dry-run-execution-blocked');
    expect(panel).toContain('executionBlockedMessage');
  });

  it('Safe test wording is consistent', () => {
    const panel = read('src/platform/omni-comms/admin/views/dryrun/ControlledDryRunPanel.tsx');
    expect(panel).toContain('Run safe dry test');
    expect(panel).toContain('Run the safe dry test?');
    expect(panel).toContain('Start a new safe test');
    expect(panel).not.toContain('Run dry-run test');
    expect(panel).not.toContain('Start a new dry run');
    expect(panel).not.toContain('Controlled dry run is disabled');
  });

  it('Operations offers an explicit view action and filter reset', () => {
    const ops = read('src/platform/omni-comms/admin/views/OmniCommsOperationsPage.tsx');
    expect(ops).toContain('omni-comms-ops-clear-filters');
    expect(ops).toContain('omni-comms-ops-active-filters');
    expect(ops).toContain('omni-comms-ops-request-view-');
    expect(ops).toContain('e.stopPropagation()');
  });

  it('Setup stages collapse when complete and open on the next action', () => {
    const setup = read('src/platform/omni-comms/admin/views/setup/SetupWizardPanel.tsx');
    expect(setup).toContain('omni-comms-setup-stages');
    expect(setup).toContain('openStages');
    expect(setup).toContain('Action required');
    expect(setup).toContain('s.state !== "complete"');
  });
});
