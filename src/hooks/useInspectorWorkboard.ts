import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inspectorWorkboardService } from '@/services/inspectorWorkboardService';
import { useAuth } from '@/contexts/AuthContext';
import { useUserCode } from '@/hooks/useUserCode';
import { useToast } from '@/hooks/use-toast';

const STALE = 30_000;

export function useInspectorWorkboard() {
  const { user } = useAuth();
  const { userCode, userId } = useUserCode();
  const { toast } = useToast();
  const qc = useQueryClient();
  // Follow-up actions are stamped with either the auth user id or the staff
  // user_code depending on which screen created them, so scope on both.
  const identities = useMemo(
    () => [userId, userCode].filter(Boolean) as string[],
    [userId, userCode],
  );
  const inspectorId = identities.length ? identities : undefined;
  const scopeKey = identities.join('|');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['workboard'] });
  };

  const counts = useQuery({
    queryKey: ['workboard', 'counts', scopeKey],
    queryFn: () => inspectorWorkboardService.getCounts(inspectorId),
    staleTime: STALE,
    enabled: identities.length > 0,
  });

  const overdue = useQuery({
    queryKey: ['workboard', 'overdue', scopeKey],
    queryFn: () => inspectorWorkboardService.getOverdue(inspectorId, 20),
    staleTime: STALE,
    enabled: identities.length > 0,
  });

  const dueToday = useQuery({
    queryKey: ['workboard', 'due-today', scopeKey],
    queryFn: () => inspectorWorkboardService.getDueToday(inspectorId),
    staleTime: STALE,
    enabled: identities.length > 0,
  });

  const thisWeek = useQuery({
    queryKey: ['workboard', 'this-week', scopeKey],
    queryFn: () => inspectorWorkboardService.getThisWeek(inspectorId),
    staleTime: STALE,
    enabled: identities.length > 0,
  });

  const upcoming = useQuery({
    queryKey: ['workboard', 'upcoming', scopeKey],
    queryFn: () => inspectorWorkboardService.getUpcoming(inspectorId, 20),
    staleTime: STALE,
    enabled: identities.length > 0,
  });

  const startAction = useMutation({
    mutationFn: (id: string) => inspectorWorkboardService.startAction(id, userCode ?? user?.id ?? 'system'),
    onSuccess: () => { invalidate(); toast({ title: 'Action Started', description: 'Status changed to In Progress' }); },
    onError: (e: Error) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const completeAction = useMutation({
    mutationFn: (p: { id: string; outcome: string; notes?: string }) =>
      inspectorWorkboardService.completeAction(p.id, userCode ?? user?.id ?? 'system', p.outcome, p.notes),
    onSuccess: () => { invalidate(); toast({ title: 'Action Completed' }); },
    onError: (e: Error) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const cancelAction = useMutation({
    mutationFn: (p: { id: string; reason: string }) =>
      inspectorWorkboardService.cancelAction(p.id, userCode ?? user?.id ?? 'system', p.reason),
    onSuccess: () => { invalidate(); toast({ title: 'Action Cancelled' }); },
    onError: (e: Error) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const rescheduleAction = useMutation({
    mutationFn: (p: { id: string; newDueDate: string; newScheduledDate?: string; notes?: string }) =>
      inspectorWorkboardService.rescheduleAction(p.id, userCode ?? user?.id ?? 'system', p.newDueDate, p.newScheduledDate, p.notes),
    onSuccess: () => { invalidate(); toast({ title: 'Action Rescheduled' }); },
    onError: (e: Error) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const addNotes = useMutation({
    mutationFn: (p: { id: string; notes: string }) =>
      inspectorWorkboardService.addNotes(p.id, userCode ?? user?.id ?? 'system', p.notes),
    onSuccess: () => { invalidate(); toast({ title: 'Notes Saved' }); },
    onError: (e: Error) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const claimAction = useMutation({
    mutationFn: (id: string) =>
      inspectorWorkboardService.claimAction(id, userCode ?? user?.id ?? 'system', user?.name ?? 'Unknown'),
    onSuccess: () => { invalidate(); toast({ title: 'Action Claimed' }); },
    onError: (e: Error) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  return {
    counts, overdue, dueToday, thisWeek, upcoming,
    startAction, completeAction, cancelAction, rescheduleAction, addNotes, claimAction,
    isLoading: counts.isLoading,
  };
}
