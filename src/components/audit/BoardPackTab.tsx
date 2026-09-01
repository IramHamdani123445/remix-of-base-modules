import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileText, Download, Lock, Loader2, AlertTriangle, Info, Settings2 } from 'lucide-react';
import { StatusBadge, DataTable } from '@/components/common';
import type { DataTableColumn } from '@/components/common';
import { useIAPlanArtifacts, useIAPlanArtifactMutations } from '@/hooks/useAuditPlanArtifacts';
import { formatDateForDisplay } from '@/lib/format-config';
import { useToast } from '@/hooks/use-toast';
import { useUserCode } from '@/hooks/useUserCode';
import { supabase } from '@/integrations/supabase/client';
import { useIADepartments, useIADepartmentFunctions, useIAActiveAuditors } from '@/hooks/useAuditData';
import { useIARiskAssessments } from '@/hooks/useAuditDataPhase2';
import { useDocumentFoundation } from '@/hooks/useDocumentFoundation';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ReportCustomizationDialog, DEFAULT_REPORT_CONFIG, THEME_COLORS } from './ReportCustomizationDialog';
import type { ReportConfig } from './ReportCustomizationDialog';
import ssbLogoPng from '@/assets/ssb-logo.png';
import { useAuditPlanTemplate } from '@/hooks/useAuditDocumentTemplates';
import { resolvePlanTemplate } from '@/lib/audit/documentTemplateResolver';
import { mapPlanOutput } from '@/lib/audit/planOutputMapper';
import { DEFAULT_AUDIT_PLAN_CONFIG } from '@/lib/audit/documentTemplateDefaults';
import type { PlanTemplateOverride } from '@/lib/audit/documentTemplateOverrides';
import { applyPlanOverrides, createEmptyPlanOverride, hasPlanOverrides } from '@/lib/audit/documentTemplateOverrides';
import { PlanOverridePanel } from './templates/PlanOverridePanel';
import { LiveDocumentPreview } from './templates/LiveDocumentPreview';
import { useDocumentTemplateSections } from '@/hooks/useDocumentTemplateSections';
import { formatDepartmentLabel } from '@/lib/audit/departmentLabel';
import {
  DEFAULT_AUDIT_BRANDING,
  renderCoverPage as renderUnifiedCover,
  renderPageHeader,
  renderFooter,
  renderSectionTitle as renderUnifiedSectionTitle,
  renderNarrativeBlock,
  renderKvTable,
  renderWatermarkAllPages,
  brandingFromFoundation,
  loadLogoBase64,
  displayValue as dv,
  resolveField as ef,
  type ExportBranding,
} from '@/lib/audit/auditExportPrimitives';

interface BoardPackTabProps {
  planId: string;
  plan: any;
  engagements: any[];
}

// ===== HELPER: Lookup maps =====
function buildLookups(departments: any[], functions: any[], auditors: any[]) {
  const deptMap = new Map(departments.map((d: any) => [d.id, d.name]));
  const funcMap = new Map(functions.map((f: any) => [f.id, f.function_name]));
  const auditorMap = new Map(auditors.map((a: any) => [a.id, a.name]));
  return { deptMap, funcMap, auditorMap };
}

// ===== PDF HELPERS — delegating to unified auditExportPrimitives =====
function getTheme(config: ReportConfig) {
  return THEME_COLORS[config.colorTheme] || THEME_COLORS['ssb-green'];
}

function toJsPdfFormat(pageSize?: string): 'letter' | 'a4' | 'legal' {
  if (pageSize === 'a4' || pageSize === 'legal') return pageSize;
  return 'letter';
}

/** Convert hex color to RGB tuple */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)];
}

/** Build theme from resolved plan template config (template/foundation take priority) */
function getThemeFromTemplate(config: ReportConfig, templateConfig?: ReturnType<typeof mapPlanOutput>) {
  const shouldUseCustomTheme = config.colorTheme !== DEFAULT_REPORT_CONFIG.colorTheme;
  if (shouldUseCustomTheme || !templateConfig?.resolved?.branding?.colorPalette) {
    return getTheme(config);
  }
  const palette = templateConfig.resolved.branding.colorPalette;
  return {
    primary: hexToRgb(palette.primary),
    secondary: hexToRgb(palette.secondary),
    accent: hexToRgb(palette.accent),
    altRow: hexToRgb(palette.tableStripe),
    label: 'Template',
    description: 'From template config',
  };
}

function isCustomHeaderTitle(config: ReportConfig) {
  return config.headerTitle.trim() !== DEFAULT_REPORT_CONFIG.headerTitle;
}

function isCustomHeaderSubtitle(config: ReportConfig) {
  return config.headerSubtitle.trim() !== DEFAULT_REPORT_CONFIG.headerSubtitle;
}

function isCustomConfidentialityLabel(config: ReportConfig) {
  return config.confidentialityLabel.trim() !== DEFAULT_REPORT_CONFIG.confidentialityLabel;
}

function buildDefaultReportConfig(templateConfig?: ReturnType<typeof mapPlanOutput>, foundation?: any): ReportConfig {
  return {
    ...DEFAULT_REPORT_CONFIG,
    headerTitle:
      templateConfig?.resolved?.branding?.orgName ||
      foundation?.branding?.orgName ||
      DEFAULT_REPORT_CONFIG.headerTitle,
    confidentialityLabel:
      templateConfig?.cover?.confidentialLabel ||
      foundation?.branding?.confidentialLabel ||
      DEFAULT_REPORT_CONFIG.confidentialityLabel,
    showDraftWatermark:
      templateConfig?.showWatermark ??
      foundation?.draftRules?.showWatermark ??
      DEFAULT_REPORT_CONFIG.showDraftWatermark,
    pageOrientation:
      templateConfig?.pageLayout?.orientation ||
      DEFAULT_REPORT_CONFIG.pageOrientation,
  };
}

/** Build ExportBranding from Document & Output Settings with optional one-off overrides */
function buildBranding(
  config: ReportConfig,
  templateConfig?: ReturnType<typeof mapPlanOutput>,
  foundation?: any
): ExportBranding {
  const baseBranding = foundation
    ? brandingFromFoundation(foundation)
    : { ...DEFAULT_AUDIT_BRANDING };
  const theme = templateConfig ? getThemeFromTemplate(config, templateConfig) : getTheme(config);

  return {
    ...baseBranding,
    orgName:
      isCustomHeaderTitle(config)
        ? config.headerTitle
        : (templateConfig?.resolved?.branding?.orgName || baseBranding.orgName),
    department: isCustomHeaderSubtitle(config) ? config.headerSubtitle : baseBranding.department,
    primaryColor: theme.primary,
    accentColor: theme.accent,
    altRowColor: theme.altRow,
    confidentialityText:
      isCustomConfidentialityLabel(config)
        ? config.confidentialityLabel
        : (templateConfig?.cover?.confidentialLabel || baseBranding.confidentialityText),
  };
}

async function getLogoBase64(foundation?: any): Promise<string | null> {
  if (foundation?.branding?.showLogo === false) return null;
  const logoSrc = foundation?.branding?.logoSource && foundation.branding.logoSource !== 'default'
    ? foundation.branding.logoSource
    : ssbLogoPng;
  return loadLogoBase64(logoSrc);
}

// dv and ef are now imported from auditExportPrimitives (displayValue, resolveField)

/** Get rationale display from structured or legacy fields */
function getRationaleDisplay(e: any): string {
  const codes = Array.isArray(e.inclusion_reason_codes) ? e.inclusion_reason_codes : [];
  if (codes.length > 0) {
    return codes.join(', ') + (e.inclusion_reason_notes ? ` — ${e.inclusion_reason_notes}` : '');
  }
  return e.inclusion_rationale || '';
}

/** Get deliverables display from structured or legacy fields */
function getDeliverablesDisplay(e: any): string {
  const codes = Array.isArray(e.expected_deliverable_codes) ? e.expected_deliverable_codes : [];
  if (codes.length > 0) {
    return codes.join(', ') + (e.expected_deliverable_notes ? ` — ${e.expected_deliverable_notes}` : '');
  }
  return e.expected_deliverable || '';
}

/** Get support auditor names */
function getSupportNames(e: any, auditorMap: Map<string, string>): string {
  return (Array.isArray(e.supportive_auditor_ids) ? e.supportive_auditor_ids : [])
    .map((id: string) => auditorMap.get(id)).filter(Boolean).join(', ');
}

// ===== PAGE HEADER — delegates to unified primitives =====
function addHeader(doc: jsPDF, branding: ExportBranding, sectionTitle: string, fiscalYear: string, version: number) {
  renderPageHeader(doc, branding, { sectionTitle, fiscalYear, version });
}

// ===== FOOTER — delegates to unified primitives =====
function addFooter(doc: jsPDF, branding: ExportBranding, version: number, artifactVersion: number) {
  renderFooter(doc, branding, {
    extraText: `Plan v${version}  •  Artifact v${artifactVersion}`,
  });
}

// ===== SECTION TITLE — delegates to unified primitives =====
function drawSectionTitle(doc: jsPDF, y: number, title: string, branding: ExportBranding): number {
  return renderUnifiedSectionTitle(doc, branding, title, y);
}

// ===== NARRATIVE BLOCK — delegates to unified primitives =====
function addNarrativeBlock(doc: jsPDF, y: number, title: string, content: string | null | undefined, _pw: number, branding: ExportBranding): number {
  return renderNarrativeBlock(doc, branding, title, content, y);
}

// ===== KEY-VALUE PAIR TABLE — delegates to unified primitives =====
function addKvTable(doc: jsPDF, y: number, pairs: [string, string][], branding: ExportBranding): number {
  return renderKvTable(doc, branding, pairs, y);
}

// ===== BOARD SUMMARY PDF (REDESIGNED) =====
function generateBoardSummaryPdf(
  plan: any,
  engagements: any[],
  lookups: ReturnType<typeof buildLookups>,
  config: ReportConfig,
  branding: ExportBranding,
  planTemplateConfig?: ReturnType<typeof mapPlanOutput>
): jsPDF {
  const doc = new jsPDF({
    orientation: planTemplateConfig?.pageLayout?.orientation || config.pageOrientation,
    format: toJsPdfFormat(planTemplateConfig?.pageLayout?.pageSize),
  });
  const version = plan?.current_version_number || 1;
  const artVersion = (plan?.artifact_version_number || 0) + 1;

  addHeader(doc, branding, 'Board Summary — Annual Audit Plan', plan?.fiscal_year || 'N/A', version);

  let y = 50;
  y = addKvTable(doc, y, [
    ['Plan Title', dv(plan?.title)],
    ['Status', dv(plan?.status, 'Draft')],
    ['Plan Version', `v${version}`],
    ['Prepared By', dv(plan?.created_by || plan?.plan_owner)],
    ['Total Audits', String(engagements.length)],
    ['Total Planned Days', String(engagements.reduce((s: number, e: any) => s + (Number(e.estimated_days) || 0), 0))],
    ['Approved By', dv(plan?.approved_by)],
    ['Approved Date', plan?.approved_date ? formatDateForDisplay(plan.approved_date) : ''],
  ], branding);

  if (config.includeExecutiveSummary) {
    y = addNarrativeBlock(doc, y, 'Executive Summary', plan?.executive_summary, 0, branding);
    y = addNarrativeBlock(doc, y, 'Planning Methodology', plan?.methodology || plan?.methodology_notes, 0, branding);
  }

  if (config.includeRiskCoverage) {
    if (y > 210) { doc.addPage(); y = 52; }
    y = drawSectionTitle(doc, y, 'Risk Coverage Summary', branding);
    const riskDist = { Critical: 0, High: 0, Medium: 0, Low: 0 };
    engagements.forEach((e: any) => {
      const r = e.engagement_risk_rating as keyof typeof riskDist;
      if (r in riskDist) riskDist[r]++;
    });
    autoTable(doc, {
      startY: y,
      head: [['Risk Level', 'Audits', '% of Plan']],
      body: Object.entries(riskDist).map(([k, v]) => [k, String(v), engagements.length ? `${Math.round((v / engagements.length) * 100)}%` : '0%']),
      styles: { fontSize: 10, cellPadding: 4 },
      headStyles: { fillColor: branding.primaryColor, fontSize: 10, cellPadding: 4 },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 10;
  }

  if (config.includeEngagementSchedule) {
    if (y > 180) { doc.addPage(); y = 52; }
    y = drawSectionTitle(doc, y, 'Audit Schedule', branding);

    autoTable(doc, {
      startY: y,
      head: [['#', 'Audit Title', 'Department', 'Risk', 'Lead Auditor', 'Quarter', 'Days', 'Status']],
      body: engagements.map((e: any, i: number) => {
        const startDate = ef(e, 'planned_start_date', 'start_date', 'actual_start_date');
        const quarter = ef(e, 'quarter') || (startDate ? `Q${Math.ceil((new Date(startDate).getMonth() + 1) / 3)}` : '');
        const days = ef(e, 'estimated_days', 'budgeted_hours');
        return [
          e.sequence_no || i + 1,
          dv(e.engagement_name || e.title, 'Untitled'),
          dv(lookups.deptMap.get(e.department_id)),
          dv(e.engagement_risk_rating),
          dv(lookups.auditorMap.get(e.lead_auditor_id)),
          dv(quarter),
          dv(days),
          dv(e.status, 'Planned'),
        ];
      }),
      styles: { fontSize: 8.5, cellPadding: 3 },
      headStyles: { fillColor: branding.primaryColor, fontSize: 8.5, cellPadding: 3 },
      alternateRowStyles: { fillColor: branding.altRowColor },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 10;
  }

  if (config.includeResourceSummary) {
    if (y > 230) { doc.addPage(); y = 52; }
    const totalDays = engagements.reduce((s: number, e: any) => s + (Number(e.estimated_days) || 0), 0);
    y = addNarrativeBlock(doc, y, 'Resource Summary',
      `Available Days: ${dv(plan?.total_available_hours, 'Not yet calculated')}\nPlanned Days: ${totalDays}\nContingency Days: ${dv(plan?.contingency_hours, 'Not yet calculated')}`, 0, branding);
  }

  addFooter(doc, branding, version, artVersion);
  if (plan?.status !== 'Approved' && (planTemplateConfig?.showWatermark ?? config.showDraftWatermark)) {
    renderWatermarkAllPages(doc, planTemplateConfig?.watermarkText || 'DRAFT', 0.12);
  }
  return doc;
}

// ===== DETAILED PLAN PDF (REDESIGNED) =====
async function generateDetailedPlanPdf(
  plan: any, engagements: any[], lookups: ReturnType<typeof buildLookups>,
  gapFunctions: any[], config: ReportConfig,
  branding: ExportBranding,
  planTemplateConfig?: ReturnType<typeof mapPlanOutput>,
  foundation?: any,
  approvalSectionEnabled?: boolean
): Promise<jsPDF> {
  const doc = new jsPDF({
    orientation: planTemplateConfig?.pageLayout?.orientation || config.pageOrientation,
    format: toJsPdfFormat(planTemplateConfig?.pageLayout?.pageSize),
  });
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const version = plan?.current_version_number || 1;
  const artVersion = (plan?.artifact_version_number || 0) + 1;
  const logoData = await getLogoBase64(foundation);

  // ===== A. COVER PAGE — delegates to unified primitives =====
  if (config.includeCoverPage) {
    const coverBranding = { ...branding, logoBase64: logoData };
    const coverTitle = planTemplateConfig?.cover.titleText || 'Annual Internal\nAudit Plan';
    const fyDisplay = planTemplateConfig?.cover.fiscalYearDisplay || dv(plan?.fiscal_year, 'N/A');
    renderUnifiedCover(doc, coverBranding, {
      title: coverTitle,
      fullPageCover: true,
      fiscalYear: fyDisplay,
      version: `v${version}`,
      status: dv(plan?.status, 'Draft'),
      preparedBy: dv(plan?.created_by || plan?.plan_owner, 'Internal Audit Department'),
      approvedBy: plan?.approved_by || undefined,
      approvedDate: plan?.approved_date ? formatDateForDisplay(plan.approved_date) : undefined,
      showConfidentiality: true,
    });
  }

  // ===== B. EXECUTIVE SUMMARY =====
  if (config.includeExecutiveSummary) {
    doc.addPage();
    addHeader(doc, branding, 'Executive Summary', plan?.fiscal_year || '', version);
    let y = 50;
    y = drawSectionTitle(doc, y, 'Executive Summary', branding);

    y = addNarrativeBlock(doc, y, 'Annual Audit Strategy', plan?.executive_summary, pw, branding);
    y = addNarrativeBlock(doc, y, 'Planning Basis & Methodology', plan?.methodology || plan?.methodology_notes, pw, branding);
    y = addNarrativeBlock(doc, y, 'Major Assumptions', plan?.planning_assumptions, pw, branding);
    y = addNarrativeBlock(doc, y, 'Exclusions / Out-of-Scope', plan?.exclusions, pw, branding);
    y = addNarrativeBlock(doc, y, 'Resource Constraints', plan?.resource_constraints, pw, branding);
    y = addNarrativeBlock(doc, y, 'Objective', plan?.objective, pw, branding);
  }

  // ===== C. COVERAGE SUMMARY =====
  if (config.includeRiskCoverage) {
    doc.addPage();
    addHeader(doc, branding, 'Annual Coverage Summary', plan?.fiscal_year || '', version);
    let y = 50;
    y = drawSectionTitle(doc, y, 'Annual Coverage Summary', branding);

    const coveredDepts = new Set(engagements.map((e: any) => e.department_id).filter(Boolean));
    const coveredFuncs = new Set(engagements.map((e: any) => e.function_id).filter(Boolean));
    const riskDist = { Critical: 0, High: 0, Medium: 0, Low: 0 };
    engagements.forEach((e: any) => {
      const r = e.engagement_risk_rating as keyof typeof riskDist;
      if (r in riskDist) riskDist[r]++;
    });
    const totalDays = engagements.reduce((s: number, e: any) => s + (Number(e.estimated_days) || 0), 0);
    const totalHours = engagements.reduce((s: number, e: any) => s + (Number(e.estimated_hours) || 0), 0);
    const boardPri = engagements.filter((e: any) => e.board_priority_flag).length;

    // Summary metrics as a clean card-style table
    y = addKvTable(doc, y, [
      ['Total Audits', String(engagements.length)],
      ['Departments Covered', String(coveredDepts.size)],
      ['Functions Covered', String(coveredFuncs.size)],
      ['Total Planned Days', String(totalDays)],
      ['Total Planned Hours', String(totalHours)],
      ...(boardPri > 0 ? [['Board Priority Audits', String(boardPri)] as [string, string]] : []),
    ], branding);

    // Risk distribution table
    y += 4;
    doc.setFontSize(11);
    doc.setFont(undefined as any, 'bold');
    doc.setTextColor(branding.primaryColor[0], branding.primaryColor[1], branding.primaryColor[2]);
    doc.text('Risk Distribution', 14, y);
    y += 6;
    autoTable(doc, {
      startY: y,
      head: [['Risk Level', 'Count', '% of Plan']],
      body: Object.entries(riskDist).map(([k, v]) => [k, String(v), engagements.length ? `${Math.round((v / engagements.length) * 100)}%` : '0%']),
      styles: { fontSize: 10, cellPadding: 4 },
      headStyles: { fillColor: branding.primaryColor, fontSize: 10, cellPadding: 4 },
      margin: { left: 14, right: 14 },
    });
  }

  // ===== D. AUDIT SCHEDULE — REDESIGNED =====
  if (config.includeEngagementSchedule) {
    // Primary schedule summary table
    doc.addPage();
    addHeader(doc, branding, 'Audit Schedule', plan?.fiscal_year || '', version);
    let y = 50;
    y = drawSectionTitle(doc, y, 'Audit Schedule', branding);

    // Clean summary table with readable columns
    autoTable(doc, {
      startY: y,
      head: [['#', 'Code', 'Audit Title', 'Department', 'Function', 'Risk', 'Lead Auditor', 'Q', 'Start', 'End', 'Days', 'Status']],
      body: engagements.map((e: any, i: number) => {
        const startDate = ef(e, 'planned_start_date', 'start_date', 'actual_start_date');
        const endDate = ef(e, 'planned_end_date', 'end_date', 'actual_end_date');
        const quarter = ef(e, 'quarter') || (startDate ? `Q${Math.ceil((new Date(startDate).getMonth() + 1) / 3)}` : '');
        const days = ef(e, 'estimated_days', 'budgeted_hours');
        return [
          e.sequence_no || i + 1,
          dv(e.engagement_code),
          dv(e.engagement_name || e.title, 'Untitled'),
          dv(lookups.deptMap.get(e.department_id)),
          dv(lookups.funcMap.get(e.function_id)),
          dv(e.engagement_risk_rating),
          dv(lookups.auditorMap.get(e.lead_auditor_id)),
          dv(quarter),
          startDate ? formatDateForDisplay(startDate) : '',
          endDate ? formatDateForDisplay(endDate) : '',
          dv(days),
          dv(e.status, 'Planned'),
        ];
      }),
      styles: { fontSize: 7.5, cellPadding: 2.5, overflow: 'linebreak' },
      headStyles: { fillColor: branding.primaryColor, fontSize: 7.5, cellPadding: 2.5 },
      alternateRowStyles: { fillColor: branding.altRowColor },
      columnStyles: {
        0: { cellWidth: 8 },
        1: { cellWidth: 22 },
        2: { cellWidth: 'auto' },
        7: { cellWidth: 10 },
        10: { cellWidth: 12 },
      },
      margin: { left: 10, right: 10 },
    });
    y = (doc as any).lastAutoTable.finalY + 14;

    // Engagement detail cards — one per engagement on new pages
    doc.addPage();
    addHeader(doc, branding, 'Engagement Details', plan?.fiscal_year || '', version);
    y = 50;
    y = drawSectionTitle(doc, y, 'Engagement Details', branding);

    engagements.forEach((e: any, i: number) => {
      if (y > 220) {
        doc.addPage();
          addHeader(doc, branding, 'Engagement Details (cont.)', plan?.fiscal_year || '', version);
        y = 50;
      }

      // Engagement card header
      doc.setFillColor(245, 248, 250);
      doc.roundedRect(12, y - 4, pw - 24, 10, 2, 2, 'F');
      doc.setFontSize(11);
      doc.setFont(undefined as any, 'bold');
        doc.setTextColor(branding.primaryColor[0], branding.primaryColor[1], branding.primaryColor[2]);
      const titleText = `${e.sequence_no || i + 1}. ${dv(e.engagement_name, 'Untitled Engagement')}`;
      doc.text(titleText, 16, y + 3);

      // Risk + status badges on right
      const riskText = dv(e.engagement_risk_rating);
      const statusText = dv(e.status, 'Planned');
      if (riskText) {
        doc.setFontSize(7);
        doc.setFont(undefined as any, 'normal');
        doc.setTextColor(100, 100, 100);
        doc.text(`${riskText}  •  ${statusText}`, pw - 16, y + 3, { align: 'right' });
      }
      y += 12;

      // Detail pairs
      const detailPairs: [string, string][] = [];
      const dept = dv(lookups.deptMap.get(e.department_id));
      const func = dv(lookups.funcMap.get(e.function_id));
      if (dept) detailPairs.push(['Department', dept]);
      if (func) detailPairs.push(['Business Function', func]);
      const lead = dv(lookups.auditorMap.get(e.lead_auditor_id));
      if (lead) detailPairs.push(['Lead Auditor', lead]);
      const support = getSupportNames(e, lookups.auditorMap);
      if (support) detailPairs.push(['Support Team', support]);
      const startDate = ef(e, 'planned_start_date', 'start_date', 'actual_start_date');
      const endDate = ef(e, 'planned_end_date', 'end_date', 'actual_end_date');
      const quarter = ef(e, 'quarter') || (startDate ? `Q${Math.ceil((new Date(startDate).getMonth() + 1) / 3)}` : null);
      const days = ef(e, 'estimated_days', 'budgeted_hours');
      if (quarter) detailPairs.push(['Quarter', String(quarter)]);
      if (startDate) detailPairs.push(['Start Date', formatDateForDisplay(startDate)]);
      if (endDate) detailPairs.push(['End Date', formatDateForDisplay(endDate)]);
      if (days) detailPairs.push(['Estimated Days', String(days)]);

      // Render detail pairs inline
      doc.setFontSize(8.5);
      detailPairs.forEach(([label, val]) => {
        if (y > 270) {
          doc.addPage();
          addHeader(doc, branding, 'Engagement Details (cont.)', plan?.fiscal_year || '', version);
          y = 50;
        }
        doc.setFont(undefined as any, 'bold');
        doc.setTextColor(80, 80, 80);
        doc.text(`${label}:`, 18, y);
        doc.setFont(undefined as any, 'normal');
        doc.setTextColor(40, 40, 40);
        doc.text(val, 70, y);
        y += 5;
      });

      // Narrative fields
      const narratives: [string, string][] = [];
      const obj = dv(e.objectives);
      if (obj) narratives.push(['Objective', obj]);
      const scope = dv(e.scope);
      if (scope) narratives.push(['Scope', scope]);
      const rationale = getRationaleDisplay(e);
      if (rationale) narratives.push(['Inclusion Rationale', rationale]);
      const deliverables = getDeliverablesDisplay(e);
      if (deliverables) narratives.push(['Expected Deliverables', deliverables]);

      narratives.forEach(([label, content]) => {
        if (y > 255) {
          doc.addPage();
          addHeader(doc, branding, 'Engagement Details (cont.)', plan?.fiscal_year || '', version);
          y = 50;
        }
        doc.setFont(undefined as any, 'bold');
        doc.setTextColor(80, 80, 80);
        doc.setFontSize(8.5);
        doc.text(`${label}:`, 18, y);
        y += 4.5;
        doc.setFont(undefined as any, 'normal');
        doc.setTextColor(40, 40, 40);
        doc.setFontSize(8);
        const lines = doc.splitTextToSize(content, pw - 40);
        doc.text(lines, 20, y);
        y += lines.length * 4 + 3;
      });

      // Separator line between engagements
      y += 3;
      doc.setDrawColor(210, 210, 210);
      doc.setLineWidth(0.3);
      doc.line(14, y, pw - 14, y);
      y += 8;
    });
  }

  // ===== E. RESOURCE PLAN =====
  if (config.includeResourceSummary) {
    doc.addPage();
    addHeader(doc, branding, 'Resource Plan', plan?.fiscal_year || '', version);
    let y = 50;
    y = drawSectionTitle(doc, y, 'Resource Plan', branding);

    const totalDays = engagements.reduce((s: number, e: any) => s + (Number(e.estimated_days) || 0), 0);
    const availDays = plan?.total_available_hours;
    const contDays = plan?.contingency_hours;

    y = addKvTable(doc, y, [
      ['Total Available Days', availDays ? String(availDays) : 'Not yet calculated'],
      ['Total Planned Days', String(totalDays)],
      ['Contingency Days', contDays ? String(contDays) : 'Not yet calculated'],
      ['Utilization', availDays && Number(availDays) > 0 ? `${Math.round((totalDays / Number(availDays)) * 100)}%` : 'Not yet calculated'],
    ], branding);

    if (config.includeAuditorBreakdown) {
      const auditorDays = new Map<string, number>();
      engagements.forEach((e: any) => {
        if (e.lead_auditor_id) {
          const name = lookups.auditorMap.get(e.lead_auditor_id) || 'Unknown';
          auditorDays.set(name, (auditorDays.get(name) || 0) + (Number(e.estimated_days) || 0));
        }
      });
      if (auditorDays.size > 0) {
        doc.setFontSize(11); doc.setFont(undefined as any, 'bold'); doc.setTextColor(branding.primaryColor[0], branding.primaryColor[1], branding.primaryColor[2]);
        doc.text('Days by Lead Auditor', 14, y); y += 6;
        autoTable(doc, {
          startY: y,
          head: [['Auditor', 'Planned Days']],
          body: Array.from(auditorDays.entries()).map(([name, days]) => [name, String(days)]),
          styles: { fontSize: 10, cellPadding: 4 },
          headStyles: { fillColor: branding.primaryColor, fontSize: 10, cellPadding: 4 },
          margin: { left: 14, right: 14 },
        });
        y = (doc as any).lastAutoTable.finalY + 10;
      }
    }

    if (config.includeQuarterBreakdown) {
      const quarterDays = ['Q1', 'Q2', 'Q3', 'Q4'].map(q => [
        q,
        String(engagements.filter((e: any) => e.quarter === q).length),
        String(engagements.filter((e: any) => e.quarter === q).reduce((s: number, e: any) => s + (Number(e.estimated_days) || 0), 0)),
      ]);
      doc.setFontSize(11); doc.setFont(undefined as any, 'bold'); doc.setTextColor(branding.primaryColor[0], branding.primaryColor[1], branding.primaryColor[2]);
      doc.text('Days by Quarter', 14, y); y += 6;
      autoTable(doc, {
        startY: y,
        head: [['Quarter', 'Engagements', 'Days']],
        body: quarterDays,
        styles: { fontSize: 10, cellPadding: 4 },
        headStyles: { fillColor: branding.primaryColor, fontSize: 10, cellPadding: 4 },
        margin: { left: 14, right: 14 },
      });
      y = (doc as any).lastAutoTable.finalY + 10;
    }

    y = addNarrativeBlock(doc, y, 'Outsourced Support', plan?.outsourced_support_notes, pw, branding);
    y = addNarrativeBlock(doc, y, 'Skills Constraints', plan?.skills_constraints, pw, branding);
  }

  // ===== F. GAP ANALYSIS =====
  if (config.includeGapAnalysis && gapFunctions.length > 0) {
    doc.addPage();
    addHeader(doc, branding, 'Risk Coverage / Gap Analysis', plan?.fiscal_year || '', version);
    let y = 50;

    // Section title — no emoji, clean text only (jsPDF Helvetica doesn't support Unicode symbols)
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(branding.gapHeaderColor[0], branding.gapHeaderColor[1], branding.gapHeaderColor[2]);
    doc.text('Risk Coverage & Gap Analysis', 14, y);
    y += 4;
    doc.setDrawColor(branding.gapHeaderColor[0], branding.gapHeaderColor[1], branding.gapHeaderColor[2]);
    doc.setLineWidth(0.8);
    doc.line(14, y, pw - 14, y);
    y += 10;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);
    const introText = 'The following high-risk business functions are not covered by the current annual audit plan. These should be considered for inclusion in subsequent planning cycles or addressed through supplementary engagements.';
    const introLines = doc.splitTextToSize(introText, pw - 32);
    doc.text(introLines, 16, y);
    y += introLines.length * 5 + 8;

    // Gap analysis table with RED header
    autoTable(doc, {
      startY: y,
      head: [['Business Function', 'Department', 'Risk Level', 'Coverage Status']],
      body: gapFunctions.map((g: any) => [g.functionName, g.departmentName, g.riskLevel, 'Not Covered']),
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: branding.gapHeaderColor, textColor: [255, 255, 255], fontSize: 9, cellPadding: 4 },
      bodyStyles: { textColor: [40, 40, 40] },
      alternateRowStyles: { fillColor: [255, 245, 245] },
      columnStyles: {
        3: { textColor: branding.gapHeaderColor, fontStyle: 'bold' },
      },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 12;

    // Recommendation box
    if (y + 30 > ph - 30) {
      doc.addPage();
      addHeader(doc, branding, 'Risk Coverage / Gap Analysis (cont.)', plan?.fiscal_year || '', version);
      y = 50;
    }
    doc.setFillColor(255, 243, 243);
    doc.roundedRect(14, y, pw - 28, 22, 2, 2, 'F');
    doc.setDrawColor(branding.gapHeaderColor[0], branding.gapHeaderColor[1], branding.gapHeaderColor[2]);
    doc.setLineWidth(0.5);
    doc.roundedRect(14, y, pw - 28, 22, 2, 2, 'S');
    doc.setFontSize(9);
    doc.setFont(undefined as any, 'bold');
    doc.setTextColor(branding.gapHeaderColor[0], branding.gapHeaderColor[1], branding.gapHeaderColor[2]);
    doc.text('⚠  Recommendation', 20, y + 8);
    doc.setFont(undefined as any, 'normal');
    doc.setTextColor(60, 60, 60);
    doc.setFontSize(8.5);
    doc.text('These high-risk functions should be prioritized in the next planning cycle or addressed via supplementary audit engagements.', 20, y + 16);
  }

  // ===== G. GOVERNANCE =====
  if (config.includeGovernance) {
    doc.addPage();
    addHeader(doc, branding, 'Approval & Governance', plan?.fiscal_year || '', version);
    let y = 50;
    y = drawSectionTitle(doc, y, 'Approval & Governance', branding);

    const isApproved = plan?.status === 'Approved';
    const isPending = !isApproved;

    if (isPending) {
      // Clean pending state
      doc.setFillColor(250, 248, 240);
      doc.roundedRect(14, y, pw - 28, 20, 2, 2, 'F');
      doc.setFontSize(10);
      doc.setFont(undefined as any, 'bold');
      doc.setTextColor(150, 130, 50);
      doc.text('Status: Pending Approval', 20, y + 12);
      y += 30;
    }

    const govRows: [string, string][] = [];
    if (planTemplateConfig?.governance.showBoardLine !== false) {
      govRows.push(['Board / Audit Committee', dv(plan?.board_committee_name, 'Not yet specified')]);
    }
    govRows.push(
      ['Minutes Reference', dv(plan?.minutes_reference)],
      ['Approval Note', dv(plan?.approval_note || plan?.approval_comments)],
      ['Submitted By', dv(plan?.submitted_by, isPending ? 'Pending' : '')],
      ['Submitted Date', plan?.submitted_date ? formatDateForDisplay(plan.submitted_date) : (isPending ? 'Pending' : '')],
      ['Approved By', dv(plan?.approved_by, isPending ? 'Pending' : '')],
      ['Approved Date', plan?.approved_date ? formatDateForDisplay(plan.approved_date) : (isPending ? 'Pending' : '')],
    );
    y = addKvTable(doc, y, govRows, branding);

    // Sign-off placeholders — only if approval section is enabled in template
    const shouldRenderApprovalSection = approvalSectionEnabled === true;
    if (shouldRenderApprovalSection) {
      y += 10;
      doc.setFontSize(9);
      doc.setTextColor(80, 80, 80);
      doc.setFont('helvetica', 'normal');

      const signoffY = y + 20;
      const prepLabel = planTemplateConfig?.governance.preparedByLabel || 'Prepared By';
      const apprLabel = planTemplateConfig?.governance.approvedByLabel || 'Approved By';
      // Prepared by
      doc.text(`${prepLabel}:`, 20, signoffY);
      doc.line(60, signoffY + 1, 120, signoffY + 1);
      doc.text('Date:', 130, signoffY);
      doc.line(145, signoffY + 1, pw - 20, signoffY + 1);
      // Approved by
      if (planTemplateConfig?.governance.showApprovedByBlock !== false) {
        doc.text(`${apprLabel}:`, 20, signoffY + 20);
        doc.line(60, signoffY + 21, 120, signoffY + 21);
        doc.text('Date:', 130, signoffY + 20);
        doc.line(145, signoffY + 21, pw - 20, signoffY + 21);
      }
    }
  }

  addFooter(doc, branding, version, artVersion);
  if (plan?.status !== 'Approved' && (planTemplateConfig?.showWatermark ?? config.showDraftWatermark)) {
    renderWatermarkAllPages(doc, planTemplateConfig?.watermarkText || 'DRAFT', 0.12);
  }
  return doc;
}

// ===== COMPONENT =====
export function BoardPackTab({ planId, plan, engagements }: BoardPackTabProps) {
  const { toast } = useToast();
  const { userCode } = useUserCode();
  const { data: artifacts = [], isLoading } = useIAPlanArtifacts(planId);
  const { create, update } = useIAPlanArtifactMutations();
  const { data: departments = [] } = useIADepartments();
  const { data: functions = [] } = useIADepartmentFunctions('all');
  const { data: auditors = [] } = useIAActiveAuditors();
  const { data: assessments = [] } = useIARiskAssessments();
  const { data: planTemplateConfig } = useAuditPlanTemplate();
  const { sectionRefs: dbPlanSections } = useDocumentTemplateSections('audit_plan');
  const { data: foundation } = useDocumentFoundation();
  const [generating, setGenerating] = useState<string | null>(null);
  const [reportConfig, setReportConfig] = useState<ReportConfig>(DEFAULT_REPORT_CONFIG);
  const [customizeDialogOpen, setCustomizeDialogOpen] = useState(false);
  const [pendingArtifactType, setPendingArtifactType] = useState<string>('');
  const [planOverrides, setPlanOverrides] = useState<PlanTemplateOverride>(createEmptyPlanOverride());
  const [showPlanOverrides, setShowPlanOverrides] = useState(false);
  const [reportConfigInitialized, setReportConfigInitialized] = useState(false);

  // Apply overrides before resolving
  const effectivePlanConfig = useMemo(
    () => planTemplateConfig
      ? applyPlanOverrides(planTemplateConfig, planOverrides)
      : DEFAULT_AUDIT_PLAN_CONFIG,
    [planTemplateConfig, planOverrides]
  );

  // Resolve plan template for PDF generation
  const resolvedPlanTemplate = useMemo(
    () => mapPlanOutput(resolvePlanTemplate(effectivePlanConfig, undefined, foundation), plan),
    [effectivePlanConfig, foundation, plan]
  );

  const approvalSectionEnabled = useMemo(() => {
    const approvalSection = dbPlanSections.find((section) => section.id === 'approval' || section.id === 'approval_signoff');
    return approvalSection ? approvalSection.enabled : undefined;
  }, [dbPlanSections]);

  const defaultReportConfig = useMemo(
    () => buildDefaultReportConfig(resolvedPlanTemplate, foundation),
    [resolvedPlanTemplate, foundation]
  );

  useEffect(() => {
    if (!reportConfigInitialized && foundation) {
      setReportConfig(defaultReportConfig);
      setReportConfigInitialized(true);
    }
  }, [defaultReportConfig, foundation, reportConfigInitialized]);

  const isApproved = plan?.status === 'Approved';
  const isDraft = ['Draft', 'Submitted', 'Under Review'].includes(plan?.status);
  const hasFinal = artifacts.some((a: any) => a.is_final);
  const lookups = buildLookups(departments, functions, auditors);

  // Gap analysis: high-risk functions not covered
  const coveredFuncIds = new Set(engagements.map((e: any) => e.function_id).filter(Boolean));
  const gapFunctions = (functions || [])
    .filter((fn: any) => {
      if (coveredFuncIds.has(fn.id)) return false;
      const riskA = (assessments || []).find((a: any) => a.function_id === fn.id);
      const fnRisk = riskA?.risk_rating || fn.risk_rating;
      return ['High', 'Critical'].includes(fnRisk);
    })
    .map((fn: any) => {
      const dept = departments.find((d: any) => d.id === fn.department_id);
      const riskA = (assessments || []).find((a: any) => a.function_id === fn.id);
      return {
        functionName: fn.function_name,
        departmentName: formatDepartmentLabel(dept) || 'Unknown',
        riskLevel: riskA?.risk_rating || fn.risk_rating || 'High',
      };
    });

  const openCustomize = (artifactType: string) => {
    setPendingArtifactType(artifactType);
    setCustomizeDialogOpen(true);
  };

  const handleGenerate = async (artifactType: string, config?: ReportConfig) => {
    const cfg = config || reportConfig;
    setGenerating(artifactType);
    try {
      const existing = artifacts.filter((a: any) => a.artifact_type === artifactType && a.status !== 'Superseded');
      for (const art of existing) {
        await update.mutateAsync({ id: (art as any).id, status: 'Superseded', is_final: false });
      }

      const version = (plan?.current_version_number || 1);
      const artVersion = (artifacts.filter((a: any) => a.artifact_type === artifactType).length || 0) + 1;
      const artifactStatus = isApproved ? 'Generated' : 'Draft';
      const fileName = artifactType === 'board_summary_pdf'
        ? `Board_Summary_FY${plan?.fiscal_year}_v${version}.${artVersion}.pdf`
        : artifactType === 'detailed_plan_pdf'
          ? `Detailed_Plan_FY${plan?.fiscal_year}_v${version}.${artVersion}.pdf`
          : `Engagement_Annex_FY${plan?.fiscal_year}_v${version}.${artVersion}.xlsx`;
      const filePath = `plans/${planId}/${fileName}`;

      let generatedBlob: Blob | null = null;
      const exportBranding = buildBranding(cfg, resolvedPlanTemplate, foundation);

      if (artifactType === 'board_summary_pdf' || artifactType === 'detailed_plan_pdf') {
        const doc = artifactType === 'board_summary_pdf'
          ? generateBoardSummaryPdf(plan, engagements, lookups, cfg, exportBranding, resolvedPlanTemplate)
          : await generateDetailedPlanPdf(
              plan,
              engagements,
              lookups,
              gapFunctions,
              cfg,
              exportBranding,
              resolvedPlanTemplate,
              foundation,
              approvalSectionEnabled
            );

        generatedBlob = doc.output('blob');
        const { error: uploadError } = await supabase.storage.from('ia-artifacts').upload(filePath, generatedBlob, { contentType: 'application/pdf', upsert: true });
        if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
      } else if (artifactType === 'excel_annex') {
        const ExcelJS = (await import('exceljs')).default;
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Audit Schedule');
        sheet.columns = [
          { header: '#', key: 'seq', width: 5 },
          { header: 'Code', key: 'code', width: 16 },
          { header: 'Audit Title', key: 'title', width: 35 },
          { header: 'Department', key: 'dept', width: 25 },
          { header: 'Function', key: 'func', width: 25 },
          { header: 'Risk', key: 'risk', width: 10 },
          { header: 'Lead Auditor', key: 'lead', width: 20 },
          { header: 'Support Team', key: 'support', width: 30 },
          { header: 'Quarter', key: 'quarter', width: 8 },
          { header: 'Start', key: 'start', width: 14 },
          { header: 'End', key: 'end', width: 14 },
          { header: 'Days', key: 'days', width: 8 },
          { header: 'Hours', key: 'hours', width: 8 },
          { header: 'Objective', key: 'objective', width: 40 },
          { header: 'Scope', key: 'scope', width: 40 },
          { header: 'Inclusion Rationale', key: 'rationale', width: 30 },
          { header: 'Expected Deliverables', key: 'deliverables', width: 30 },
          { header: 'Priority', key: 'priority', width: 10 },
          { header: 'Status', key: 'status', width: 12 },
        ];
        engagements.forEach((e: any, i: number) => {
          sheet.addRow({
            seq: e.sequence_no || i + 1,
            code: dv(e.engagement_code),
            title: dv(e.engagement_name, 'Untitled'),
            dept: dv(lookups.deptMap.get(e.department_id)),
            func: dv(lookups.funcMap.get(e.function_id)),
            risk: dv(e.engagement_risk_rating),
            lead: dv(lookups.auditorMap.get(e.lead_auditor_id)),
            support: getSupportNames(e, lookups.auditorMap),
            quarter: dv(e.quarter),
            start: e.planned_start_date ? formatDateForDisplay(e.planned_start_date) : '',
            end: e.planned_end_date ? formatDateForDisplay(e.planned_end_date) : '',
            days: dv(e.estimated_days),
            hours: dv(e.estimated_hours),
            objective: dv(e.objectives),
            scope: dv(e.scope),
            rationale: getRationaleDisplay(e),
            deliverables: getDeliverablesDisplay(e),
            priority: e.board_priority_flag ? 'High' : 'Normal',
            status: dv(e.status, 'Planned'),
          });
        });
        // Style header row with SSB green
        const headerRow = sheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E5F3A' } };
        const buffer = await workbook.xlsx.writeBuffer();
        generatedBlob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const { error: uploadError } = await supabase.storage.from('ia-artifacts').upload(filePath, generatedBlob, {
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', upsert: true,
        });
        if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
      }

      // Auto-download the generated file immediately
      if (generatedBlob) {
        triggerBlobDownload(generatedBlob, fileName);
      }

      await create.mutateAsync({
        plan_id: planId,
        version_number: version,
        artifact_type: artifactType,
        status: artifactStatus,
        file_name: fileName,
        file_path: filePath,
        mime_type: artifactType.includes('pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        generated_at: new Date().toISOString(),
        generated_by: userCode || 'system',
        is_final: false,
      });

      await supabase.from('ia_annual_plans' as any).update({
        artifact_version_number: artVersion,
        updated_by: userCode || 'system',
      } as any).eq('id', planId);

      toast({ title: 'Artifact Generated', description: `${fileName} has been generated successfully.` });
    } catch (err: any) {
      toast({ title: 'Generation Failed', description: err.message, variant: 'destructive' });
    } finally {
      setGenerating(null);
    }
  };

  const handleMarkFinal = async (artifactId: string) => {
    if (!isApproved) {
      toast({ title: 'Cannot Finalize', description: 'Only approved plans can have final artifacts.', variant: 'destructive' });
      return;
    }
    try {
      await update.mutateAsync({ id: artifactId, status: 'Final', is_final: true });
      toast({ title: 'Artifact Finalized' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const triggerBlobDownload = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  };

  const handleDownload = async (artifact: any) => {
    try {
      // ia-artifacts is a PRIVATE bucket (Wave 1). Always use the authenticated
      // SDK download path — never getPublicUrl().
      const { data, error } = await supabase.storage.from('ia-artifacts').download(artifact.file_path);
      if (error) throw error;
      triggerBlobDownload(data, artifact.file_name);
    } catch (err: any) {
      console.error('[Download] Error:', err);
      toast({ title: 'Download Failed', description: err.message, variant: 'destructive' });
    }
  };

  const artifactColumns: DataTableColumn<any>[] = [
    { key: 'file_name', header: 'File', render: (r) => <span className="font-medium text-sm">{r.file_name || 'Untitled'}</span> },
    { key: 'artifact_type', header: 'Type', render: (r) => <StatusBadge status={r.artifact_type?.replace(/_/g, ' ') || 'Unknown'} /> },
    { key: 'version_number', header: 'Plan Ver.', render: (r) => `v${r.version_number}` },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'generated_at', header: 'Generated', render: (r) => r.generated_at ? formatDateForDisplay(r.generated_at) : '' },
    { key: 'generated_by', header: 'By', render: (r) => r.generated_by || '' },
  ];

  return (
    <div className="space-y-4">
      {isDraft && (
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="flex items-center gap-3 pt-6">
            <Info className="h-5 w-5 text-warning shrink-0" />
            <div className="text-sm">
              <p className="font-medium">Pre-Approval Board Pack</p>
              <p className="text-muted-foreground">Artifacts generated now will be marked as <strong>Draft</strong> with a watermark.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {isApproved && !hasFinal && (
        <Card className="border-success/30 bg-success/5">
          <CardContent className="flex items-center gap-3 pt-6">
            <Info className="h-5 w-5 text-success shrink-0" />
            <div className="text-sm">
              <p className="font-medium">Plan Approved — Ready to Finalize</p>
              <p className="text-muted-foreground">Generate final artifacts and mark them as <strong>Final</strong> for official distribution.</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            Generate Board Pack Artifacts
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="flex gap-1">
              <Button variant="outline" className="justify-start gap-2 flex-1" onClick={() => handleGenerate('board_summary_pdf')} disabled={!!generating}>
                {generating === 'board_summary_pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4 text-primary" />}
                Board Summary PDF
              </Button>
              <Button variant="ghost" size="icon" className="shrink-0" onClick={() => openCustomize('board_summary_pdf')} disabled={!!generating}>
                <Settings2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex gap-1">
              <Button variant="outline" className="justify-start gap-2 flex-1" onClick={() => handleGenerate('detailed_plan_pdf')} disabled={!!generating}>
                {generating === 'detailed_plan_pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4 text-primary" />}
                Detailed Plan PDF
              </Button>
              <Button variant="ghost" size="icon" className="shrink-0" onClick={() => openCustomize('detailed_plan_pdf')} disabled={!!generating}>
                <Settings2 className="h-4 w-4" />
              </Button>
            </div>
            <Button variant="outline" className="justify-start gap-2" onClick={() => handleGenerate('excel_annex')} disabled={!!generating}>
              {generating === 'excel_annex' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4 text-primary" />}
              Excel Annex
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Click the <Settings2 className="inline h-3 w-3" /> icon to customize output before generating. By default, PDFs inherit the current Document & Output Settings.
          </p>
        </CardContent>
      </Card>

      {/* Plan Template Overrides & Live Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <Button
            variant="outline"
            size="sm"
            className="mb-3 gap-2"
            onClick={() => setShowPlanOverrides(!showPlanOverrides)}
          >
            <Settings2 className="h-4 w-4" />
            {showPlanOverrides ? 'Hide' : 'Show'} Template Overrides
            {hasPlanOverrides(planOverrides) && (
              <span className="text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">Active</span>
            )}
          </Button>
          {showPlanOverrides && (
            <PlanOverridePanel
              baseConfig={planTemplateConfig || DEFAULT_AUDIT_PLAN_CONFIG}
              overrides={planOverrides}
              onChange={setPlanOverrides}
              onReset={() => setPlanOverrides(createEmptyPlanOverride())}
            />
          )}
        </div>
        <LiveDocumentPreview
          type="plan"
          baseConfig={planTemplateConfig || DEFAULT_AUDIT_PLAN_CONFIG}
          overrides={planOverrides}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Artifact History</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={artifactColumns}
            data={artifacts}
            emptyMessage="No artifacts generated yet."
            renderActions={(row) => (
              <div className="flex gap-1">
                {row.file_path && row.status !== 'Superseded' && (
                  <Button variant="ghost" size="sm" onClick={() => handleDownload(row)}>
                    <Download className="h-4 w-4 mr-1" />Download
                  </Button>
                )}
                {row.status === 'Generated' && isApproved && (
                  <Button variant="ghost" size="sm" onClick={() => handleMarkFinal(row.id)}>
                    <Lock className="h-4 w-4 mr-1" />Final
                  </Button>
                )}
                {row.status === 'Draft' && isApproved && (
                  <Button variant="ghost" size="sm" onClick={() => handleMarkFinal(row.id)}>
                    <Lock className="h-4 w-4 mr-1" />Finalize
                  </Button>
                )}
              </div>
            )}
          />
        </CardContent>
      </Card>

      <ReportCustomizationDialog
        open={customizeDialogOpen}
        onOpenChange={setCustomizeDialogOpen}
        config={reportConfig}
        onConfigChange={setReportConfig}
        onGenerate={(cfg) => handleGenerate(pendingArtifactType, cfg)}
        reportType={pendingArtifactType}
        generating={!!generating}
      />
    </div>
  );
}
