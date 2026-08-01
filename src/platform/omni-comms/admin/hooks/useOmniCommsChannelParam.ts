/**
 * Omni-Comms C1 — URL-controlled channel selection (`?channel=`).
 *
 * The channel identifier is addressable so operator bookmarks, Setup Wizard
 * deep links and browser smoke tests all land on the same surface. Unknown or
 * malformed values fall back to the catalogue default and never throw.
 */
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  OMNI_COMMS_DEFAULT_CHANNEL,
  resolveChannelDescriptor,
  type OmniCommsChannel,
  type OmniCommsChannelDescriptor,
} from '@/platform/omni-comms/domain/channelCatalogue';

export interface UseOmniCommsChannelParamResult {
  channel: OmniCommsChannel;
  descriptor: OmniCommsChannelDescriptor;
  setChannel: (next: string) => void;
}

export function useOmniCommsChannelParam(): UseOmniCommsChannelParamResult {
  const [searchParams, setSearchParams] = useSearchParams();

  const descriptor = useMemo(
    () => resolveChannelDescriptor(searchParams.get('channel')),
    [searchParams],
  );

  const setChannel = useCallback(
    (next: string) => {
      const resolved = resolveChannelDescriptor(next);
      const params = new URLSearchParams(searchParams);
      params.set('channel', resolved.channel);
      // A channel switch invalidates the previous channel's tab selection.
      params.delete('tab');
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  return { channel: descriptor.channel, descriptor, setChannel };
}

export { OMNI_COMMS_DEFAULT_CHANNEL };
