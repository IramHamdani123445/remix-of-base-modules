/**
 * A refusal, shown so an officer can act on it.
 *
 * BN refusals are often several conditions at once — two unverified documents
 * and a missing recommendation, say. Those arrive as one string with a heading
 * on the first line and a bullet on each line after it (see
 * `describeApprovalBlockers`). Handed straight to `toast.error` as a title,
 * sonner collapsed the newlines and produced a paragraph the officer had to
 * pick apart:
 *
 *   Cannot approve — 2 conditions not met: 1. 2 mandatory document(s) are
 *   neither verified nor formally waived: 874bede8-2dd0-44b5-92dc-52dc9e0738c3,
 *   c82efd7a-ea4f-4361-9de0-3b304da9775d. Verify or waive them before
 *   approving. 2. No recommendation has been submitted for this claim…
 *
 * This splits the heading from the detail and keeps one condition per line. A
 * single short sentence stays a plain title — a heading invented for it would
 * only add words.
 */
import { toast } from 'sonner';

/** Beyond this, a lone sentence reads better as body text than as a title. */
const TITLE_MAX = 90;

export interface BlockerToastOptions {
  /** Heading to use when the message carries none of its own. */
  fallbackTitle?: string;
  /** Milliseconds. Longer for multi-condition refusals — they take reading. */
  duration?: number;
}

/**
 * Shows `message` as a refusal.
 *
 * Multi-line: first line becomes the title, the rest the body, one per line.
 * Single line: shown as the title, or as the body under `fallbackTitle` when
 * it is too long to sit on one.
 */
export function showBlockerToast(
  message: unknown,
  options: BlockerToastOptions = {},
): void {
  const text = String(
    (message as any)?.message ?? message ?? '',
  ).trim();
  if (!text) {
    toast.error(options.fallbackTitle ?? 'The action could not be completed.');
    return;
  }

  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  const duration = options.duration ?? (lines.length > 1 ? 12_000 : 6_000);

  if (lines.length > 1) {
    const [heading, ...rest] = lines;
    toast.error(heading, {
      // pre-line keeps each condition on its own line; without it sonner runs
      // them together, which is the whole defect this exists to avoid.
      description: <span className="whitespace-pre-line">{rest.join('\n')}</span>,
      duration,
    });
    return;
  }

  const only = lines[0];
  if (only.length <= TITLE_MAX || !options.fallbackTitle) {
    toast.error(only, { duration });
    return;
  }
  toast.error(options.fallbackTitle, { description: only, duration });
}
