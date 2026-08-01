/**
 * Omni-Comms C1 — Test Centre tab (read-only placeholder).
 *
 * Hard boundary: this tab performs NO action. It does not call
 * sendCommunication(), does not create a request, message, dispatch job or
 * delivery attempt, and never contacts Resend or any other provider.
 */
import React from 'react';
import { DeferredCapabilityCard } from './channelFormPrimitives';
import type { ChannelUiDefinition } from './channelUiRegistry';

export const TEST_CENTRE_NOTICE =
  'Technical channel testing will be implemented after provider account, '
  + 'identity, endpoint and binding configuration are complete.';

export const ChannelTestCentreTab: React.FC<{
  definition: ChannelUiDefinition;
}> = ({ definition }) => (
  <DeferredCapabilityCard
    testId="omni-comms-test-centre"
    title={`${definition.name} Test Centre`}
    description={TEST_CENTRE_NOTICE}
    bullets={[
      'No request is created.',
      'No message is created.',
      'No dispatch job is created.',
      'No delivery attempt is created.',
      'No provider is contacted.',
    ]}
    footer="Read-only placeholder."
  />
);

export default ChannelTestCentreTab;
