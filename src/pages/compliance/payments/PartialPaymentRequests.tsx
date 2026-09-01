import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import {
  listPartialPaymentRequests,
  type PartialPaymentRequest,
  type PartialPaymentStatus,
} from '@/services/partialPaymentService';
import { PartialPaymentApprovalDialog } from '@/components/compliance/payments/PartialPaymentApprovalDialog';
import { PartialPaymentRequestDialog } from '@/components/compliance/payments/PartialPaymentRequestDialog';
import { formatCurrency } from '@/utils/formatCurrency';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Info } from 'lucide-react';
import { useHasCapability } from '@/hooks/useHasCapability';
import { COMPLIANCE_CAPABILITIES } from '@/lib/compliance/capabilities';

const TABS: Array<{ value: PartialPaymentStatus | 'ALL'; label: string }> = [
  { value: 'PENDING_APPROVAL', label: 'Awaiting approval' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'SETTLED', label: 'Settled' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'ALL', label: 'All' },
];

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  PENDING_APPROVAL: 'secondary',
  APPROVED: 'default',
  SETTLED: 'default',
  REJECTED: 'destructive',
  EXPIRED: 'destructive',
  CANCELLED: 'outline',
  DRAFT: 'outline',
};

export default function PartialPaymentRequests() {
  const [status, setStatus] = useState<PartialPaymentStatus | 'ALL'>('PENDING_APPROVAL');
  const [selected, setSelected] = useState<PartialPaymentRequest | null>(null);
  const [creating, setCreating] = useState(false);
  const canRequest = useHasCapability(COMPLIANCE_CAPABILITIES.PARTIAL_PAYMENT_REQUEST);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['ce-pp-requests', status],
    queryFn: () => listPartialPaymentRequests({ status }),
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Partial payment requests</h1>
          <p className="text-muted-foreground">
            Employers who cannot settle a period in full request approval here. No partial payment may be
            posted until it is approved and a payment authority has been issued.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button onClick={() => setCreating(true)} disabled={!canRequest}>
            <Plus className="h-4 w-4 mr-2" /> New request
          </Button>
        </div>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Approving a partial payment issues a payment authority only. It does not extend the statutory
          payment deadline, and neither a pending request nor an approved authority suspends non-payment
          (DR-003) or partial-payment (DR-004) enforcement.
        </AlertDescription>
      </Alert>

      <Tabs value={status} onValueChange={(v) => setStatus(v as PartialPaymentStatus | 'ALL')}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle>Requests</CardTitle>
          <CardDescription>{data?.length ?? 0} record(s)</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Request</TableHead>
                <TableHead>Employer</TableHead>
                <TableHead>Wage period</TableHead>
                <TableHead className="text-right">Liability</TableHead>
                <TableHead className="text-right">Requested</TableHead>
                <TableHead className="text-right">Approved</TableHead>
                <TableHead>Authority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              )}
              {!isLoading && (data ?? []).length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No requests in this state.</TableCell></TableRow>
              )}
              {(data ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.request_number}</TableCell>
                  <TableCell>{r.employer_name ?? r.employer_id}</TableCell>
                  <TableCell>{format(new Date(r.wage_period), 'MMM yyyy')}</TableCell>
                  <TableCell className="text-right">{formatCurrency(r.total_liability)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(r.requested_amount)}</TableCell>
                  <TableCell className="text-right">
                    {r.approved_amount != null ? formatCurrency(r.approved_amount) : '—'}
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.authority_number ? (
                      <>
                        {r.authority_number}
                        <span className="block text-muted-foreground">
                          expires {r.authority_expires_on ? format(new Date(r.authority_expires_on), 'dd MMM yyyy') : '—'}
                        </span>
                      </>
                    ) : '—'}
                  </TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[r.status] ?? 'outline'}>{r.status.replace('_', ' ')}</Badge></TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setSelected(r)}>
                      {r.status === 'PENDING_APPROVAL' ? 'Review' : 'View'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <PartialPaymentApprovalDialog
        request={selected}
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
      />
      <PartialPaymentRequestDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
