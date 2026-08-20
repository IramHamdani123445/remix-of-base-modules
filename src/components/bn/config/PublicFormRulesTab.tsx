import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Save, Users } from 'lucide-react';
import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  useBnParticipantConfig,
  useUpsertBnParticipantConfig,
} from '@/hooks/bn/useBnParticipantConfig';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchActiveCountryParticipantTypes } from '@/services/bn/countryPackService';
import type { BnProductParticipantConfigInput } from '@/types/bnParticipant';

interface Props {
  versionId: string | undefined;
  isReadOnly?: boolean;
}


function emptyDraft(versionId: string): BnProductParticipantConfigInput {
  return {
    product_version_id: versionId,
    applicant_must_equal_insured: false,
    allowed_applicant_kinds: ['APPLICANT'],
    required_roles: [],
    optional_roles: [],
    requires_deceased: false,
    requires_beneficiaries: false,
    requires_guardian_or_payee: false,
    requires_employer_task: false,
    requires_doctor_task: false,
    requires_school_task_when: {},
    notes: null,
  };
}

export default function PublicFormRulesTab({ versionId, isReadOnly }: Props) {
  const { data, isLoading } = useBnParticipantConfig(versionId);
  const upsert = useUpsertBnParticipantConfig();
  const [draft, setDraft] = useState<BnProductParticipantConfigInput | null>(null);

  useEffect(() => {
    if (!versionId) return;
    if (data) {
      setDraft({
        product_version_id: data.product_version_id,
        applicant_must_equal_insured: data.applicant_must_equal_insured,
        allowed_applicant_kinds: data.allowed_applicant_kinds ?? [],
        required_roles: data.required_roles ?? [],
        optional_roles: data.optional_roles ?? [],
        requires_deceased: data.requires_deceased,
        requires_beneficiaries: data.requires_beneficiaries,
        requires_guardian_or_payee: data.requires_guardian_or_payee,
        requires_employer_task: data.requires_employer_task,
        requires_doctor_task: data.requires_doctor_task,
        requires_school_task_when: data.requires_school_task_when ?? {},
        notes: data.notes ?? null,
      });
    } else {
      setDraft(emptyDraft(versionId));
    }
  }, [data, versionId]);

  // Resolve country for this product version, then load ACTIVE country
  // participant types. These must be declared before any early return —
  // hooks have to run in the same order on every render, and the two
  // early returns below fire on the first pass while data is still loading.
  const { data: versionRow } = useQuery({
    queryKey: ['bn-pv-country', versionId],
    enabled: !!versionId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('bn_product_version')
        .select('id, product_id, bn_product:product_id(country_code)')
        .eq('id', versionId).maybeSingle();
      return data as any;
    },
  });
  const countryCode = versionRow?.bn_product?.country_code as string | undefined;
  const { data: activeTypes = [] } = useQuery({
    queryKey: ['bn-active-cpt', countryCode],
    enabled: !!countryCode,
    queryFn: () => fetchActiveCountryParticipantTypes(countryCode!),
    staleTime: 5 * 60_000,
  });

  if (!versionId) {
    return <Card><CardContent className="p-6 text-sm text-muted-foreground">Select a product version to configure participant rules.</CardContent></Card>;
  }
  if (isLoading || !draft) {
    return <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading participant rules…</CardContent></Card>;
  }

  const participantOptions = activeTypes.map(t => ({ value: t.type_code, label: t.type_name }));
  const refMissing = participantOptions.length === 0;
  const toggleArray = (list: string[], role: string): string[] =>
    list.includes(role) ? list.filter((r) => r !== role) : [...list, role];

  const set = <K extends keyof BnProductParticipantConfigInput>(k: K, v: BnProductParticipantConfigInput[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));

  const onSave = async () => {
    try {
      await upsert.mutateAsync({ ...draft, id: data?.id });
      toast.success('Public form rules saved');
    } catch (e: any) {
      toast.error('Save failed', { description: e?.message ?? 'Unknown error' });
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Participants & Public Form Rules
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Controls the "Who are you applying for?" first step and which participant roles the public form collects.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex items-center justify-between rounded border p-3">
              <div>
                <Label className="text-sm font-medium">Applicant must equal Insured Person</Label>
                <p className="text-xs text-muted-foreground">Restrict to self-claims only</p>
              </div>
              <Switch
                checked={draft.applicant_must_equal_insured}
                disabled={isReadOnly}
                onCheckedChange={(v) => set('applicant_must_equal_insured', v)}
              />
            </div>
            <div className="flex items-center justify-between rounded border p-3">
              <div>
                <Label className="text-sm font-medium">Deceased Insured Person required</Label>
                <p className="text-xs text-muted-foreground">For funeral, survivors, death benefit</p>
              </div>
              <Switch checked={draft.requires_deceased} disabled={isReadOnly}
                onCheckedChange={(v) => set('requires_deceased', v)} />
            </div>
            <div className="flex items-center justify-between rounded border p-3">
              <div>
                <Label className="text-sm font-medium">Beneficiaries required</Label>
                <p className="text-xs text-muted-foreground">Survivor / death benefit grid</p>
              </div>
              <Switch checked={draft.requires_beneficiaries} disabled={isReadOnly}
                onCheckedChange={(v) => set('requires_beneficiaries', v)} />
            </div>
            <div className="flex items-center justify-between rounded border p-3">
              <div>
                <Label className="text-sm font-medium">Guardian / Payee required</Label>
                <p className="text-xs text-muted-foreground">For minors or incapacitated</p>
              </div>
              <Switch checked={draft.requires_guardian_or_payee} disabled={isReadOnly}
                onCheckedChange={(v) => set('requires_guardian_or_payee', v)} />
            </div>
            <div className="flex items-center justify-between rounded border p-3">
              <div>
                <Label className="text-sm font-medium">Employer task required</Label>
                <p className="text-xs text-muted-foreground">Send confirmation task to employer</p>
              </div>
              <Switch checked={draft.requires_employer_task} disabled={isReadOnly}
                onCheckedChange={(v) => set('requires_employer_task', v)} />
            </div>
            <div className="flex items-center justify-between rounded border p-3">
              <div>
                <Label className="text-sm font-medium">Doctor / Provider task required</Label>
                <p className="text-xs text-muted-foreground">Send certificate/report task</p>
              </div>
              <Switch checked={draft.requires_doctor_task} disabled={isReadOnly}
                onCheckedChange={(v) => set('requires_doctor_task', v)} />
            </div>
          </div>

          <Separator />

          {refMissing && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>No active participant types for this country</AlertTitle>
              <AlertDescription>
                Configure active participant types under Country Config → Participant Types before editing product participant rules.
              </AlertDescription>
            </Alert>
          )}

          <div>
            <Label className="mb-2 block text-sm font-medium">Allowed applicant kinds (Step 0 options)</Label>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {participantOptions.map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 rounded border p-2 text-sm">
                  <Checkbox
                    checked={draft.allowed_applicant_kinds.includes(opt.value)}
                    disabled={isReadOnly}
                    onCheckedChange={() => set('allowed_applicant_kinds', toggleArray(draft.allowed_applicant_kinds, opt.value))}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <Label className="mb-2 block text-sm font-medium">Required participant roles</Label>
            <div className="flex flex-wrap gap-2">
              {participantOptions.map((opt) => {
                const active = draft.required_roles.includes(opt.value);
                return (
                  <Badge
                    key={opt.value}
                    variant={active ? 'default' : 'outline'}
                    className={isReadOnly ? '' : 'cursor-pointer'}
                    onClick={() => !isReadOnly && set('required_roles', toggleArray(draft.required_roles, opt.value))}
                  >
                    {opt.label}
                  </Badge>
                );
              })}
              {draft.required_roles
                .filter((r) => !participantOptions.some((o) => o.value === r))
                .map((r) => (
                  <Badge key={`retired-req-${r}`} variant="outline" className="border-amber-600 text-amber-600">
                    {r} (retired)
                  </Badge>
                ))}
            </div>
          </div>

          <div>
            <Label className="mb-2 block text-sm font-medium">Optional participant roles</Label>
            <div className="flex flex-wrap gap-2">
              {participantOptions.map((opt) => {
                const active = draft.optional_roles.includes(opt.value);
                return (
                  <Badge
                    key={opt.value}
                    variant={active ? 'secondary' : 'outline'}
                    className={isReadOnly ? '' : 'cursor-pointer'}
                    onClick={() => !isReadOnly && set('optional_roles', toggleArray(draft.optional_roles, opt.value))}
                  >
                    {opt.label}
                  </Badge>
                );
              })}
              {draft.optional_roles
                .filter((r) => !participantOptions.some((o) => o.value === r))
                .map((r) => (
                  <Badge key={`retired-opt-${r}`} variant="outline" className="border-amber-600 text-amber-600">
                    {r} (retired)
                  </Badge>
                ))}
            </div>
          </div>


          <div>
            <Label className="mb-2 block text-sm font-medium">Notes</Label>
            <Textarea
              rows={3}
              value={draft.notes ?? ''}
              disabled={isReadOnly}
              onChange={(e) => set('notes', e.target.value || null)}
            />
          </div>

          {!isReadOnly && (
            <div className="flex justify-end">
              <Button onClick={onSave} disabled={upsert.isPending} className="gap-2">
                <Save className="h-4 w-4" /> Save participant rules
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
