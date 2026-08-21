import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { logError as logSystemError, logTechnical } from '@/services/systemLoggerService';
import { 
  LayoutDashboard, Users, Settings, Shield, Building2, FileText,
  ClipboardList, ClipboardCheck, Bell, Key, UserCog, Briefcase, FolderTree,
  Database, Lock, Activity, Calendar, ChartBar, Home, Layers,
  Settings2, Boxes, PenTool, Mail, Building, CheckCircle, FileCheck,
  AlertTriangle, DollarSign, CreditCard, Receipt, Wallet, TrendingUp,
  PieChart, BarChart2, UserPlus, UserCheck, FilePlus, Search,
  Monitor, FileCode, History, Link, GitBranch, Globe, Stethoscope,
  BellRing, Send, TestTube, FlaskConical, Terminal, MapPin, HardHat,
  Heart, Flag, BadgeCheck, Network, Workflow, Play, Eye, Plug, 
  ArrowLeftRight, ShieldAlert, ShieldCheck, Wrench, BarChart3,
  Clock, Target, FileBarChart,
  type LucideIcon
} from 'lucide-react';
import { applyAuditRemoteRouting, applyComplianceRemoteRouting, setSatelliteRemoteEnabled } from '@/lib/embed/satelliteRouting';

export interface MenuItem {
  id: string;
  title: string;
  url?: string;
  icon: LucideIcon;
  description?: string;
  subItems?: MenuItem[];
}

interface ModuleRow {
  id: string;
  name: string;
  display_name: string;
  icon: string | null;
  route: string | null;
  parent_id: string | null;
  sort_order: number | null;
  description: string | null;
  base_url: string | null;
}

// Map of icon names to Lucide icons
const iconMap: Record<string, LucideIcon> = {
  'layout-dashboard': LayoutDashboard,
  'layoutdashboard': LayoutDashboard,
  'dashboard': LayoutDashboard,
  'users': Users,
  'settings': Settings,
  'settings2': Settings2,
  'shield': Shield,
  'shieldcheck': ShieldCheck,
  'shield-check': ShieldCheck,
  'shieldalert': ShieldAlert,
  'shield-alert': ShieldAlert,
  'building': Building,
  'building2': Building2,
  'file-text': FileText,
  'filetext': FileText,
  'clipboard-list': ClipboardList,
  'clipboardlist': ClipboardList,
  'clipboardcheck': ClipboardCheck,
  'clipboard-check': ClipboardCheck,
  'bell': Bell,
  'bellring': BellRing,
  'bell-ring': BellRing,
  'key': Key,
  'user-cog': UserCog,
  'usercog': UserCog,
  'briefcase': Briefcase,
  'folder-tree': FolderTree,
  'foldertree': FolderTree,
  'database': Database,
  'lock': Lock,
  'activity': Activity,
  'calendar': Calendar,
  'chart-bar': ChartBar,
  'chartbar': ChartBar,
  'barchart3': BarChart3,
  'bar-chart-3': BarChart3,
  'home': Home,
  'layers': Layers,
  'boxes': Boxes,
  'pentool': PenTool,
  'pen-tool': PenTool,
  'mail': Mail,
  'send': Send,
  'checkcircle': CheckCircle,
  'check-circle': CheckCircle,
  'filecheck': FileCheck,
  'file-check': FileCheck,
  'alerttriangle': AlertTriangle,
  'alert-triangle': AlertTriangle,
  'dollarsign': DollarSign,
  'dollar-sign': DollarSign,
  'creditcard': CreditCard,
  'credit-card': CreditCard,
  'receipt': Receipt,
  'wallet': Wallet,
  'trendingup': TrendingUp,
  'trending-up': TrendingUp,
  'piechart': PieChart,
  'pie-chart': PieChart,
  'barchart2': BarChart2,
  'bar-chart-2': BarChart2,
  'userplus': UserPlus,
  'user-plus': UserPlus,
  'usercheck': UserCheck,
  'user-check': UserCheck,
  'fileplus': FilePlus,
  'file-plus': FilePlus,
  'search': Search,
  'monitor': Monitor,
  'filecode': FileCode,
  'file-code': FileCode,
  'history': History,
  'link': Link,
  'gitbranch': GitBranch,
  'git-branch': GitBranch,
  'globe': Globe,
  'stethoscope': Stethoscope,
  'testtube': TestTube,
  'test-tube': TestTube,
  'flaskconical': FlaskConical,
  'flask-conical': FlaskConical,
  'terminal': Terminal,
  'mappin': MapPin,
  'map-pin': MapPin,
  'hardhat': HardHat,
  'hard-hat': HardHat,
  'heart': Heart,
  'flag': Flag,
  'badgecheck': BadgeCheck,
  'badge-check': BadgeCheck,
  'network': Network,
  'workflow': Workflow,
  'play': Play,
  'eye': Eye,
  'plug': Plug,
  'arrowleftright': ArrowLeftRight,
  'arrow-left-right': ArrowLeftRight,
  'wrench': Wrench,
  'rows3': Layers,
  'clock': Clock,
  'target': Target,
  'filebarchart': FileBarChart,
  'file-bar-chart': FileBarChart,
};

function getIcon(iconName: string | null): LucideIcon {
  if (!iconName) return LayoutDashboard;
  const normalizedName = iconName.toLowerCase().replace(/[_\s]/g, '-');
  return iconMap[normalizedName] || iconMap[normalizedName.replace(/-/g, '')] || LayoutDashboard;
}

function buildMenuTree(modules: ModuleRow[]): MenuItem[] {
  const childrenMap = new Map<string, ModuleRow[]>();
  const rootModules: ModuleRow[] = [];

  modules.forEach(module => {
    if (module.parent_id) {
      const siblings = childrenMap.get(module.parent_id) || [];
      siblings.push(module);
      childrenMap.set(module.parent_id, siblings);
    } else {
      rootModules.push(module);
    }
  });

  const sortModules = (a: ModuleRow, b: ModuleRow) =>
    (a.sort_order ?? 999) - (b.sort_order ?? 999);

  function buildMenuItem(module: ModuleRow, parentBaseUrl?: string | null): MenuItem {
    const children = childrenMap.get(module.id) || [];
    children.sort(sortModules);

    // Inherit base_url from parent if not set on this module
    const effectiveBaseUrl = module.base_url || parentBaseUrl || null;

    const menuItem: MenuItem = {
      id: module.id,
      title: module.display_name,
      icon: getIcon(module.icon),
      description: module.description || undefined,
    };

    if (module.route) {
      // Prepend base_url for cross-app modules
      menuItem.url = effectiveBaseUrl
        ? `${effectiveBaseUrl.replace(/\/+$/, '')}${module.route}`
        : module.route;
    }

    if (children.length > 0) {
      menuItem.subItems = children.map(child => buildMenuItem(child, effectiveBaseUrl));
    }

    return menuItem;
  }

  rootModules.sort(sortModules);
  const built = rootModules.map(m => buildMenuItem(m, null));
  // Rewrite local prefixes to satellite-host prefixes when remote is enabled
  // so DB-driven menu clicks land on the in-app SatelliteFrame route
  // (which preserves host sidebar + header) instead of the local pages.
  return applyAuditRemoteRouting(applyComplianceRemoteRouting(built));
}

// ── Internal Audit: workflow-based group definitions ──
interface IAGroupDef {
  groupTitle: string;
  icon: LucideIcon;
  paths: string[];
}

const IA_WORKFLOW_GROUPS: IAGroupDef[] = [
  { groupTitle: 'Dashboard', icon: LayoutDashboard, paths: ['/audit/dashboard'] },
  { groupTitle: 'Risk Management', icon: Shield, paths: ['/audit/risk-assessment', '/audit/entity-summary', '/audit/risk-matrix'] },
  { groupTitle: 'Planning', icon: ClipboardCheck, paths: ['/audit/audit-plans', '/audit/plan-approval'] },
  { groupTitle: 'Execution', icon: Briefcase, paths: ['/audit/audits', '/audit/queries'] },
  {
    groupTitle: 'Resources', icon: Users,
    paths: ['/audit/auditors', '/audit/auditor-profiles', '/audit/workload', '/audit/time-tracking', '/audit/leave'],
  },
  { groupTitle: 'Reference Data', icon: Database, paths: ['/audit/departments', '/audit/functions', '/audit/templates'] },
  { groupTitle: 'Reporting', icon: FileBarChart, paths: ['/audit/audit-reports'] },
  { groupTitle: 'Configuration', icon: Settings, paths: ['/audit/config', '/audit/risk-settings', '/audit/document-templates'] },
];

const IA_ITEM_OVERRIDES: Record<string, { title?: string; icon?: LucideIcon; description?: string }> = {
  '/audit/dashboard':        { title: 'Dashboard',               icon: LayoutDashboard, description: 'Audit overview and KPIs' },
  '/audit/risk-assessment':  { title: 'Risk Assessment',         icon: Shield,          description: 'Assess function-level risks' },
  '/audit/entity-summary':   { title: 'Entity Risk Summary',     icon: Building2,       description: 'Department-level risk overview' },
  '/audit/risk-matrix':      { title: 'Risk Matrix',             icon: BarChart3,       description: 'View the 5×5 risk heatmap' },
  '/audit/audit-plans':      { title: 'Audit Plans',             icon: ClipboardList,   description: 'Create risk-driven audit plans' },
  '/audit/plan-approval':    { title: 'Plan Approval',           icon: ClipboardCheck,  description: 'Review and approve submitted plans' },
  '/audit/audits':           { title: 'Audits',                  icon: Briefcase,       description: 'Execute audits for department functions' },
  '/audit/auditors':         { title: 'Auditor Profiles',        icon: UserCheck,       description: 'Manage auditor registry and roles' },
  '/audit/auditor-profiles': { title: 'Auditor Profiles',        icon: UserCheck,       description: 'Manage auditor registry and roles' },
  '/audit/workload':         { title: 'Workload & Capacity',     icon: BarChart3,       description: 'View auditor workload and capacity' },
  '/audit/time-tracking':    { title: 'Time Tracking',           icon: Clock,           description: 'Track audit time spent' },
  '/audit/leave':            { title: 'Leave & Vacation',        icon: Calendar,        description: 'Manage auditor leave schedules' },
  '/audit/departments':      { title: 'Departments',             icon: Building2,       description: 'Manage department information' },
  '/audit/functions':        { title: 'Business Functions',      icon: FolderTree,      description: 'Manage department functions' },
  '/audit/templates':        { title: 'Communication Templates', icon: FileText,        description: 'Reusable templates for letters, reports, and notices' },
  '/audit/audit-reports':    { title: 'Report Center',           icon: FileBarChart,    description: 'Create and manage audit reports' },
  '/audit/config':           { title: 'Audit Configuration',     icon: Settings,        description: 'Workflow defaults, notifications, SLA' },
  '/audit/risk-settings':    { title: 'Risk Configuration',      icon: Shield,          description: 'Likelihood, impact, formula, rating bands' },
  '/audit/document-templates': { title: 'Document & Output Settings', icon: Settings,   description: 'Foundation branding, section library, and layouts' },
  '/db-diagram/internal_audit': { title: 'DB Diagram',           icon: Database,        description: 'Internal Audit database schema' },
};

function normalizePath(path?: string): string {
  if (!path) return '';
  let p = path.trim();
  // If a full URL was passed (e.g. https://internalaudit.secureserve.biz/audit/dashboard),
  // extract just the pathname so grouping/active-state logic still matches.
  if (/^https?:\/\//i.test(p)) {
    try {
      p = new URL(p).pathname;
    } catch {
      // fall through
    }
  }
  return p.replace(/\/+$/, '') || '/';
}

function groupInternalAuditNavigation(items: MenuItem[]): MenuItem[] {
  return items.map((item) => {
    const isInternalAuditRoot = item.title.toLowerCase() === 'internal audit';
    const children = item.subItems || [];

    if (!isInternalAuditRoot || children.length === 0) return item;

    const enhanced = children.map((child) => {
      const norm = normalizePath(child.url);
      const ov = IA_ITEM_OVERRIDES[norm];
      if (ov) {
        return {
          ...child,
          title: ov.title ?? child.title,
          icon: ov.icon ?? child.icon,
          description: child.description || ov.description,
        } as MenuItem;
      }
      return child;
    });

    const claimedPaths = new Set<string>();
    IA_WORKFLOW_GROUPS.forEach(g => g.paths.forEach(p => claimedPaths.add(normalizePath(p))));

    const groupedItems: MenuItem[] = [];

    IA_WORKFLOW_GROUPS.forEach((group) => {
      const pathSet = new Set(group.paths.map(normalizePath));
      const members = enhanced.filter(c => c.url && pathSet.has(normalizePath(c.url)));

      if (members.length === 0) return;

      if (members.length === 1 && members[0].title === group.groupTitle) {
        groupedItems.push(members[0]);
      } else {
        groupedItems.push({
          id: `ia-group-${group.groupTitle.toLowerCase().replace(/\s+/g, '-')}`,
          title: group.groupTitle,
          icon: group.icon,
          subItems: members,
        });
      }
    });

    const unclaimed = enhanced.filter(c => !c.url || !claimedPaths.has(normalizePath(c.url)));
    unclaimed.forEach(c => groupedItems.push(c));

    return { ...item, subItems: groupedItems };
  });
}

export function useDynamicNavigation() {
  const { user, isAdmin, isAuthReady, isAuthenticated } = useSupabaseAuth();

  const {
    data: menuItems = [],
    isLoading,
    isError,
    error,
    refetch
  } = useQuery({
    queryKey: ['dynamic-navigation', user?.id],
    queryFn: async ({ signal }) => {
      if (!user?.id) return [];

      const startTime = performance.now();
      const requestController = new AbortController();
      const timeoutId = window.setTimeout(() => requestController.abort(), 8_000);
      const cancelRequest = () => requestController.abort();
      signal.addEventListener('abort', cancelRequest, { once: true });

      let data: unknown;
      let error: { code?: string; message: string; details?: string; hint?: string } | null;

      try {
        const result = await supabase
          .rpc('get_user_accessible_modules' as any, { _user_id: user.id })
          .abortSignal(requestController.signal);
        data = result.data;
        error = result.error;
      } catch (requestError) {
        if (requestController.signal.aborted && !signal.aborted) {
          throw new Error('NAVIGATION_TIMEOUT: Menu request did not respond.');
        }
        throw requestError;
      } finally {
        window.clearTimeout(timeoutId);
        signal.removeEventListener('abort', cancelRequest);
      }

      const executionTime = Math.round(performance.now() - startTime);

      if (error) {
        console.error('Failed to fetch accessible modules:', error);
        
        // Fire-and-forget logging
        logSystemError({
          api_name: 'get_user_accessible_modules',
          module: 'Navigation',
          error_type: error.code || 'API_ERROR',
          error_message: error.message,
          stack_trace: error.details ? JSON.stringify({ details: error.details, hint: error.hint }) : undefined,
          severity: 'error',
          payload_json: { user_id: user.id, error_code: error.code },
        }, user.id).catch(() => {});

        logTechnical({
          api_name: 'get_user_accessible_modules',
          module: 'Navigation',
          execution_time_ms: executionTime,
          status: 'failed',
          severity: 'error',
          request_payload: { user_id: user.id },
          response_payload: { error: error.message, code: error.code },
        }, user.id).catch(() => {});

        throw error;
      }

      // Fire-and-forget successful logging
      logTechnical({
        api_name: 'get_user_accessible_modules',
        module: 'Navigation',
        execution_time_ms: executionTime,
        status: 'success',
        severity: 'info',
        request_payload: { user_id: user.id, module_count: ((data as ModuleRow[]) || []).length },
      }, user.id).catch(() => {});

      const modulesData = (data as ModuleRow[]) || [];

      // Drive satellite remote-enabled flags from app_modules.base_url so the
      // sidebar/menu rewrites only happen when an operator has configured a
      // non-blank base_url (see docs/INTERNAL_AUDIT_ROLLBACK.md).
      const auditRow = modulesData.find(m => m.name === 'internal_audit');
      const complianceRow = modulesData.find(m => m.name === 'compliance');
      setSatelliteRemoteEnabled({
        audit: !!(auditRow?.base_url || '').trim(),
        compliance: !!(complianceRow?.base_url || '').trim(),
      });

      return groupInternalAuditNavigation(buildMenuTree(modulesData));
    },
    enabled: isAuthReady && isAuthenticated && !!user?.id,
    staleTime: 5 * 60 * 1000,
    retry: (failureCount, queryError) =>
      !String(queryError instanceof Error ? queryError.message : queryError).includes('NAVIGATION_TIMEOUT')
      && failureCount < 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
    refetchOnWindowFocus: false,
  });

  const isEmpty = !isLoading && !isError && menuItems.length === 0;

  return {
    menuItems,
    isLoading,
    isError,
    isEmpty,
    isAdmin,
    error,
    refetch
  };
}

// Hook to check if user can access a specific module
export function useCanAccessModule(moduleName: string) {
  const { user, isAdmin, isAuthReady, isAuthenticated } = useSupabaseAuth();

  const { data: canAccess = false, isLoading } = useQuery({
    queryKey: ['can-access-module', user?.id, moduleName],
    queryFn: async () => {
      if (!user?.id) return false;
      if (isAdmin) return true;

      const startTime = performance.now();
      
      const { data, error } = await supabase
        .rpc('can_access_module' as any, { 
          _user_id: user.id, 
          _module_name: moduleName 
        });

      const executionTime = Math.round(performance.now() - startTime);

      if (error) {
        console.error('Failed to check module access:', error);
        
        logSystemError({
          api_name: 'can_access_module',
          module: 'Authorization',
          error_type: error.code || 'API_ERROR',
          error_message: error.message,
          stack_trace: error.details ? JSON.stringify({ details: error.details, hint: error.hint }) : undefined,
          severity: 'error',
          payload_json: { user_id: user.id, module_name: moduleName, error_code: error.code },
        }, user.id).catch(() => {});

        logTechnical({
          api_name: 'can_access_module',
          module: 'Authorization',
          execution_time_ms: executionTime,
          status: 'failed',
          severity: 'error',
        }, user.id).catch(() => {});

        return false;
      }

      return (data as boolean) ?? false;
    },
    enabled: isAuthReady && isAuthenticated && !!user?.id && !!moduleName,
    staleTime: 5 * 60 * 1000,
  });

  return { canAccess, isLoading, isAdmin };
}
