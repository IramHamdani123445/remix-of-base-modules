import { useComplianceRole } from '@/hooks/useComplianceRole';
import RoleWorkbench from '@/components/compliance/workbench/RoleWorkbench';
import HeadWorkbench from '@/components/compliance/workbench/executive/HeadWorkbench';
import { Navigate } from 'react-router-dom';


const COPY: Record<string, { title: string; subtitle: string }> = {
  inspector: {
    title: 'My Workbench',
    subtitle: 'Your visits, plans, reports, and open violations.',
  },
  senior: {
    title: 'Team Workbench',
    subtitle: 'Your work plus team approvals, reviews and escalations.',
  },
  head: {
    title: 'Compliance Executive Workbench',
    subtitle: 'Module-wide KPIs, team performance, and enforcement pipeline.',
  },
};

/**
 * Single canonical entry point for the Compliance & Enforcement Workbench.
 * Renders a role-appropriate widget board. Unknown roles are routed to the
 * legacy manager dashboard so existing users are unaffected.
 */
export default function WorkbenchLanding() {
  const role = useComplianceRole();

  if (role === 'other') {
    return <Navigate to="/compliance/workbench/manager" replace />;
  }

  const copy = COPY[role];

  if (role === 'head') {
    return <HeadWorkbench title={copy.title} subtitle={copy.subtitle} />;
  }

  return <RoleWorkbench role={role} title={copy.title} subtitle={copy.subtitle} />;
}

