import {
  Shield,
  LayoutDashboard,
  Inbox,
  AlertTriangle,
  FolderOpen,
  Briefcase,
  Bell,
  HandshakeIcon,
  ClipboardCheck,
  Scale,
  TrendingUp,
  BarChart3,
  Settings,
  FileText,
  Mail,
  Cog,
  Hash,
  ListChecks,
  Eye,
  UserCheck,
  Users,
  Map,
  Network,
  ArrowRightLeft,
  Route,
  Activity,
  Hammer,
  HelpCircle,
  Calculator,
  ListOrdered,
  Globe,
  Layers,
  Search,
  Target,
  Zap,
  Timer,
  Calendar,
  MapPin,
  Building2,
  ShieldAlert,
  DollarSign,
  Gavel,
  ShieldQuestion,
} from "lucide-react";
import { applyComplianceRemoteRouting } from "@/lib/embed/satelliteRouting";
import { isComplianceFeatureEnabled } from "@/lib/compliance/featureToggles";

/**
 * Compliance & Enforcement — Top-Level Menu
 *
 * Aligned with the finalized planning document. The structure preserves
 * every existing working route and adds placeholder routes only where a
 * target screen is not yet implemented (those resolve to PlaceholderPage).
 *
 * Permission model: existing legacy permission strings consumed by the
 * static sidebar path (see `useSupabaseAuth().hasPermission`). The
 * canonical model (`app_modules` + `module_actions`) continues to gate
 * the DB-driven sidebar — this file plugs into both surfaces.
 *
 * Feature toggles: hide-only safety gate via `isComplianceFeatureEnabled`
 * (see src/lib/compliance/featureToggles.ts). TODO: replace with the real
 * `ce_feature_toggles` admin screen when implemented.
 */

type SubItem = {
  title: string;
  url?: string;
  icon: any;
  requiresPermission?: string;
  description?: string;
  subItems?: SubItem[];
};

function filterEnabled<T extends { __feature?: string }>(items: T[]): T[] {
  return items.filter((i) => {
    if (!i.__feature) return true;
    return isComplianceFeatureEnabled(i.__feature as any);
  });
}

const dashboard: SubItem = {
  title: "Dashboard",
  icon: LayoutDashboard,
  requiresPermission: "manage_compliance",
  description: "Overview, KPIs, and role-specific dashboards",
  subItems: [
    { title: "Command Center", url: "/compliance/workbench/overview", icon: LayoutDashboard, requiresPermission: "manage_compliance" },
    { title: "Overview", url: "/compliance/workbench/manager", icon: LayoutDashboard, requiresPermission: "manage_compliance" },
    { title: "My Work", url: "/compliance/my-work-queue", icon: Inbox, requiresPermission: "manage_compliance" },
    { title: "Inspector Dashboard", url: "/compliance/workbench/inspector", icon: UserCheck, requiresPermission: "manage_compliance" },
    { title: "Legal Dashboard", url: "/compliance/workbench/legal", icon: Gavel, requiresPermission: "manage_compliance" },
    { title: "Analytics", url: "/compliance/workbench/analytics", icon: TrendingUp, requiresPermission: "manage_compliance" },
    { title: "Monitoring", url: "/compliance/workbench/monitoring", icon: Activity, requiresPermission: "manage_compliance" },
  ],
};

const myWorkQueue: SubItem = {
  title: "My Work Queue",
  url: "/compliance/my-work-queue",
  icon: Inbox,
  requiresPermission: "manage_compliance",
  description: "Items assigned to me across violations, cases, notices, and inspections",
};

const violations: SubItem = {
  title: "Violations",
  icon: AlertTriangle,
  requiresPermission: "manage_compliance",
  description: "Manage compliance violations",
  subItems: filterEnabled<SubItem & { __feature?: string }>([
    { title: "All Violations", url: "/compliance/violations", icon: FolderOpen, requiresPermission: "manage_compliance" },
    { title: "Verification Queue", url: "/compliance/violations/verification-queue", icon: ClipboardCheck, requiresPermission: "manage_compliance", __feature: "violations.verificationQueue" },
    { title: "Review Flags", url: "/compliance/violations/review-flags", icon: ShieldQuestion, requiresPermission: "manage_compliance" },
    { title: "Manual Violation Entry", url: "/compliance/violations/manual-entry", icon: AlertTriangle, requiresPermission: "manage_compliance" },
    { title: "Rule Detected Violations", url: "/compliance/violations/rule-detected", icon: Zap, requiresPermission: "manage_compliance", __feature: "violations.ruleDetected" },
    { title: "Duplicate Review", url: "/compliance/violations/duplicate-review", icon: Eye, requiresPermission: "manage_compliance", __feature: "violations.duplicateReview" },
    { title: "Violation History", url: "/compliance/violations/history", icon: Timer, requiresPermission: "manage_compliance", __feature: "violations.history" },
  ]),
};

const cases: SubItem = {
  title: "Compliance Cases",
  icon: Briefcase,
  requiresPermission: "manage_compliance",
  description: "Case management with full lifecycle",
  subItems: filterEnabled<SubItem & { __feature?: string }>([
    { title: "All Cases", url: "/compliance/cases", icon: Briefcase, requiresPermission: "manage_compliance" },
    { title: "Case Intake", url: "/compliance/cases/intake", icon: Inbox, requiresPermission: "manage_compliance", __feature: "cases.intake" },
    { title: "Assigned Cases", url: "/compliance/cases/assigned", icon: UserCheck, requiresPermission: "manage_compliance", __feature: "cases.assigned" },
    { title: "Case Review", url: "/compliance/cases/queue", icon: ListChecks, requiresPermission: "manage_compliance", __feature: "cases.review" },
    { title: "Case Merge Review", url: "/compliance/cases/merge-review", icon: ArrowRightLeft, requiresPermission: "manage_compliance", __feature: "cases.mergeReview" },
    { title: "Reopen Requests", url: "/compliance/cases/reopen-requests", icon: ArrowRightLeft, requiresPermission: "manage_compliance", __feature: "cases.reopenRequests" },
    { title: "Case Closure", url: "/compliance/cases/closure", icon: ClipboardCheck, requiresPermission: "manage_compliance", __feature: "cases.closure" },
  ]),
};

const notices: SubItem = {
  title: "Notices And Communications",
  icon: Bell,
  requiresPermission: "manage_compliance",
  description: "Notices, delivery tracking, and employer correspondence",
  subItems: filterEnabled<SubItem & { __feature?: string }>([
    { title: "Notice Register", url: "/compliance/notices/register", icon: Bell, requiresPermission: "manage_compliance" },
    { title: "Generate Notice", url: "/compliance/notices/generate", icon: Mail, requiresPermission: "manage_compliance", __feature: "notices.generate" },
    { title: "Pending Approval", url: "/compliance/notices/pending-approval", icon: ClipboardCheck, requiresPermission: "manage_compliance", __feature: "notices.pendingApproval" },
    { title: "Delivery Tracking", url: "/compliance/notices/delivery-tracking", icon: Activity, requiresPermission: "manage_compliance", __feature: "notices.deliveryTracking" },
    { title: "Employer Responses", url: "/compliance/notices/employer-responses", icon: Globe, requiresPermission: "manage_compliance", __feature: "notices.employerResponses" },
    { title: "Communication History", url: "/compliance/notices/communication-history", icon: Timer, requiresPermission: "manage_compliance", __feature: "notices.communicationHistory" },
  ]),
};

const arrangements: SubItem = {
  title: "Payment Arrangements",
  icon: HandshakeIcon,
  requiresPermission: "manage_compliance",
  description: "Payment plans, installments, breaches, and allocation",
  subItems: filterEnabled<SubItem & { __feature?: string }>([
    { title: "All Arrangements", url: "/compliance/enforcement/arrangements", icon: HandshakeIcon, requiresPermission: "manage_compliance" },
    { title: "New Arrangement", url: "/compliance/arrangements/new", icon: HandshakeIcon, requiresPermission: "manage_compliance", __feature: "arrangements.new" },
    { title: "Pending Approval", url: "/compliance/arrangements/pending-approval", icon: ClipboardCheck, requiresPermission: "manage_compliance", __feature: "arrangements.pendingApproval" },
    { title: "Active Arrangements", url: "/compliance/arrangements/active", icon: Activity, requiresPermission: "manage_compliance", __feature: "arrangements.active" },
    { title: "Installments Due", url: "/compliance/arrangements/installments-due", icon: Calendar, requiresPermission: "manage_compliance", __feature: "arrangements.installmentsDue" },
    { title: "Breaches", url: "/compliance/arrangements/breaches", icon: ShieldAlert, requiresPermission: "manage_compliance" },
    { title: "Payment Allocation", url: "/compliance/arrangements/payment-allocation", icon: DollarSign, requiresPermission: "manage_compliance", __feature: "arrangements.paymentAllocation" },
  ]),
};

const inspections: SubItem = {
  title: "Inspections",
  icon: MapPin,
  requiresPermission: "manage_compliance",
  description: "Plans, assignments, field visits, and findings",
  subItems: filterEnabled<SubItem & { __feature?: string }>([
    { title: "Weekly Plan Builder", url: "/compliance/field/plan-builder", icon: Calendar, requiresPermission: "create_weekly_plan" },
    { title: "My Inspection Plans", url: "/compliance/field/my-plans", icon: Calendar, requiresPermission: "manage_compliance" },
    { title: "Plan Approvals", url: "/compliance/field/pending-review", icon: ClipboardCheck, requiresPermission: "manage_compliance" },
    { title: "Assigned Inspections", url: "/compliance/field/inspections", icon: ClipboardCheck, requiresPermission: "manage_compliance" },
    { title: "Field Visits", url: "/compliance/field/execution", icon: MapPin, requiresPermission: "conduct_inspections" },
    { title: "Inspection Findings", url: "/compliance/field/findings", icon: FileText, requiresPermission: "manage_compliance" },
    { title: "Evidence", url: "/compliance/inspections/evidence", icon: FolderOpen, requiresPermission: "manage_compliance", __feature: "inspections.evidence" },
    { title: "Convert Finding To Violation", url: "/compliance/inspections/convert-finding", icon: ArrowRightLeft, requiresPermission: "manage_compliance", __feature: "inspections.convertFinding" },

  ]),
};

const legalEscalations: SubItem = {
  title: "Legal Escalations",
  icon: Scale,
  requiresPermission: "manage_compliance",
  description: "Recommendations, legal pack, approvals, and status tracking",
  subItems: filterEnabled<SubItem & { __feature?: string }>([
    { title: "Legal Review Queue", url: "/compliance/enforcement/legal-queue", icon: Scale, requiresPermission: "manage_compliance" },
    { title: "Escalation Recommendations", url: "/compliance/enforcement/recommendation-queue", icon: ListChecks, requiresPermission: "manage_compliance" },
    { title: "Legal Pack Preparation", url: "/compliance/legal/pack-preparation", icon: FileText, requiresPermission: "manage_compliance", __feature: "legal.packPreparation" },
    { title: "Approved Escalations", url: "/compliance/legal/approved-escalations", icon: ClipboardCheck, requiresPermission: "manage_compliance", __feature: "legal.approvedEscalations" },
    { title: "Returned From Legal", url: "/compliance/legal/returned-from-legal", icon: ArrowRightLeft, requiresPermission: "manage_compliance", __feature: "legal.returnedFromLegal" },
    { title: "Legal Status Tracking", url: "/compliance/enforcement/proceedings", icon: Gavel, requiresPermission: "manage_compliance" },
  ]),
};

const riskProfile: SubItem = {
  title: "Risk And Employer Profile",
  icon: TrendingUp,
  requiresPermission: "manage_compliance",
  description: "Employer risk register, scoring, defaulters, and watchlists",
  subItems: filterEnabled<SubItem & { __feature?: string }>([
    { title: "Employer Risk Register", url: "/compliance/field/employer-360", icon: Building2, requiresPermission: "manage_compliance" },
    { title: "Risk Score Details", url: "/compliance/risk/score-details", icon: TrendingUp, requiresPermission: "manage_compliance", __feature: "risk.scoreDetails" },
    { title: "Repeat Defaulters", url: "/compliance/risk/repeat-defaulters", icon: AlertTriangle, requiresPermission: "manage_compliance", __feature: "risk.repeatDefaulters" },
    { title: "High Risk Employers", url: "/compliance/risk/high-risk", icon: ShieldAlert, requiresPermission: "manage_compliance", __feature: "risk.highRiskEmployers" },
    { title: "Watchlist", url: "/compliance/risk/watchlist", icon: Eye, requiresPermission: "manage_compliance", __feature: "risk.watchlist" },
  ]),
};

const reports: SubItem = {
  title: "Reports",
  icon: BarChart3,
  requiresPermission: "generate_reports",
  description: "Compliance analytics and operational reports",
  subItems: filterEnabled<SubItem & { __feature?: string }>([
    { title: "Violation Reports", icon: FileText, requiresPermission: "generate_reports", subItems: [
      { title: "Violation Summary", url: "/compliance/reports/violations/summary", icon: BarChart3, requiresPermission: "generate_reports" },
      { title: "Violations by Status", url: "/compliance/reports/violations/status", icon: FileText, requiresPermission: "generate_reports" },
      { title: "Violations by Type", url: "/compliance/reports/violations/type", icon: FileText, requiresPermission: "generate_reports" },
      { title: "Violation Resolution Time", url: "/compliance/reports/violations/resolution-time", icon: FileText, requiresPermission: "generate_reports" },
      { title: "Violations by Zone", url: "/compliance/reports/violations/zone", icon: FileText, requiresPermission: "generate_reports" },
    ] },
    { title: "Case Aging Reports", url: "/compliance/reports/case-analytics", icon: Timer, requiresPermission: "generate_reports" },
    { title: "Employer Compliance Reports", url: "/compliance/reports/c3-compliance", icon: ClipboardCheck, requiresPermission: "generate_reports" },
    { title: "Arrears And Recovery Reports", url: "/compliance/reports/arrears", icon: DollarSign, requiresPermission: "generate_reports" },
    { title: "Payment Arrangement Reports", url: "/compliance/reports/arrangements", icon: HandshakeIcon, requiresPermission: "generate_reports" },
    { title: "Legal Escalation Reports", url: "/compliance/reports/legal", icon: Scale, requiresPermission: "generate_reports" },
    { title: "Officer Workload Reports", url: "/compliance/reports/inspector-performance", icon: Users, requiresPermission: "generate_reports" },
    { title: "Automation Job Reports", url: "/compliance/reports/automation-jobs", icon: Zap, requiresPermission: "generate_reports", __feature: "reports.automationJobs" },
  ]),
};

const administration: SubItem = {
  title: "Setup",
  icon: Settings,
  requiresPermission: "manage_compliance",
  description: "Compliance configuration, rules, templates, and automation",
  subItems: filterEnabled<SubItem & { __feature?: string }>([
    { title: "Setup Wizard", url: "/compliance/admin/setup-wizard", icon: Cog, requiresPermission: "manage_compliance", __feature: "admin.setupWizard" },
    { title: "General Settings", url: "/compliance/admin/settings", icon: Settings, requiresPermission: "manage_compliance" },
    { title: "Feature Toggles", url: "/compliance/admin/feature-toggles", icon: Zap, requiresPermission: "manage_compliance", __feature: "admin.featureToggles" },
    {
      title: "Staff Management",
      icon: Users,
      requiresPermission: "manage_compliance",
      subItems: [
        { title: "Officers / Inspectors", url: "/compliance/admin/staff/officers", icon: UserCheck, requiresPermission: "manage_compliance" },
        { title: "Supervisor Hierarchy", url: "/compliance/admin/staff/supervisors", icon: Network, requiresPermission: "manage_compliance" },
        { title: "Queue Members", url: "/compliance/admin/staff/queue-members", icon: Users, requiresPermission: "manage_compliance" },
        { title: "Legacy Inspector Linking", url: "/compliance/admin/staff/link-legacy", icon: ArrowRightLeft, requiresPermission: "manage_compliance" },
      ],
    },
    { title: "Violation Types", url: "/compliance/admin/settings/violation-types", icon: AlertTriangle, requiresPermission: "manage_compliance" },
    { title: "Employer Status Register", url: "/compliance/admin/settings/employer-status-register", icon: Building2, requiresPermission: "manage_compliance" },
    { title: "Review Flag Queue", url: "/compliance/admin/settings/review-flag-queue", icon: ShieldQuestion, requiresPermission: "manage_compliance" },
    { title: "Self-Employed Compliance", url: "/compliance/admin/settings/self-employed-compliance", icon: Users, requiresPermission: "manage_compliance" },
    { title: "Headcount Tiers", url: "/compliance/admin/settings/headcount-tiers", icon: Users, requiresPermission: "manage_compliance" },
    { title: "Wage Benchmarks", url: "/compliance/admin/settings/wage-benchmarks", icon: TrendingUp, requiresPermission: "manage_compliance" },
    { title: "Contribution Exemptions", url: "/compliance/admin/settings/contribution-exemptions", icon: Scale, requiresPermission: "manage_compliance" },
    { title: "Unregistered Employer Leads", url: "/compliance/admin/settings/unregistered-employer-leads", icon: Building2, requiresPermission: "manage_compliance" },
    { title: "Rule Engine", url: "/compliance/admin/settings/rule-engine", icon: Cog, requiresPermission: "manage_compliance" },
    { title: "Calculation Rules", url: "/compliance/admin/calculation-rules", icon: Hash, requiresPermission: "manage_compliance", __feature: "admin.calculationRules" },
    { title: "Escalation Rules", url: "/compliance/admin/escalation-rules", icon: Scale, requiresPermission: "manage_compliance", __feature: "admin.escalationRules" },
    { title: "Case Families", url: "/compliance/admin/case-families", icon: Layers, requiresPermission: "manage_compliance", __feature: "admin.caseFamilies" },
    { title: "Risk Scoring", url: "/compliance/admin/settings/risk-policy", icon: TrendingUp, requiresPermission: "manage_compliance" },
    { title: "Assignment Routing", url: "/compliance/admin/settings/assignment-routing", icon: Route, requiresPermission: "manage_compliance" },
    { title: "Workflow Mapping", url: "/compliance/admin/workflow-mapping", icon: Network, requiresPermission: "manage_compliance", __feature: "admin.workflowMapping" },
    { title: "Reference Numbering", url: "/compliance/admin/settings/number-templates", icon: Hash, requiresPermission: "manage_compliance" },
    { title: "Notice Templates", url: "/admin/notification-templates?tab=core&module=COMPLIANCE&type=NOTICE", icon: FileText, requiresPermission: "manage_compliance" },
    { title: "Communication Templates", url: "/admin/notification-templates?tab=core&module=COMPLIANCE", icon: Mail, requiresPermission: "manage_compliance" },
    { title: "Communication Trigger Rules", url: "/compliance/admin/comm-trigger-rules", icon: Mail, requiresPermission: "manage_compliance" },

    { title: "Automation Jobs", url: "/compliance/admin/automation/jobs", icon: Zap, requiresPermission: "manage_compliance" },
    { title: "Schedule Settings", url: "/compliance/admin/schedule-settings", icon: Calendar, requiresPermission: "manage_compliance", __feature: "admin.scheduleSettings" },
    { title: "Payment Arrangement Rules", url: "/compliance/admin/payment-arrangement-rules", icon: HandshakeIcon, requiresPermission: "manage_compliance", __feature: "admin.paymentArrangementRules" },
    { title: "Waiver Rules", url: "/compliance/admin/waiver-rules", icon: Hammer, requiresPermission: "manage_compliance", __feature: "admin.waiverRules" },
    { title: "Legal Handoff Rules", url: "/compliance/admin/legal-handoff-rules", icon: Gavel, requiresPermission: "manage_compliance", __feature: "admin.legalHandoffRules" },
    { title: "Employer Response Settings", url: "/compliance/admin/online-response", icon: Globe, requiresPermission: "manage_compliance" },
    {
      title: "Simulators",
      icon: Search,
      requiresPermission: "manage_compliance",
      subItems: [
        { title: "Rule Simulator", url: "/compliance/admin/tools/rule-simulator", icon: Zap, requiresPermission: "manage_compliance" },
        { title: "Risk Simulator", url: "/compliance/admin/tools/risk-simulator", icon: Target, requiresPermission: "manage_compliance" },
      ],
    },
    { title: "Ledger Recalculation Wizard", url: "/ledger/recalc", icon: Calculator, requiresPermission: "manage_compliance" },
    { title: "Payment Allocation Rules", url: "/admin/ledger/allocation-rules", icon: ListOrdered, requiresPermission: "manage_compliance" },
    { title: "Help And Instructions", url: "/compliance/admin/help", icon: HelpCircle, requiresPermission: "manage_compliance", __feature: "admin.helpAndInstructions" },
  ]),
};

const complianceMenuItemsRaw = [
  {
    title: "Compliance & Enforcement",
    icon: Shield,
    subItems: [
      dashboard,
      myWorkQueue,
      violations,
      cases,
      notices,
      arrangements,
      ...(isComplianceFeatureEnabled("inspections") ? [inspections] : []),
      legalEscalations,
      riskProfile,
      reports,
      administration,
    ],
  },
];

/**
 * When VITE_USE_COMPLIANCE_HUB_REMOTE=true the Compliance menu URLs are
 * rewritten from /compliance/... to /compliance-hub/... so clicks land on
 * the embedded SatelliteFrame route instead of the local pages.
 */
export const complianceMenuItems = applyComplianceRemoteRouting(complianceMenuItemsRaw);
