import { describe, it, expect } from 'vitest';
import { RECOMMENDED_ACTION_TAB, resolveRecommendedActionTab } from '../recommendedActionDispatch';
import {
  AUDIT_ATTACHMENT_BUCKET,
  AUDIT_MAX_FILE_SIZE,
  buildAuditObjectPath,
  sanitizeAuditFileName,
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

  it('produces collision-safe engagement-scoped object paths', () => {
    const a = buildAuditObjectPath('working-papers', 'eng-1', 'wp-1', 'same.pdf');
    const b = buildAuditObjectPath('working-papers', 'eng-1', 'wp-1', 'same.pdf');
    expect(a).not.toEqual(b);
    expect(a.startsWith('working-papers/eng-1/wp-1/')).toBe(true);
  });
});
