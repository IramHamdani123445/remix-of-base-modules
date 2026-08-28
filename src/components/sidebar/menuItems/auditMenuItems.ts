import {
  Shield,
  LayoutDashboard,
  Users,
  FileSearch,
  Target,
  Grid3X3,
  FileText,
  Briefcase,
  BarChart3,
  ClipboardCheck,
  Clock,
  Settings,
  UserCheck,
  Timer,
  BookOpen,
  Database,
  Cog,
  Mail,
  Building2,
} from "lucide-react";
import { applyAuditRemoteRouting } from "@/lib/embed/satelliteRouting";

const auditMenuItemsRaw = [
  {
    title: "Internal Audit",
    icon: Shield,
    subItems: [
      // ── Governance ──
      {
        title: "Governance",
        isGroupLabel: true,
      },
      {
        title: "Dashboard",
        url: "/audit/dashboard",
        icon: LayoutDashboard,
        requiresPermission: "view_audit_assignments",
        description: "Audit overview and KPIs"
      },
      {
        title: "Audit Universe",
        icon: Grid3X3,
        requiresPermission: "configure_audit_system",
        description: "Auditable entities and functions",
        items: [
          {
            title: "Departments",
            url: "/audit/departments",
            icon: Users,
            requiresPermission: "configure_audit_system",
            description: "Manage department information"
          },
          {
            title: "Business Functions",
            url: "/audit/functions",
            icon: FileSearch,
            requiresPermission: "configure_audit_system",
            description: "Manage department functions"
          },
        ]
      },
      // ── Risk Management ──
      {
        title: "Risk Management",
        isGroupLabel: true,
      },
      {
        title: "Risk Assessment",
        url: "/audit/risk-assessment",
        icon: Target,
        requiresPermission: "configure_audit_system",
        description: "Assess function-level risks"
      },
      {
        title: "Entity Risk Summary",
        url: "/audit/entity-summary",
        icon: Building2,
        requiresPermission: "view_audit_assignments",
        description: "Department-level risk overview"
      },
      {
        title: "Risk Matrix",
        url: "/audit/risk-matrix",
        icon: Grid3X3,
        requiresPermission: "view_audit_assignments",
        description: "5×5 Impact vs Likelihood matrix"
      },
      // ── Planning ──
      {
        title: "Planning",
        isGroupLabel: true,
      },
      {
        title: "Audit Plans",
        url: "/audit/audit-plans",
        icon: FileText,
        requiresPermission: "create_audit_plans",
        description: "Risk-driven audit planning"
      },
      {
        title: "Plan Approval",
        url: "/audit/plan-approval",
        icon: ClipboardCheck,
        requiresPermission: "approve_audit_plans",
        description: "Review and approve submitted plans"
      },
      // ── Execution ──
      {
        title: "Execution",
        isGroupLabel: true,
      },
      {
        title: "Audits",
        url: "/audit/audits",
        icon: Briefcase,
        requiresPermission: "create_audit_plans",
        description: "Execute audits with checklists"
      },
      {
        title: "Audit Queries",
        url: "/audit/queries",
        icon: FileSearch,
        requiresPermission: "view_audit_assignments",
        description: "Communication between audit team and departments"
      },
      // ── Reporting ──
      {
        title: "Reporting",
        isGroupLabel: true,
      },
      {
        title: "Report Center",
        url: "/audit/audit-reports",
        icon: BarChart3,
        requiresPermission: "generate_reports",
        description: "Create and manage audit reports"
      },
      {
        title: "Engagement Summary",
        url: "/audit/reports/engagement-summary",
        icon: BarChart3,
        requiresPermission: "generate_reports",
        description: "Engagement register with governed finding counts"
      },
      {
        title: "Overdue Actions",
        url: "/audit/reports/overdue-actions",
        icon: Clock,
        requiresPermission: "generate_reports",
        description: "Overdue corrective actions and aging, from the Action Centre read model"
      },
      {
        title: "Plan Slippage",
        url: "/audit/reports/plan-slippage",
        icon: Timer,
        requiresPermission: "generate_reports",
        description: "Planned versus actual engagement timelines"
      },

      // ── Resources ──
      {
        title: "Resources",
        isGroupLabel: true,
      },
      {
        title: "Auditor Profiles",
        url: "/audit/auditors",
        icon: UserCheck,
        requiresPermission: "view_audit_assignments",
        description: "Manage auditor registry and roles"
      },
      {
        title: "Workload & Capacity",
        url: "/audit/workload",
        icon: BarChart3,
        requiresPermission: "view_audit_assignments",
        description: "View auditor workload and capacity"
      },
      {
        title: "Time Tracking",
        url: "/audit/time-tracking",
        icon: Timer,
        requiresPermission: "view_audit_assignments",
        description: "Track audit time spent"
      },
      {
        title: "Auditor Leave",
        url: "/audit/leave",
        icon: Clock,
        requiresPermission: "view_audit_assignments",
        description: "Manage auditor leave schedules"
      },
      // ── Reference Data ──
      {
        title: "Reference Data",
        isGroupLabel: true,
      },
      {
        title: "Communication Templates",
        url: "/admin/notification-templates?tab=core&module=AUDIT",
        icon: Mail,
        requiresPermission: "configure_audit_system",
        description: "Opens the shared Core Template Designer filtered to Audit module"
      },
      // ── Configuration ──
      {
        title: "Configuration",
        isGroupLabel: true,
      },
      {
        title: "Audit Configuration",
        url: "/audit/config",
        icon: Cog,
        requiresPermission: "configure_audit_system",
        description: "Workflow defaults, notifications, SLA, and general module behavior"
      },
      {
        title: "Risk Configuration",
        url: "/audit/risk-settings",
        icon: Shield,
        requiresPermission: "configure_audit_system",
        description: "Likelihood, impact, formula, rating bands, and risk derivation"
      },
      {
        title: "Document & Output Settings",
        url: "/audit/document-templates",
        icon: Settings,
        requiresPermission: "configure_audit_system",
        description: "Foundation branding, section library, and document type layouts"
      },
    ]
  }
];


/**
 * When VITE_USE_AUDIT_HUB_REMOTE=true the Internal Audit menu URLs are
 * rewritten from /audit/... to /audit-hub/... so clicks land on the embedded
 * SatelliteFrame route instead of the local pages.
 */
export const auditMenuItems = applyAuditRemoteRouting(auditMenuItemsRaw);
