import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Building2, FileText, Bell, ClipboardCheck, Shield, Clock, DollarSign,
  Users, AlertTriangle, Loader2, Eye, TrendingUp, Scale, ArrowLeft,
  Briefcase, MessageSquare, FolderOpen, Printer, Plus, Send, CalendarPlus,
  ChevronUp, StickyNote, Gavel, History, BookOpen,
} from 'lucide-react';
import { EmployerComplianceHistoryPanel } from '@/components/compliance/employer-history/EmployerComplianceHistoryPanel';
import { PaymentHistoryGroupedTable } from './PaymentHistoryGroupedTable';
import EmployerFinancialLedgerTab from './EmployerFinancialLedgerTab';
import {
  fetchEmployerMaster, fetchEmployerFiling, fetchEmployerArrears, fetchEmployerPayments,
  fetchEmployerLegal, fetchEmployerWorkforce, fetchEmployerRisk, fetchEmployerViolations,
  fetchEmployerNotices, fetchEmployerFollowUps, fetchEmployerTimeline,
} from '@/services/employer360Service';
import {
  fetchEmployerCases, fetchEmployerPaymentHistory, fetchEmployerCommunications,
  fetchEmployerDocuments, fetchEmployerArrangements, fetchEmployerBreaches,
} from '@/services/employer360ExtendedService';
import {
  useEmployerStatement, useEmployerArrears as useLedgerArrears,
} from '@/hooks/useComplianceLedger';
import {
  fetchEmployerExposure, fetchViolationFinancialsMap, formatComplianceCurrency,
} from '@/services/complianceViolationAmountService';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Info } from 'lucide-react';


const RISK_BAND_COLORS: Record<string, string> = {
  LOW: 'bg-green-500/15 text-green-700',
  MEDIUM: 'bg-yellow-500/15 text-yellow-700',
  HIGH: 'bg-orange-500/15 text-orange-700',
  CRITICAL: 'bg-destructive/15 text-destructive',
};

const STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-primary/10 text-primary',
  UNDER_REVIEW: 'bg-yellow-500/15 text-yellow-700',
  ESCALATED: 'bg-destructive/10 text-destructive',
  RESOLVED: 'bg-green-500/15 text-green-700',
  CLOSED: 'bg-muted text-muted-foreground',
  IN_PROGRESS: 'bg-blue-500/15 text-blue-700',
};

const EVENT_CATEGORY_COLORS: Record<string, string> = {
  VIOLATION: 'bg-destructive/10 text-destructive',
  NOTICE: 'bg-blue-500/15 text-blue-700',
  FOLLOW_UP: 'bg-orange-500/15 text-orange-700',
  RISK: 'bg-purple-500/15 text-purple-700',
  PAYMENT: 'bg-green-500/15 text-green-700',
};

const formatDate = (val: string | null) => {
  if (!val) return '—';
  try { return new Date(val).toLocaleDateString('en-GB'); } catch { return val; }
};

// Shared compliance currency formatter — never re-implement locally.
const formatCurrency = formatComplianceCurrency;


export default function Employer360() {
  const { employerId } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');

  // ── Core queries ──
  const { data: master, isLoading: loadingMaster } = useQuery({
    queryKey: ['employer360_master', employerId], queryFn: () => fetchEmployerMaster(employerId!), enabled: !!employerId,
  });
  const { data: filing } = useQuery({ queryKey: ['employer360_filing', employerId], queryFn: () => fetchEmployerFiling(employerId!), enabled: !!employerId });
  const { data: arrears } = useQuery({ queryKey: ['employer360_arrears', employerId], queryFn: () => fetchEmployerArrears(employerId!), enabled: !!employerId });
  const { data: payments } = useQuery({ queryKey: ['employer360_payments', employerId], queryFn: () => fetchEmployerPayments(employerId!), enabled: !!employerId });
  const { data: legal } = useQuery({ queryKey: ['employer360_legal', employerId], queryFn: () => fetchEmployerLegal(employerId!), enabled: !!employerId });
  const { data: workforce } = useQuery({ queryKey: ['employer360_workforce', employerId], queryFn: () => fetchEmployerWorkforce(employerId!), enabled: !!employerId });
  const { data: risk } = useQuery({ queryKey: ['employer360_risk', employerId], queryFn: () => fetchEmployerRisk(employerId!), enabled: !!employerId });
  const { data: violationsPage } = useQuery({ queryKey: ['employer360_violations', employerId], queryFn: () => fetchEmployerViolations(employerId!), enabled: !!employerId });
  const violations = violationsPage?.rows ?? [];
  const violationTotal = violationsPage?.total ?? 0;
  const violationsTruncated = violationsPage?.truncated ?? false;
  // Canonical, non-double-counting enforcement exposure (open cases + open unlinked violations).
  const { data: exposure } = useQuery({ queryKey: ['employer360_exposure', employerId], queryFn: () => fetchEmployerExposure(employerId!), enabled: !!employerId });
  // Money for the listed violations comes from the shared read layer, never recomputed here.
  const { data: violationFinancials = {} } = useQuery({
    queryKey: ['employer360_violation_financials', employerId, violations.map((v: any) => v.id).join(',')],
    queryFn: () => fetchViolationFinancialsMap(violations.map((v: any) => v.id)),
    enabled: violations.length > 0,
  });


  const { data: notices = [] } = useQuery({ queryKey: ['employer360_notices', employerId], queryFn: () => fetchEmployerNotices(employerId!), enabled: !!employerId });
  const { data: followUps = [] } = useQuery({ queryKey: ['employer360_followups', employerId], queryFn: () => fetchEmployerFollowUps(employerId!), enabled: !!employerId });
  const { data: timeline = [] } = useQuery({ queryKey: ['employer360_timeline', employerId], queryFn: () => fetchEmployerTimeline(employerId!), enabled: !!employerId });

  // ── Extended queries ──
  const { data: cases = [] } = useQuery({ queryKey: ['employer360_cases', employerId], queryFn: () => fetchEmployerCases(employerId!), enabled: !!employerId });
  const { data: paymentHistory = [] } = useQuery({ queryKey: ['employer360_payment_history', employerId], queryFn: () => fetchEmployerPaymentHistory(employerId!), enabled: !!employerId });
  const { data: communications = [] } = useQuery({ queryKey: ['employer360_comms', employerId], queryFn: () => fetchEmployerCommunications(employerId!), enabled: !!employerId });
  const { data: documents = [] } = useQuery({ queryKey: ['employer360_docs', employerId], queryFn: () => fetchEmployerDocuments(employerId!), enabled: !!employerId });
  const { data: arrangements = [] } = useQuery({ queryKey: ['employer360_arrangements', employerId], queryFn: () => fetchEmployerArrangements(employerId!), enabled: !!employerId });
  const { data: breaches = [] } = useQuery({ queryKey: ['employer360_breaches', employerId], queryFn: () => fetchEmployerBreaches(employerId!), enabled: !!employerId });

  // ── Ledger statement for embedded view ──
  const { data: ledgerStatement = [] } = useEmployerStatement(employerId);
  const { data: ledgerArrears = [] } = useLedgerArrears(employerId);

  if (loadingMaster) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!master) {
    return (
      <div className="container mx-auto p-6 text-center">
        <h2 className="text-2xl font-bold text-foreground">Employer not found</h2>
        <p className="text-muted-foreground mt-2">No employer record for ID: {employerId}</p>
        <Button onClick={() => navigate('/compliance/field/employer-360')} className="mt-4"><ArrowLeft className="h-4 w-4 mr-2" />Back to Search</Button>
      </div>
    );
  }

  // Open-violation count comes from a real count query, not the loaded page.
  const activeViolationCount = exposure?.open_violations ?? violationsPage?.openTotal ?? 0;
  const activeCases = cases.filter((c: any) => !['RESOLVED', 'CLOSED'].includes(c.status));
  const riskBand = risk?.override_band || risk?.risk_band || 'N/A';
  const totalLedgerArrears = ledgerArrears.reduce((sum, a) => sum + (a.net_balance || 0), 0);
  const activeArrangement = arrangements.find((a: any) => a.status === 'ACTIVE');
  // Enforcement exposure is resolved server-side by fn_ce_employer_financial_exposure:
  //   open case outstanding + open UNLINKED violation outstanding.
  // A case-linked violation is counted exactly once, through its case.
  // This is distinct from C3 arrears (dues vs payments in cn_c3_reported / cn_payment).
  const enforcementOutstanding = exposure?.enforcement_exposure ?? 0;
  const openCaseCount = exposure?.open_cases ?? activeCases.length;
  const c3Outstanding = arrears?.total_outstanding ?? 0;


  return (
    <div className="container mx-auto p-6 space-y-6">
      <PageHeader
        title={master.employer_name}
        subtitle={`Registration: ${employerId} | Office: ${master.office_code || '—'} | Status: ${master.status || '—'}`}
        breadcrumbs={[
          { label: 'Compliance', href: '/compliance' },
          { label: 'Employer 360°', href: '/compliance/field/employer-360' },
          { label: master.employer_name },
        ]}
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => navigate(`/compliance/field/employer-statement/${employerId}`)}>
              <Printer className="h-4 w-4 mr-1" />Statement
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate(`/compliance/field/visit/${employerId}`)}>
              <ClipboardCheck className="h-4 w-4 mr-1" />Visit Workspace
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate('/compliance/enforcement/notices', {
              state: { prefill: { employer_id: employerId, employer_name: master.employer_name } }
            })}>
              <Send className="h-4 w-4 mr-1" />Send Notice
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate('/compliance/violations/manual-entry', {
              state: { prefill: { employer_id: employerId, employer_name: master.employer_name } }
            })}>
              <AlertTriangle className="h-4 w-4 mr-1" />New Violation
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate(`/compliance/field/employer-risk/${employerId}`)}>
              <TrendingUp className="h-4 w-4 mr-1" />Risk Profile
            </Button>
            {/* Ledger is reachable via the Ledger tab below — the duplicate
                header shortcut was removed. */}

          </div>
        }
      />

      {/* Warning Banners */}
      {(arrears?.has_arrears || enforcementOutstanding > 0 || activeViolationCount > 0 || legal?.has_active_legal) && (
        <div className="space-y-2">
          {arrears?.has_arrears && (
            <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" />
              <span className="font-medium">C3 arrears: {formatCurrency(c3Outstanding)}</span>
              {activeArrangement && <Badge variant="outline" className="ml-2 text-xs">Payment arrangement active</Badge>}
            </div>
          )}
          {enforcementOutstanding > 0 && (
            <div className="flex items-center gap-2 p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg text-sm text-orange-700">
              <Briefcase className="h-4 w-4" />
              <span className="font-medium">Enforcement outstanding: {formatCurrency(enforcementOutstanding)}</span>
              <span className="text-xs text-muted-foreground">
                ({openCaseCount} open case{openCaseCount === 1 ? '' : 's'}
                {(exposure?.open_unlinked_violations ?? 0) > 0 &&
                  ` + ${exposure!.open_unlinked_violations} unlinked violation${exposure!.open_unlinked_violations === 1 ? '' : 's'}`})
              </span>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-sm text-xs">
                    Enforcement exposure = outstanding on open cases ({formatCurrency(exposure?.case_outstanding ?? 0)})
                    plus outstanding on open violations not linked to any case
                    ({formatCurrency(exposure?.unlinked_violation_outstanding ?? 0)}).
                    A violation attached to a case is counted once only, through its case roll-up.
                    Collections and approved waivers are already deducted.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          )}

          {legal?.has_active_legal && (
            <div className="flex items-center gap-2 p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg text-sm text-orange-700">
              <Gavel className="h-4 w-4" />
              <span className="font-medium">Active legal proceedings ({(legal.active_suit_count || 0) + (legal.active_escalation_count || 0)})</span>
            </div>
          )}
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-9 gap-3">
        {[
          { label: 'Risk', content: <Badge className={`${RISK_BAND_COLORS[riskBand] || 'bg-muted text-muted-foreground'}`}>{riskBand}</Badge> },
          { label: 'C3 Arrears', content: <span className="text-xs font-bold text-destructive">{formatCurrency(c3Outstanding)}</span> },
          { label: 'Enforcement', content: <span className="text-xs font-bold text-orange-600">{formatCurrency(enforcementOutstanding)}</span> },
          { label: 'Violations', content: <span className="text-xl font-bold">{activeViolationCount}</span> },
          { label: 'Cases', content: <span className="text-xl font-bold">{openCaseCount}</span> },
          { label: 'Missed Filings', content: <span className="text-xl font-bold">{filing?.missed_filings_12m ?? '—'}</span> },
          { label: 'Workforce', content: <span className="text-lg font-bold">{workforce?.registered_total ?? '—'}</span> },
          { label: 'Paid YTD', content: <span className="text-xs font-bold text-green-600">{formatCurrency(payments?.total_amount_12m ?? 0)}</span> },
          { label: 'Legal', content: <span className="text-xl font-bold">{(legal?.active_suit_count ?? 0) + (legal?.active_escalation_count ?? 0)}</span> },
        ].map((kpi, i) => (
          <Card key={i}>
            <CardContent className="p-3 flex flex-col items-center justify-center text-center min-h-[72px]">
              <div className="text-[11px] text-muted-foreground leading-tight mb-1">{kpi.label}</div>
              <div className="w-full flex justify-center">{kpi.content}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="overview"><Building2 className="h-3.5 w-3.5 mr-1" />Overview</TabsTrigger>
          <TabsTrigger value="financial"><DollarSign className="h-3.5 w-3.5 mr-1" />Financials</TabsTrigger>
          <TabsTrigger value="violations"><AlertTriangle className="h-3.5 w-3.5 mr-1" />Violations ({violationTotal})</TabsTrigger>
          <TabsTrigger value="cases"><Briefcase className="h-3.5 w-3.5 mr-1" />Cases ({cases.length})</TabsTrigger>
          <TabsTrigger value="payments"><DollarSign className="h-3.5 w-3.5 mr-1" />Payments</TabsTrigger>
          <TabsTrigger value="statement"><FileText className="h-3.5 w-3.5 mr-1" />Statement</TabsTrigger>
          <TabsTrigger value="ledger"><BookOpen className="h-3.5 w-3.5 mr-1" />Ledger</TabsTrigger>
          <TabsTrigger value="communications"><MessageSquare className="h-3.5 w-3.5 mr-1" />Comms ({communications.length})</TabsTrigger>
          <TabsTrigger value="documents"><FolderOpen className="h-3.5 w-3.5 mr-1" />Docs ({documents.length})</TabsTrigger>
          <TabsTrigger value="timeline"><Clock className="h-3.5 w-3.5 mr-1" />Timeline</TabsTrigger>
          <TabsTrigger value="history"><History className="h-3.5 w-3.5 mr-1" />History</TabsTrigger>
        </TabsList>

        {/* ═══ OVERVIEW TAB ═══ */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-sm">Registration Details</CardTitle></CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Registration #</span><span className="font-medium font-mono">{employerId}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Name</span><span className="font-medium">{master.employer_name}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Status</span><Badge variant="outline">{master.status || '—'}</Badge></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Office</span><span className="font-medium">{master.office_code || '—'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Village</span><span className="font-medium">{master.village_code || '—'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Registered</span><span className="font-medium">{formatDate(master.registration_date)}</span></div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Workforce</CardTitle></CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Males</span><span className="font-medium">{workforce?.registered_males ?? master.males_employed ?? '—'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Females</span><span className="font-medium">{workforce?.registered_females ?? master.females_employed ?? '—'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="font-bold">{workforce?.registered_total ?? '—'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Last Reported</span><span className="font-medium">{workforce?.last_reported_employees ?? '—'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Delta</span>
                  <span className={`font-bold ${(workforce?.employee_delta ?? 0) < 0 ? 'text-destructive' : 'text-green-600'}`}>
                    {workforce?.employee_delta != null ? (workforce.employee_delta > 0 ? '+' : '') + workforce.employee_delta : '—'}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-sm">Filing Status (12 months)</CardTitle></CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Total Filings</span><span className="font-medium">{filing?.total_filings_12m ?? '—'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Missed</span><span className={`font-bold ${(filing?.missed_filings_12m ?? 0) > 0 ? 'text-destructive' : ''}`}>{filing?.missed_filings_12m ?? '—'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Last Filed</span><span className="font-medium">{formatDate(filing?.last_filing_date ?? null)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Current?</span><Badge variant={filing?.is_current ? 'default' : 'destructive'}>{filing?.is_current ? 'Yes' : 'No'}</Badge></div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Risk Profile</CardTitle></CardHeader>
              <CardContent>
                {!risk ? <p className="text-sm text-muted-foreground">No risk profile</p> : (
                  <div className="flex items-center gap-4">
                    <div className="text-center">
                      <div className="text-3xl font-bold">{risk.total_score?.toFixed(1) ?? '—'}</div>
                      <Badge className={`mt-1 ${RISK_BAND_COLORS[riskBand] || ''}`}>{riskBand}</Badge>
                    </div>
                    <div className="flex-1 grid grid-cols-5 gap-2">
                      {[
                        { label: 'Arr', score: risk.arrears_score },
                        { label: 'Viol', score: risk.violation_score },
                        { label: 'File', score: risk.filing_score },
                        { label: 'Pay', score: risk.payment_behavior_score },
                        { label: 'Leg', score: risk.legal_history_score },
                      ].map(d => (
                        <div key={d.label} className="text-center p-1.5 bg-muted/50 rounded">
                          <div className="text-sm font-bold">{d.score?.toFixed(0) ?? '—'}</div>
                          <div className="text-[9px] text-muted-foreground">{d.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ═══ FINANCIAL TAB ═══ */}
        <TabsContent value="financial" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            <Card>
              <CardContent className="pt-6">
                <p className="text-xs text-muted-foreground">C3 Outstanding</p>
                <p className="text-2xl font-bold text-destructive">{formatCurrency(c3Outstanding)}</p>
                <p className="text-[10px] text-muted-foreground mt-1">C3 dues − payments (+ C3 penalty)</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-xs text-muted-foreground">Enforcement Outstanding</p>
                <p className="text-2xl font-bold text-orange-600">{formatCurrency(enforcementOutstanding)}</p>
                <p className="text-[10px] text-muted-foreground mt-1">Open cases · principal + penalty − collected</p>
              </CardContent>
            </Card>
            <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">C3 Current Arrears</p><p className="text-2xl font-bold">{formatCurrency(arrears?.current_arrears ?? 0)}</p></CardContent></Card>
            <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">C3 Penalties</p><p className="text-2xl font-bold text-orange-600">{formatCurrency(arrears?.current_penalty ?? 0)}</p></CardContent></Card>
            <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Paid (12m)</p><p className="text-2xl font-bold text-green-600">{formatCurrency(payments?.total_amount_12m ?? 0)}</p></CardContent></Card>
          </div>
          {/* Arrears by Fund */}
          {ledgerArrears.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Arrears by Fund</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fund</TableHead>
                      <TableHead className="text-right">Principal</TableHead>
                      <TableHead className="text-right">Penalties</TableHead>
                      <TableHead className="text-right">Interest</TableHead>
                      <TableHead className="text-right">Payments</TableHead>
                      <TableHead className="text-right font-bold">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ledgerArrears.map(a => (
                      <TableRow key={a.fund_type}>
                        <TableCell><Badge variant="outline">{a.fund_type}</Badge></TableCell>
                        <TableCell className="text-right font-mono text-sm">{formatCurrency(a.principal_due)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-orange-600">{formatCurrency(a.penalties)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{formatCurrency(a.interest)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-green-600">{formatCurrency(a.payments)}</TableCell>
                        <TableCell className="text-right font-mono text-sm font-bold text-destructive">{formatCurrency(a.net_balance)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-bold bg-muted">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(ledgerArrears.reduce((s, a) => s + a.principal_due, 0))}</TableCell>
                      <TableCell className="text-right font-mono text-orange-600">{formatCurrency(ledgerArrears.reduce((s, a) => s + a.penalties, 0))}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(ledgerArrears.reduce((s, a) => s + a.interest, 0))}</TableCell>
                      <TableCell className="text-right font-mono text-green-600">{formatCurrency(ledgerArrears.reduce((s, a) => s + a.payments, 0))}</TableCell>
                      <TableCell className="text-right font-mono text-destructive">{formatCurrency(totalLedgerArrears)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
          {/* Arrangement */}
          {activeArrangement && (
            <Card className="border-primary/30">
              <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Scale className="h-4 w-4" />Active Payment Arrangement</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div><p className="text-xs text-muted-foreground">Arrangement #</p><p className="font-medium">{activeArrangement.arrangement_number}</p></div>
                <div><p className="text-xs text-muted-foreground">Total Debt</p><p className="font-medium">{formatCurrency(activeArrangement.total_debt)}</p></div>
                <div><p className="text-xs text-muted-foreground">Paid</p><p className="font-medium text-green-600">{formatCurrency(activeArrangement.total_paid)}</p></div>
                <div><p className="text-xs text-muted-foreground">Remaining</p><p className="font-medium text-destructive">{formatCurrency((activeArrangement.total_debt || 0) - (activeArrangement.total_paid || 0))}</p></div>
              </CardContent>
            </Card>
          )}
          <Button variant="outline" onClick={() => navigate(`/compliance/field/employer-statement/${employerId}`)}>
            <FileText className="h-4 w-4 mr-2" />View Full Financial Statement
          </Button>
        </TabsContent>

        {/* ═══ VIOLATIONS TAB ═══ */}
        <TabsContent value="violations">
          <Card>
            <CardHeader>
              <CardTitle>Violations ({violationTotal})</CardTitle>
              {violationsTruncated && (
                <p className="text-xs text-muted-foreground">
                  Showing the {violations.length} most recent of {violationTotal} violations.
                  Open the Violations register for the full list.
                </p>
              )}
            </CardHeader>
            <CardContent>
              {violations.length === 0 ? <div className="text-center py-8 text-muted-foreground">No violations on record</div> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Violation #</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">Waived</TableHead>
                      <TableHead className="text-right">Outstanding</TableHead>
                      <TableHead>Created</TableHead><TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {violations.map((v: any) => {
                      const f = violationFinancials[v.id];
                      return (
                      <TableRow key={v.id}>
                        <TableCell className="font-mono text-xs">{v.violation_number}</TableCell>
                        <TableCell className="text-xs">{v.ce_violation_types?.name || '—'}</TableCell>
                        <TableCell><Badge className={`text-xs ${STATUS_COLORS[v.status] || ''}`}>{v.status?.replace(/_/g, ' ')}</Badge></TableCell>
                        <TableCell className="text-xs">{v.priority}</TableCell>
                        <TableCell className="text-xs text-right">{formatCurrency(f?.gross ?? null)}</TableCell>
                        <TableCell className="text-xs text-right">{formatCurrency(f?.waived ?? null)}</TableCell>
                        <TableCell className="text-xs text-right font-medium">{formatCurrency(f?.outstanding ?? null)}</TableCell>
                        <TableCell className="text-xs">{formatDate(v.created_at)}</TableCell>
                        <TableCell><Button size="sm" variant="ghost" onClick={() => navigate(`/compliance/violations/${v.id}`)}><Eye className="h-3.5 w-3.5" /></Button></TableCell>
                      </TableRow>
                    );})}
                  </TableBody>

                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ CASES TAB ═══ */}
        <TabsContent value="cases">
          <Card>
            <CardHeader><CardTitle>Compliance Cases ({cases.length})</CardTitle></CardHeader>
            <CardContent>
              {cases.length === 0 ? <div className="text-center py-8 text-muted-foreground">No compliance cases</div> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Case #</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead>
                      <TableHead>Priority</TableHead><TableHead>Created</TableHead><TableHead>Resolved</TableHead><TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cases.map((c: any) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono text-xs">{c.case_number}</TableCell>
                        <TableCell className="text-xs">{(c.case_type || '').replace(/_/g, ' ')}</TableCell>
                        <TableCell><Badge className={`text-xs ${STATUS_COLORS[c.status] || ''}`}>{c.status?.replace(/_/g, ' ')}</Badge></TableCell>
                        <TableCell className="text-xs">{c.priority}</TableCell>
                        <TableCell className="text-xs">{formatDate(c.created_at)}</TableCell>
                        <TableCell className="text-xs">{formatDate(c.resolved_at)}</TableCell>
                        <TableCell><Button size="sm" variant="ghost" onClick={() => navigate(`/compliance/cases/${c.id}`)}><Eye className="h-3.5 w-3.5" /></Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ PAYMENTS TAB ═══ */}
        <TabsContent value="payments">
          <Card>
            <CardHeader>
              <CardTitle>Payment History</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                One row per payment transaction. Use <span className="font-medium">View Details</span> to see the fund-level breakdown (contribution, penalty, interest, fees).
              </p>
            </CardHeader>
            <CardContent>
              {paymentHistory.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No payment records found for this employer in either the cashier system or the compliance ledger.
                </div>
              ) : (
                <PaymentHistoryGroupedTable rows={paymentHistory as any[]} />
              )}
            </CardContent>
          </Card>
        </TabsContent>





        {/* ═══ STATEMENT TAB (embedded preview) ═══ */}
        <TabsContent value="statement" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm">Ledger Preview (last 20 entries)</CardTitle>
              <Button size="sm" onClick={() => navigate(`/compliance/field/employer-statement/${employerId}`)}>
                <Eye className="h-4 w-4 mr-1" />Full Statement
              </Button>
            </CardHeader>
            <CardContent>
              {(() => {
                // Prefer posted ledger entries. Fall back to cashier receipts +
                // outstanding arrears when the formal ledger has not been
                // materialised yet, so the Statement view always reflects real
                // financial activity captured elsewhere in the system.
                type StatementRow = {
                  key: string;
                  posted_at: string | null;
                  period: string | null;
                  fund_type: string | null;
                  entry_type: string;
                  debit: number;
                  credit: number;
                  balance: number | null;
                  source: 'LEDGER' | 'CASHIER' | 'ARREARS';
                };

                let rows: StatementRow[] = [];
                if (ledgerStatement.length > 0) {
                  rows = ledgerStatement.slice(0, 20).map((e) => ({
                    key: e.entry_id,
                    posted_at: e.posted_at,
                    period: e.period,
                    fund_type: e.fund_type,
                    entry_type: e.entry_type.replace(/_/g, ' '),
                    debit: e.debit_amount || 0,
                    credit: e.credit_amount || 0,
                    balance: e.running_balance,
                    source: 'LEDGER',
                  }));
                } else {
                  const receiptRows: StatementRow[] = (paymentHistory as any[])
                    .filter((p) => (p.credit_amount || 0) > 0)
                    .slice(0, 20)
                    .map((p) => ({
                      key: p.id,
                      posted_at: p.posted_at,
                      period: p.period ? String(p.period).slice(0, 10) : null,
                      fund_type: p.fund_type,
                      entry_type: `PAYMENT · ${p.source}`,
                      debit: 0,
                      credit: p.credit_amount || 0,
                      balance: null,
                      source: p.source === 'CASHIER' ? 'CASHIER' : 'LEDGER',
                    }));
                  const arrearsRows: StatementRow[] = (ledgerArrears as any[])
                    .filter((a) => (a.net_balance || 0) > 0)
                    .map((a, idx) => ({
                      key: `AR-${a.fund_type}-${idx}`,
                      posted_at: null,
                      period: null,
                      fund_type: a.fund_type,
                      entry_type: `OUTSTANDING BALANCE (${a.period_count} periods)`,
                      debit: a.net_balance || 0,
                      credit: 0,
                      balance: a.net_balance || 0,
                      source: 'ARREARS',
                    }));
                  rows = [...receiptRows, ...arrearsRows];
                }

                if (rows.length === 0) {
                  return (
                    <div className="text-center py-8 text-muted-foreground">
                      No ledger, cashier, or outstanding balance activity recorded for this employer.
                    </div>
                  );
                }

                return (
                  <>
                    {ledgerStatement.length === 0 && (
                      <div className="mb-3 text-xs text-muted-foreground italic">
                        Ledger not yet posted — showing cashier receipts and outstanding balances as a preview.
                      </div>
                    )}
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead><TableHead>Period</TableHead><TableHead>Fund</TableHead>
                          <TableHead>Type</TableHead><TableHead className="text-right">Debit</TableHead>
                          <TableHead className="text-right">Credit</TableHead><TableHead className="text-right">Balance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((r) => (
                          <TableRow key={r.key}>
                            <TableCell className="text-xs">{r.posted_at ? formatDate(r.posted_at) : '—'}</TableCell>
                            <TableCell className="font-mono text-xs">{r.period || '—'}</TableCell>
                            <TableCell>{r.fund_type ? <Badge variant="outline" className="text-[10px]">{r.fund_type}</Badge> : '—'}</TableCell>
                            <TableCell className="text-xs">{r.entry_type}</TableCell>
                            <TableCell className="text-right font-mono text-xs text-destructive">{r.debit > 0 ? formatCurrency(r.debit) : '—'}</TableCell>
                            <TableCell className="text-right font-mono text-xs text-green-600">{r.credit > 0 ? formatCurrency(r.credit) : '—'}</TableCell>
                            <TableCell className="text-right font-mono text-xs font-medium">{r.balance != null ? formatCurrency(r.balance) : '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </>
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ LEDGER (PASSBOOK) TAB ═══ */}
        <TabsContent value="ledger" className="space-y-4">
          <EmployerFinancialLedgerTab employerId={employerId!} />
        </TabsContent>

        {/* ═══ COMMUNICATIONS TAB ═══ */}
        <TabsContent value="communications">
          <Card>
            <CardHeader><CardTitle>Communications ({communications.length})</CardTitle></CardHeader>
            <CardContent>
              {communications.length === 0 ? <div className="text-center py-8 text-muted-foreground">No communications recorded</div> : (
                <div className="space-y-3">
                  {communications.map((c: any) => (
                    <div key={c.id} className="flex items-start gap-3 p-3 border rounded-lg">
                      <div className={`p-1.5 rounded ${c.source === 'NOTICE' ? 'bg-blue-500/15' : 'bg-primary/10'}`}>
                        {c.source === 'NOTICE' ? <Bell className="h-4 w-4 text-blue-600" /> : <MessageSquare className="h-4 w-4 text-primary" />}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{c.title}</span>
                          <Badge variant="outline" className="text-[10px]">{c.source}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{c.detail}</p>
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(c.date)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ DOCUMENTS TAB ═══ */}
        <TabsContent value="documents">
          <Card>
            <CardHeader><CardTitle>Documents ({documents.length})</CardTitle></CardHeader>
            <CardContent>
              {documents.length === 0 ? <div className="text-center py-8 text-muted-foreground">No documents</div> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Document</TableHead><TableHead>Type</TableHead><TableHead>Uploaded</TableHead>
                      <TableHead>By</TableHead><TableHead>Confidential</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {documents.map((d: any) => (
                      <TableRow key={d.id}>
                        <TableCell className="text-sm font-medium">{d.title || d.file_name}</TableCell>
                        <TableCell className="text-xs">{(d.document_type || '').replace(/_/g, ' ')}</TableCell>
                        <TableCell className="text-xs">{formatDate(d.created_at)}</TableCell>
                        <TableCell className="text-xs">{d.uploaded_by_name || '—'}</TableCell>
                        <TableCell>{d.is_confidential ? <Badge variant="destructive" className="text-xs">Yes</Badge> : <span className="text-xs text-muted-foreground">No</span>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ TIMELINE TAB ═══ */}
        <TabsContent value="timeline">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5" />Activity Timeline</CardTitle></CardHeader>
            <CardContent>
              {timeline.length === 0 ? <div className="text-center py-8 text-muted-foreground">No activity recorded</div> : (
                <div className="relative">
                  <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />
                  <div className="space-y-4">
                    {timeline.map((event, idx) => (
                      <div key={`${event.reference_id}-${idx}`} className="relative pl-10">
                        <div className="absolute left-2.5 top-1.5 w-3 h-3 rounded-full border-2 border-background bg-primary" />
                        <div className="p-3 border rounded-lg bg-card">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <Badge className={`text-[10px] ${EVENT_CATEGORY_COLORS[event.event_category] || ''}`}>{event.event_category}</Badge>
                              {event.status && <Badge variant="outline" className="text-[10px]">{event.status}</Badge>}
                            </div>
                            <span className="text-xs text-muted-foreground">{formatDate(event.event_date)}</span>
                          </div>
                          <p className="text-sm font-medium text-foreground">{event.title}</p>
                          {event.description && <p className="text-xs text-muted-foreground mt-0.5">{event.description}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          {employerId && <EmployerComplianceHistoryPanel employerId={employerId} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}
