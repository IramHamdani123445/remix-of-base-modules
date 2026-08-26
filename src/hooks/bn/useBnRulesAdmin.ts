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
      qc.invalidateQueries({ queryKey: ['bn', 'rule-versions'] });
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
        qc.invalidateQueries({ queryKey: ['bn', 'rule-versions'] });
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
        qc.invalidateQueries({ queryKey: ['bn', 'rule-versions'] });
        qc.invalidateQueries({ queryKey: ['bn', 'product-versions'] });
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
        qc.invalidateQueries({ queryKey: ['bn', 'rule-versions'] });
        qc.invalidateQueries({ queryKey: ['bn', 'product-versions'] });
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
        qc.invalidateQueries({ queryKey: ['bn', 'rule-versions'] });
        qc.invalidateQueries({ queryKey: ['bn', 'product-versions'] });
        qc.invalidateQueries({ queryKey: ['bn', 'version-readiness'] });
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
        qc.invalidateQueries({ queryKey: ['bn', 'rule-versions'] });
        qc.invalidateQueries({ queryKey: ['bn', 'product-versions'] });
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
