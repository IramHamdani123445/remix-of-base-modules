/**
 * BN Means-Test — assessment workspace (MT4).
 *
 * Structured intake sections driven entirely by the governed command and
 * query services. Lifecycle rules are NEVER recomputed in React: the
 * canonical `bn_means_available_actions_v1` query decides what is allowed
 * and why.
 */
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, ArrowLeft, Loader2, ShieldAlert } from 'lucide-react';
import {
  meansQueryService,
  type BnMeansAvailableAction,
  type BnMeansCalculationReadiness,
} from '@/services/bn/meansTests/meansQueryService';
import { meansCommandService, type BnMeansCommandResult } from '@/services/bn/meansTests/meansCommandService';
import type { BnMeansCommandName } from '@/types/bn/meansTests/meansCommands';
import { formatWithCurrency } from '@/utils/formatCurrency';
import {
  BnMeansVerificationPanel,
  buildFactGroups,
  type BnMeansVerificationRecord,
} from '@/components/bn/meansTests/BnMeansVerificationPanel';
import { BnMeansCalculationPanel } from '@/components/bn/meansTests/BnMeansCalculationPanel';


const REASON_LABEL: Record<string, string> = {
  ACTIONS_DISABLED: 'Actions are disabled while the module is in internal pilot',
  PERMISSION_DENIED: 'You do not hold the required permission',
  INVALID_STATE: 'Not available in the current status',
  NOT_READY_FOR_CALCULATION: 'Outstanding verification blockers prevent calculation',

  MISSING_REQUIRED_INFORMATION: 'Required information is missing',
  MISSING_EVIDENCE: 'Required evidence has not been attached',
  STALE_ROW_VERSION: 'The record changed — reload before continuing',
  MAKER_CHECKER_REQUIRED: 'A separate officer must have performed the preceding step',
  SELF_APPROVAL_DENIED: 'You cannot approve your own submission',
  POLICY_NOT_EFFECTIVE: 'The selected policy version is not effective',
  CURRENCY_MISMATCH: 'Currency does not match the assessment',
  ALREADY_SUBMITTED: 'The assessment has already been submitted',
};

export interface BnMeansAssessmentWorkspaceProps {
  assessmentId: string;
  onBack: () => void;
}

type Row = Record<string, unknown>;

function asRows(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : [];
}

export const BnMeansAssessmentWorkspace: React.FC<BnMeansAssessmentWorkspaceProps> = ({
  assessmentId,
  onBack,
}) => {
  const queryClient = useQueryClient();
  const [commandError, setCommandError] = React.useState<BnMeansCommandResult | null>(null);

  const detail = useQuery({
    queryKey: ['bn-means-detail', assessmentId],
    queryFn: () => meansQueryService.detail(assessmentId),
  });
  const actions = useQuery({
    queryKey: ['bn-means-actions', assessmentId],
    queryFn: () => meansQueryService.availableActions(assessmentId),
  });
  const readiness = useQuery({
    queryKey: ['bn-means-readiness', assessmentId],
    queryFn: () => meansQueryService.calculationReadiness(assessmentId),
  });

  const run = useMutation({
    mutationFn: (input: { command: BnMeansCommandName; payload?: Record<string, unknown> }) =>
      meansCommandService.execute({
        command: input.command,
        assessmentId,
        expectedRowVersion: rowVersion,
        payload: input.payload,
      }),
    onSuccess: (result) => {
      if (result.status === 'FAILED') {
        setCommandError(result);
        return;
      }
      setCommandError(null);
      queryClient.invalidateQueries({ queryKey: ['bn-means-detail', assessmentId] });
      queryClient.invalidateQueries({ queryKey: ['bn-means-actions', assessmentId] });
      queryClient.invalidateQueries({ queryKey: ['bn-means-readiness', assessmentId] });
      queryClient.invalidateQueries({ queryKey: ['bn-means-queue'] });
    },
  });



  if (detail.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (detail.data && detail.data.status !== 'OK') {
    return (
      <Alert variant="destructive">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Assessment unavailable</AlertTitle>
        <AlertDescription>
          {detail.data.status === 'DENIED'
            ? 'You do not have permission to view this assessment.'
            : detail.data.status === 'NOT_FOUND'
              ? 'This assessment no longer exists.'
              : `The assessment could not be loaded (${detail.data.detail ?? detail.data.code ?? 'unknown error'}).`}
        </AlertDescription>
      </Alert>
    );
  }

  const data = (detail.data?.data ?? {}) as Row;
  const assessment = (data.assessment ?? {}) as Row;
  const rowVersion = Number(assessment.row_version ?? 0);
  const currency = String(assessment.currency_code ?? 'XCD');
  const availableActions = (actions.data?.data ?? []) as readonly BnMeansAvailableAction[];
  const actionFor = (command: string) => availableActions.find((a) => a.command === command);

  // MT6 — verification and calculation state, all backend-owned.
  const verifyAction = actionFor('BN_MEANS_VERIFY_INFORMATION');
  const calculateAction = actionFor('BN_MEANS_CALCULATE');
  const factGroups = buildFactGroups(data as Record<string, unknown>, currency);
  const verifications = asRows(data.verifications) as unknown as readonly BnMeansVerificationRecord[];
  const calculations = asRows(data.calculations);
  const latestCalculation = (calculations[0] ?? null) as Record<string, unknown> | null;
  const readinessData =
    readiness.data?.status === 'OK'
      ? ((readiness.data.data ?? null) as BnMeansCalculationReadiness | null)
      : null;
  const readinessUnavailable =
    readiness.isError
      ? 'Readiness could not be loaded. Treat it as unknown, not as ready.'
      : readiness.data && readiness.data.status !== 'OK'
        ? readiness.data.status === 'DENIED'
          ? 'You do not have permission to evaluate calculation readiness.'
          : `Readiness could not be evaluated (${readiness.data.detail ?? readiness.data.code ?? 'unknown error'}).`
        : null;


  const ActionButton: React.FC<{ command: BnMeansCommandName; label: string; payload?: Record<string, unknown> }> = ({
    command,
    label,
    payload,
  }) => {
    const state = actionFor(command);
    const disabled = !state?.allowed || run.isPending;
    return (
      <div className="flex flex-col gap-1">
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => run.mutate({ command, payload })}
        >
          {run.isPending && run.variables?.command === command && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          {label}
        </Button>
        {state && !state.allowed && state.reason && (
          <span className="text-xs text-muted-foreground">
            {REASON_LABEL[state.reason] ?? state.reason}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Work queue
          </Button>
          <div>
            <h2 className="text-xl font-semibold">{String(assessment.assessment_reference ?? '')}</h2>
            <p className="text-sm text-muted-foreground">
              {String(assessment.benefit_programme ?? '')} · {String(assessment.assessment_reason ?? '')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{String(assessment.status ?? '')}</Badge>
          <Badge variant="outline">Version {rowVersion}</Badge>
        </div>
      </div>

      {commandError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{REASON_LABEL[commandError.errorCode ?? ''] ?? 'Command failed'}</AlertTitle>
          <AlertDescription>
            {commandError.errorCode}
            {commandError.errorDetail ? ` — ${commandError.errorDetail}` : ''}
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="context">
        <TabsList className="flex-wrap">
          <TabsTrigger value="context">Context</TabsTrigger>
          <TabsTrigger value="household">Household</TabsTrigger>
          <TabsTrigger value="income">Income</TabsTrigger>
          <TabsTrigger value="assets">Assets</TabsTrigger>
          <TabsTrigger value="deductions">Deductions</TabsTrigger>
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
          <TabsTrigger value="review">Review &amp; submit</TabsTrigger>
          <TabsTrigger value="verification">Verification</TabsTrigger>
          <TabsTrigger value="calculation">Calculation</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>

        </TabsList>

        <TabsContent value="context">
          <Card>
            <CardHeader>
              <CardTitle>Assessment context</CardTitle>
              <CardDescription>Frozen at submission; corrections use a controlled successor version.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {[
                ['Person', assessment.person_id],
                ['Claim', assessment.claim_id],
                ['Award', assessment.award_id],
                ['Effective from', assessment.effective_from],
                ['Effective to', assessment.effective_to],
                ['Policy version', assessment.policy_version_id],
                ['Currency', assessment.currency_code],
                ['Reassessment due', assessment.reassessment_due],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <p className="text-xs uppercase text-muted-foreground">{String(label)}</p>
                  <p className="text-sm">{value === null || value === undefined ? '—' : String(value)}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="household">
          <FactSection
            title="Household members"
            description="Dependency is never inferred from relationship alone."
            rows={asRows(data.household)}
            columns={[
              ['relationship_code', 'Relationship'],
              ['member_from', 'From'],
              ['member_to', 'To'],
              ['is_dependant', 'Dependant'],
              ['verification_status', 'Verification'],
              ['evidence_status', 'Evidence'],
            ]}
            form={
              <InlineFactForm
                fields={[
                  { name: 'relationship_code', label: 'Relationship code', required: true },
                  { name: 'member_from', label: 'Member from', type: 'date', required: true },
                  { name: 'member_to', label: 'Member to', type: 'date' },
                ]}
                submitLabel="Add household member"
                disabled={!actionFor('BN_MEANS_ADD_HOUSEHOLD_MEMBER')?.allowed || run.isPending}
                reason={actionFor('BN_MEANS_ADD_HOUSEHOLD_MEMBER')?.reason ?? null}
                onSubmit={(payload) => run.mutate({ command: 'BN_MEANS_ADD_HOUSEHOLD_MEMBER', payload })}
              />
            }
          />
        </TabsContent>

        <TabsContent value="income">
          <FactSection
            title="Income facts"
            description="Declared amount and frequency are retained; the annualised value is derived server-side."
            rows={asRows(data.income)}
            columns={[
              ['category_code', 'Category'],
              ['declared_amount', 'Declared'],
              ['declared_frequency', 'Frequency'],
              ['normalised_annual_amount', 'Annualised'],
              ['verification_status', 'Verification'],
              ['evidence_status', 'Evidence'],
            ]}
            currency={currency}
            form={
              <InlineFactForm
                fields={[
                  { name: 'category_code', label: 'Income category', required: true },
                  { name: 'declared_amount', label: 'Declared amount', type: 'number', required: true },
                  { name: 'declared_frequency', label: 'Frequency (e.g. MONTHLY)', required: true },
                  { name: 'effective_from', label: 'Effective from', type: 'date', required: true },
                ]}
                submitLabel="Add income"
                disabled={!actionFor('BN_MEANS_ADD_INCOME')?.allowed || run.isPending}
                reason={actionFor('BN_MEANS_ADD_INCOME')?.reason ?? null}
                onSubmit={(payload) => run.mutate({ command: 'BN_MEANS_ADD_INCOME', payload })}
              />
            }
          />
        </TabsContent>

        <TabsContent value="assets">
          <FactSection
            title="Asset facts"
            description="Disregards are decided at calculation, not at intake."
            rows={asRows(data.assets)}
            columns={[
              ['category_code', 'Category'],
              ['valuation_amount', 'Valuation'],
              ['ownership_share', 'Share'],
              ['valuation_date', 'Valued on'],
              ['verification_status', 'Verification'],
            ]}
            currency={currency}
            form={
              <InlineFactForm
                fields={[
                  { name: 'category_code', label: 'Asset category', required: true },
                  { name: 'valuation_amount', label: 'Valuation', type: 'number', required: true },
                  { name: 'valuation_date', label: 'Valuation date', type: 'date', required: true },
                ]}
                submitLabel="Add asset"
                disabled={!actionFor('BN_MEANS_ADD_ASSET')?.allowed || run.isPending}
                reason={actionFor('BN_MEANS_ADD_ASSET')?.reason ?? null}
                onSubmit={(payload) => run.mutate({ command: 'BN_MEANS_ADD_ASSET', payload })}
              />
            }
          />
        </TabsContent>

        <TabsContent value="deductions">
          <FactSection
            title="Deductions and disregards claimed"
            description="A claimed deduction is not applied until it is approved."
            rows={asRows(data.deductions)}
            columns={[
              ['category_code', 'Category'],
              ['claimed_amount', 'Claimed'],
              ['normalised_annual_amount', 'Annualised'],
              ['approval_status', 'Approval'],
              ['verification_status', 'Verification'],
            ]}
            currency={currency}
            form={
              <InlineFactForm
                fields={[
                  { name: 'category_code', label: 'Deduction category', required: true },
                  { name: 'claimed_amount', label: 'Claimed amount', type: 'number', required: true },
                  { name: 'effective_from', label: 'Effective from', type: 'date', required: true },
                ]}
                submitLabel="Claim deduction"
                disabled={!actionFor('BN_MEANS_ADD_DEDUCTION')?.allowed || run.isPending}
                reason={actionFor('BN_MEANS_ADD_DEDUCTION')?.reason ?? null}
                onSubmit={(payload) => run.mutate({ command: 'BN_MEANS_ADD_DEDUCTION', payload })}
              />
            }
          />
        </TabsContent>

        <TabsContent value="evidence">
          <FactSection
            title="Evidence"
            description="Governed document references only — no document content is stored here."
            rows={asRows(data.evidence)}
            columns={[
              ['evidence_type', 'Type'],
              ['dms_document_id', 'Document'],
              ['dms_reference', 'Reference'],
              ['status', 'Status'],
              ['fact_kind', 'Linked fact'],
            ]}
            form={
              <InlineFactForm
                fields={[
                  { name: 'evidence_type', label: 'Evidence type', required: true },
                  { name: 'dms_document_id', label: 'Document ID' },
                  { name: 'dms_reference', label: 'Document reference' },
                ]}
                submitLabel="Attach evidence"
                disabled={!actionFor('BN_MEANS_ATTACH_EVIDENCE')?.allowed || run.isPending}
                reason={actionFor('BN_MEANS_ATTACH_EVIDENCE')?.reason ?? null}
                onSubmit={(payload) => run.mutate({ command: 'BN_MEANS_ATTACH_EVIDENCE', payload })}
              />
            }
          />
        </TabsContent>

        <TabsContent value="review">
          <Card>
            <CardHeader>
              <CardTitle>Completeness review and submission</CardTitle>
              <CardDescription>
                Submission freezes the assessment version. Later corrections require a successor
                version, a return-to-information flow or the adjustment process.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Summary label="Household members" value={asRows(data.household).length} />
                <Summary label="Income facts" value={asRows(data.income).length} />
                <Summary label="Evidence items" value={asRows(data.evidence).length} />
              </div>
              <div className="flex flex-wrap gap-4">
                <ActionButton command="BN_MEANS_SUBMIT" label="Submit assessment" />
              </div>
              <div>
                <p className="mb-2 text-xs uppercase text-muted-foreground">Frozen versions</p>
                {asRows(data.versions).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No frozen version yet.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {asRows(data.versions).map((v) => (
                      <li key={String(v.assessment_version_id)}>
                        v{String(v.version_no)} · {String(v.frozen_reason)} ·{' '}
                        <span className="font-mono text-xs">{String(v.snapshot_hash).slice(0, 12)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="verification">
          <BnMeansVerificationPanel
            groups={factGroups}
            verifications={verifications}
            canVerify={Boolean(verifyAction?.allowed) && !run.isPending}
            disabledReason={
              verifyAction?.allowed
                ? null
                : REASON_LABEL[verifyAction?.reason ?? ''] ?? verifyAction?.reason ?? 'not currently available'
            }
            busy={run.isPending}
            onVerify={(input) =>
              run.mutate({
                command: 'BN_MEANS_VERIFY_INFORMATION',
                payload: {
                  fact_kind: input.factKind,
                  fact_id: input.factId,
                  outcome: input.outcome,
                  reason_code: input.reasonCode ?? null,
                  notes: input.note ?? null,
                },
              })
            }
          />
        </TabsContent>

        <TabsContent value="calculation">
          <BnMeansCalculationPanel
            readiness={readinessData}
            readinessUnavailable={readinessUnavailable}
            calculation={latestCalculation}
            currency={currency}
            canCalculate={Boolean(calculateAction?.allowed) && !run.isPending}
            calculateReason={
              calculateAction?.allowed
                ? null
                : REASON_LABEL[calculateAction?.reason ?? ''] ??
                  calculateAction?.reason ??
                  'Calculation is not currently available'
            }
            busy={run.isPending}
            onCalculate={() => run.mutate({ command: 'BN_MEANS_CALCULATE' })}
          />
        </TabsContent>

        <TabsContent value="timeline">

          <Card>
            <CardHeader>
              <CardTitle>Audit timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {asRows(data.timeline).length === 0 ? (
                <p className="text-sm text-muted-foreground">No events recorded.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {asRows(data.timeline).map((e) => (
                    <li key={String(e.event_id)} className="border-l-2 border-border pl-3">
                      <p className="font-medium">{String(e.event_code)}</p>
                      <p className="text-xs text-muted-foreground">
                        {String(e.command_name ?? '')} · {String(e.from_status ?? '—')} →{' '}
                        {String(e.to_status ?? '—')} · {String(e.created_at)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

const Summary: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-md border border-border p-3">
    <p className="text-xs uppercase text-muted-foreground">{label}</p>
    <p className="text-2xl font-semibold">{value}</p>
  </div>
);

interface FactSectionProps {
  title: string;
  description: string;
  rows: Row[];
  columns: readonly (readonly [string, string])[];
  form: React.ReactNode;
  currency?: string;
}

const MONEY_FIELDS = new Set([
  'declared_amount',
  'normalised_annual_amount',
  'valuation_amount',
  'claimed_amount',
]);

const FactSection: React.FC<FactSectionProps> = ({ title, description, rows, columns, form, currency }) => (
  <Card>
    <CardHeader>
      <CardTitle>{title}</CardTitle>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-6">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map(([key, label]) => (
                <TableHead key={key}>{label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={String(row.member_id ?? row.income_fact_id ?? row.asset_fact_id ?? row.deduction_fact_id ?? row.evidence_id ?? index)}>
                {columns.map(([key]) => {
                  const value = row[key];
                  const display =
                    value === null || value === undefined
                      ? '—'
                      : MONEY_FIELDS.has(key) && currency
                        ? formatWithCurrency(Number(value), currency)
                        : typeof value === 'boolean'
                          ? value ? 'Yes' : 'No'
                          : String(value);
                  return <TableCell key={key}>{display}</TableCell>;
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {form}
    </CardContent>
  </Card>
);

interface InlineField {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'date';
  required?: boolean;
}

interface InlineFactFormProps {
  fields: readonly InlineField[];
  submitLabel: string;
  disabled: boolean;
  reason: string | null;
  onSubmit: (payload: Record<string, unknown>) => void;
}

/** Entered data is preserved after a recoverable command failure. */
const InlineFactForm: React.FC<InlineFactFormProps> = ({ fields, submitLabel, disabled, reason, onSubmit }) => {
  const [values, setValues] = React.useState<Record<string, string>>({});
  const missing = fields.filter((f) => f.required && !values[f.name]?.trim()).map((f) => f.label);

  return (
    <form
      className="space-y-3 rounded-md border border-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (missing.length > 0) return;
        const payload: Record<string, unknown> = {};
        for (const field of fields) {
          const raw = values[field.name]?.trim();
          if (!raw) continue;
          payload[field.name] = field.type === 'number' ? Number(raw) : raw;
        }
        onSubmit(payload);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {fields.map((field) => (
          <div key={field.name} className="space-y-1">
            <Label htmlFor={field.name}>{field.label}</Label>
            <Input
              id={field.name}
              type={field.type ?? 'text'}
              value={values[field.name] ?? ''}
              disabled={disabled}
              onChange={(event) =>
                setValues((prev) => ({ ...prev, [field.name]: event.target.value }))
              }
            />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" disabled={disabled || missing.length > 0}>
          {submitLabel}
        </Button>
        {missing.length > 0 && (
          <span className="text-xs text-muted-foreground">Required: {missing.join(', ')}</span>
        )}
        {disabled && reason && (
          <span className="text-xs text-muted-foreground">{REASON_LABEL[reason] ?? reason}</span>
        )}
      </div>
    </form>
  );
};

export default BnMeansAssessmentWorkspace;
