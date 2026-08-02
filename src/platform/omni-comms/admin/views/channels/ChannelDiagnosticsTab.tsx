/**
 * Omni-Comms C5A.1 — Diagnostics tab (read-only placeholder).
 *
 * No diagnostics query is implemented. This tab states plainly what delivery
 * evidence will exist once controlled provider test delivery is built, and it
 * never contacts a provider or sends anything.
 */
import React from 'react';
import { DeferredCapabilityCard } from './channelFormPrimitives';
import type { ChannelUiDefinition } from './channelUiRegistry';

export const DIAGNOSTICS_EVIDENCE: readonly string[] = [
  'Provider dispatch attempt and provider reference',
  'Provider callback and delivery status events',
  'Technical delivery result and failure category',
  'Latency and retry history',
  'Credential and identity verification history',
];

export const DIAGNOSTICS_NOTICE =
  'Delivery diagnostics are not implemented. The Test Centre validates '
  + 'configuration only: a passed configuration preflight is not proof of '
  + 'delivery, and nothing on this screen contacts a provider or sends a '
  + 'message.';

export const ChannelDiagnosticsTab: React.FC<{
  definition: ChannelUiDefinition;
}> = ({ definition }) => (
  <DeferredCapabilityCard
    testId="omni-comms-diagnostics"
    title={`${definition.name} diagnostics`}
    description={DIAGNOSTICS_NOTICE}
    bullets={DIAGNOSTICS_EVIDENCE}
    footer="Read-only placeholder — no diagnostics query runs and no message is sent."
  />
);

export default ChannelDiagnosticsTab;
