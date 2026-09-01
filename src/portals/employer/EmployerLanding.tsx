import { PortalLandingTemplate } from '@/portals/_shared/PortalLandingTemplate';
import { Upload, FileSpreadsheet, Coins, Wallet, Users, ClipboardList, AlertTriangle, MessageSquare, HandCoins } from 'lucide-react';

export default function EmployerLanding() {
  return (
    <PortalLandingTemplate
      brand="Employer Portal"
      role="EMPLOYER"
      hero={{
        title: 'Manage employer contributions, C3 submissions, employee records and benefit requests.',
        subtitle: 'A single place for payroll, HR and compliance officers to interact with the Social Security Board.',
      }}
      ctas={[
        { label: 'Sign in as Employer', to: '/employer/dashboard' },
        { label: 'Submit C3', to: '/employer/c3/new', variant: 'outline' },
        { label: 'View Pending Requests', to: '/employer/benefit-tasks', variant: 'outline' },
      ]}
      cards={[
        { title: 'Submit C3', desc: 'Monthly contribution return submission.', icon: Upload, to: '/employer/c3/new' },
        { title: 'Upload C3 File', desc: 'Bulk upload validated C3 files.', icon: FileSpreadsheet, to: '/employer/c3/upload' },
        { title: 'Contribution History', desc: 'C3 returns paid and reported.', icon: Coins, to: '/employer/contributions' },
        { title: 'Outstanding Balances', desc: 'Arrears, penalties and pending amounts.', icon: Wallet, to: '/employer/balances' },
        { title: 'Request Partial Payment', desc: 'Ask to settle part of a period now. Does not change the legal due date.', icon: HandCoins, to: '/employer/partial-payment' },
        { title: 'Manage Employees', desc: 'Register, update and end employments.', icon: Users, to: '/employer/employees' },
        { title: 'Benefit Requests', desc: 'Confirm employment for benefit claims.', icon: ClipboardList, to: '/employer/benefit-tasks' },
        { title: 'Accident Reports', desc: 'Submit workplace injury reports.', icon: AlertTriangle, to: '/employer/accident-reports' },
        { title: 'Messages & Notices', desc: 'Compliance and official communications.', icon: MessageSquare, to: '/employer/messages' },
      ]}
      dashboardPath="/employer/dashboard"
    />
  );
}
