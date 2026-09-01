import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Check, X, RotateCcw, Send, ShieldAlert, Stethoscope, Building2, User } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateForDisplay } from '@/lib/format-config';
import {
  useBnClaimParticipants,
  useBnClaimExternalTasks,
  useUpdateExternalTaskDecision,
  useResendParticipantInvite,
  useMaterializeExternalTasks,
  useUpdateParticipantRelationship,
  type BnExternalTaskRow,
  type BnClaimParticipantRow,
} from '@/hooks/bn/useBnClaimParticipants';
import { useUserCode } from '@/hooks/useUserCode';
import { Sparkles } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BnBusyButton } from '@/components/bn/shared';


interface Props { claimId: string }

const KIND_META: Record<string, { label: string; icon: any }> = {
  CLAIMANT: { label: 'Claimant', icon: User },
  EMPLOYER: { label: 'Employer', icon: Building2 },
  DOCTOR: { label: 'Doctor / Provider', icon: Stethoscope },
  OTHER: { label: 'Other', icon: User },
};

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  PENDING: 'outline',
  SUBMITTED: 'default',
  ACCEPTED: 'secondary',
  REJECTED: 'destructive',
  EXPIRED: 'destructive',
  CANCELLED: 'secondary',
};

/**
 * ClaimParticipantsTab — Internal BN view of all external portal
 * participants (claimant / employer / doctor) on a single claim. Reviews
 * each external task submission and lets staff accept, reject, reopen or
 * cancel — and resend portal invites. Internal-only; never exposed to portals.
 */
export function ClaimParticipantsTab({ claimId }: Props) {
  const { userCode } = useUserCode();
  const { data: participants = [], isLoading: pLoading } = useBnClaimParticipants(claimId);
  const { data: tasks = [], isLoading: tLoading } = useBnClaimExternalTasks(claimId);
  const decide = useUpdateExternalTaskDecision(claimId);
  const resend = useResendParticipantInvite(claimId);
  const materialize = useMaterializeExternalTasks(claimId);
  const updateRelationship = useUpdateParticipantRelationship(claimId);


  const [filterKind, setFilterKind] = useState<'ALL' | 'CLAIMANT' | 'EMPLOYER' | 'DOCTOR'>('ALL');

  const blocking = useMemo(
    () => tasks.filter(t => t.blocks_workflow && !['ACCEPTED', 'CANCELLED'].includes(t.status)),
    [tasks],
  );

  const tasksByParticipant = useMemo(() => {
    const map = new Map<string, BnExternalTaskRow[]>();
    tasks.forEach(t => {
      const key = t.participant_id ?? `kind:${t.participant_kind}`;
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    });
    return map;
  }, [tasks]);

  const filteredParticipants = filterKind === 'ALL'
    ? participants
    : participants.filter(p => p.kind === filterKind);

  if (pLoading || tLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      {blocking.length > 0 && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Workflow blocked by {blocking.length} external task(s)</AlertTitle>
          <AlertDescription>
            The claim cannot advance until all required external submissions are accepted or cancelled.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Participants</CardTitle>
              <CardDescription>
                Claimant, employer and medical provider activity for this claim. Data flows in from the public portals and secure links.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{participants.length} total</Badge>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={materialize.isPending}
                onClick={async () => {
                  try {
                    const { inserted } = await materialize.mutateAsync();
                    if (inserted > 0) toast.success(`Materialized ${inserted} external task(s) from product config.`);
                    else toast.info('No new tasks to materialize — all configured tasks already exist.');
                  } catch (e: any) {
                    toast.error('Failed to materialize tasks', { description: e?.message });
                  }
                }}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {materialize.isPending ? 'Materializing…' : 'Materialize tasks'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={filterKind} onValueChange={(v) => setFilterKind(v as any)}>
            <TabsList>
              <TabsTrigger value="ALL">All</TabsTrigger>
              <TabsTrigger value="CLAIMANT">Claimant</TabsTrigger>
              <TabsTrigger value="EMPLOYER">Employer</TabsTrigger>
              <TabsTrigger value="DOCTOR">Doctor</TabsTrigger>
            </TabsList>

            <TabsContent value={filterKind} className="mt-4 space-y-4">
              {filteredParticipants.length === 0 && (
                <p className="text-sm text-muted-foreground">No participants of this type on this claim.</p>
              )}
              {filteredParticipants.map(p => {
                const meta = KIND_META[p.kind] ?? KIND_META.OTHER;
                const Icon = meta.icon;
                const pTasks = tasksByParticipant.get(p.id) ?? [];
                return (
                  <Card key={p.id} className="border-muted">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <div className="text-sm font-semibold">{p.display_name ?? meta.label}</div>
                            <div className="text-xs text-muted-foreground">
                              {[p.ssn, p.employer_regno, p.provider_code, p.email, p.phone].filter(Boolean).join(' · ') || '—'}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={p.status === 'ACTIVE' ? 'secondary' : 'outline'}>{p.status}</Badge>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            disabled={resend.isPending}
                            onClick={async () => {
                              try {
                                await resend.mutateAsync({ participantId: p.id });
                                toast.success('Invite re-issued. External user will be notified.');
                              } catch (e: any) {
                                toast.error(e?.message ?? 'Could not resend invite');
                              }
                            }}
                          >
                            <Send className="h-3.5 w-3.5" /> Resend invite
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <ParticipantMetadataEditor
                        participant={p}
                        busy={updateRelationship.isPending}
                        onChangeRelationship={async (rel) => {
                          try {
                            await updateRelationship.mutateAsync({ participantId: p.id, relationship: rel });
                            toast.success('Relationship updated.');
                          } catch (e: any) {
                            toast.error(e?.message ?? 'Could not update relationship');
                          }
                        }}
                      />
                      {pTasks.length === 0 && (
                        <p className="text-xs text-muted-foreground">No tasks assigned to this participant yet.</p>
                      )}

                      {pTasks.map(t => (
                        <TaskRow
                          key={t.id}
                          task={t}
                          onDecide={async (decision, notes) => {
                            try {
                              await decide.mutateAsync({ taskId: t.id, decision, notes, userCode });
                              toast.success(`Task ${decision.toLowerCase()}.`);
                            } catch (e: any) {
                              toast.error(e?.message ?? 'Decision failed');
                            }
                          }}
                          busy={decide.isPending}
                        />
                      ))}
                    </CardContent>
                  </Card>
                );
              })}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function TaskRow({
  task, onDecide, busy,
}: {
  task: BnExternalTaskRow;
  onDecide: (decision: 'ACCEPTED' | 'REJECTED' | 'PENDING' | 'CANCELLED', notes?: string) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const closed = ['ACCEPTED', 'CANCELLED', 'EXPIRED'].includes(task.status);
  const reviewable = task.status === 'SUBMITTED';
  const reopenable = ['ACCEPTED', 'REJECTED'].includes(task.status);

  return (
    <div className="rounded-md border bg-card/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{task.task_title}</span>
            <Badge variant={STATUS_VARIANT[task.status] ?? 'outline'} className="text-[10px]">{task.status}</Badge>
            {task.blocks_workflow && !closed && <Badge variant="destructive" className="text-[10px]">Blocks workflow</Badge>}
          </div>
          {task.task_description && (
            <div className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{task.task_description}</div>
          )}
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            <span>Type: {task.task_type}</span>
            {task.due_at && <span>Due: {formatDateForDisplay(task.due_at)}</span>}
            {task.submitted_at && <span>Submitted: {formatDateForDisplay(task.submitted_at)} by {task.submitted_by ?? '—'}</span>}
            {task.reviewed_at && <span>Reviewed: {formatDateForDisplay(task.reviewed_at)} by {task.reviewed_by ?? '—'}</span>}
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'Review'}</Button>
        </div>
      </div>

      {open && (
        <div className="mt-3 space-y-2 border-t pt-3">
          <div className="rounded-md bg-muted/40 p-2">
            <div className="text-[11px] font-medium text-muted-foreground">Submitted payload</div>
            <pre className="mt-1 max-h-48 overflow-auto text-[11px]">{JSON.stringify(task.payload, null, 2)}</pre>
          </div>
          {task.decision_notes && (
            <div className="text-[11px] text-muted-foreground">
              <span className="font-medium">Prior decision notes: </span>{task.decision_notes}
            </div>
          )}
          <Textarea
            placeholder="Decision / reopen notes (optional)"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
          />
          <div className="flex flex-wrap gap-2">
            <BnBusyButton loading={busy}
              size="sm"
              className="gap-1.5"
              disabled={busy || !reviewable}
              onClick={() => onDecide('ACCEPTED', notes)}
            >
              <Check className="h-3.5 w-3.5" /> Accept
            </BnBusyButton>
            <BnBusyButton loading={busy}
              size="sm"
              variant="destructive"
              className="gap-1.5"
              disabled={busy || !reviewable}
              onClick={() => onDecide('REJECTED', notes)}
            >
              <X className="h-3.5 w-3.5" /> Reject
            </BnBusyButton>
            <BnBusyButton loading={busy}
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={busy || !reopenable}
              onClick={() => onDecide('PENDING', notes)}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reopen
            </BnBusyButton>
            <BnBusyButton loading={busy}
              size="sm"
              variant="ghost"
              disabled={busy || closed}
              onClick={() => onDecide('CANCELLED', notes)}
            >
              Cancel task
            </BnBusyButton>
          </div>
        </div>
      )}
    </div>
  );
}

const DECEASED_ROLE_HINTS = ['DECEASED_INSURED_PERSON', 'DECEASED'];
const RELATIONSHIP_OPTIONS: { value: string; label: string }[] = [
  { value: 'INSURED', label: 'Insured (self)' },
  { value: 'SPOUSE', label: 'Spouse' },
  { value: 'DEPENDENT_CHILD', label: 'Dependent child' },
  { value: 'PARENT', label: 'Parent' },
  { value: 'SIBLING', label: 'Sibling' },
  { value: 'OTHER', label: 'Other' },
];

function ParticipantMetadataEditor({
  participant, onChangeRelationship, busy,
}: {
  participant: BnClaimParticipantRow;
  onChangeRelationship: (rel: string) => void;
  busy: boolean;
}) {
  const role = String(participant.participant_role ?? '').toUpperCase();
  const kind = String(participant.kind ?? '').toUpperCase();
  const isDeceased = DECEASED_ROLE_HINTS.includes(role) || kind === 'DECEASED';
  if (!isDeceased) return null;
  const current = participant.relationship_to_insured ?? '';
  return (
    <div className="flex flex-col gap-1 rounded-md border border-dashed bg-muted/30 p-2 sm:flex-row sm:items-center sm:gap-3">
      <div className="text-xs font-medium">
        Relationship to insured <span className="text-destructive">*</span>
      </div>
      <Select value={current || undefined} onValueChange={onChangeRelationship} disabled={busy}>
        <SelectTrigger className="h-8 w-full sm:w-64">
          <SelectValue placeholder="Select relationship…" />
        </SelectTrigger>
        <SelectContent>
          {RELATIONSHIP_OPTIONS.map(opt => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!current && (
        <span className="text-[11px] text-destructive">Required for eligibility rules (e.g. Funeral Grant).</span>
      )}
    </div>
  );
}

export default ClaimParticipantsTab;

