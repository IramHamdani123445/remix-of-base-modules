/**
 * Generic request queue for CLOSURE / REOPEN / MERGE.
 * Used by CaseClosure, ReopenRequests, CaseMergeReview pages.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/shared/PageHeader';
import { PermissionWrapper } from '@/components/ui/permission-wrapper';
import { PermissionButton } from '@/components/ui/permission-button';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, CheckCircle, XCircle, ExternalLink, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useUserCode } from '@/hooks/useUserCode';
import {
  listCaseRequests, reviewCaseRequest,
  type CaseRequestRow, type CaseRequestStatus, type CaseRequestType,
} from '@/services/caseRequestsService';
import { isComplianceFeatureEnabled, type ComplianceFeatureKey } from '@/lib/compliance/featureToggles';

const MODULE = 'manage_compliance';

interface Props {
  title: string;
  description: string;
  icon: LucideIcon;
  type: CaseRequestType;
  featureKey: ComplianceFeatureKey;
}

const STATUSES: CaseRequestStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];

const CaseRequestsQueue = ({ title, description, icon, type, featureKey }: Props) => {
  const enabled = isComplianceFeatureEnabled(featureKey);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { userCode } = useUserCode();
  const [tab, setTab] = useState<CaseRequestStatus>('PENDING');
  const [reviewing, setReviewing] = useState<CaseRequestRow | null>(null);
  const [approve, setApprove] = useState(true);
  const [notes, setNotes] = useState('');

  const { data = [], isLoading } = useQuery({
    queryKey: ['ce_case_requests', type, tab],
    queryFn: () => listCaseRequests(type, tab),
    enabled,
  });

  const reviewMut = useMutation({
    mutationFn: () => reviewCaseRequest({
      id: reviewing!.id,
      approve,
      reviewedBy: userCode || 'UNKNOWN',
      notes,
    }),
    onSuccess: () => {
      toast.success(`Request ${approve ? 'approved' : 'rejected'}`);
      qc.invalidateQueries({ queryKey: ['ce_case_requests'] });
      qc.invalidateQueries({ queryKey: ['ce_cases'] });
      setReviewing(null); setNotes('');
    },
    onError: (e: any) => toast.error(e.message || 'Review failed'),
  });

  if (!enabled) {
    return (
      <PermissionWrapper moduleName={MODULE}>
        <div className="container mx-auto p-6">
          <PageHeader title={title} subtitle={description} />
          <Card><CardContent className="py-12 text-center text-muted-foreground">This feature is disabled in configuration.</CardContent></Card>
        </div>
      </PermissionWrapper>
    );
  }

  return (
    <PermissionWrapper moduleName={MODULE}>
      <div className="container mx-auto p-6 space-y-6">
        <PageHeader title={title} subtitle={description} />

        <Tabs value={tab} onValueChange={(v) => setTab(v as CaseRequestStatus)}>
          <TabsList>
            {STATUSES.map((s) => <TabsTrigger key={s} value={s}>{s}</TabsTrigger>)}
          </TabsList>

          {STATUSES.map((s) => (
            <TabsContent key={s} value={s}>
              <Card>
                <CardContent className="p-0">
                  {isLoading ? (
                    <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
                  ) : data.length === 0 ? (
                    <div className="py-16 text-center text-muted-foreground">No {s.toLowerCase()} {type.toLowerCase()} requests</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Case</TableHead>
                          <TableHead>Employer</TableHead>
                          {type === 'MERGE' && <TableHead>Target Case</TableHead>}
                          <TableHead>Reason</TableHead>
                          <TableHead>Requested By</TableHead>
                          <TableHead>Requested</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="font-mono text-xs">{r.case_number}</TableCell>
                            <TableCell>{r.employer_name}</TableCell>
                            {type === 'MERGE' && (
                              <TableCell className="text-xs">
                                {r.target_case_number ? (
                                  <span className="font-mono">{r.target_case_number}</span>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </TableCell>
                            )}

                            <TableCell className="max-w-xs"><span className="line-clamp-2 text-sm">{r.reason}</span></TableCell>
                            <TableCell className="text-xs">{r.requested_by}</TableCell>
                            <TableCell className="text-xs">{new Date(r.requested_at).toLocaleString()}</TableCell>
                            <TableCell className="text-right space-x-1">
                              <Button size="sm" variant="ghost" onClick={() => navigate(`/compliance/cases/${r.case_id}`)}>
                                <ExternalLink className="h-3 w-3" />
                              </Button>
                              {s === 'PENDING' && (
                                <>
                                  <PermissionButton moduleName={MODULE} actionName="edit" size="sm" variant="outline"
                                    onClick={() => { setReviewing(r); setApprove(true); }}>
                                    <CheckCircle className="h-3 w-3 mr-1" /> Approve
                                  </PermissionButton>
                                  <PermissionButton moduleName={MODULE} actionName="edit" size="sm" variant="destructive"
                                    onClick={() => { setReviewing(r); setApprove(false); }}>
                                    <XCircle className="h-3 w-3 mr-1" /> Reject
                                  </PermissionButton>
                                </>
                              )}
                              {s !== 'PENDING' && r.review_notes && (
                                <Badge variant="outline" className="text-[10px]">{r.reviewed_by}</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>

        <Dialog open={!!reviewing} onOpenChange={(o) => !o && setReviewing(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{approve ? 'Approve' : 'Reject'} {type.toLowerCase()} request</DialogTitle>
              <DialogDescription>Case {reviewing?.case_number} — {reviewing?.employer_name}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Original reason:</div>
              <div className="p-3 bg-muted rounded text-sm">{reviewing?.reason}</div>
              <Textarea rows={3} placeholder="Review notes (required)" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReviewing(null)}>Cancel</Button>
              <PermissionButton
                moduleName={MODULE}
                actionName="edit"
                variant={approve ? 'default' : 'destructive'}
                disabled={!notes.trim() || reviewMut.isPending}
                onClick={() => reviewMut.mutate()}
              >
                Confirm {approve ? 'Approval' : 'Rejection'}
              </PermissionButton>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </PermissionWrapper>
  );
};

export default CaseRequestsQueue;
