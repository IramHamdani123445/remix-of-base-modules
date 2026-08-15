import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getClaimCommunicationHistory,
  triggerClaimCommunication,
  updateLetterStatus,
  retryCommunication,
  generateLetterFromBlocked,
  markCommunicationManuallyDispatched,
  type BnCommContext,
} from '@/services/bn/communication/bnCommunicationAdapter';

export function useBnClaimCommunicationHistory(claimId: string | undefined) {
  return useQuery({
    queryKey: ['bn', 'claim-communications', claimId],
    queryFn: () => getClaimCommunicationHistory(claimId!),
    enabled: !!claimId,
    refetchInterval: 30_000,
  });
}

export function useBnTriggerCommunication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventCode, claimId, ctx }: { eventCode: string; claimId: string; ctx?: BnCommContext }) =>
      triggerClaimCommunication(eventCode, claimId, ctx),
    onSuccess: (_, { claimId }) => {
      qc.invalidateQueries({ queryKey: ['bn', 'claim-communications', claimId] });
      qc.invalidateQueries({ queryKey: ['bn', 'claim-events', claimId] });
    },
  });
}

export function useBnUpdateLetterStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ letterId, newStatus, userCode, notes }: { letterId: string; newStatus: string; userCode: string; notes?: string }) =>
      updateLetterStatus(letterId, newStatus, userCode, notes),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bn', 'claim-communications'] }),
  });
}

export function useBnRetryCommunication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ logId, userCode }: { logId: string; userCode: string }) =>
      retryCommunication(logId, userCode),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bn', 'claim-communications'] }),
  });
}

export function useBnGenerateLetterFromBlocked() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ logId, userCode }: { logId: string; userCode: string }) =>
      generateLetterFromBlocked(logId, userCode),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bn', 'claim-communications'] }),
  });
}

export function useBnMarkManuallyDispatched() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ logId, userCode, note }: { logId: string; userCode: string; note?: string }) =>
      markCommunicationManuallyDispatched(logId, userCode, note),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bn', 'claim-communications'] }),
  });
}


// ── Omni-Comms cutover (canonical path) ────────────────────────────
import {
  triggerClaimCommunicationViaOmniComms,
  listClaimOmniCommsActivity,
} from '@/services/bn/communication/bnClaimOmniCommsService';
import { useOmniCommsRpcClient } from '@/platform/omni-comms/admin/hooks/useOmniCommsRpcClient';

/** Claim communications as governed by Omni-Comms (business-event Activity). */
export function useBnClaimOmniCommsActivity(claimId: string | undefined) {
  const client = useOmniCommsRpcClient();
  return useQuery({
    queryKey: ['bn', 'claim-omni-comms', claimId],
    queryFn: () => listClaimOmniCommsActivity(client, claimId!),
    enabled: !!claimId,
    refetchInterval: 30_000,
  });
}

/** Raise a claim communication through the single Omni-Comms façade. */
export function useBnTriggerOmniCommsCommunication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventCode, claimId, ctx }: { eventCode: string; claimId: string; ctx?: BnCommContext }) =>
      triggerClaimCommunicationViaOmniComms(eventCode, claimId, ctx),
    onSuccess: (_, { claimId }) => {
      qc.invalidateQueries({ queryKey: ['bn', 'claim-omni-comms', claimId] });
      qc.invalidateQueries({ queryKey: ['bn', 'claim-events', claimId] });
    },
  });
}
