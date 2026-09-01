/**
 * BN Application Form Engine
 *
 * Renders a configurable benefit application form from a FormDefinition
 * loaded out of Product Catalogue. Same component is used for INTERNAL,
 * ASSISTED_OFFLINE, and PUBLIC channels — channel-specific visibility is
 * already baked into the definition.
 */
import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
function ValidationSummary({ errorCount }: { errorCount: number }) {
  if (!errorCount) return null;
  return (
    <Alert variant="destructive">
      <AlertTitle>Please check the form</AlertTitle>
      <AlertDescription>{errorCount} field{errorCount === 1 ? '' : 's'} need attention.</AlertDescription>
    </Alert>
  );
}
import type { FormChannel, FormFieldDef } from '@/services/bn/forms/sectionCatalogue';
import type {
  FormDefinition,
  FieldError,
  ApplicationPayload,
} from '@/services/bn/forms/formDefinitionService';
import { validateApplicationPayload, submitApplication } from '@/services/bn/forms/formDefinitionService';
import { BnBusyButton } from '@/components/bn/shared';

interface Props {
  definition: FormDefinition;
  channel: FormChannel;
  initialValues?: Record<string, any>;
  readOnly?: boolean;
  userCode?: string;
  onSubmitted?: (claimId: string) => void;
}

export function ApplicationFormEngine({ definition, channel, initialValues, readOnly, userCode, onSubmitted }: Props) {
  const [values, setValues] = useState<Record<string, any>>(() => ({
    product_code: definition.productCode,
    ...(initialValues ?? {}),
  }));
  const [uploadedDocs, setUploadedDocs] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const requiredFieldCodes = useMemo(
    () => definition.fields.filter(f => f.is_required).map(f => f.field_code),
    [definition.fields],
  );
  const errorCount = attempted ? requiredFieldCodes.filter(c => errors[c]).length : 0;

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

  function toggleDoc(code: string) {
    setUploadedDocs(prev => {
      const n = new Set(prev);
      if (n.has(code)) n.delete(code); else n.add(code);
      return n;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAttempted(true);
    const payload: ApplicationPayload = {
      productCode: definition.productCode,
      claimDate: values.claim_date ?? new Date().toISOString().slice(0, 10),
      values,
      uploadedDocumentTypeCodes: Array.from(uploadedDocs),
      userCode,
    };
    const validation = validateApplicationPayload(payload, definition);
    if (validation.length) {
      const map: Record<string, string> = {};
      validation.forEach(v => { map[v.field] = v.message; });
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
        result.errors.forEach(v => { map[v.field] = v.message; });
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

  const grouped = useMemo(() => {
    const map = new Map<string, FormFieldDef[]>();
    for (const f of definition.fields) {
      if (!map.has(f.section_code)) map.set(f.section_code, []);
      map.get(f.section_code)!.push(f);
    }
    return map;
  }, [definition.fields]);

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-4">
      <Alert>
        <AlertTitle className="flex items-center gap-2">
          {definition.productCode} <Badge variant="secondary">{channel}</Badge>
        </AlertTitle>
        <AlertDescription>
          This form is driven by Product Catalogue configuration. Required documents and workflow are configured per product version.
        </AlertDescription>
      </Alert>

      <ValidationSummary errorCount={errorCount} />

      {definition.sections.map(section => {
        const sectionFields = grouped.get(section.section_code) ?? [];
        if (!sectionFields.length && section.section_code !== 'documents') return null;
        return (
          <Card key={section.section_code}>
            <CardHeader>
              <CardTitle className="text-base">{section.title}</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sectionFields.map(field => (
                <FieldRenderer
                  key={field.field_code}
                  field={field}
                  value={values[field.field_code]}
                  error={errors[field.field_code]}
                  readOnly={readOnly}
                  onChange={v => setField(field.field_code, v)}
                />
              ))}
              {section.section_code === 'documents' && (
                <DocumentChecklist
                  documents={definition.documents}
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

function FieldRenderer({
  field,
  value,
  error,
  readOnly,
  onChange,
}: {
  field: FormFieldDef;
  value: any;
  error?: string;
  readOnly?: boolean;
  onChange: (v: any) => void;
}) {
  const disabled = readOnly || !!field.validation_rules?.readOnly;
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
      <Label className="text-sm">
        {field.field_label}
        {field.is_required && <span className="text-destructive"> *</span>}
      </Label>
      {control}
      {field.help_text && field.field_type !== 'CHECKBOX' && (
        <p className="text-xs text-muted-foreground">{field.help_text}</p>
      )}
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  );
}

function DocumentChecklist({
  documents,
  uploaded,
  toggle,
  channel,
  errors,
  readOnly,
}: {
  documents: FormDefinition['documents'];
  uploaded: Set<string>;
  toggle: (code: string) => void;
  channel: FormChannel;
  errors: Record<string, string>;
  readOnly?: boolean;
}) {
  if (!documents.length) {
    return <p className="text-sm text-muted-foreground col-span-2">No documents configured for this product version.</p>;
  }
  return (
    <div className="col-span-2 space-y-2">
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
              <div className="text-sm font-medium">
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
