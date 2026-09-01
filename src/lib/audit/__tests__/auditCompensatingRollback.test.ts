import { describe, it, expect, vi, beforeEach } from 'vitest';

const removeMock = vi.fn();
const deleteState: { evidenceError: { message: string } | null; paperError: { message: string } | null } = {
  evidenceError: null,
  paperError: null,
};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    storage: { from: () => ({ remove: removeMock }) },
    from: (table: string) => ({
      delete: () => ({
        in: async () => ({ error: table === 'ia_evidence' ? deleteState.evidenceError : null }),
        eq: async () => ({ error: table === 'ia_working_papers' ? deleteState.paperError : null }),
      }),
    }),
  },
}));

const { compensateWorkingPaperFailure, describeRollback } = await import('../auditCompensatingRollback');

const PATH = 'internal-audit/3f1c1a2e-6b7d-4c8a-9f10-2a4b6c8d0e12/working-papers/9d2b7c44-1a35-4f6e-8b90-5c7d1e3f2a48/1_x.pdf';

beforeEach(() => {
  removeMock.mockReset();
  deleteState.evidenceError = null;
  deleteState.paperError = null;
});

describe('IA-POST-UAT-04 corrective — compensating rollback (NOT a transaction)', () => {
  it('reports success when every compensating step succeeds', async () => {
    removeMock.mockResolvedValue({ data: [{ name: PATH }], error: null });
    const r = await compensateWorkingPaperFailure({
      uploadedPaths: [PATH],
      evidenceIds: ['ev-1'],
      workingPaperRowId: 'wp-row-1',
    });
    expect(r).toEqual({ cleanup_attempted: true, cleanup_succeeded: true, cleanup_errors: [] });
    expect(describeRollback(r, 'Link failed.')).toContain('Compensating rollback complete');
  });

  it('surfaces a storage cleanup failure instead of swallowing the error', async () => {
    removeMock.mockResolvedValue({ data: null, error: { message: 'access denied' } });
    const r = await compensateWorkingPaperFailure({ uploadedPaths: [PATH], evidenceIds: [], workingPaperRowId: null });
    expect(r.cleanup_attempted).toBe(true);
    expect(r.cleanup_succeeded).toBe(false);
    expect(r.cleanup_errors[0]).toContain('access denied');
    expect(describeRollback(r, 'Link failed.')).toContain('COMPENSATING ROLLBACK INCOMPLETE');
  });

  it('flags an orphan when storage silently removes nothing', async () => {
    removeMock.mockResolvedValue({ data: [], error: null });
    const r = await compensateWorkingPaperFailure({ uploadedPaths: [PATH], evidenceIds: [], workingPaperRowId: null });
    expect(r.cleanup_succeeded).toBe(false);
    expect(r.cleanup_errors[0]).toContain('not removed');
  });

  it('reports evidence and working-paper cleanup failures', async () => {
    removeMock.mockResolvedValue({ data: [{ name: PATH }], error: null });
    deleteState.evidenceError = { message: 'ev delete denied' };
    deleteState.paperError = { message: 'wp delete denied' };
    const r = await compensateWorkingPaperFailure({
      uploadedPaths: [PATH],
      evidenceIds: ['ev-1'],
      workingPaperRowId: 'wp-row-1',
    });
    expect(r.cleanup_succeeded).toBe(false);
    expect(r.cleanup_errors.join(' ')).toContain('ia_evidence cleanup failed');
    expect(r.cleanup_errors.join(' ')).toContain('ia_working_papers cleanup failed');
  });

  it('does not claim cleanup when there is nothing to compensate', async () => {
    const r = await compensateWorkingPaperFailure({ uploadedPaths: [], evidenceIds: [], workingPaperRowId: null });
    expect(r.cleanup_attempted).toBe(false);
    expect(removeMock).not.toHaveBeenCalled();
  });
});
