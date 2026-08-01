/**
 * Omni-Comms C1 — channel Endpoints tab (UI shell only).
 *
 * No database table, no configuration model and no callback handling is added
 * in C1. This tab documents the future endpoint responsibilities per channel.
 */
import React from 'react';
import { DeferredCapabilityCard } from './channelFormPrimitives';
import type { ChannelUiDefinition } from './channelUiRegistry';

export const ENDPOINTS_NOT_IMPLEMENTED_LABEL =
  'Configuration model not implemented in C1';

export const ChannelEndpointsTab: React.FC<{
  definition: ChannelUiDefinition;
}> = ({ definition }) => (
  <DeferredCapabilityCard
    testId="omni-comms-endpoints-shell"
    title={`${definition.name} endpoints`}
    description={ENDPOINTS_NOT_IMPLEMENTED_LABEL}
    bullets={definition.endpoints}
    footer="No endpoint record is created, stored or contacted."
  />
);

export default ChannelEndpointsTab;
