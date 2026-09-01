/**
 * Product Approval Console
 *
 * Lists every product version awaiting approval (PENDING_APPROVAL, plus
 * legacy IN_REVIEW), shows the configurable per-product approval chain
 * (CONFIG_PUBLISH rows in bn_approval_policy), and lets a user holding the
 * role for the next pending level approve / reject / publish.
 *
 * Versions the signed-in user cannot act on are listed too, marked with the
 * role they are waiting for — otherwise a version stuck behind a role nobody
 * holds is invisible to everyone.
 *
 * Route: /bn/config/product-approvals
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Loader2, ShieldCheck, XCircle, Rocket, Inbox, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { BnBusyButton } from '@/components/bn/shared';
import {
  listPendingForRoles, getApprovalChain, getApprovalHistory, recordDecision,
  type ApprovalLevelPolicy, type ApprovalEvent, type PendingApprovalRow,
} from '@/services/bn/productApprovalService';

export default function ProductApprovalConsole() {
  const { isAuthReady, isAuthenticated, profile, roles } = useSupabaseAuth();
  const qc = useQueryClient();
  const userRoles = roles ?? [];
  const userCode = (profile as any)?.user_code ?? (profile as any)?.id ?? 'system';

  const { data, isLoading } = useQuery({
    queryKey: ['bn-product-approvals', userRoles.join(',')],
    queryFn: () => listPendingForRoles(userRoles),
    enabled: isAuthReady && isAuthenticated,
    refetchInterval: 30_000,
  });

  const [selected, setSelected] = useState<any | null>(null);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="t-page-title">Product Approval Console</h1>
          <p className="t-page-subtitle mt-1">
            Approve, reject or publish benefit product versions (including bundled rule changes).
            Approval levels are configured per product.
          </p>
        </div>
        {/* Naming the roles, not counting them. On a screen where every action
            is gated by role matching, "6 role(s)" tells the user nothing about
            why they can or cannot act. */}
        <div className="flex flex-wrap items-center justify-end gap-1 max-w-md">
          {userRoles.length === 0 ? (
            <Badge variant="destructive">No roles — you cannot approve anything</Badge>
          ) : (
            userRoles.map(r => <Badge key={r} variant="outline">{r}</Badge>)
          )}
        </div>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Pending Product Versions</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : !data?.length ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <Inbox className="h-8 w-8 mb-2" />
              {/* "Nothing pending" and "nothing pending for me" are different
                  facts. The queue lists every pending version now, so an empty
                  list really does mean nothing is waiting. */}
              <p>No product versions are awaiting approval.</p>
              <p className="text-xs mt-1">
                Versions appear here once they are submitted for approval from a product's Versions tab.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {data.map(row => (
                <div
                  key={row.productVersion.id}
                  className="flex items-center justify-between border rounded-lg p-3 hover:bg-muted/40 cursor-pointer"
                  onClick={() => setSelected(row)}
                >
                  <div>
                    <div className="font-medium">
                      {row.productVersion.bn_product?.benefit_name || '(Unnamed product)'}{' '}
                      <span className="text-muted-foreground text-sm font-mono">
                        v{row.productVersion.version_number}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {row.productVersion.bn_product?.benefit_code} · {row.productVersion.bn_product?.category}
                      {row.productVersion.effective_from && ` · eff. ${row.productVersion.effective_from}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={row.productVersion.status === 'APPROVED' ? 'default' : 'secondary'}>
                      {row.productVersion.status}
                    </Badge>
                    {/* The three readiness cases are distinct. "No approval
                        chain" used to render as "Ready to Publish", which made
                        a version nobody can approve look finished. */}
                    {row.readiness === 'AWAITING_LEVEL' && row.nextLevel ? (
                      <Badge variant="outline">
                        L{row.nextLevel.level}: {row.nextLevel.approval_role}
                      </Badge>
                    ) : row.readiness === 'READY_TO_PUBLISH' ? (
                      <Badge>Ready to Publish</Badge>
                    ) : (
                      <Badge variant="destructive" className="gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        No approval chain configured
                      </Badge>
                    )}
                    {row.canAct && <Badge className="bg-emerald-600">Your turn</Badge>}
                    {!row.canAct && row.readiness === 'AWAITING_LEVEL' && (
                      <span className="text-xs text-muted-foreground">not your turn</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selected && (
        <DecisionDialog
          row={selected}
          userRoles={userRoles}
          userCode={userCode}
          onClose={() => setSelected(null)}
          onActed={() => {
            qc.invalidateQueries({ queryKey: ['bn-product-approvals'] });
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}

function DecisionDialog({
  row, userRoles, userCode, onClose, onActed,
}: {
  row: PendingApprovalRow;
  userRoles: string[];
  userCode: string;
  onClose: () => void;
  onActed: () => void;
}) {
  const [chain, setChain] = useState<ApprovalLevelPolicy[]>([]);
  const [history, setHistory] = useState<ApprovalEvent[]>([]);
  const [comments, setComments] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const [c, h] = await Promise.all([
        getApprovalChain(row.productVersion.id),
        getApprovalHistory(row.productVersion.id),
      ]);
      setChain(c);
      setHistory(h);
    })();
  }, [row.productVersion.id]);

  // Publish was gated on status === 'APPROVED', a state the version lifecycle
  // never reaches, so the button could never appear. It is now gated on every
  // configured level having signed off, which is what "approved" actually means
  // here.
  const isPublishable = row.readiness === 'READY_TO_PUBLISH';
  const canPublish = isPublishable && userRoles.some(r =>
    ['BN_DIRECTOR', 'BN_CONFIG_ADMIN', 'admin'].includes(r),
  );

  async function act(action: 'APPROVE' | 'REJECT' | 'PUBLISH') {
    if (action !== 'PUBLISH' && row.nextLevel?.requires_justification && !comments.trim()) {
      toast.error('Please provide a justification.');
      return;
    }
    setBusy(true);
    try {
      await recordDecision({
        productVersionId: row.productVersion.id,
        action,
        level: action === 'PUBLISH' ? null : row.nextLevel?.level ?? undefined,
        stageCode: row.nextLevel?.stage_code ?? null,
        approverRole: row.nextLevel?.approval_role ?? null,
        comments,
        performedBy: userCode,
      });
      toast.success(`Recorded: ${action}`);
      onActed();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to record decision');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {row.productVersion.bn_product?.benefit_name} — v{row.productVersion.version_number}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <section>
            <h3 className="text-sm font-medium mb-2">Approval Chain</h3>
            <div className="space-y-1">
              {chain.map(l => {
                const approved = history.some(h => h.level === l.level && h.decision === 'APPROVED');
                const isNext = row.nextLevel?.level === l.level;
                return (
                  <div key={l.id} className="flex items-center justify-between text-sm border rounded p-2">
                    <span>
                      <strong>L{l.level}</strong> · {l.stage_code} · {l.approval_role}
                    </span>
                    {approved ? <Badge>Approved</Badge>
                      : isNext ? <Badge variant="secondary">Pending</Badge>
                      : <Badge variant="outline">Waiting</Badge>}
                  </div>
                );
              })}
              {chain.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No approval chain configured. Set CONFIG_PUBLISH rows in Approval Policies for this product.
                </p>
              )}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-medium mb-2">History ({history.length})</h3>
            <div className="max-h-40 overflow-auto space-y-1 text-xs">
              {history.map(h => (
                <div key={h.id} className="border-b py-1">
                  <span className="font-mono">{new Date(h.performed_at).toLocaleString()}</span>
                  {' · '}<strong>{h.action}</strong>
                  {h.level != null && <> · L{h.level}</>}
                  {h.decision && <> · {h.decision}</>}
                  {' · '}{h.performed_by}
                  {h.comments && <div className="text-muted-foreground">“{h.comments}”</div>}
                </div>
              ))}
              {history.length === 0 && <p className="text-muted-foreground">No prior decisions.</p>}
            </div>
          </section>

          {(row.canAct || canPublish) && (
            <section>
              <label className="text-sm font-medium">Justification / Comments</label>
              <Textarea
                value={comments}
                onChange={e => setComments(e.target.value)}
                placeholder="Required for approval / rejection"
                rows={3}
              />
            </section>
          )}
        </div>

        <DialogFooter className="gap-2">
          <BnBusyButton loading={busy} variant="outline" onClick={onClose} disabled={busy}>Close</BnBusyButton>
          {row.canAct && (
            <>
              <BnBusyButton loading={busy} variant="destructive" disabled={busy} onClick={() => act('REJECT')}>
                <XCircle className="h-4 w-4 mr-1" /> Reject
              </BnBusyButton>
              <BnBusyButton loading={busy} disabled={busy} onClick={() => act('APPROVE')}>
                <ShieldCheck className="h-4 w-4 mr-1" /> Approve L{row.nextLevel?.level}
              </BnBusyButton>
            </>
          )}
          {canPublish && (
            <BnBusyButton loading={busy} disabled={busy} onClick={() => act('PUBLISH')} className="bg-emerald-600 hover:bg-emerald-700">
              <Rocket className="h-4 w-4 mr-1" /> Publish (Activate)
            </BnBusyButton>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
