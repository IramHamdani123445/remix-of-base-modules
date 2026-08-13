/**
 * Omni-Comms — Activity automation observability UI contract.
 *
 *  - A transient status-refresh failure must NOT erase the last known good
 *    automation state; it raises a bounded, non-technical warning instead.
 *  - Claimed jobs are never presented as "sent".
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const HOOK = readFileSync(
  join(process.cwd(), 'src/platform/omni-comms/admin/hooks/useAutomationStatus.ts'),
  'utf8',
);
const SECTION = readFileSync(
  join(
    process.cwd(),
    'src/platform/omni-comms/admin/views/channels/simple/AutomationSection.tsx',
  ),
  'utf8',
);
const ACTIVITY = readFileSync(
  join(
    process.cwd(),
    'src/platform/omni-comms/admin/views/channels/simple/SimpleActivitySurface.tsx',
  ),
  'utf8',
);

describe('automation status polling resilience', () => {
  it('never clears the last known good status on a failed refresh', () => {
    const failureBlock = HOOK.slice(HOOK.indexOf('} catch'), HOOK.indexOf('} finally'));
    expect(failureBlock).not.toContain('setStatus(null)');
  });

  it('raises a bounded, non-technical refresh warning', () => {
    expect(HOOK).toContain('Unable to refresh automation status.');
    expect(HOOK).toContain('setRefreshError(AUTOMATION_REFRESH_ERROR_MESSAGE)');
  });

  it('clears the warning on the next successful refresh', () => {
    expect(HOOK).toContain('setRefreshError(null)');
  });

  it('does not surface raw RPC errors', () => {
    expect(HOOK).not.toMatch(/error\.message/);
  });

  it('suspends polling while the page is hidden and resumes on visibility', () => {
    expect(HOOK).toContain("document.visibilityState === 'visible'");
    expect(HOOK).toContain("addEventListener('visibilitychange'");
    expect(HOOK).toContain("removeEventListener('visibilitychange'");
  });
});

describe('claimed is not sent', () => {
  it('labels claimed jobs as picked up', () => {
    expect(SECTION).toContain('Jobs picked up in last run');
    expect(SECTION).not.toContain('Jobs sent in last run');
  });

  it('renders the refresh warning on the Activity surface', () => {
    expect(ACTIVITY).toContain('omni-comms-automation-refresh-warning');
    expect(ACTIVITY).toContain('automationRefreshError');
  });
});
