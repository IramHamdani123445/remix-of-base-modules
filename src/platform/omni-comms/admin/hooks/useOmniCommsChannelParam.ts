/**
 * Omni-Comms C1 — URL-controlled channel selection (`?channel=`).
 *
 * Catalogue-first: an unknown, empty or missing `?channel=` value renders the
 * channel catalogue. No channel (Email included) is ever silently selected.
 */
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  findChannelDescriptor,
  type OmniCommsChannelDescriptor,
} from '@/platform/omni-comms/domain/channelCatalogue';

export interface UseOmniCommsSelectedChannelResult {
  selected: OmniCommsChannelDescriptor | null;
  raw: string | null;
  selectChannel: (next: string) => void;
  clearChannel: () => void;
}

export function useOmniCommsSelectedChannel(): UseOmniCommsSelectedChannelResult {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('channel');

  const selected = useMemo(() => findChannelDescriptor(raw), [raw]);

  const selectChannel = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams);
      params.set('channel', next);
      // A channel switch invalidates the previous channel's tab selection.
      params.delete('tab');
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const clearChannel = useCallback(() => {
    const params = new URLSearchParams(searchParams);
    params.delete('channel');
    params.delete('tab');
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  return { selected, raw, selectChannel, clearChannel };
}
