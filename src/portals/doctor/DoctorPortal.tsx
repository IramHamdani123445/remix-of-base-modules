import { Routes, Route, Navigate, useParams, Link } from 'react-router-dom';
import { ExternalPortalShell } from '@/portals/_shared/ExternalPortalShell';
import { ExternalTaskList } from '@/portals/_shared/ExternalTaskList';
import { ExternalTaskForm } from '@/portals/_shared/ExternalTaskForm';
import { PortalModulePlaceholder } from '@/portals/_shared/PortalModulePlaceholder';
import DoctorLanding from '@/portals/doctor/DoctorLanding';
import MedicalProviderReferralWorkspace from '@/portals/doctor/medical-reviews/MedicalProviderReferralWorkspace';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDoctorProfile, useDoctorReports, useExternalMessages } from '@/portals/_shared/externalHooks';

const NAV = [
  { to: '/doctor/dashboard', label: 'Dashboard' },
  { to: '/doctor/profile', label: 'Provider Profile' },
  { to: '/doctor/users', label: 'Provider Users' },
  { to: '/doctor/tasks', label: 'Medical Certificate Requests' },
  { to: '/doctor/certificates', label: 'Certificates' },
  { to: '/doctor/sickness-certificates', label: 'Sickness Certificates' },
  { to: '/doctor/maternity-certificates', label: 'Maternity Certificates' },
  { to: '/doctor/ei-medical-reports', label: 'Employment Injury Reports' },
  { to: '/doctor/invalidity-reports', label: 'Invalidity Reports' },
  { to: '/doctor/disablement-assessments', label: 'Disablement Assessments' },
  { to: '/doctor/reviews', label: 'Medical Review Requests' },
  { to: '/doctor/documents', label: 'Documents' },
  { to: '/doctor/messages', label: 'Messages' },
];

export default function DoctorPortal() {
  return (
    <Routes>
      <Route index element={<DoctorLanding />} />
      <Route path="*" element={
        <ExternalPortalShell role="DOCTOR" brand="Medical Provider Portal" nav={NAV}>
          <Routes>
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="profile" element={<Profile />} />
            <Route path="users" element={<PortalModulePlaceholder title="Provider Users" description="Manage clinicians authorised to submit on behalf of this facility." internalSource="user_roles + provider link" />} />
            <Route path="tasks" element={<ExternalTaskList basePath="/doctor/tasks" />} />
            <Route path="tasks/:taskId" element={<TaskDetail />} />
            <Route path="medical-tasks" element={<ExternalTaskList basePath="/doctor/tasks" />} />
            <Route path="certificates" element={<Reports title="Submitted Certificates" description="All certificates you have submitted." />} />
            <Route path="sickness-certificates" element={<PortalModulePlaceholder title="Sickness Certificates" description="Certify periods of sickness for Sickness Benefit claims." internalSource="bn_medical_recommendation" />} />
            <Route path="maternity-certificates" element={<PortalModulePlaceholder title="Maternity Certificates" description="Certify expected/actual delivery for Maternity Benefit." internalSource="bn_medical_recommendation" />} />
            <Route path="ei-reports" element={<PortalModulePlaceholder title="Employment Injury Medical Reports" description="Initial and follow-up EI medical reports." internalSource="bn_medical_recommendation" />} />
            <Route path="ei-medical-reports" element={<PortalModulePlaceholder title="Employment Injury Medical Reports" description="Initial and follow-up EI medical reports." internalSource="bn_medical_recommendation" />} />
            <Route path="invalidity-reports" element={<PortalModulePlaceholder title="Invalidity Reports" description="Medical evidence for Invalidity Benefit." internalSource="bn_medical_recommendation" />} />
            <Route path="disablement" element={<PortalModulePlaceholder title="Disablement Assessments" description="Loss-of-faculty assessments for Disablement Benefit." internalSource="bn_medical_recommendation" />} />
            <Route path="disablement-assessments" element={<PortalModulePlaceholder title="Disablement Assessments" description="Loss-of-faculty assessments for Disablement Benefit." internalSource="bn_medical_recommendation" />} />
            <Route path="submitted" element={<Reports title="Submitted Reports" description="All medical reports you have submitted." />} />
            {/* BN-MR-UI: restricted Medical Provider surface. Scoping to the
                signed-in provider identity is enforced inside the RPC. */}
            <Route path="reviews" element={<MedicalProviderReferralWorkspace />} />
            <Route path="documents" element={<PortalModulePlaceholder title="Provider Documents" description="Documents you uploaded with reports and certificates." internalSource="bn_external_task_document" />} />
            <Route path="messages" element={<Messages />} />
            <Route path="*" element={<Navigate to="/doctor/dashboard" replace />} />
          </Routes>
        </ExternalPortalShell>
      } />
    </Routes>
  );
}

function Dashboard() {
  const cards = [
    { to: '/doctor/tasks', title: 'Medical Certificate Requests', desc: 'Open requests awaiting your action.' },
    { to: '/doctor/sickness-certificates', title: 'Sickness Certificates', desc: 'Certify periods of sickness.' },
    { to: '/doctor/maternity-certificates', title: 'Maternity Certificates', desc: 'Certify maternity expected/actual dates.' },
    { to: '/doctor/ei-medical-reports', title: 'EI Medical Reports', desc: 'Employment Injury reports.' },
    { to: '/doctor/invalidity-reports', title: 'Invalidity Reports', desc: 'Medical evidence for Invalidity Benefit.' },
    { to: '/doctor/disablement-assessments', title: 'Disablement Assessments', desc: 'Loss-of-faculty assessments.' },
    { to: '/doctor/reviews', title: 'Medical Review Requests', desc: 'Periodic reviews of existing awards.' },
    { to: '/doctor/messages', title: 'Messages', desc: 'Communications from SSB.' },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {cards.map(c => (
        <Link key={c.to} to={c.to}>
          <Card className="hover:shadow-md transition-shadow h-full">
            <CardHeader><CardTitle className="text-base">{c.title}</CardTitle><CardDescription>{c.desc}</CardDescription></CardHeader>
          </Card>
        </Link>
      ))}
    </div>
  );
}

function Profile() {
  const { data, isLoading } = useDoctorProfile();
  if (isLoading) return <Skeleton className="h-32 w-full" />;
  const p = data?.provider;
  return (
    <Card>
      <CardHeader><CardTitle>Provider Profile</CardTitle><CardDescription>Sourced from Medical Facility registry (bn_medical_facility).</CardDescription></CardHeader>
      <CardContent>
        {!p ? <p className="text-sm text-muted-foreground">No provider profile on record.</p> : (
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Code</dt><dd className="font-mono">{p.facility_code}</dd>
            <dt className="text-muted-foreground">Name</dt><dd>{p.facility_name}</dd>
            <dt className="text-muted-foreground">Type</dt><dd>{p.facility_type ?? '—'}</dd>
            <dt className="text-muted-foreground">Address</dt><dd>{p.address ?? '—'}</dd>
            <dt className="text-muted-foreground">Phone</dt><dd>{p.phone ?? '—'}</dd>
            <dt className="text-muted-foreground">Status</dt><dd><Badge>{p.status ?? 'ACTIVE'}</Badge></dd>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function Reports({ title, description }: { title: string; description: string }) {
  const { data, isLoading } = useDoctorReports();
  if (isLoading) return <Skeleton className="h-48 w-full" />;
  const rows = data?.reports ?? [];
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description} (bn_medical_recommendation)</CardDescription></CardHeader>
      <CardContent>
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">No submitted reports.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Submitted</TableHead><TableHead>Patient SSN</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>{rows.map((r: any) => (
              <TableRow key={r.id}><TableCell>{r.created_at?.slice(0,10)}</TableCell><TableCell className="font-mono">{r.ssn ?? '—'}</TableCell><TableCell>{r.recommendation_type ?? '—'}</TableCell><TableCell><Badge>{r.status ?? 'SUBMITTED'}</Badge></TableCell></TableRow>
            ))}</TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function Messages() {
  const { data, isLoading } = useExternalMessages();
  if (isLoading) return <Skeleton className="h-32 w-full" />;
  const rows = data?.messages ?? [];
  return (
    <div className="space-y-2">
      {rows.length === 0 && <p className="text-sm text-muted-foreground">No messages yet.</p>}
      {rows.map((m: any) => (
        <Card key={m.id}><CardHeader><CardTitle className="text-base">{m.subject ?? m.template_code ?? 'Message'}</CardTitle><CardDescription>{m.created_at}</CardDescription></CardHeader></Card>
      ))}
    </div>
  );
}

function TaskDetail() {
  const { taskId } = useParams<{ taskId: string }>();
  return <ExternalTaskForm taskId={taskId!} />;
}
