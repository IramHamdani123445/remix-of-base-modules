/**
 * BN Rules Administration Hooks
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  fetchRuleVersions,
  cloneVersionAsDraft,
  compareVersions,
  submitVersionForApproval,
  approveVersion,
  rejectVersion,
  returnVersionToDraft,
  publishVersion,

  simulateVersionRules,
  type RuleVersionSummary,
  type RuleVersionCompareResult,
} from '@/services/bn/rulesAdminService';

/**
 * Every governance transition changes the same three things, so all three
 * caches are refreshed together.
 *
 * Submit used to refresh only `rule-versions`, so Rule Version Governance
 * showed the new status while the Product Editor — which reads
 * `product-versions` — kept showing the old one. And `version-readiness` was
 * refreshed only by Return to Draft, so the Readiness badge could still read
 * "Ready to submit and publish" on a version that had already gone live.
 *
 * Note: a React Query cache is per browser tab. This keeps one tab consistent;
 * a second tab still needs a refresh to see a change made in the first.
 */
function invalidateVersionCaches(qc: ReturnType<typeof useQueryClient>): void {
  qc.invalidateQueries({ queryKey: ['bn', 'rule-versions'] });
  qc.invalidateQueries({ queryKey: ['bn', 'product-versions'] });
  qc.invalidateQueries({ queryKey: ['bn', 'version-readiness'] });
}

export function useBnRuleVersions(productId?: string) {
  return useQuery({
    queryKey: ['bn', 'rule-versions', productId],
    queryFn: () => fetchRuleVersions(productId),
    staleTime: 30_000,
  });
}

export function useBnCloneVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { sourceVersionId: string; newLabel: string; changeNotes: string; userCode: string }) =>
      cloneVersionAsDraft(params.sourceVersionId, params.newLabel, params.changeNotes, params.userCode),
    onSuccess: () => {
      toast.success('Draft version created');
      // A clone adds a version row, so the Product Editor's version list must
      // refresh too — otherwise the new draft is invisible until a page reload.
      invalidateVersionCaches(qc);
    },
    onError: (err: any) => toast.error('Clone failed', { description: err.message }),
  });
}

export function useBnCompareVersions(baseId?: string, compareId?: string) {
  return useQuery({
    queryKey: ['bn', 'rule-compare', baseId, compareId],
    queryFn: () => compareVersions(baseId!, compareId!),
    enabled: !!baseId && !!compareId,
    staleTime: 60_000,
  });
}

export function useBnSubmitForApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { versionId: string; userCode: string }) =>
      submitVersionForApproval(params.versionId, params.userCode),
    onSuccess: (result) => {
      if (result.success) {
        toast.success('Version submitted for approval');
        invalidateVersionCaches(qc);
      } else {
        toast.error('Submission failed', { description: result.error });
      }
    },
  });
}

export function useBnApproveVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { versionId: string; approverCode: string; comments?: string }) =>
      approveVersion(params.versionId, params.approverCode, params.comments),
    onSuccess: (result) => {
      if (result.success) {
        toast.success('Version approved');
        invalidateVersionCaches(qc);
      } else {
        toast.error('Approval failed', { description: result.error });
      }
    },
  });
}

export function useBnRejectVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { versionId: string; rejectorCode: string; reason: string }) =>
      rejectVersion(params.versionId, params.rejectorCode, params.reason),
    onSuccess: (result) => {
      if (result.success) {
        toast.success('Version returned to draft');
        invalidateVersionCaches(qc);
      } else {
        toast.error('Rejection failed', { description: result.error });
      }
    },
  });
}

/**
 * Unlocks a Pending/Approved version so its blocking issues can be fixed.
 * Readiness is invalidated too — the badge must recompute once editing starts.
 */
export function useBnReturnToDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { versionId: string; userCode: string; reason: string }) =>
      returnVersionToDraft(params.versionId, params.userCode, params.reason),
    onSuccess: (result) => {
      if (result.success) {
        toast.success('Version returned to draft — it can now be edited');
        invalidateVersionCaches(qc);
      } else {
        toast.error('Could not return to draft', { description: result.error });
      }
    },
    onError: (err: any) => toast.error('Could not return to draft', { description: err.message }),
  });
}

export function useBnPublishVersion() {

  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { versionId: string; effectiveDate: string; publisherCode: string }) =>
      publishVersion(params.versionId, params.effectiveDate, params.publisherCode),
    onSuccess: (result) => {
      if (result.success) {
        toast.success('Version published and active');
        invalidateVersionCaches(qc);
      } else {
        toast.error('Publish failed', { description: result.error });
      }
    },
  });
}

export function useBnSimulateVersion() {
  return useMutation({
    mutationFn: (params: {
      versionId: string;
      input: { ssn: string; claimDate: string; productId: string };
    }) => simulateVersionRules(params.versionId, params.input),
    onError: (err: any) => toast.error('Simulation error', { description: err.message }),
  });
}
