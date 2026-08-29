import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { useBlockingMutation } from '@/hooks/useBlockingMutation';
import { toast } from 'sonner';
import { UserCheck } from 'lucide-react';
import { notificationsAdapter } from '@/adapters/notificationsAdapter';

type EntityType = 'violation' | 'case';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: EntityType;
  entityId: string;
  currentOfficerId?: string | null;
  currentOfficerName?: string | null;
  onAssigned?: () => void;
}

export function AssignmentDialog({ open, onOpenChange, entityType, entityId, currentOfficerId, currentOfficerName, onAssigned }: Props) {
  const qc = useQueryClient();
  const { user } = useSupabaseAuth();
  const [toInspectorId, setToInspectorId] = useState<string>('');
  const [reason, setReason] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));

  const { data: inspectors = [], isLoading } = useQuery({
    queryKey: ['ce_inspectors_active_for_assign'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ce_inspectors')
        .select('id, inspector_code, legacy_inspector_code, profile_id, max_caseload')
        .eq('is_active', true)
        .eq('status', 'ACTIVE')
        .order('inspector_code');
      if (error) throw error;
      const rows = data || [];
      const profileIds = Array.from(new Set(rows.map((r: any) => r.profile_id).filter(Boolean)));
      const nameMap = new Map<string, string>();
      if (profileIds.length) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', profileIds as string[]);
        (profs || []).forEach((p: any) => { if (p.full_name) nameMap.set(p.id, p.full_name); });
      }
      return rows.map((r: any) => ({ ...r, full_name: r.profile_id ? nameMap.get(r.profile_id) || null : null }));
    },
    enabled: open,
  });

  const inspectorOptions = useMemo(
    () => inspectors.map((i: any) => ({
      id: i.id,
      name: i.full_name || i.inspector_code,
      label: i.full_name
        ? `${i.full_name} (${i.inspector_code})`
        : `${i.inspector_code}${i.legacy_inspector_code ? ` (${i.legacy_inspector_code})` : ''}`,
    })),
    [inspectors]
  );

  const selectedInspector = inspectors.find((i: any) => i.id === toInspectorId);

  const assignMutation = useBlockingMutation({
    mutationFn: async () => {
      if (!toInspectorId) throw new Error('Select an officer');
      if (!reason.trim()) throw new Error('Reason is required');

      const userCode = (user as any)?.user_metadata?.user_code || (user as any)?.email || 'system';
      const userName = (user as any)?.user_metadata?.full_name || (user as any)?.email || 'System';
      const effFrom = new Date(effectiveFrom).toISOString();

      if (entityType === 'violation') {
        // Governed server-side command (Checkpoint F-S1): the database resolves the
        // previous assignment, supersedes it, creates the new one and writes
        // history + audit atomically after verifying the caller's capability.
        // Direct writes to ce_violation_assignments are revoked for browser clients.
        const { data: hasCurrent } = await supabase
          .from('ce_violation_assignments')
          .select('id')
          .eq('violation_id', entityId)
          .eq('is_current', true)
          .limit(1)
          .maybeSingle();

        const { error: rpcErr } = hasCurrent
          ? await (supabase.rpc as any)('ce_violation_reassign_v1', {
              p_violation_id: entityId,
              p_target_inspector_id: toInspectorId,
              p_reason: 'MANUAL',
              p_notes: reason,
            })
          : await (supabase.rpc as any)('ce_violation_assign_v1', {
              p_violation_id: entityId,
              p_target_inspector_id: toInspectorId,
              p_notes: reason,
            });
        if (rpcErr) throw rpcErr;
      } else {

        // case
        await supabase
          .from('ce_case_assignments')
          .update({ is_active: false, effective_to: new Date().toISOString() })
          .eq('case_id', entityId)
          .eq('is_active', true);

        const { error: insErr } = await supabase.from('ce_case_assignments').insert({
          case_id: entityId,
          from_officer_id: currentOfficerId || null,
          from_officer_name: currentOfficerName || null,
          to_officer_id: toInspectorId,
          to_officer_name: inspectorOptions.find(o => o.id === toInspectorId)?.label || null,
          assignment_method: 'MANUAL',
          reason,
          assigned_by: userCode,
          assigned_by_name: userName,
          effective_from: effFrom,
          is_active: true,
        });
        if (insErr) throw insErr;

        const { error: updErr } = await supabase
          .from('ce_cases')
          .update({
            assigned_officer_id: toInspectorId,
            assigned_officer_name: inspectorOptions.find(o => o.id === toInspectorId)?.label || null,
          } as any)
          .eq('id', entityId);
        if (updErr) throw updErr;

        await supabase.from('ce_case_history').insert({
          case_id: entityId,
          action: 'REASSIGNED',
          performed_by: userCode,
          notes: `${reason}${currentOfficerName ? ` (from ${currentOfficerName}` : ''}${currentOfficerName ? ` to ${inspectorOptions.find(o => o.id === toInspectorId)?.label || toInspectorId})` : ` -> ${inspectorOptions.find(o => o.id === toInspectorId)?.label || toInspectorId}`}`,
        } as any);
      }

      // Notify the assigned officer via email (best-effort; do not block on failure)
      try {
        let officerEmail: string | null = null;
        let officerName: string | null = inspectorOptions.find(o => o.id === toInspectorId)?.name || null;
        if (selectedInspector?.profile_id) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('email, full_name')
            .eq('id', selectedInspector.profile_id)
            .maybeSingle();
          officerEmail = (prof as any)?.email || null;
          officerName = (prof as any)?.full_name || officerName;
        }
        if (officerEmail) {
          await notificationsAdapter.dispatch({
            channel: 'Email',
            to: [officerEmail],
            templateId: entityType === 'violation' ? 'CE_VIOLATION_ASSIGNED' : 'CE_CASE_ASSIGNED',
            caseId: entityType === 'case' ? entityId : undefined,
            mergeData: {
              officer_name: officerName || '',
              entity_type: entityType,
              entity_id: entityId,
              assigned_by: userName,
              assigned_at: effFrom,
              reason,
              reassigned_from: currentOfficerName || null,
            },
          });
        } else {
          console.warn('[AssignmentDialog] No email on file for assigned officer; skipping notification.');
        }
      } catch (notifyErr) {
        console.error('[AssignmentDialog] Failed to send assignment notification:', notifyErr);
      }
    },
    onSuccess: () => {
      toast.success(`${entityType === 'violation' ? 'Violation' : 'Case'} reassigned successfully`);
      qc.invalidateQueries({ queryKey: [entityType === 'violation' ? 'ce_violations' : 'ce_cases'] });
      qc.invalidateQueries({ queryKey: [entityType === 'violation' ? 'ce_violation_assignments' : 'ce_case_assignments'] });
      onAssigned?.();
      onOpenChange(false);
      setToInspectorId('');
      setReason('');
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to reassign'),
  }, 'Reassigning');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCheck className="h-5 w-5" />
            {currentOfficerName ? 'Reassign' : 'Assign'} {entityType === 'violation' ? 'Violation' : 'Case'}
          </DialogTitle>
          <DialogDescription>
            {currentOfficerName ? `Currently assigned to ${currentOfficerName}.` : 'Currently unassigned.'} Select a new officer and provide a reason. Audit trail will be recorded.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label>Officer</Label>
            <Select value={toInspectorId} onValueChange={setToInspectorId} disabled={isLoading}>
              <SelectTrigger><SelectValue placeholder={isLoading ? 'Loading officers…' : 'Select officer'} /></SelectTrigger>
              <SelectContent>
                {inspectorOptions.map(o => (
                  <SelectItem key={o.id} value={o.id} disabled={o.id === currentOfficerId}>
                    {o.label}{o.id === currentOfficerId ? ' (current)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="effective-from">Effective from</Label>
            <Input id="effective-from" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </div>

          <div>
            <Label htmlFor="assign-reason">Reason <span className="text-destructive">*</span></Label>
            <Textarea id="assign-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being reassigned?" rows={3} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={assignMutation.isPending}>Cancel</Button>
          <Button onClick={() => assignMutation.mutate()} disabled={!toInspectorId || !reason.trim() || assignMutation.isPending}>
            {assignMutation.isPending ? 'Saving…' : 'Confirm Assignment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
