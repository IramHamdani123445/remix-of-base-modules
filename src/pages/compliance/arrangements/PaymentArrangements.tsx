import { useEffect, useMemo, useState } from 'react';
import { ArrangementDetailPanel } from '@/components/compliance/ArrangementDetailPanel';
import { PageHeader } from '@/components/shared/PageHeader';
import { ComplianceHelpButton } from '@/components/help/ComplianceHelpButton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Eye, Loader2, Info, Search, AlertTriangle } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useRegnoParam } from '@/hooks/useRegnoParam';
import { EmployerLinkChip, RegnoFilterBanner } from '@/components/compliance/EmployerLinkChip';
import ReferToLegalButton from '@/components/legal/lg/ReferToLegalButton';
import { fetchArrangementRegister } from '@/services/compliance/arrangementRegisterService';
import {
  formatXCD,
  ArrangementHealthBadge,
  arrangementStatusClass,
} from '@/components/compliance/arrangements/arrangementFormat';
import { formatDateForDisplay } from '@/lib/format-config';

const STATUS_FILTERS = ['ALL', 'DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'COMPLETED', 'DEFAULTED', 'SUPERSEDED'];
const HEALTH_FILTERS = ['ALL', 'HEALTHY', 'AT_RISK', 'BREACHED'];

export default function PaymentArrangements() {
  const navigate = useNavigate();
  const { regno } = useRegnoParam();
  const [searchParams, setSearchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [healthFilter, setHealthFilter] = useState<string>('ALL');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedArrangementId, setSelectedArrangementId] = useState<string | null>(
    () => searchParams.get('arr'),
  );

  // Keep URL <-> state in sync so a deep link like ?arr=<id> auto-opens the detail
  // and closing the detail cleans the query param.
  useEffect(() => {
    const urlArr = searchParams.get('arr');
    if (urlArr !== selectedArrangementId) {
      setSelectedArrangementId(urlArr);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const { data: register = [], isLoading } = useQuery({
    queryKey: ['ce_v_arrangement_register'],
    queryFn: fetchArrangementRegister,
  });

  const arrangements = useMemo(() => {
    const term = search.trim().toLowerCase();
    return register.filter((a) => {
      if (regno && a.employer_id !== regno) return false;
      if (statusFilter !== 'ALL' && a.status !== statusFilter) return false;
      if (healthFilter !== 'ALL' && a.health_status !== healthFilter) return false;
      if (overdueOnly && Number(a.overdue_count ?? 0) === 0) return false;
      if (term) {
        const hay = `${a.arrangement_number ?? ''} ${a.employer_name ?? ''} ${a.employer_id ?? ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [register, regno, statusFilter, healthFilter, overdueOnly, search]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (selectedArrangementId) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <PageHeader
          title="Arrangement Detail"
          subtitle="Operational view for compliance officers"
          breadcrumbs={[
            { label: 'Compliance', href: '/compliance/dashboard' },
            { label: 'Payment Arrangements', href: '/compliance/enforcement/arrangements' },
            { label: 'Detail' },
          ]}
        />
        <ArrangementDetailPanel
          arrangementId={selectedArrangementId}
          onBack={() => {
            setSelectedArrangementId(null);
            if (searchParams.get('arr')) {
              const next = new URLSearchParams(searchParams);
              next.delete('arr');
              setSearchParams(next, { replace: true });
            }
          }}
        />
      </div>
    );
  }

  const activeCount = arrangements.filter((a) => a.status === 'ACTIVE').length;
  const defaultedCount = arrangements.filter((a) => a.status === 'DEFAULTED').length;
  const breachedCount = arrangements.filter((a) => a.health_status === 'BREACHED' && a.status !== 'DEFAULTED').length;
  const totalOutstanding = arrangements.reduce((s, a) => s + Number(a.outstanding ?? 0), 0);
  const totalPastDue = arrangements.reduce((s, a) => s + Number(a.past_due_amount ?? 0), 0);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <PageHeader
        title="Payment Arrangements"
        subtitle="Operational register — schedule adherence, arrears and default visibility"
        breadcrumbs={[
          { label: 'Compliance', href: '/compliance/dashboard' },
          { label: 'Payment Arrangements' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <ComplianceHelpButton screenKey="arrangements" />
            <ReferToLegalButton
              module="compliance"
              employerId={regno ?? null}
              reasonCode="PAYMENT_ARRANGEMENT_DEFAULT"
              label="Refer Default to Legal"
            />
          </div>
        }
      />

      <RegnoFilterBanner />

      {/* KPI cards */}
      <div className="grid gap-4 md:grid-cols-6">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-foreground">{arrangements.length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-medium text-muted-foreground">Active</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-success">{activeCount}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-medium text-muted-foreground">Breached</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-warning-foreground">{breachedCount}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-medium text-muted-foreground">Defaulted</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-destructive">{defaultedCount}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-medium text-muted-foreground">Outstanding</CardTitle></CardHeader>
          <CardContent><div className="text-xl font-bold text-foreground">{formatXCD(totalOutstanding)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-medium text-muted-foreground">Past Due</CardTitle></CardHeader>
          <CardContent><div className="text-xl font-bold text-destructive">{formatXCD(totalPastDue)}</div></CardContent>
        </Card>
      </div>

      {/* Creation guidance */}
      <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg border text-sm text-muted-foreground">
        <Info className="h-4 w-4 shrink-0" />
        <span>
          Payment arrangements are created from individual{' '}
          <Button variant="link" className="h-auto p-0 text-sm" onClick={() => navigate('/compliance/cases')}>
            Compliance Cases
          </Button>
          . Open a case and use the "Create Payment Arrangement" action.
        </span>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Filters</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search arrangement # or employer"
              className="pl-8"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {STATUS_FILTERS.map((s) => (
              <Button key={s} variant={statusFilter === s ? 'default' : 'outline'} size="sm" onClick={() => setStatusFilter(s)}>
                {s === 'ALL' ? 'All statuses' : s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
              </Button>
            ))}
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            {HEALTH_FILTERS.map((h) => (
              <Button key={h} variant={healthFilter === h ? 'default' : 'outline'} size="sm" onClick={() => setHealthFilter(h)}>
                {h === 'ALL' ? 'All health' : h.replace('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
              </Button>
            ))}
            <Button
              variant={overdueOnly ? 'destructive' : 'outline'}
              size="sm"
              onClick={() => setOverdueOnly((v) => !v)}
            >
              <AlertTriangle className="h-3.5 w-3.5 mr-1" />
              Overdue only
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Arrangements Table */}
      <Card>
        <CardHeader><CardTitle>Payment Arrangements</CardTitle></CardHeader>
        <CardContent>
          {arrangements.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No arrangements match the current filters</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Arrangement #</TableHead>
                    <TableHead>Employer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Arranged</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead className="text-center">Installments</TableHead>
                    <TableHead>Next due</TableHead>
                    <TableHead className="text-center">Overdue</TableHead>
                    <TableHead className="text-right">Past due</TableHead>
                    <TableHead className="text-center">Health</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {arrangements.map((arr) => (
                    <TableRow
                      key={arr.arrangement_id}
                      tabIndex={0}
                      role="button"
                      aria-label={`Open arrangement ${arr.arrangement_number}`}
                      className={`cursor-pointer ${
                        arr.status === 'DEFAULTED'
                          ? 'bg-destructive/5'
                          : arr.health_status === 'BREACHED'
                            ? 'bg-warning/5'
                            : ''
                      }`}
                      onClick={(e) => {
                        // Ignore clicks that originate from interactive controls inside the row
                        if ((e.target as HTMLElement).closest('a,button,input,select,[role="button"][data-interactive]')) return;
                        setSelectedArrangementId(arr.arrangement_id);
                      }}
                      onKeyDown={(e) => {
                        if (e.target !== e.currentTarget) return;
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedArrangementId(arr.arrangement_id);
                        }
                      }}
                    >
                      <TableCell className="font-medium">{arr.arrangement_number}</TableCell>
                      <TableCell>
                        <EmployerLinkChip regno={arr.employer_id ?? ''} name={arr.employer_name ?? undefined} />
                      </TableCell>
                      <TableCell>
                        <Badge className={arrangementStatusClass(arr.status)}>{arr.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{formatXCD(arr.total_arranged)}</TableCell>
                      <TableCell className="text-right text-success">{formatXCD(arr.total_paid)}</TableCell>
                      <TableCell className="text-right font-semibold">{formatXCD(arr.outstanding)}</TableCell>
                      <TableCell className="text-center text-xs">
                        {arr.installments_paid}/{arr.installments_total}
                        {arr.installments_partial > 0 && (
                          <span className="block text-muted-foreground">{arr.installments_partial} partial</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {arr.next_due_date ? formatDateForDisplay(arr.next_due_date) : '—'}
                        {arr.next_installment_amount != null && arr.next_due_date && (
                          <span className="block text-muted-foreground">{formatXCD(arr.next_installment_amount)}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {Number(arr.overdue_count) > 0 ? (
                          <span className="text-destructive font-semibold">{arr.overdue_count}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {Number(arr.past_due_amount) > 0 ? (
                          <span className="text-destructive font-medium">{formatXCD(arr.past_due_amount)}</span>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-center">
                        <ArrangementHealthBadge health={arr.health_status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedArrangementId(arr.arrangement_id)}
                          title="View arrangement details"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
