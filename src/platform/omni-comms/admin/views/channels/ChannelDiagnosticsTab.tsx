/**
 * Omni-Comms C1 — Diagnostics tab (read-only placeholder).
 *
 * No diagnostics queries are implemented in C1; this documents the evidence
 * the later delivery chunks will surface.
 */
import React from 'react';
import { DeferredCapabilityCard } from './channelFormPrimitives';
import type { ChannelUiDefinition } from './channelUiRegistry';

export const DIAGNOSTICS_EVIDENCE: readonly string[] = [
  'Credential verification history',
  'Identity verification',
  'Test request',
  'Dispatch job',
  'Provider attempt',
  'Provider reference',
  'Callback events',
  'Latency',
  'Failure category',
];

export const ChannelDiagnosticsTab: React.FC<{
  definition: ChannelUiDefinition;
}> = ({ definition }) => (
  <DeferredCapabilityCard
    testId="omni-comms-diagnostics"
    title={`${definition.name} diagnostics`}
    description="Planned delivery evidence. No diagnostics query runs in C1."
    bullets={DIAGNOSTICS_EVIDENCE}
    footer="Read-only placeholder."
  />
);

export default ChannelDiagnosticsTab;
