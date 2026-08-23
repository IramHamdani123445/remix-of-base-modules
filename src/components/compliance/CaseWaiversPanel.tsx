/**
 * Waiver tracking for a compliance case.
 *
 * The tester's "Request Waiver does nothing" observation was a visibility
 * problem: the request was created in `ce_waivers` but the case gave no
 * feedback afterwards. This panel makes the whole lifecycle visible on the
 * case — request, approval status, amounts and the decision history — and
 * links through to the approval queue.
 */
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BadgePercent, ExternalLink } from 'lucide-react';
import { listWaiverRequests, getWaiverDecisions, type WaiverRequest } from '@/services/waiverService';

const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'XCD', minimumFractionDigits: 2 }).format(n || 0);

const statusVariant = (s: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
  const u = (s || '').toUpperCase();
  if (u === 'REJECTED' || u === 'CANCELLED') return 'destructive';
  if (u === 'APPROVED' || u === 'APPLIED') return 'default';
  if (u.startsWith('PENDING')) return 'secondary';
  return 'outline';
};

export function CaseWaiversPanel({ caseId }: { caseId: string }) {
  const navigate = useNavigate();

  const { data: waivers = [], isLoading } = useQuery({
    queryKey: ['ce_case_waivers', caseId],
    queryFn: () => listWaiverRequests({ caseId, status: 'ALL' }),
    enabled: !!caseId,
  });

  const { data: decisions = [] } = useQuery({
    queryKey: ['ce_case_waiver_decisions', waivers.map((w: WaiverRequest) => w.id).join(',')],
    enabled: waivers.length > 0,
    queryFn: async () => {
      const all = await Promise.all(waivers.map((w: WaiverRequest) => getWaiverDecisions(w.id)));
      return all.flat() as Array<Record<string, any>>;
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BadgePercent className="h-4 w-4 text-primary" />
              Waiver Requests
            </CardTitle>
            <CardDescription>
              Every waiver raised from this case, its approval stage and the amount actually waived.
              Only penalty, interest and rule-permitted components can be waived — contribution
              principal is waivable only where a configured rule explicitly allows it.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate('/compliance/waivers/requests')}>
            <ExternalLink className="h-4 w-4 mr-1" />Approval Queue
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground">Loading waivers…</div>
        ) : waivers.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            No waiver requests for this case yet.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Waiver #</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>Approved</TableHead>
                <TableHead>Requested by</TableHead>
                <TableHead>Decision</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {waivers.map((w: WaiverRequest) => (
                <TableRow key={w.id}>
                  <TableCell className="font-mono text-xs">{w.waiver_number}</TableCell>
                  <TableCell>{w.waiver_type}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(w.status)}>{String(w.status).replace(/_/g, ' ')}</Badge>
                  </TableCell>
                  <TableCell>{money(Number(w.amount_requested ?? 0))}</TableCell>
                  <TableCell>{w.amount_approved == null ? '—' : money(Number(w.amount_approved))}</TableCell>
                  <TableCell className="text-xs">
                    {w.requested_by || '—'}
                    <div className="text-muted-foreground">{w.requested_at?.slice(0, 10)}</div>
                  </TableCell>
                  <TableCell className="max-w-[16rem] truncate text-xs">
                    {w.rejected_reason || w.approver_comments || w.reviewer_comments || '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {decisions.length > 0 && (
          <div>
            <h4 className="mb-2 text-sm font-medium">Decision history</h4>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {decisions
                .slice()
                .sort((a, b) => String(b.acted_at).localeCompare(String(a.acted_at)))
                .map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">{d.action}</Badge>
                    <span>
                      {d.from_status ? `${d.from_status} → ` : ''}
                      {d.to_status ?? ''}
                    </span>
                    <span>by {d.acted_by}</span>
                    <span>{String(d.acted_at ?? '').slice(0, 10)}</span>
                    {d.comments && <span className="truncate">· {d.comments}</span>}
                  </li>
                ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
