import { describe, it, expect } from 'vitest';
import { RECOMMENDED_ACTION_TAB, resolveRecommendedActionTab } from '../recommendedActionDispatch';
import {
  AUDIT_ATTACHMENT_BUCKET,
  AUDIT_MAX_FILE_SIZE,
  AUDIT_STORAGE_ROOT,
  buildAuditObjectPath,
  sanitizeAuditFileName,
  storageClassOf,
  storageEngagementOf,
  validateAuditFile,
} from '@/lib/audit/auditAttachmentUpload';


const ALL_KEYS = [
  'LAUNCH_AUDIT',
  'BEGIN_FIELDWORK',
  'DOCUMENT_FINDINGS',
  'REQUEST_MANAGEMENT_RESPONSES',
  'FOLLOW_UP_OVERDUE_ACTIONS',
  'CLOSE_AUDIT',
] as const;

function file(name: string, type: string, size: number): File {
  const f = new File([new Uint8Array(Math.min(size, 1024))], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

describe('IA-POST-UAT-01 — exhaustive recommended-action dispatch', () => {
  it('resolves every NextActionKey', () => {
    ALL_KEYS.forEach(key => {
      expect(resolveRecommendedActionTab(key), `missing dispatcher for ${key}`).toBeTruthy();
    });
  });

  it('has no dispatcher entries beyond the declared keys', () => {
    expect(Object.keys(RECOMMENDED_ACTION_TAB).sort()).toEqual([...ALL_KEYS].sort());
  });
});

describe('IA-POST-UAT-04 — audit attachment policy', () => {
  it('uses the private audit bucket', () => {
    expect(AUDIT_ATTACHMENT_BUCKET).toBe('audit-attachments');
  });

  it('accepts valid PDF, XLSX and image files', () => {
    expect(validateAuditFile(file('wp.pdf', 'application/pdf', 1024)).ok).toBe(true);
    expect(validateAuditFile(file('t.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 2048)).ok).toBe(true);
    expect(validateAuditFile(file('shot.png', 'image/png', 512)).ok).toBe(true);
  });

  it('rejects unsupported extension, invalid MIME, oversized and zero-byte files', () => {
    expect(validateAuditFile(file('x.exe', 'application/octet-stream', 10)).ok).toBe(false);
    expect(validateAuditFile(file('x.pdf', 'application/x-msdownload', 10)).ok).toBe(false);
    expect(validateAuditFile(file('big.pdf', 'application/pdf', AUDIT_MAX_FILE_SIZE + 1)).ok).toBe(false);
    expect(validateAuditFile(file('empty.pdf', 'application/pdf', 0)).ok).toBe(false);
  });

  it('sanitizes unsafe file names', () => {
    expect(sanitizeAuditFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeAuditFileName('my report (final).pdf')).toBe('my_report_final_.pdf');
  });

  it('produces collision-safe canonical object paths', () => {
    const a = buildAuditObjectPath(ENG, 'working-papers', PAPER, 'same.pdf');
    const b = buildAuditObjectPath(ENG, 'working-papers', PAPER, 'same.pdf');
    expect(a).not.toEqual(b);
  });
});

// IA-POST-UAT-04 CORRECTIVE — the generated path MUST satisfy the certified
// storage policy parser (ia_storage_engagement / ia_storage_class), otherwise
// the storage INSERT policy rejects the upload.
const ENG = '3f1c1a2e-6b7d-4c8a-9f10-2a4b6c8d0e12';
const PAPER = '9d2b7c44-1a35-4f6e-8b90-5c7d1e3f2a48';

describe('IA-POST-UAT-04 corrective — canonical storage path contract', () => {
  const path = buildAuditObjectPath(ENG, 'working-papers', PAPER, 'Q3 Payroll Test (final).pdf');
  const segs = path.split('/');

  it('segment 1 is the internal-audit root', () => {
    expect(AUDIT_STORAGE_ROOT).toBe('internal-audit');
    expect(segs[0]).toBe('internal-audit');
  });

  it('segment 2 is the engagement UUID', () => {
    expect(segs[1]).toBe(ENG);
    expect(segs[1]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('segment 3 is the working-papers object class', () => {
    expect(segs[2]).toBe('working-papers');
  });

  it('segment 4 is the working-paper UUID and segment 5 the safe file name', () => {
    expect(segs[3]).toBe(PAPER);
    expect(segs[4]).toMatch(/^\d+-[a-z0-9]{6}_Q3_Payroll_Test_final_.pdf$/);
    expect(segs).toHaveLength(5);
  });

  it('is accepted by the ia_storage_engagement / ia_storage_class semantics', () => {
    expect(storageEngagementOf(path)).toBe(ENG);
    expect(storageClassOf(path)).toBe('working-papers');
  });

  it('rejects the legacy non-conforming path shape', () => {
    const legacy = `working-papers/${ENG}/${PAPER}/file.pdf`;
    // ia_storage_engagement returns NULL -> storage INSERT policy denies.
    expect(storageEngagementOf(legacy)).toBeNull();
  });

  it('refuses arbitrary roots, non-UUID engagements and unknown classes', () => {
    expect(() => buildAuditObjectPath('eng-1', 'working-papers', PAPER, 'f.pdf')).toThrow();
    // @ts-expect-error class is allow-listed at the type level too
    expect(() => buildAuditObjectPath(ENG, 'anything', PAPER, 'f.pdf')).toThrow();
    expect(() => buildAuditObjectPath(ENG, 'working-papers', '../escape', 'f.pdf')).toThrow();
  });

  it('never lets a respondent-writable class be confused with working-papers', () => {
    // Mirrors ia_respondent_writable_class(): working-papers is NOT in the list.
    const respondentWritable = ['responses', 'actions', 'documents', 'queries'];
    expect(respondentWritable).not.toContain(storageClassOf(path));
  });

});
