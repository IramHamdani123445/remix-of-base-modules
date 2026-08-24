import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, CheckCircle, XCircle, Clock, Send, Copy, Loader2, Info, ShieldCheck, ExternalLink } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useUpdateBnProductVersion, useCopyBnVersionRules, useRetireBnProductVersion } from '@/hooks/bn/useBnProduct';
import { useCreateBnVersionApproval } from '@/hooks/bn/useBnConfig';
import { BN_PRODUCT_STATUS_LABELS } from '@/types/bn';
import type { BnProductVersion, BnProductStatus } from '@/types/bn';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDateForDisplay } from '@/lib/format-config';
import { useUserCode } from '@/hooks/useUserCode';

interface Props {
  productId: string | undefined;
  versions: BnProductVersion[];
  onCreateVersion: () => void;
}

const statusIcons: Record<string, React.ReactNode> = {
  DRAFT: <Clock className="h-4 w-4 text-muted-foreground" />,
  PENDING_APPROVAL: <Send className="h-4 w-4 text-amber-500" />,
  APPROVED: <ShieldCheck className="h-4 w-4 text-blue-500" />,
  ACTIVE: <CheckCircle className="h-4 w-4 text-green-500" />,
  SUSPENDED: <XCircle className="h-4 w-4 text-destructive" />,
  ARCHIVED: <XCircle className="h-4 w-4 text-muted-foreground" />,
};

const GOVERNANCE_PATH = '/bn/config/rules-administration';

export function VersionHistoryTab({ productId, versions, onCreateVersion }: Props) {
  const { toast } = useToast();
  const updateVersionMutation = useUpdateBnProductVersion();
  const createApprovalMutation = useCreateBnVersionApproval();
  const copyRulesMutation = useCopyBnVersionRules();
  const retireMutation = useRetireBnProductVersion();
  const { userCode } = useUserCode();
  const [approvalDialog, setApprovalDialog] = useState<{ versionId: string; action: string } | null>(null);
  const [copyDialog, setCopyDialog] = useState<{ targetVersionId: string } | null>(null);
  const [copySourceId, setCopySourceId] = useState('');
  const [comments, setComments] = useState('');
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);

  const retireBlockReason = (version: BnProductVersion) => {
    if (version.status !== 'ACTIVE') return 'Only ACTIVE versions can be retired.';
    const replacement = versions.find(v => v.id !== version.id && v.status === 'ACTIVE');
    if (!replacement && !version.effective_to) {
      return 'Publish the replacement version first. Publishing auto-closes the current active version; manual retire requires another ACTIVE version or an Effective To date.';
    }
    return null;
  };

  // Approve / Reject / Publish are NOT available here — Rule Version Governance
  // is the single approval authority. This screen only submits drafts and
  // retires closed active versions.
  const handleStatusAction = async (versionId: string, action: string, toStatus: string) => {
    try {
      setLifecycleError(null);
      const fromStatus = versions.find(v => v.id === versionId)?.status;
      const version = versions.find(v => v.id === versionId);

      if (action === 'RETIRE') {
        if (version) {
          const reason = retireBlockReason(version);
          if (reason) throw new Error(reason);
        }
        await retireMutation.mutateAsync(versionId);
      } else {
        await updateVersionMutation.mutateAsync({ id: versionId, updates: { status: toStatus } as any });
      }
      await createApprovalMutation.mutateAsync({ product_version_id: versionId, action, from_status: fromStatus, to_status: toStatus, comments, performed_by: userCode || 'system' });
      toast({ title: 'Success', description: action === 'RETIRE' ? 'Version retired.' : 'Version submitted for approval.' });
      setApprovalDialog(null);
      setComments('');
    } catch (err: any) {
      const message = err?.message || 'Version lifecycle action failed.';
      setLifecycleError(message);
      toast({ title: 'Error', description: message, variant: 'destructive' });
    }
  };

  const handleCopyRules = async () => {
    if (!copyDialog || !copySourceId) return;
    try {
      const counts = await copyRulesMutation.mutateAsync({
        sourceVersionId: copySourceId,
        targetVersionId: copyDialog.targetVersionId,
      });
      toast({
        title: 'Configuration Copied',
        description: `Copied ${counts.eligibility} eligibility, ${counts.calculation} calculation, ${counts.timeline} timeline rules, and ${counts.documents} document requirements.`,
      });
      setCopyDialog(null);
      setCopySourceId('');
    } catch (err: any) {
      toast({ title: 'Copy Failed', description: err?.message, variant: 'destructive' });
    }
  };

  if (!productId) return <Card><CardContent className="py-8 text-center text-muted-foreground">Save the product first.</CardContent></Card>;

  const sourceVersions = versions.filter(v => v.status !== 'DRAFT' || v.id !== copyDialog?.targetVersionId);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Version History</CardTitle>
            <CardDescription>Effective-dated versions with DRAFT → PENDING&nbsp;APPROVAL → APPROVED → ACTIVE lifecycle. Overlapping date ranges are blocked.</CardDescription>
          </div>
          <Button onClick={onCreateVersion} className="gap-2"><Plus className="h-4 w-4" /> New Version</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {lifecycleError && (
            <Alert variant="destructive">
              <Info className="h-4 w-4" />
              <AlertTitle>Version action blocked</AlertTitle>
              <AlertDescription className="whitespace-pre-line">{lifecycleError}</AlertDescription>
            </Alert>
          )}
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Create or copy into a DRAFT here and submit it for approval. <strong>Approval and publishing happen in Rule Version Governance</strong> — that screen is the single approval authority and enforces maker-checker. Once published, the version becomes ACTIVE, the previous active version is closed to the day before the new effective date, and the product becomes available for claim registration. Manual retire here is only for an already closed or replaced active version.
              {' '}
              <Link to={GOVERNANCE_PATH} className="underline underline-offset-2 font-medium">Open Rule Version Governance</Link>
            </AlertDescription>
          </Alert>
          {versions.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">No versions yet. Click "New Version" to create the first one.</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Version</TableHead><TableHead>Effective From</TableHead><TableHead>Effective To</TableHead>
                <TableHead>Status</TableHead><TableHead>Description</TableHead><TableHead className="w-56">Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {versions.map((v: BnProductVersion) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium">V{v.version_number}</TableCell>
                    <TableCell>{v.effective_from ? formatDateForDisplay(v.effective_from) : '—'}</TableCell>
                    <TableCell>{v.effective_to ? formatDateForDisplay(v.effective_to) : <span className="text-muted-foreground">Open-ended</span>}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {statusIcons[v.status]}
                        <Badge variant={v.status === 'ACTIVE' ? 'default' : v.status === 'DRAFT' ? 'secondary' : 'outline'}>
                          {BN_PRODUCT_STATUS_LABELS[v.status as BnProductStatus] || v.status}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{v.description || '—'}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {v.status === 'DRAFT' && (
                          <>
                            <Button variant="outline" size="sm" onClick={() => setApprovalDialog({ versionId: v.id, action: 'SUBMIT' })}>Submit</Button>
                            <Button variant="ghost" size="sm" onClick={() => setCopyDialog({ targetVersionId: v.id })} title="Copy rules from another version">
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                        {(v.status === 'PENDING_APPROVAL' || v.status === 'APPROVED') && (
                          <Button asChild variant="outline" size="sm" className="gap-1.5">
                            <Link to={GOVERNANCE_PATH} title={v.status === 'APPROVED'
                              ? 'Approved — publish it in Rule Version Governance'
                              : 'Approve or reject this version in Rule Version Governance'}>
                              <ExternalLink className="h-3.5 w-3.5" />
                              {v.status === 'APPROVED' ? 'Publish in Governance' : 'Review in Governance'}
                            </Link>
                          </Button>
                        )}
                        {v.status === 'ACTIVE' && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!!retireBlockReason(v)}
                            title={retireBlockReason(v) || 'Retire this active version'}
                            onClick={() => setApprovalDialog({ versionId: v.id, action: 'RETIRE' })}
                          >Retire</Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Status Action Dialog */}
      <Dialog open={!!approvalDialog} onOpenChange={() => setApprovalDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{approvalDialog?.action === 'SUBMIT' ? 'Submit for Approval' : approvalDialog?.action === 'APPROVE' ? 'Approve Version' : approvalDialog?.action === 'REJECT' ? 'Reject Version' : 'Retire Version'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Comments {approvalDialog?.action === 'REJECT' ? '*' : '(optional)'}</Label>
              <Textarea value={comments} onChange={e => setComments(e.target.value)} rows={3} placeholder="Reason or notes..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApprovalDialog(null)}>Cancel</Button>
            <Button
              variant={approvalDialog?.action === 'REJECT' ? 'destructive' : 'default'}
              onClick={() => {
                if (!approvalDialog) return;
                const statusMap: Record<string, string> = { SUBMIT: 'PENDING_APPROVAL', APPROVE: 'ACTIVE', REJECT: 'DRAFT', RETIRE: 'ARCHIVED' };
                handleStatusAction(approvalDialog.versionId, approvalDialog.action, statusMap[approvalDialog.action]);
              }}
            >
              {approvalDialog?.action === 'SUBMIT' ? 'Submit' : approvalDialog?.action === 'APPROVE' ? 'Approve' : approvalDialog?.action === 'REJECT' ? 'Reject' : 'Retire'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Copy Rules Dialog */}
      <Dialog open={!!copyDialog} onOpenChange={() => { setCopyDialog(null); setCopySourceId(''); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Copy Rules from Another Version</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This will copy eligibility, calculation, timeline rules, and document requirements from the selected source version into the draft version.
            </p>
            <div className="space-y-2">
              <Label>Source Version *</Label>
              <Select value={copySourceId} onValueChange={setCopySourceId}>
                <SelectTrigger><SelectValue placeholder="Select source version" /></SelectTrigger>
                <SelectContent>
                  {sourceVersions.map(v => (
                    <SelectItem key={v.id} value={v.id}>
                      V{v.version_number} — {v.effective_from || 'No date'} [{v.status}]
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCopyDialog(null); setCopySourceId(''); }}>Cancel</Button>
            <Button onClick={handleCopyRules} disabled={!copySourceId || copyRulesMutation.isPending} className="gap-2">
              {copyRulesMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Copy Rules
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
