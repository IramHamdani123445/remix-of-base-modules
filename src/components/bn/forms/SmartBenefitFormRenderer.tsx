/**
 * SmartBenefitFormRenderer
 *
 * Renders a benefit application form using the Smart Field Registry. Plain
 * <input> boxes are NOT generated for system-known data (person identity,
 * employer, contribution weeks, etc.) — those come from lookup adapters and
 * display as read-only.
 *
 * Editable fields are limited to:
 *   - claim-specific facts (event dates, witnesses, expense amounts, …)
 *   - SSN / employer reg-no (lookup keys)
 *   - declarations, uploads, internal notes, routing
 *
 * Channel rules:
 *   - PUBLIC users cannot free-text verified identity / employer / contribution
 *     fields. Free-text submitted for a publicFreeTextForbidden field that
 *     wasn't lookup-hydrated is rejected at submit time.
 *   - STAFF channels may override a verified field if they hold the configured
 *     permission; an audit row is written (see Override section).
 */
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Search, ShieldCheck, AlertTriangle, FileUp, Link2 } from 'lucide-react';
import { toast } from 'sonner';

import type { FormChannel, FormFieldDef } from '@/services/bn/forms/sectionCatalogue';
import type { FormDefinition, ApplicationPayload } from '@/services/bn/forms/formDefinitionService';
import { validateApplicationPayload, submitApplication } from '@/services/bn/forms/formDefinitionService';
import {
  SMART_FIELD_REGISTRY,
  getSmartFieldDescriptor,
  inferSmartType,
  resolveSmartFieldReadOnly,
  findPublicFreeTextViolations,
  type SmartFieldType,
} from '@/services/bn/forms/smartFieldRegistry';
import {
  lookupPersonBySSN,
  lookupEmployerByRegNo,
  getContributionSummary,
  getDependants,
  getExistingClaims,
  getRequiredDocuments,
  lookupLegacyClaims,
  type ContributionSummaryResult,
  type RequiredDocumentLite,
  type ExistingClaimRecord,
  type LegacyClaimRecord,
} from '@/services/bn/forms/formLookupService';
import type { PersonSummary, EmployerSummary, Dependant } from '@/services/bn/integration';
import PaymentDetailsSection from '@/components/bn/payment/PaymentDetailsSection';
import { BnBusyButton } from '@/components/bn/shared';

interface Props {
  definition: FormDefinition;
  channel: FormChannel;
  initialValues?: Record<string, any>;
  readOnly?: boolean;
  userCode?: string;
  /** Permission gate used by AUTO_OVERRIDE_STAFF fields. */
  hasPermission?: (perm: string) => boolean;
  onSubmitted?: (claimId: string) => void;
}

export function SmartBenefitFormRenderer({
  definition,
  channel,
  initialValues,
  readOnly,
  userCode,
  hasPermission = () => false,
  onSubmitted,
}: Props) {
  // ─── State ──────────────────────────────────────────────────────
  const [values, setValues] = useState<Record<string, any>>(() => ({
    product_code: definition.productCode,
    ...(initialValues ?? {}),
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [person, setPerson] = useState<PersonSummary | null>(null);
  const [personLoading, setPersonLoading] = useState(false);
  const [personError, setPersonError] = useState<string | null>(null);
  const [hydratedFields, setHydratedFields] = useState<Set<string>>(new Set());

  const [employer, setEmployer] = useState<EmployerSummary | null>(null);
  const [employerLoading, setEmployerLoading] = useState(false);
  const [employerError, setEmployerError] = useState<string | null>(null);

  const [contribution, setContribution] = useState<ContributionSummaryResult | null>(null);
  const [contributionLoading, setContributionLoading] = useState(false);

  const [dependants, setDependants] = useState<Dependant[]>([]);
  const [existingClaims, setExistingClaims] = useState<ExistingClaimRecord[]>([]);
  const [legacyMatches, setLegacyMatches] = useState<LegacyClaimRecord[]>([]);

  const [uploadedDocs, setUploadedDocs] = useState<Set<string>>(new Set());
  const [docList, setDocList] = useState<RequiredDocumentLite[]>(definition.documents as any);

  const [overrideOpen, setOverrideOpen] = useState<string | null>(null);

  // ─── Derived ────────────────────────────────────────────────────
  const fieldsWithSmart = useMemo(
    () =>
      definition.fields.map(f => {
        const declared = (f.validation_rules?.smart_type as SmartFieldType | undefined) ?? null;
        const smartType = declared ?? inferSmartType(f.field_code);
        return { field: f, smartType };
      }),
    [definition.fields],
  );

  const sectionsGrouped = useMemo(() => {
    const m = new Map<string, typeof fieldsWithSmart>();
    for (const entry of fieldsWithSmart) {
      const code = entry.field.section_code;
      if (!m.has(code)) m.set(code, []);
      m.get(code)!.push(entry);
    }
    return m;
  }, [fieldsWithSmart]);

  const requiredCount = useMemo(
    () => definition.fields.filter(f => f.is_required).length,
    [definition.fields],
  );
  const errorCount = attempted ? Object.keys(errors).length : 0;

  // ─── Effects: refresh documents when product version changes ────
  useEffect(() => {
    (async () => {
      if (!definition.productVersionId) return;
      const docs = await getRequiredDocuments(definition.productVersionId, channel);
      if (docs.length) setDocList(docs);
    })();
  }, [definition.productVersionId, channel]);

  // ─── Helpers ────────────────────────────────────────────────────
  function setField(code: string, value: any) {
    setValues(prev => ({ ...prev, [code]: value }));
    if (errors[code]) {
      setErrors(prev => {
        const n = { ...prev };
        delete n[code];
        return n;
      });
    }
  }

  function markHydrated(...codes: string[]) {
    setHydratedFields(prev => {
      const n = new Set(prev);
      codes.forEach(c => n.add(c));
      return n;
    });
  }

  async function runSSNLookup(ssn: string) {
    if (!ssn) {
      setPerson(null);
      setPersonError(null);
      return;
    }
    setPersonLoading(true);
    setPersonError(null);
    try {
      const res = await lookupPersonBySSN(ssn);
      if (!res.found || !res.person) {
        setPerson(null);
        setPersonError(res.reason === 'NOT_FOUND' ? 'No person found for this SSN.' : (res.error ?? 'Lookup failed.'));
        return;
      }
      setPerson(res.person);
      // Hydrate identity fields
      const p = res.person;
      const [first, ...rest] = (p.fullName ?? '').split(' ');
      const last = rest.join(' ').trim();
      setValues(prev => ({
        ...prev,
        ssn: p.ssn,
        claimant_first_name: first ?? '',
        claimant_last_name: last,
        claimant_phone: prev.claimant_phone || p.phone || '',
        claimant_email: prev.claimant_email || p.email || '',
      }));
      markHydrated('ssn', 'claimant_first_name', 'claimant_last_name');

      // Side-effects: dependants, existing claims, contribution
      const [deps, existing] = await Promise.all([
        getDependants(p.ssn),
        getExistingClaims(p.ssn, definition.productCode),
      ]);
      setDependants(deps);
      setExistingClaims(existing);

      const claimDate = values.claim_date ?? new Date().toISOString().slice(0, 10);
      setContributionLoading(true);
      try {
        const summary = await getContributionSummary(p.ssn, claimDate, definition.productVersionId);
        setContribution(summary);
      } finally {
        setContributionLoading(false);
      }
    } catch (e: any) {
      setPerson(null);
      setPersonError(e?.message ?? 'Lookup failed.');
    } finally {
      setPersonLoading(false);
    }
  }

  async function runEmployerLookup(regNo: string) {
    if (!regNo) {
      setEmployer(null);
      setEmployerError(null);
      return;
    }
    setEmployerLoading(true);
    setEmployerError(null);
    try {
      const res = await lookupEmployerByRegNo(regNo);
      if (!res.found || !res.employer) {
        setEmployer(null);
        setEmployerError(res.reason === 'NOT_FOUND' ? 'No employer found.' : (res.error ?? 'Lookup failed.'));
        return;
      }
      setEmployer(res.employer);
      setField('employer_regno', res.employer.regNo);
      markHydrated('employer_regno');
    } finally {
      setEmployerLoading(false);
    }
  }

  async function runLegacyLookup() {
    if (!person?.ssn) {
      toast.info('Resolve an SSN first.');
      return;
    }
    const rows = await lookupLegacyClaims(person.ssn);
    setLegacyMatches(rows);
    if (!rows.length) toast.info('No legacy claims found.');
  }

  function toggleDoc(code: string) {
    setUploadedDocs(prev => {
      const n = new Set(prev);
      n.has(code) ? n.delete(code) : n.add(code);
      return n;
    });
  }

  // ─── Submit ─────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAttempted(true);

    // Block public free-text into forbidden smart fields
    const publicViolations = findPublicFreeTextViolations(
      fieldsWithSmart
        .filter(({ smartType }) => smartType)
        .map(({ field, smartType }) => ({
          fieldCode: field.field_code,
          type: smartType as SmartFieldType,
          lookupHydrated: hydratedFields.has(field.field_code),
          value: values[field.field_code],
        })),
      channel,
    );
    if (publicViolations.length) {
      const errMap: Record<string, string> = {};
      publicViolations.forEach(c => {
        errMap[c] = 'This field must come from SSN / Employer lookup. Free-text entry is not allowed.';
      });
      setErrors(errMap);
      toast.error('Please use lookup to fill these fields.', {
        description: publicViolations.join(', '),
      });
      return;
    }

    const payload: ApplicationPayload = {
      productCode: definition.productCode,
      claimDate: values.claim_date ?? new Date().toISOString().slice(0, 10),
      values: {
        ...values,
        // Snapshot hints — picked up by claim intake RPC
        _person_snapshot: person ?? undefined,
        _employer_snapshot: employer ?? undefined,
        _contribution_snapshot: contribution ?? undefined,
        _dependants_snapshot: dependants,
        _linked_legacy_refs: legacyMatches.map(l => l.legacy_ref),
      },
      uploadedDocumentTypeCodes: Array.from(uploadedDocs),
      userCode,
    };

    const validation = validateApplicationPayload(payload, definition);
    if (validation.length) {
      const map: Record<string, string> = {};
      validation.forEach(v => {
        map[v.field] = v.message;
      });
      setErrors(map);
      toast.error('Please check the form for valid information!', {
        description: validation[0]?.message,
      });
      return;
    }

    setSubmitting(true);
    try {
      const result = await submitApplication(payload, channel);
      if (result.errors?.length) {
        const map: Record<string, string> = {};
        result.errors.forEach(v => {
          map[v.field] = v.message;
        });
        setErrors(map);
        toast.error('Submission failed', { description: result.errors[0]?.message });
        return;
      }
      toast.success('Application submitted', { description: `Claim #${result.claimId}` });
      onSubmitted?.(result.claimId);
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Render ─────────────────────────────────────────────────────
  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-4">
      <Alert>
        <AlertTitle className="flex items-center gap-2">
          {definition.productCode} <Badge variant="secondary">{channel}</Badge>
          <Badge variant="outline" className="ml-auto">Smart Form</Badge>
        </AlertTitle>
        <AlertDescription>
          Verified data comes from the platform registry. {requiredCount} required field
          {requiredCount === 1 ? '' : 's'}. Only claim-specific facts are editable here.
        </AlertDescription>
      </Alert>

      {errorCount > 0 && (
        <Alert variant="destructive">
          <AlertTitle>Please check the form</AlertTitle>
          <AlertDescription>
            {errorCount} field{errorCount === 1 ? '' : 's'} need attention.
          </AlertDescription>
        </Alert>
      )}

      {existingClaims.length > 0 && (
        <Alert>
          <AlertTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Existing claims for this person
          </AlertTitle>
          <AlertDescription>
            <ul className="text-xs mt-1 space-y-0.5">
              {existingClaims.slice(0, 5).map(c => (
                <li key={c.id}>
                  {c.claim_number ?? c.id} — {c.product_code ?? '—'} — {c.status ?? '—'} ({c.claim_date ?? '—'})
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {definition.sections.map(section => {
        const sectionEntries = sectionsGrouped.get(section.section_code) ?? [];
        if (!sectionEntries.length && section.section_code !== 'documents') return null;

        return (
          <Card key={section.section_code}>
            <CardHeader>
              <CardTitle className="text-base">{section.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Render contribution / person / employer summary panels inline */}
              {section.section_code === 'insured_person_details' && (
                <PersonSummaryPanel
                  person={person}
                  loading={personLoading}
                  error={personError}
                />
              )}
              {section.section_code === 'employment_details' && (
                <EmployerSummaryPanel
                  employer={employer}
                  loading={employerLoading}
                  error={employerError}
                />
              )}
              {section.section_code === 'contribution_context' && (
                <ContributionSummaryPanel
                  summary={contribution}
                  loading={contributionLoading}
                />
              )}

              {section.section_code === 'banking_payee_details' ? (
                values.ssn ? (
                  <PaymentDetailsSection
                    mode={readOnly ? 'view' : 'edit'}
                    channel={
                      channel === 'PUBLIC'
                        ? 'PUBLIC_ONLINE'
                        : channel === 'ASSISTED_OFFLINE'
                          ? 'ASSISTED_COUNTER'
                          : 'STAFF_OFFLINE'
                    }
                    productId={definition.productId ?? null}
                    personSsn={String(values.ssn)}
                    userCode={userCode}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Payment details become available once the SSN is captured above.
                  </p>
                )
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {sectionEntries.map(({ field, smartType }) => (
                    <SmartFieldRenderer
                      key={field.field_code}
                      field={field}
                      smartType={smartType}
                      value={values[field.field_code]}
                      error={errors[field.field_code]}
                      readOnly={readOnly}
                      channel={channel}
                      hasPermission={hasPermission}
                      hydrated={hydratedFields.has(field.field_code)}
                      dependants={dependants}
                      onChange={v => setField(field.field_code, v)}
                      onSSNLookup={runSSNLookup}
                      onEmployerLookup={runEmployerLookup}
                      onLegacyLookup={runLegacyLookup}
                      onRequestOverride={() => setOverrideOpen(field.field_code)}
                      legacyMatches={legacyMatches}
                    />
                  ))}
                </div>
              )}

              {section.section_code === 'documents' && (
                <DocumentChecklistPanel
                  documents={docList}
                  uploaded={uploadedDocs}
                  toggle={toggleDoc}
                  channel={channel}
                  errors={errors}
                  readOnly={readOnly}
                />
              )}
            </CardContent>
          </Card>
        );
      })}

      {overrideOpen && (
        <OverrideRequestPanel
          fieldCode={overrideOpen}
          onCancel={() => setOverrideOpen(null)}
          onConfirm={(reason) => {
            toast.success(`Override request logged for ${overrideOpen}`, { description: reason });
            setOverrideOpen(null);
          }}
        />
      )}

      {!readOnly && (
        <div className="flex justify-end gap-2">
          <BnBusyButton loading={submitting} type="submit" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit Application'}
          </BnBusyButton>
        </div>
      )}
    </form>
  );
}

// ────────────────────────────────────────────────────────────────────
// Sub-renderers
// ────────────────────────────────────────────────────────────────────

interface SmartFieldRendererProps {
  field: FormFieldDef;
  smartType: SmartFieldType | null;
  value: any;
  error?: string;
  readOnly?: boolean;
  channel: FormChannel;
  hasPermission: (perm: string) => boolean;
  hydrated: boolean;
  dependants: Dependant[];
  legacyMatches: LegacyClaimRecord[];
  onChange: (v: any) => void;
  onSSNLookup: (ssn: string) => void | Promise<void>;
  onEmployerLookup: (regNo: string) => void | Promise<void>;
  onLegacyLookup: () => void | Promise<void>;
  onRequestOverride: () => void;
}

function SmartFieldRenderer(props: SmartFieldRendererProps) {
  const { field, smartType, value, error, readOnly, channel, hasPermission, hydrated, dependants, onChange, onSSNLookup, onEmployerLookup, onLegacyLookup, onRequestOverride, legacyMatches } = props;

  const smartReadOnly =
    smartType ? resolveSmartFieldReadOnly(smartType, channel, hasPermission) : false;
  const disabled = readOnly || smartReadOnly || !!field.validation_rules?.readOnly;
  const errCls = error ? 'border-destructive focus-visible:ring-destructive' : '';

  const descriptor = smartType ? getSmartFieldDescriptor(smartType) : null;

  // Skip rendering smart fields that aren't visible to the current channel.
  if (descriptor && !descriptor.channels.includes(channel)) return null;

  function header() {
    return (
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm">
          {field.field_label}
          {field.is_required && <span className="text-destructive"> *</span>}
        </Label>
        {smartType && (
          <div className="flex items-center gap-1">
            {hydrated && <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />}
            <Badge variant="outline" className="text-[10px] uppercase">{smartType}</Badge>
            {descriptor?.editability === 'AUTO_OVERRIDE_STAFF' && channel !== 'PUBLIC' && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={onRequestOverride}
                disabled={!hasPermission(descriptor.staffOverridePermission ?? '')}
              >
                Override
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  // ─── Smart-typed controls ────────────────────────────────────────
  if (smartType === 'SSN_LOOKUP') {
    return (
      <div className="space-y-1">
        {header()}
        <div className="flex gap-2">
          <Input
            value={value ?? ''}
            onChange={e => onChange(e.target.value)}
            onBlur={e => onSSNLookup(e.target.value)}
            disabled={disabled}
            className={errCls}
            placeholder="Enter SSN…"
            inputMode="numeric"
          />
          <Button type="button" variant="secondary" onClick={() => onSSNLookup(value ?? '')} disabled={disabled}>
            <Search className="h-4 w-4" />
          </Button>
        </div>
        {error && <p className="text-xs text-destructive mt-1">{error}</p>}
      </div>
    );
  }

  if (smartType === 'EMPLOYER_LOOKUP') {
    return (
      <div className="space-y-1">
        {header()}
        <div className="flex gap-2">
          <Input
            value={value ?? ''}
            onChange={e => onChange(e.target.value)}
            onBlur={e => onEmployerLookup(e.target.value)}
            disabled={disabled}
            className={errCls}
            placeholder="Employer reg-no…"
          />
          <Button type="button" variant="secondary" onClick={() => onEmployerLookup(value ?? '')} disabled={disabled}>
            <Search className="h-4 w-4" />
          </Button>
        </div>
        {error && <p className="text-xs text-destructive mt-1">{error}</p>}
      </div>
    );
  }

  if (smartType === 'PERSON_READONLY_FIELD') {
    return (
      <div className="space-y-1">
        {header()}
        <Input value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled} className={errCls} />
        {smartReadOnly && (
          <p className="text-[11px] text-muted-foreground">
            Verified from Insured Person registry. {channel !== 'PUBLIC' && 'Use Override to amend.'}
          </p>
        )}
        {error && <p className="text-xs text-destructive mt-1">{error}</p>}
      </div>
    );
  }

  if (smartType === 'DEPENDANT_SELECTOR') {
    return (
      <div className="space-y-1 md:col-span-2">
        {header()}
        {dependants.length === 0 && (
          <p className="text-xs text-muted-foreground">No registered dependants.</p>
        )}
        {dependants.map((d, i) => {
          const id = d.ssn ?? `${d.fullName}-${i}`;
          const checked = Array.isArray(value) && value.includes(id);
          return (
            <div key={id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={checked}
                onCheckedChange={c => {
                  const arr: string[] = Array.isArray(value) ? [...value] : [];
                  if (c) arr.push(id);
                  else arr.splice(arr.indexOf(id), 1);
                  onChange(arr);
                }}
                disabled={disabled}
              />
              <span>{d.fullName} <span className="text-muted-foreground">({d.relationship}, {d.dateOfBirth})</span></span>
            </div>
          );
        })}
        {error && <p className="text-xs text-destructive mt-1">{error}</p>}
      </div>
    );
  }

  if (smartType === 'RELATIONSHIP_SELECTOR') {
    const opts: string[] = field.validation_rules?.options ?? ['SPOUSE', 'CHILD', 'DEPENDANT_PARENT', 'OTHER'];
    return (
      <div className="space-y-1">
        {header()}
        <Select value={value ?? ''} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger className={errCls}><SelectValue placeholder="Select…" /></SelectTrigger>
          <SelectContent>
            {opts.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
        {error && <p className="text-xs text-destructive mt-1">{error}</p>}
      </div>
    );
  }

  if (smartType === 'DECLARATION_CHECKBOX') {
    return (
      <div className="space-y-1 md:col-span-2">
        <div className="flex items-start gap-2">
          <Checkbox checked={!!value} onCheckedChange={v => onChange(!!v)} disabled={disabled} />
          <Label className="text-sm">
            {field.field_label}
            {field.is_required && <span className="text-destructive"> *</span>}
          </Label>
        </div>
        {field.help_text && <p className="text-xs text-muted-foreground">{field.help_text}</p>}
        {error && <p className="text-xs text-destructive mt-1">{error}</p>}
      </div>
    );
  }

  if (smartType === 'INTERNAL_NOTES') {
    return (
      <div className="space-y-1 md:col-span-2">
        {header()}
        <Textarea value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled} className={errCls} />
        {error && <p className="text-xs text-destructive mt-1">{error}</p>}
      </div>
    );
  }

  if (smartType === 'LEGACY_LOOKUP') {
    return (
      <div className="space-y-1 md:col-span-2">
        {header()}
        <div className="flex gap-2">
          <Input
            value={value ?? ''}
            onChange={e => onChange(e.target.value)}
            disabled={disabled}
            className={errCls}
            placeholder="Legacy claim reference…"
          />
          <Button type="button" variant="secondary" onClick={onLegacyLookup} disabled={disabled}>
            <Link2 className="h-4 w-4 mr-1" /> Search
          </Button>
        </div>
        {legacyMatches.length > 0 && (
          <ul className="text-xs mt-1 space-y-0.5">
            {legacyMatches.map(l => (
              <li key={l.legacy_ref}>
                <button
                  type="button"
                  className="underline text-primary"
                  onClick={() => onChange(l.legacy_ref)}
                >
                  {l.legacy_ref}
                </button>
                {' '}— {l.product_code ?? '—'} ({l.status ?? '—'}, {l.effective_date ?? '—'})
              </li>
            ))}
          </ul>
        )}
        {error && <p className="text-xs text-destructive mt-1">{error}</p>}
      </div>
    );
  }

  if (smartType === 'WORKFLOW_ROUTING') {
    if (field.field_type === 'SELECT') {
      const opts: string[] = field.validation_rules?.options ?? [];
      return (
        <div className="space-y-1">
          {header()}
          <Select value={value ?? ''} onValueChange={onChange} disabled={disabled}>
            <SelectTrigger className={errCls}><SelectValue placeholder="Select…" /></SelectTrigger>
            <SelectContent>
              {opts.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
          {error && <p className="text-xs text-destructive mt-1">{error}</p>}
        </div>
      );
    }
    return (
      <div className="space-y-1">
        {header()}
        <Input value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled} className={errCls} />
        {error && <p className="text-xs text-destructive mt-1">{error}</p>}
      </div>
    );
  }

  if (smartType === 'BANK_ACCOUNT_CAPTURE' || smartType === 'CLAIM_EVENT_DATE') {
    // Reuse plain controls but with smart header
    return <PlainFieldControl field={field} value={value} error={error} disabled={disabled} onChange={onChange} header={header()} />;
  }

  // No smart type → plain renderer
  return <PlainFieldControl field={field} value={value} error={error} disabled={disabled} onChange={onChange} />;
}

function PlainFieldControl({
  field,
  value,
  error,
  disabled,
  onChange,
  header,
}: {
  field: FormFieldDef;
  value: any;
  error?: string;
  disabled?: boolean;
  onChange: (v: any) => void;
  header?: React.ReactNode;
}) {
  const errCls = error ? 'border-destructive focus-visible:ring-destructive' : '';
  let control: React.ReactNode = null;
  switch (field.field_type) {
    case 'TEXTAREA':
      control = <Textarea value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled} className={errCls} />;
      break;
    case 'NUMBER':
      control = <Input type="number" value={value ?? ''} onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))} disabled={disabled} className={errCls} />;
      break;
    case 'DATE':
      control = <Input type="date" value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled} className={errCls} />;
      break;
    case 'EMAIL':
      control = <Input type="email" value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled} className={errCls} />;
      break;
    case 'PHONE':
      control = <Input type="tel" value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled} className={errCls} />;
      break;
    case 'CHECKBOX':
      control = (
        <div className="flex items-center gap-2 pt-2">
          <Checkbox checked={!!value} onCheckedChange={v => onChange(!!v)} disabled={disabled} />
          <span className="text-sm">{field.help_text ?? ''}</span>
        </div>
      );
      break;
    case 'SELECT': {
      const opts: string[] = field.validation_rules?.options ?? [];
      control = (
        <Select value={value ?? ''} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger className={errCls}><SelectValue placeholder="Select…" /></SelectTrigger>
          <SelectContent>
            {opts.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
      );
      break;
    }
    default:
      control = <Input value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled} className={errCls} />;
  }
  return (
    <div className="space-y-1">
      {header ?? (
        <Label className="text-sm">
          {field.field_label}
          {field.is_required && <span className="text-destructive"> *</span>}
        </Label>
      )}
      {control}
      {field.help_text && field.field_type !== 'CHECKBOX' && (
        <p className="text-xs text-muted-foreground">{field.help_text}</p>
      )}
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  );
}

function PersonSummaryPanel({
  person,
  loading,
  error,
}: { person: PersonSummary | null; loading: boolean; error: string | null }) {
  if (loading) return <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Resolving person…</div>;
  if (error) return <Alert variant="destructive"><AlertTitle>SSN lookup failed</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>;
  if (!person) return <p className="text-xs text-muted-foreground">Enter an SSN above to resolve identity.</p>;
  return (
    <div className="rounded border bg-muted/30 p-3 text-sm space-y-1">
      <div className="font-medium flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-emerald-600" />
        {person.fullName}
        <Badge variant="outline">{person.status}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-x-4 text-xs text-muted-foreground">
        <div>SSN: {person.ssn}</div>
        <div>DOB: {person.dateOfBirth}</div>
        <div>Gender: {person.gender}</div>
        {person.phone && <div>Phone: {person.phone}</div>}
        {person.email && <div>Email: {person.email}</div>}
      </div>
    </div>
  );
}

function EmployerSummaryPanel({
  employer,
  loading,
  error,
}: { employer: EmployerSummary | null; loading: boolean; error: string | null }) {
  if (loading) return <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Resolving employer…</div>;
  if (error) return <Alert variant="destructive"><AlertTitle>Employer lookup failed</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>;
  if (!employer) return null;
  return (
    <div className="rounded border bg-muted/30 p-3 text-sm space-y-1">
      <div className="font-medium flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-emerald-600" />
        {employer.name}
        <Badge variant="outline">{employer.status}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-x-4 text-xs text-muted-foreground">
        <div>Reg-No: {employer.regNo}</div>
        {employer.industry && <div>Industry: {employer.industry}</div>}
        {employer.address && <div className="col-span-2">{employer.address}</div>}
      </div>
    </div>
  );
}

function ContributionSummaryPanel({
  summary,
  loading,
}: { summary: ContributionSummaryResult | null; loading: boolean }) {
  if (loading) return <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Loading contribution summary…</div>;
  if (!summary) return null;
  return (
    <div className="rounded border bg-muted/30 p-3 text-sm">
      <div className="font-medium flex items-center gap-2">
        Contribution Window {summary.windowStart} → {summary.windowEnd}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2 text-xs">
        <Metric label="Total Weeks" value={summary.totalWeeks} />
        <Metric label="Paid Weeks" value={summary.paidWeeks} />
        <Metric label="Credited Weeks" value={summary.creditedWeeks} />
        <Metric label="Avg Weekly Wage" value={summary.averageWeeklyWage.toFixed(2)} />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded bg-background p-2 border">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function DocumentChecklistPanel({
  documents,
  uploaded,
  toggle,
  channel,
  errors,
  readOnly,
}: {
  documents: RequiredDocumentLite[];
  uploaded: Set<string>;
  toggle: (code: string) => void;
  channel: FormChannel;
  errors: Record<string, string>;
  readOnly?: boolean;
}) {
  if (!documents.length) {
    return <p className="text-sm text-muted-foreground">No documents configured for this product version.</p>;
  }
  return (
    <div className="space-y-2">
      {documents.map(d => {
        const err = errors[`document:${d.document_type_code}`];
        const isMandatory = d.requirement_level === 'MANDATORY' || d.blocks_submission;
        return (
          <div key={d.id} className="flex items-start gap-2 p-2 border rounded">
            <Checkbox
              checked={uploaded.has(d.document_type_code)}
              onCheckedChange={() => toggle(d.document_type_code)}
              disabled={readOnly}
            />
            <div className="flex-1">
              <div className="text-sm font-medium flex items-center gap-2">
                <FileUp className="h-3.5 w-3.5 text-muted-foreground" />
                {d.description ?? d.document_type_code}
                {isMandatory && <Badge variant="destructive" className="ml-2">Mandatory</Badge>}
              </div>
              {channel !== 'PUBLIC' && !uploaded.has(d.document_type_code) && (
                <p className="text-xs text-muted-foreground">Staff may mark as Pending and upload later.</p>
              )}
              {err && <p className="text-xs text-destructive mt-1">{err}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OverrideRequestPanel({
  fieldCode,
  onCancel,
  onConfirm,
}: { fieldCode: string; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Card className="border-amber-500/60">
      <CardHeader>
        <CardTitle className="text-base">Override Verified Field — {fieldCode}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Label>Justification (audited)</Label>
        <Textarea value={reason} onChange={e => setReason(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button type="button" disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}>
            Submit Override Request
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Re-export smart registry for callers
export { SMART_FIELD_REGISTRY };
