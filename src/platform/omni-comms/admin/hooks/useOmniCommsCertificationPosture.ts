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
}

export function useOmniCommsCertificationPosture(
  options: { autoProbe?: boolean } = {},
): UseOmniCommsCertificationPosture {
  const autoProbe = options.autoProbe !== false;
  const { result: edge, probe, probing } = useOmniCommsEdgeHealthProbe();
  const environment = React.useMemo(() => currentOmniCommsEnvironment(), []);

  React.useEffect(() => {
    if (autoProbe) void probe();
  }, [autoProbe, probe]);

  const posture = React.useMemo(
    () =>
      deriveCertificationPosture({
        recordedState: OMNI_COMMS_CERTIFICATION_EVIDENCE.state,
        certifiedCommit: OMNI_COMMS_CERTIFICATION_EVIDENCE.certifiedCommit,
        deployedRevision: edge?.revision ?? null,
        edgeCertificationState: edge?.certificationState ?? null,
        edgeAvailable: edge ? edge.available : null,
        environment,
      }),
    [edge, environment],
  );

  const refresh = React.useCallback(() => {
    void probe();
  }, [probe]);

  return { posture, edge, environment, probing, refresh };
}

export default useOmniCommsCertificationPosture;
