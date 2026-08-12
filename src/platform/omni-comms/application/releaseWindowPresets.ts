/**
 * Omni-Comms — controlled pilot release-window presets.
 *
 * Presentation/configuration values only. Nothing here sends, enqueues,
 * approves or contacts a provider. The window is always bounded and always
 * starts now, so an administrator can never accidentally leave a pilot open.
 */

export interface ReleaseWindowValues {
  /** `datetime-local` value for the window start. */
  startsAt: string;
  /** `datetime-local` value for the window end. */
  expiresAt: string;
}

export interface ReleaseWindowPreset {
  id: string;
  label: string;
  hours: number;
  description: string;
}

export const RELEASE_WINDOW_PRESETS: readonly ReleaseWindowPreset[] = [
  {
    id: 'one_hour',
    label: '1-hour window',
    hours: 1,
    description: 'Tightest window. The pilot closes itself one hour from now.',
  },
  {
    id: 'two_hours',
    label: '2-hour window',
    hours: 2,
    description: 'Recommended for a single supervised business send.',
  },
  {
    id: 'twenty_four_hours',
    label: '24-hour window',
    hours: 24,
    description: 'Use only when the send must wait for another team.',
  },
] as const;

/** Local `datetime-local` representation (no timezone shift, minute precision). */
export function toDateTimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export function buildReleaseWindow(hours: number, now: Date = new Date()): ReleaseWindowValues {
  const start = new Date(now.getTime());
  const end = new Date(now.getTime() + hours * 60 * 60 * 1000);
  return { startsAt: toDateTimeLocal(start), expiresAt: toDateTimeLocal(end) };
}
