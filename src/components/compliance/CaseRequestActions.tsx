/**
 * Inline action menu for case detail: Request Closure / Reopen / Merge.
 * Gated by manage_compliance permission and feature toggles.
 *
 * Closure submissions consult `ce_workflow_mappings` for the
 * `case.closure_approval` event and honor the resolved fallback behavior
 * (BLOCK / REQUIRE_NOTE / DIRECT_APPLY). When a workflow mapping is enabled
 * the resolved workflow is recorded on the request's metadata so the approval
 * queue can route accordingly.
 */
import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { PermissionButton } from '@/components/ui/permission-button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Lock, Undo2, GitMerge } from 'lucide-react';
import { toast } from 'sonner';
import { useUserCode } from '@/hooks/useUserCode';
import { createCaseRequest, type CaseRequestType } from '@/services/caseRequestsService';
import { isComplianceFeatureEnabled } from '@/lib/compliance/featureToggles';
import { resolveWorkflow, type ResolvedMapping } from '@/services/complianceWorkflowMappingService';

const MODULE = 'manage_compliance';
const REQUIRE_NOTE_MIN_LEN = 20;

interface Props {
  caseId: string;
  caseStatus: string;
  caseNumber: string;
}

export const CaseRequestActions = ({ caseId, caseStatus, caseNumber }: Props) => {
  const { userCode } = useUserCode();
  const [open, setOpen] = useState<CaseRequestType | null>(null);
  const [reason, setReason] = useState('');
  const [targetCaseId, setTargetCaseId] = useState('');
  const [mergeSearch, setMergeSearch] = useState('');
  const [selectedTargetLabel, setSelectedTargetLabel] = useState('');
  const [closureMapping, setClosureMapping] = useState<ResolvedMapping | null>(null);

  const closed = ['RESOLVED', 'CLOSED', 'COMPLETED'].includes(caseStatus);

  // Debounced search term for the merge target picker.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(mergeSearch.trim()), 300);
    return () => clearTimeout(t);
  }, [mergeSearch]);

  const { data: candidateCases = [], isFetching: isSearching } = useQuery({
    queryKey: ['ce-case-merge-candidates', debouncedSearch, caseId],
    enabled: open === 'MERGE' && debouncedSearch.length >= 2,
    queryFn: async () => {
      const term = debouncedSearch.replace(/[%,]/g, '');
      const { data, error } = await supabase
        .from('ce_cases')
        .select('id, case_number, employer_name, status')
        .or(`case_number.ilike.%${term}%,employer_name.ilike.%${term}%`)
        .neq('id', caseId)
        .limit(20);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; case_number: string; employer_name: string | null; status: string }>;
    },
  });


  // Resolve the workflow mapping when the closure dialog opens so we can
  // surface the resolved workflow name + fallback behavior to the user.
  useEffect(() => {
    let cancelled = false;
    if (open === 'CLOSURE') {
      setClosureMapping(null);
      resolveWorkflow('case.closure_approval', {})
        .then((m) => { if (!cancelled) setClosureMapping(m); })
        .catch(() => { if (!cancelled) setClosureMapping(null); });
    } else {
      setClosureMapping(null);
    }
    return () => { cancelled = true; };
  }, [open, caseId]);

  const mut = useMutation({
    mutationFn: async () => {
      // For CLOSURE: enforce mapping/fallback before creating the request.
      let metadata: Record<string, unknown> | undefined;
      if (open === 'CLOSURE') {
        const mapping = closureMapping ?? (await resolveWorkflow('case.closure_approval', {}));
        if (!mapping.enabled) {
          if (mapping.fallbackBehavior === 'BLOCK') {
            throw new Error(
              'Case closure is currently blocked by the configured workflow mapping. Please contact your compliance administrator.',
            );
          }
          if (mapping.fallbackBehavior === 'REQUIRE_NOTE' && reason.trim().length < REQUIRE_NOTE_MIN_LEN) {
            throw new Error(
              `A justification of at least ${REQUIRE_NOTE_MIN_LEN} characters is required for closure (workflow mapping fallback).`,
            );
          }
        }
        metadata = {
          workflow: {
            event_key: 'case.closure_approval',
            mapping_id: mapping.mappingId,
            workflow_definition_id: mapping.workflowDefinitionId,
            workflow_name: mapping.workflowName,
            enabled: mapping.enabled,
            fallback_behavior: mapping.fallbackBehavior,
            resolved_at: new Date().toISOString(),
          },
        };
      }
      return createCaseRequest({
        caseId,
        type: open!,
        reason,
        targetCaseId: open === 'MERGE' ? targetCaseId : undefined,
        requestedBy: userCode || 'UNKNOWN',
        metadata,
      });
    },
    onSuccess: () => {
      toast.success(`${open} request submitted for review`);
      setOpen(null); setReason(''); setTargetCaseId('');
    },
    onError: (e: any) =>
      toast.error(e?.message || 'Failed to submit request', {
        style: { backgroundColor: 'hsl(var(--destructive))', color: 'white' } as React.CSSProperties,
        classNames: { toast: '!bg-destructive', title: '!text-white', description: '!text-white !opacity-100' },
      }),
  });

  const closureBlocked = open === 'CLOSURE' && closureMapping && !closureMapping.enabled && closureMapping.fallbackBehavior === 'BLOCK';
  const closureRequireNote = open === 'CLOSURE' && closureMapping && !closureMapping.enabled && closureMapping.fallbackBehavior === 'REQUIRE_NOTE';

  return (
    <>
      {!closed && isComplianceFeatureEnabled('cases.closure') && (
        <PermissionButton moduleName={MODULE} actionName="edit" size="sm" variant="outline"
          onClick={() => setOpen('CLOSURE')}>
          <Lock className="h-4 w-4 mr-1" />Request Closure
        </PermissionButton>
      )}
      {closed && isComplianceFeatureEnabled('cases.reopenRequests') && (
        <PermissionButton moduleName={MODULE} actionName="edit" size="sm" variant="outline"
          onClick={() => setOpen('REOPEN')}>
          <Undo2 className="h-4 w-4 mr-1" />Request Reopen
        </PermissionButton>
      )}
      {!closed && isComplianceFeatureEnabled('cases.mergeReview') && (
        <PermissionButton moduleName={MODULE} actionName="edit" size="sm" variant="outline"
          onClick={() => setOpen('MERGE')}>
          <GitMerge className="h-4 w-4 mr-1" />Request Merge
        </PermissionButton>
      )}

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request case {open?.toLowerCase()}</DialogTitle>
            <DialogDescription>Case {caseNumber}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {open === 'CLOSURE' && closureMapping && (
              <div
                className={
                  'rounded-md border p-3 text-xs ' +
                  (closureBlocked
                    ? 'border-destructive bg-destructive/10 text-destructive'
                    : closureRequireNote
                      ? 'border-amber-400 bg-amber-50 text-amber-900'
                      : 'border-primary/30 bg-primary/5 text-foreground')
                }
              >
                <div className="font-medium">Workflow mapping</div>
                {closureMapping.enabled ? (
                  <div>
                    Routed to workflow:{' '}
                    <span className="font-mono">{closureMapping.workflowName || 'Configured workflow'}</span>
                  </div>
                ) : closureBlocked ? (
                  <div>Closure is currently blocked by the configured fallback (BLOCK).</div>
                ) : closureRequireNote ? (
                  <div>
                    No active workflow — fallback requires a justification of at least{' '}
                    {REQUIRE_NOTE_MIN_LEN} characters.
                  </div>
                ) : (
                  <div>No active workflow — closure request will follow the standard review queue.</div>
                )}
              </div>
            )}
            {open === 'MERGE' && (
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">
                  Target case (search by case number or employer)
                </label>
                <Input
                  value={mergeSearch}
                  onChange={(e) => { setMergeSearch(e.target.value); setTargetCaseId(''); }}
                  placeholder="Type at least 2 characters, e.g. CE-2026 or employer name"
                />
                {selectedTargetLabel ? (
                  <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
                    <span>Merging into <span className="font-medium">{selectedTargetLabel}</span></span>
                    <Button variant="ghost" size="sm" onClick={() => { setTargetCaseId(''); setSelectedTargetLabel(''); }}>
                      Change
                    </Button>
                  </div>
                ) : mergeSearch.trim().length >= 2 ? (
                  <div className="max-h-48 overflow-y-auto rounded-md border">
                    {isSearching && (
                      <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>
                    )}
                    {!isSearching && candidateCases.length === 0 && (
                      <div className="px-3 py-2 text-xs text-muted-foreground">No matching open cases found</div>
                    )}
                    {candidateCases.map((cc) => (
                      <button
                        key={cc.id}
                        type="button"
                        className="flex w-full flex-col items-start px-3 py-2 text-left text-xs hover:bg-accent"
                        onClick={() => {
                          setTargetCaseId(cc.id);
                          setSelectedTargetLabel(`${cc.case_number}${cc.employer_name ? ` — ${cc.employer_name}` : ''}`);
                        }}
                      >
                        <span className="font-medium">{cc.case_number}</span>
                        <span className="text-muted-foreground">
                          {cc.employer_name || 'Unknown employer'} · {cc.status}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
            <div>
              <label className="text-xs text-muted-foreground">
                Reason (required{closureRequireNote ? `, min ${REQUIRE_NOTE_MIN_LEN} chars` : ''})
              </label>
              <Textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="Explain why this request is being made…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)}>Cancel</Button>
            <PermissionButton
              moduleName={MODULE}
              actionName="edit"
              disabled={
                !reason.trim() ||
                (open === 'MERGE' && !targetCaseId.trim()) ||
                !!closureBlocked ||
                (closureRequireNote && reason.trim().length < REQUIRE_NOTE_MIN_LEN) ||
                mut.isPending
              }
              onClick={() => mut.mutate()}
            >
              Submit Request
            </PermissionButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
