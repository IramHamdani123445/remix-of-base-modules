import React from 'react';
import { formatDateForDisplay } from '@/lib/format-config';

export interface PrintColumn {
  key: string;
  header: string;
}

export interface AppliedFilter {
  label: string;
  value: string;
}

function cell(row: Record<string, any>, key: string): string {
  const v = row?.[key];
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.join('; ');
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (/(_date|_at)$/.test(key) && typeof v === 'string') return formatDateForDisplay(v) || '—';
  if (key === 'progress_pct') return `${v}%`;
  if (key === 'overdue_days' || key === 'overdue_action_count') return Number(v) > 0 ? `${v}` : '—';
  return String(v);
}

function PrintHeader({ title, filters, total }: { title: string; filters: AppliedFilter[]; total: number }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <h1 style={{ margin: 0 }}>Internal Audit — {title}</h1>
      <p style={{ margin: '2px 0', fontSize: '9pt' }}>
        Generated {new Date().toLocaleString()} · {total} record{total === 1 ? '' : 's'}
      </p>
      <p style={{ margin: '2px 0', fontSize: '9pt' }}>
        <strong>Filters applied:</strong>{' '}
        {filters.length ? filters.map(f => `${f.label}: ${f.value}`).join('  |  ') : 'None (full authorised population)'}
      </p>
    </div>
  );
}

/**
 * Print-only rendering of the currently selected Action Centre queue.
 * Renders the complete filtered population (not the paginated screen page)
 * and no interactive chrome, so the output is usable in an operational meeting.
 */
export function ActionCentrePrintView({
  title, columns, rows, filters,
}: {
  title: string;
  columns: PrintColumn[];
  rows: Record<string, any>[];
  filters: AppliedFilter[];
}) {
  return (
    <div className="hidden print:block">
      <PrintHeader title={title} filters={filters} total={rows.length} />
      <table>
        <thead>
          <tr>{columns.map(c => <th key={c.key} style={{ textAlign: 'left' }}>{c.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={columns.length}>No records for the applied filters.</td></tr>
          )}
          {rows.map((r, i) => (
            <tr key={i}>{columns.map(c => <td key={c.key}>{cell(r, c.key)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Individual Audit Action Summary — one audit, its findings, management position,
 * corrective actions, targets, evidence, verification and follow-up state.
 */
export function AuditActionSummaryPrintView({
  engagementLabel, findings, actions, followUps,
}: {
  engagementLabel: string;
  findings: Record<string, any>[];
  actions: Record<string, any>[];
  followUps: Record<string, any>[];
}) {
  const head = findings[0] ?? actions[0] ?? {};
  return (
    <div className="hidden print:block">
      <h1 style={{ margin: 0 }}>Internal Audit — Audit Action Summary</h1>
      <p style={{ margin: '2px 0', fontSize: '9pt' }}>Generated {new Date().toLocaleString()}</p>
      <table style={{ marginBottom: 12 }}>
        <tbody>
          <tr><th style={{ textAlign: 'left', width: '20%' }}>Audit</th><td>{engagementLabel}</td></tr>
          <tr><th style={{ textAlign: 'left' }}>Department</th><td>{head.department_name || '—'}</td></tr>
          <tr><th style={{ textAlign: 'left' }}>Function</th><td>{head.function_name || head.function_area || '—'}</td></tr>
          <tr><th style={{ textAlign: 'left' }}>Plan year</th><td>{head.plan_fiscal_year || '—'}</td></tr>
        </tbody>
      </table>

      <h2>Findings and management position</h2>
      <table style={{ marginBottom: 12 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Finding</th><th style={{ textAlign: 'left' }}>Title</th>
            <th style={{ textAlign: 'left' }}>Severity</th><th style={{ textAlign: 'left' }}>Recommendations</th>
            <th style={{ textAlign: 'left' }}>Management position</th><th style={{ textAlign: 'left' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {findings.map(f => (
            <tr key={f.finding_id}>
              <td>{f.finding_ref || '—'}</td>
              <td>{f.title}</td>
              <td>{f.severity || '—'}</td>
              <td>{f.recommendation_count ?? 0}</td>
              <td>{f.management_position || f.response_status || 'Outstanding'}</td>
              <td>{f.lifecycle_status || '—'}</td>
            </tr>
          ))}
          {findings.length === 0 && <tr><td colSpan={6}>No findings recorded.</td></tr>}
        </tbody>
      </table>

      <h2>Corrective actions</h2>
      <table style={{ marginBottom: 12 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Action</th><th style={{ textAlign: 'left' }}>Description</th>
            <th style={{ textAlign: 'left' }}>Owner</th><th style={{ textAlign: 'left' }}>Original target</th>
            <th style={{ textAlign: 'left' }}>Current target</th><th style={{ textAlign: 'left' }}>Ext.</th>
            <th style={{ textAlign: 'left' }}>Progress</th><th style={{ textAlign: 'left' }}>Evidence</th>
            <th style={{ textAlign: 'left' }}>Verification</th><th style={{ textAlign: 'left' }}>Follow-up</th>
            <th style={{ textAlign: 'left' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {actions.map(a => (
            <tr key={a.action_id}>
              <td>{a.action_ref || '—'}</td>
              <td>{a.action_description}</td>
              <td>{a.action_owner || '—'}</td>
              <td>{formatDateForDisplay(a.original_target_date) || '—'}</td>
              <td>{formatDateForDisplay(a.current_target_date) || '—'}</td>
              <td>{a.extension_count ?? 0}</td>
              <td>{a.progress_pct ?? 0}%</td>
              <td>{a.evidence_state || 'None'}</td>
              <td>{a.verification_status || 'Not Started'}</td>
              <td>{a.follow_up_state || '—'}</td>
              <td>{a.lifecycle_status || '—'}</td>
            </tr>
          ))}
          {actions.length === 0 && <tr><td colSpan={11}>No corrective actions raised.</td></tr>}
        </tbody>
      </table>

      <h2>Follow-up</h2>
      <table>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Action</th><th style={{ textAlign: 'left' }}>Type</th>
            <th style={{ textAlign: 'left' }}>Originating plan year</th><th style={{ textAlign: 'left' }}>Due</th>
            <th style={{ textAlign: 'left' }}>Status</th><th style={{ textAlign: 'left' }}>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {followUps.map(f => (
            <tr key={f.follow_up_id}>
              <td>{f.action_ref || '—'}</td>
              <td>{f.follow_up_type || '—'}</td>
              <td>{f.plan_fiscal_year || '—'}</td>
              <td>{formatDateForDisplay(f.due_date) || '—'}</td>
              <td>{f.lifecycle_status || '—'}</td>
              <td>{f.outcome || 'Pending'}</td>
            </tr>
          ))}
          {followUps.length === 0 && <tr><td colSpan={6}>No follow-up scheduled.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
