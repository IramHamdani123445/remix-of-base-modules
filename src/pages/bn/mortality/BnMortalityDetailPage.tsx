/**
 * BN Mortality 360 — Detail Workspace  (/bn/mortality/:eventId)
 *
 * Ten tabs: Overview · Deceased & Person Match · Verification · Awards & Impact ·
 * Payments & PAD · Evidence · Survivor / Funeral / Legal · Communications ·
 * History & Audit · Actions.
 *
 * All reads flow through the secure BenefitsQueryClient. All mutations are
 * disabled while actions_enabled=false — the Actions tab shows every command
 * with a specific disabled reason.
 */
import React from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  BnModuleRouteGate,
  type BnModuleAccessContext,
} from '@/components/bn/access/BnModuleRouteGate';
import { BnMortalityAuthState } from './components/BnMortalityAuthState';
import {
  BnMortalityBreadcrumbs,
  deriveDetailBreadcrumbLabel,
} from './components/BnMortalityBreadcrumbs';

import {
  useMortalityEvent,
  useMortalityAffectedAwards,
  useMortalityAwardImpacts,
  useMortalityEventHistory,
  useMortalityEvidence,
  useMortalityCommunications,
  useMortalityReferrals,
} from '@/hooks/bn/mortality/useMortalityQueries';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import BnMortalityActionsPanel from './components/BnMortalityActionsPanel';
import {
  AlertTriangle,
  ChevronLeft,
  ClipboardCheck,
  FileText,
  Gavel,
  History,
  Lock,
  Mail,
  Scale,
  ShieldCheck,
  User,
  Wallet,
} from 'lucide-react';

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (['CLOSED', 'COMPLETED', 'REVERSED', 'CANCELLED', 'DUPLICATE'].includes(status)) return 'secondary';
  if (['REJECTED', 'CONFLICT'].includes(status)) return 'destructive';
  return 'default';
}

function fmtMoney(minor: number | null | undefined, currency = 'XCD'): string {
  if (minor == null) return '—';
  return `${currency} ${(minor / 100).toFixed(2)}`;
}

function Overview({ eventId }: { eventId: string }) {
  const q = useMortalityEvent(eventId);
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.isError) return <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription>{q.error?.message}</AlertDescription></Alert>;
  const e = q.data?.data;
  if (!e) return <Alert><AlertDescription>Event not found.</AlertDescription></Alert>;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Deceased</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-1.5">
          <div><span className="text-muted-foreground">Name:</span> {e.deceased.fullName ?? '—'}</div>
          <div><span className="text-muted-foreground">National ID:</span> {e.deceased.nationalIdMasked ?? '—'}</div>
          <div><span className="text-muted-foreground">DOB:</span> {e.deceased.dateOfBirth ?? '—'}</div>
          <div><span className="text-muted-foreground">Gender:</span> {e.deceased.gender ?? '—'}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Death</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-1.5">
          <div><span className="text-muted-foreground">Date:</span> {e.death.date ?? '—'}</div>
          <div><span className="text-muted-foreground">Time:</span> {e.death.time ?? '—'}</div>
          <div><span className="text-muted-foreground">Place:</span> {e.death.place ?? '—'}</div>
          <div><span className="text-muted-foreground">Cause:</span> {e.death.cause ?? '—'}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Verification</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-1.5">
          <div><span className="text-muted-foreground">Source:</span> {e.verification.source ?? '—'}</div>
          <div><span className="text-muted-foreground">Reference:</span> {e.verification.reference ?? '—'}</div>
          <div><span className="text-muted-foreground">Confidence:</span> {e.verification.confidence ?? '—'}</div>
          <div><span className="text-muted-foreground">Verified at:</span> {e.verification.verifiedAt ? new Date(e.verification.verifiedAt).toLocaleString() : '—'}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Workflow</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-1.5">
          <div><span className="text-muted-foreground">Status:</span> <Badge variant={statusBadgeVariant(e.status)}>{e.status}</Badge></div>
          <div><span className="text-muted-foreground">Assigned:</span> {e.assignedTo ?? 'Unassigned'}</div>
          <div><span className="text-muted-foreground">SLA due:</span> {e.slaDueAt ? new Date(e.slaDueAt).toLocaleString() : '—'}</div>
          <div><span className="text-muted-foreground">Reported:</span> {e.reportedAt ? new Date(e.reportedAt).toLocaleString() : '—'}</div>
        </CardContent>
      </Card>
    </div>
  );
}

function DeceasedPersonMatchTab({ eventId }: { eventId: string }) {
  const q = useMortalityEvent(eventId);
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.isError) return <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription>{q.error?.message}</AlertDescription></Alert>;
  const e = q.data?.data;
  if (!e) return null;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Deceased particulars</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-1.5">
          <div><span className="text-muted-foreground">Full name:</span> {e.deceased.fullName ?? '—'}</div>
          <div><span className="text-muted-foreground">Date of birth:</span> {e.deceased.dateOfBirth ?? '—'}</div>
          <div><span className="text-muted-foreground">Gender:</span> {e.deceased.gender ?? '—'}</div>
          <div><span className="text-muted-foreground">National ID:</span> {e.deceased.nationalIdMasked ?? '—'}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Canonical person match</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-1.5">
          <div><span className="text-muted-foreground">Matched IP:</span> {e.matched.ipId ?? 'Not matched'}</div>
          <div><span className="text-muted-foreground">Confidence:</span> {e.matched.confidence ?? '—'}</div>
          <div><span className="text-muted-foreground">Matched at:</span> {e.matched.matchedAt ? new Date(e.matched.matchedAt).toLocaleString() : '—'}</div>
        </CardContent>
      </Card>
    </div>
  );
}

function VerificationTab({ eventId }: { eventId: string }) {
  const q = useMortalityEvent(eventId);
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.isError) return <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription>{q.error?.message}</AlertDescription></Alert>;
  const e = q.data?.data;
  if (!e) return null;
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Verification chain</CardTitle></CardHeader>
      <CardContent className="text-sm space-y-1.5">
        <div><span className="text-muted-foreground">Source:</span> {e.verification.source ?? '—'}</div>
        <div><span className="text-muted-foreground">Reference:</span> {e.verification.reference ?? '—'}</div>
        <div><span className="text-muted-foreground">Confidence:</span> {e.verification.confidence ?? '—'}</div>
        <div><span className="text-muted-foreground">Verified at:</span> {e.verification.verifiedAt ? new Date(e.verification.verifiedAt).toLocaleString() : '—'}</div>
        <div><span className="text-muted-foreground">Submitted for verification:</span> {e.submittedForVerificationAt ? new Date(e.submittedForVerificationAt).toLocaleString() : '—'}</div>
        <div><span className="text-muted-foreground">Confirmed at:</span> {e.confirmedAt ? new Date(e.confirmedAt).toLocaleString() : '—'}</div>
      </CardContent>
    </Card>
  );
}

function AwardsAndImpact({ eventId }: { eventId: string }) {
  const q = useMortalityAwardImpacts(eventId);
  const fallback = useMortalityAffectedAwards(eventId);
  const impacts = q.data?.data ?? [];
  const rows = impacts.length > 0 ? impacts : (fallback.data?.data ?? []);
  if (q.isLoading || fallback.isLoading) return <Skeleton className="h-40" />;
  if (q.isError && fallback.isError) return <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription>{q.error?.message}</AlertDescription></Alert>;
  if (rows.length === 0) return <div className="p-6 text-center text-sm text-muted-foreground">No affected awards. Impact analysis runs when Prepare Impact executes.</div>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Award</TableHead>
          <TableHead>Action</TableHead>
          <TableHead>Current status</TableHead>
          <TableHead>Approval</TableHead>
          <TableHead>Hold</TableHead>
          <TableHead>Termination</TableHead>
          <TableHead>Est. PAD</TableHead>
          <TableHead>Integration</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id ?? `${eventId}:${r.awardId}`}>
            <TableCell className="font-mono text-xs">{r.awardReference ?? r.awardId?.slice(0, 8) ?? '—'}</TableCell>
            <TableCell><Badge>{r.action}</Badge></TableCell>
            <TableCell><Badge variant="outline">{r.currentAwardStatus ?? '—'}</Badge></TableCell>
            <TableCell className="text-xs">{r.approvalState ?? '—'}</TableCell>
            <TableCell className="text-xs">{r.holdStatus ?? '—'}</TableCell>
            <TableCell className="text-xs">{r.terminationStatus ?? '—'}</TableCell>
            <TableCell className="text-xs tabular-nums">{fmtMoney(r.estimatedPadMinor, r.currencyCode ?? 'XCD')}</TableCell>
            <TableCell className="text-xs">
              {r.integrationFailure ? (
                <span className="text-destructive">{r.integrationFailure.code}</span>
              ) : (
                r.integrationStatus ?? 'NONE'
              )}
            </TableCell>
            <TableCell className="text-right">
              {r.award360Route && (
                <Button asChild size="sm" variant="ghost"><Link to={r.award360Route}>Open 360</Link></Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function PaymentsAndPad({ eventId }: { eventId: string }) {
  const q = useMortalityAwardImpacts(eventId);
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.isError) return <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription>{q.error?.message}</AlertDescription></Alert>;
  const rows = q.data?.data ?? [];
  const totalPad = rows.reduce((sum, r) => sum + (r.estimatedPadMinor ?? 0), 0);
  const currency = rows[0]?.currencyCode ?? 'XCD';
  if (rows.length === 0) return <div className="p-6 text-center text-sm text-muted-foreground">No payment impact recorded.</div>;
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex items-center justify-between">
          <span className="text-sm">Total estimated payment-after-death exposure</span>
          <span className="text-xl font-semibold tabular-nums">{fmtMoney(totalPad, currency)}</span>
        </CardContent>
      </Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Award</TableHead>
            <TableHead>Last valid payment</TableHead>
            <TableHead>Future schedules</TableHead>
            <TableHead>PAD</TableHead>
            <TableHead>Overpayment</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id ?? `${eventId}:pad:${r.awardId}`}>
              <TableCell className="font-mono text-xs">{r.awardReference ?? r.awardId?.slice(0, 8) ?? '—'}</TableCell>
              <TableCell className="text-xs">{r.lastValidPaymentDate ?? '—'}</TableCell>
              <TableCell className="text-xs">{r.futureScheduleCount ?? 0}</TableCell>
              <TableCell className="text-xs tabular-nums">{fmtMoney(r.estimatedPadMinor, r.currencyCode ?? 'XCD')}</TableCell>
              <TableCell className="text-xs">{r.overpaymentReference ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function EvidenceTab({ eventId }: { eventId: string }) {
  const register = useMortalityEvidenceRegister(eventId);
  const docs = useMortalityEvidence(eventId);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Evidence register</CardTitle></CardHeader>
        <CardContent className="p-0">
          {register.isLoading ? (
            <Skeleton className="h-32" />
          ) : register.isError ? (
            <div className="p-4">
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Evidence could not be loaded.</AlertTitle>
                <AlertDescription className="flex items-center justify-between gap-2">
                  <span>Evidence completeness is unknown until this loads.</span>
                  <Button size="sm" variant="outline" onClick={() => register.refetch()}>Retry</Button>
                </AlertDescription>
              </Alert>
            </div>
          ) : (register.data?.data ?? []).length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No evidence recorded on this event.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>DMS reference</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Recorded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(register.data?.data ?? []).map((r) => (
                  <TableRow key={r.id} data-testid={`mort-evidence-${r.id}`}>
                    <TableCell className="text-xs">{r.evidenceType}</TableCell>
                    <TableCell className="text-xs font-mono">{r.dmsReference ?? r.dmsDocumentId ?? '—'}</TableCell>
                    <TableCell className="text-xs">{r.receivedAt ? new Date(r.receivedAt).toLocaleDateString() : '—'}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{r.status}</Badge></TableCell>
                    <TableCell className="text-xs">{new Date(r.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Generated documents</CardTitle></CardHeader>
        <CardContent className="p-0">
          {docs.isLoading ? (
            <Skeleton className="h-24" />
          ) : docs.isError ? (
            <div className="p-4">
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{docs.error?.message ?? 'Documents could not be loaded.'}</AlertDescription>
              </Alert>
            </div>
          ) : (docs.data?.data ?? []).length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No documents generated.</div>
          ) : (
            <ul className="divide-y">
              {(docs.data?.data ?? []).map((f) => (
                <li key={f.id} className="flex items-center justify-between p-3">
                  <div className="flex items-center gap-3">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <div className="text-sm">{f.title ?? f.id}</div>
                      <div className="text-xs text-muted-foreground">
                        {f.documentType ?? '—'} · {f.generatedAt ? new Date(f.generatedAt).toLocaleDateString() : '—'}
                      </div>
                    </div>
                  </div>
                  <Badge variant="outline">{f.status ?? 'UNVERIFIED'}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SurvivorFuneralLegalTab({ eventId }: { eventId: string }) {
  const q = useMortalityReferrals(eventId);
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.isError) return <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription>{q.error?.message}</AlertDescription></Alert>;
  const rows = q.data?.data ?? [];
  if (rows.length === 0) return <div className="p-6 text-center text-sm text-muted-foreground">No survivor / funeral / legal referrals raised.</div>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Type</TableHead>
          <TableHead>Target module</TableHead>
          <TableHead>Reference</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Raised</TableHead>
          <TableHead>Completed</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="text-xs"><Badge variant="outline">{r.referralType}</Badge></TableCell>
            <TableCell className="text-xs">{r.targetModule ?? '—'}</TableCell>
            <TableCell className="text-xs font-mono">{r.targetReference ?? r.targetRefId ?? '—'}</TableCell>
            <TableCell className="text-xs">{r.status}</TableCell>
            <TableCell className="text-xs">{r.raisedAt ? new Date(r.raisedAt).toLocaleDateString() : '—'}</TableCell>
            <TableCell className="text-xs">{r.completedAt ? new Date(r.completedAt).toLocaleDateString() : '—'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function CommunicationsTab({ eventId }: { eventId: string }) {
  const q = useMortalityCommunications(eventId);
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.isError) return <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription>{q.error?.message}</AlertDescription></Alert>;
  const rows = q.data?.data ?? [];
  if (rows.length === 0) return <div className="p-6 text-center text-sm text-muted-foreground">No communications sent.</div>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Sent</TableHead>
          <TableHead>Event</TableHead>
          <TableHead>Recipient</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((c) => (
          <TableRow key={c.id}>
            <TableCell className="text-xs">{c.sentAt ? new Date(c.sentAt).toLocaleString() : (c.createdAt ? new Date(c.createdAt).toLocaleString() : '—')}</TableCell>
            <TableCell className="text-xs">{c.eventCode ?? '—'}</TableCell>
            <TableCell className="text-xs">{c.recipientSummary ?? '—'}</TableCell>
            <TableCell><Badge variant="outline">{c.status ?? '—'}</Badge></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function HistoryTab({ eventId }: { eventId: string }) {
  const q = useMortalityEventHistory(eventId);
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.isError) return <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription>{q.error?.message}</AlertDescription></Alert>;
  const rows = q.data?.data ?? [];
  if (rows.length === 0) return <div className="p-6 text-center text-sm text-muted-foreground">No history yet.</div>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Command</TableHead>
          <TableHead>From → To</TableHead>
          <TableHead>Actor</TableHead>
          <TableHead>Reason</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((h) => (
          <TableRow key={h.id}>
            <TableCell className="text-xs">{h.occurredAt ? new Date(h.occurredAt).toLocaleString() : '—'}</TableCell>
            <TableCell className="text-xs font-mono">{h.commandName}</TableCell>
            <TableCell className="text-xs">
              <Badge variant="outline" className="text-[10px]">{h.fromStatus ?? '—'}</Badge>
              {' → '}
              <Badge className="text-[10px]">{h.toStatus ?? '—'}</Badge>
            </TableCell>
            <TableCell className="text-xs">{h.actorUserCode ?? (h.actorUserId ? h.actorUserId.slice(0, 8) : '—')}</TableCell>
            <TableCell className="text-xs">{h.reasonCode ?? h.justification ?? '—'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function DetailContent({ ctx, eventId }: { ctx: BnModuleAccessContext; eventId: string }) {
  const eventQuery = useMortalityEvent(eventId);
  const { user } = useAuth();
  const e = eventQuery.data?.data;
  const currentUserId = user?.id ?? null;

  return (
    <div className="p-6 space-y-4 max-w-[1400px] mx-auto">
      <BnMortalityBreadcrumbs
        leaf={{
          kind: 'detail',
          eventLabel: deriveDetailBreadcrumbLabel({
            loading: eventQuery.isLoading,
            denied: eventQuery.isError,
            notFound: !eventQuery.isLoading && !e,
            eventReference: e?.eventReference ?? null,
          }),
        }}
      />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="icon">
              <Link to="/bn/mortality"><ChevronLeft className="h-4 w-4" /></Link>
            </Button>
            <h1 className="text-2xl font-semibold">Mortality 360</h1>
            {e && <Badge variant={statusBadgeVariant(e.status)}>{e.status}</Badge>}
            {!ctx.actionsEnabled && (
              <Badge variant="secondary" className="gap-1">
                <Lock className="h-3 w-3" /> Read-only pilot
              </Badge>
            )}
          </div>
          <p className="ml-11 mt-1 text-sm text-muted-foreground">
            {e?.eventReference ?? eventId} · {e?.deceased?.fullName ?? '—'}
          </p>
        </div>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="overview" className="gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Overview</TabsTrigger>
          <TabsTrigger value="deceased" className="gap-1.5"><User className="h-3.5 w-3.5" /> Deceased &amp; match</TabsTrigger>
          <TabsTrigger value="verification" className="gap-1.5"><ClipboardCheck className="h-3.5 w-3.5" /> Verification</TabsTrigger>
          <TabsTrigger value="awards" className="gap-1.5"><Wallet className="h-3.5 w-3.5" /> Awards &amp; impact</TabsTrigger>
          <TabsTrigger value="pad" className="gap-1.5"><Wallet className="h-3.5 w-3.5" /> Payments &amp; PAD</TabsTrigger>
          <TabsTrigger value="evidence" className="gap-1.5"><FileText className="h-3.5 w-3.5" /> Evidence</TabsTrigger>
          <TabsTrigger value="survivor" className="gap-1.5"><Gavel className="h-3.5 w-3.5" /> Survivor / funeral / legal</TabsTrigger>
          <TabsTrigger value="comms" className="gap-1.5"><Mail className="h-3.5 w-3.5" /> Communications</TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5"><History className="h-3.5 w-3.5" /> History &amp; audit</TabsTrigger>
          <TabsTrigger value="actions" className="gap-1.5"><Scale className="h-3.5 w-3.5" /> Actions</TabsTrigger>
        </TabsList>
        <div className="mt-4">
          <TabsContent value="overview"><Overview eventId={eventId} /></TabsContent>
          <TabsContent value="deceased"><DeceasedPersonMatchTab eventId={eventId} /></TabsContent>
          <TabsContent value="verification"><VerificationTab eventId={eventId} /></TabsContent>
          <TabsContent value="awards"><AwardsAndImpact eventId={eventId} /></TabsContent>
          <TabsContent value="pad"><PaymentsAndPad eventId={eventId} /></TabsContent>
          <TabsContent value="evidence"><EvidenceTab eventId={eventId} /></TabsContent>
          <TabsContent value="survivor"><SurvivorFuneralLegalTab eventId={eventId} /></TabsContent>
          <TabsContent value="comms"><CommunicationsTab eventId={eventId} /></TabsContent>
          <TabsContent value="history"><HistoryTab eventId={eventId} /></TabsContent>
          <TabsContent value="actions">
            <BnMortalityActionsPanel ctx={ctx} eventId={eventId} />
          </TabsContent>

        </div>
      </Tabs>
    </div>
  );
}

export default function BnMortalityDetailPage() {
  const { eventId } = useParams<{ eventId: string }>();
  return (
    <BnModuleRouteGate moduleCode="bn_mortality" requiredAction="view">
      {(ctx) => (
        <BnMortalityAuthState
          frame={
            <div className="p-6 pb-0 max-w-[1400px] mx-auto">
              <BnMortalityBreadcrumbs
                leaf={{ kind: 'detail', eventLabel: 'Mortality event' }}
              />
            </div>
          }
        >
          {eventId ? (
            <DetailContent ctx={ctx} eventId={eventId} />
          ) : (
            <div className="p-6 max-w-[1400px] mx-auto">
              <BnMortalityBreadcrumbs
                leaf={{ kind: 'detail', eventLabel: 'Event not found' }}
              />
              <Alert variant="destructive" className="mt-4">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Missing event id</AlertTitle>
                <AlertDescription>No mortality event id provided in the URL.</AlertDescription>
              </Alert>
            </div>
          )}
        </BnMortalityAuthState>
      )}
    </BnModuleRouteGate>
  );
}

