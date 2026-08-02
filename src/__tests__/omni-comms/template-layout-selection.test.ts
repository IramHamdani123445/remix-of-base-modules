/**
 * Template layout selection — presentation gating and Rule 15 boundary tests.
 */
import { describe, it, expect } from 'vitest';
import {
  describeLayoutSelection,
  isLayoutSelectionApprovable,
  mapLayoutErrorDetail,
  isLayoutKindCompatible,
  layoutKindsForChannel,
  LAYOUT_REQUIRED_MESSAGE,
} from '@/platform/omni-comms/application/templateLayoutSelection';
import {
  checkTemplateLayoutBoundary,
  isTemplateLayoutFile,
  TEMPLATE_LAYOUT_ALLOWED_RPCS,
} from '@/platform/omni-comms/architecture/checks/checkTemplateLayoutBoundary';
import { runArchitectureChecks } from '@/platform/omni-comms/architecture/runArchitectureChecks';

/**
 * A full repository architecture scan reads ~6k source files. It is
 * inherently expensive and fully deterministic, so these specific tests get an
 * explicit generous budget instead of the 5s default. Assertions are unchanged.
 */
const REPO_SCAN_TIMEOUT_MS = 60_000;


const DIALOG = 'src/platform/omni-comms/admin/components/OmniCommsLayoutSelectionDialog.tsx';
const scanOf = (content: string) => ({ files: [{ filePath: DIALOG, content }] } as never);

describe('layout selection presentation', () => {
  it('reports not selected when nothing is persisted', () => {
    const d = describeLayoutSelection({ layout_selection_mode: null, layout_id: null, pinned_layout_version_id: null });
    expect(d.kind).toBe('not_selected');
    expect(isLayoutSelectionApprovable({ layout_selection_mode: null, layout_id: null, pinned_layout_version_id: null })).toBe(false);
  });

  it('accepts a resolved default selection', () => {
    const v = { layout_selection_mode: 'resolved_default' as const, layout_id: 'l1', pinned_layout_version_id: null, layout_name: 'Email base' };
    expect(describeLayoutSelection(v).kind).toBe('resolved_default');
    expect(describeLayoutSelection(v).label).toContain('Email base');
    expect(isLayoutSelectionApprovable(v)).toBe(true);
  });

  it('accepts a pinned selection and shows the version number', () => {
    const v = { layout_selection_mode: 'pinned' as const, layout_id: 'l1', pinned_layout_version_id: 'lv1', layout_code: 'EMAIL_BASE', pinned_layout_version_number: 3 };
    expect(describeLayoutSelection(v).label).toContain('v3');
    expect(isLayoutSelectionApprovable(v)).toBe(true);
  });

  it('rejects pinned mode without a pinned version', () => {
    const v = { layout_selection_mode: 'pinned' as const, layout_id: 'l1', pinned_layout_version_id: null };
    expect(describeLayoutSelection(v).kind).toBe('invalid');
    expect(isLayoutSelectionApprovable(v)).toBe(false);
  });

  it('honours the server-side validity flag', () => {
    const v = { layout_selection_mode: 'resolved_default' as const, layout_id: 'l1', pinned_layout_version_id: null, layout_selection_valid: false };
    expect(isLayoutSelectionApprovable(v)).toBe(false);
  });

  it('maps layout_selection_required to a controlled message', () => {
    expect(mapLayoutErrorDetail('layout_selection_required')).toContain('Select and save a layout');
    expect(mapLayoutErrorDetail('unrelated_detail')).toBeNull();
    expect(LAYOUT_REQUIRED_MESSAGE).toMatch(/required/i);
  });

  it('maps layout compatibility by channel', () => {
    expect(isLayoutKindCompatible('EMAIL', 'email')).toBe(true);
    expect(isLayoutKindCompatible('LETTER', 'email')).toBe(false);
    expect(layoutKindsForChannel('print')).toContain('LETTER');
    expect(isLayoutKindCompatible(null, 'sms')).toBe(true);
  });
});

describe('Rule 15 — OMNI_TEMPLATE_LAYOUT_BOUNDARY', () => {
  it('recognises the layout surface files', () => {
    expect(isTemplateLayoutFile(DIALOG)).toBe(true);
    expect(isTemplateLayoutFile('src/platform/omni-comms/application/templateLayoutSelection.ts')).toBe(true);
    expect(isTemplateLayoutFile('src/pages/Index.tsx')).toBe(false);
  });

  it('allows only the bounded RPC set', () => {
    expect(TEMPLATE_LAYOUT_ALLOWED_RPCS.has('omni_comms_template_version_set_layout_selection')).toBe(true);
    expect(TEMPLATE_LAYOUT_ALLOWED_RPCS.has('omni_comms_template_version_approve')).toBe(false);
  });

  it('detects direct table access', () => {
    const v = checkTemplateLayoutBoundary(scanOf(`supabase.from('core_template_layout').select()`));
    expect(v.some((x) => x.message.includes('accesses a table directly'))).toBe(true);
  });

  it('detects private RPC use', () => {
    const v = checkTemplateLayoutBoundary(scanOf(`rpc('omni_comms_priv_set_layout')`));
    expect(v.some((x) => x.message.includes('private RPC'))).toBe(true);
  });

  it('detects a non-approved RPC', () => {
    const v = checkTemplateLayoutBoundary(scanOf(`rpc('omni_comms_template_version_approve')`));
    expect(v.some((x) => x.message.includes('non-approved RPC'))).toBe(true);
  });

  it('detects direct edge invocation and approval calls', () => {
    const v = checkTemplateLayoutBoundary(scanOf(`functions.invoke('x'); approveTemplateVersion(client, {})`));
    expect(v.some((x) => x.message.includes('Edge Function'))).toBe(true);
    expect(v.some((x) => x.message.includes('approval'))).toBe(true);
  });

  it('detects a missing optimistic concurrency token', () => {
    const v = checkTemplateLayoutBoundary(scanOf(`setTemplateVersionLayoutSelection(client, { versionId })`));
    expect(v.some((x) => x.message.includes('optimistic concurrency'))).toBe(true);
  });

  it('passes clean on the real repository', async () => {
    const r = await runArchitectureChecks({});
    const layout = r.violations.filter((v) => v.ruleId === 'OMNI_TEMPLATE_LAYOUT_BOUNDARY' && v.baselineStatus === 'not_baselined');
    expect(layout).toEqual([]);
  }, REPO_SCAN_TIMEOUT_MS);
});
