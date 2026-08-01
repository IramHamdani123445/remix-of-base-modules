/**
 * Omni-Comms — shared certification posture hook.
 *
 * SINGLE source of certification wording and safe-test availability for the
 * administration UI. It combines two bounded facts:
 *
 *   1. the source-controlled certification record (`certificationEvidence.ts`);
 *   2. the deployed runtime's non-mutating `/health` probe.
 *
 * Screens must not re-derive certification state, must not compare revisions
 * themselves and must not decide independently whether the safe dry test may
 * be offered. This hook performs no mutation, submits no request, contacts no
 * provider and reads no credential.
 */
import React from 'react';
import { useOmniCommsEdgeHealthProbe } from './useOmniCommsEdgeHealthProbe';
import {
  currentOmniCommsEnvironment,
  deriveCertificationPosture,
  type DerivedCertificationPosture,
  type OmniCommsEnvironment,
} from '../posture/omniCommsPosture';
import { OMNI_COMMS_CERTIFICATION_EVIDENCE } from '@/platform/omni-comms/registry/certificationEvidence';
import type { EdgeHealthProbeResult } from '@/platform/omni-comms/application/healthDiagnosticsTypes';

export interface UseOmniCommsCertificationPosture {
  posture: DerivedCertificationPosture;
  edge: EdgeHealthProbeResult | null;
  environment: OmniCommsEnvironment;
  probing: boolean;
  refresh: () => void;
  /** Bounded Edge health agreement that the safe dry test may be offered. */
  edgeSafeTestPermitted: boolean;
  /** Derived posture AND Edge posture must both permit the safe dry test. */
  safeTestPermitted: boolean;
}

export function useOmniCommsCertificationPosture(
  options: { autoProbe?: boolean } = {},
): UseOmniCommsCertificationPosture {
  const autoProbe = options.autoProbe !== false;
  const { result: edge, probe, probing } = useOmniCommsEdgeHealthProbe();
  const browserEnvironment = React.useMemo(() => currentOmniCommsEnvironment(), []);
  // The SERVER classification is authoritative. Browser host detection is only
  // a fallback for presentation before the probe answers, and it can never
  // upgrade an unknown server classification.
  const environment: OmniCommsEnvironment = React.useMemo(() => {
    const reported = (edge?.environment ?? '').trim().toLowerCase();
    if (reported === 'production') return 'production';
    if (reported === 'non_production') return 'non_production';
    if (edge && edge.available) return 'unknown';
    return browserEnvironment;
  }, [edge, browserEnvironment]);

  React.useEffect(() => {
    if (autoProbe) void probe();
  }, [autoProbe, probe]);

  const posture = React.useMemo(
    () =>
      deriveCertificationPosture({
        // DATABASE HEALTH POSTURE IS THE SOLE RUNTIME CERTIFICATION AUTHORITY.
        // The source-controlled evidence record is never consulted here.
        certifiedCommit: edge?.certifiedCommit ?? null,
        deployedRevision: edge?.revision ?? null,
        edgeCertificationState: edge?.certificationState ?? null,
        edgeAvailable: edge ? edge.available : null,
        edgeRevisionVerified: edge?.revisionVerified ?? null,
        edgeRevisionMatch: edge?.revisionMatch ?? null,
        edgeSafeTestPermitted: edge?.safeTestPermitted ?? null,
        edgeSafeTestBlockedReason: edge?.safeTestBlockedReason ?? null,
        environment,
      }),
    [edge, environment],
  );


  const refresh = React.useCallback(() => {
    void probe();
  }, [probe]);

  /**
   * Bounded Edge posture agreement. The execution button must additionally
   * require every one of these facts; the trusted server guard remains
   * mandatory regardless of what the browser concludes.
   */
  const edgeSafeTestPermitted =
    edge?.available === true &&
    edge.safeTestPermitted === true &&
    edge.revisionVerified === true &&
    edge.revisionMatch === 'match' &&
    (edge.certificationState ?? '').trim().toLowerCase() === 'certified' &&
    (edge.environment ?? '').trim().toLowerCase() === 'non_production';

  return {
    posture,
    edge,
    environment,
    probing,
    refresh,
    edgeSafeTestPermitted,
    safeTestPermitted: posture.safeTestPermitted && edgeSafeTestPermitted,
  };
}

export default useOmniCommsCertificationPosture;
