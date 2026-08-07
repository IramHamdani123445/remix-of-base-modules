/**
 * MEANS-TEST EPIC 0 — shared Means-Test UX controls.
 *
 * Every later epic renders its fields through these controls so that
 * loading, empty, denied, failed and not-implemented states look and
 * behave identically everywhere. A failed option load is NEVER shown as
 * an empty (and therefore submittable) dropdown.
 */
import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2, Search, X, AlertTriangle } from 'lucide-react';
import type {
  BnMeansLoadState,
  BnMeansOption,
  BnMeansOptionSet,
} from '@/types/bn/meansTests/meansFieldContract';

/* ------------------------------------------------------------------ */
/* shared field shell                                                  */
/* ------------------------------------------------------------------ */

interface FieldShellProps {
  id: string;
  label: string;
  description?: string;
  required?: boolean;
  error?: string | null;
  children: React.ReactNode;
}

export const MeansFieldShell: React.FC<FieldShellProps> = ({
  id, label, description, required, error, children,
}) => (
  <div className="space-y-1.5">
    <Label htmlFor={id} className="flex items-center gap-1">
      <span>{label}</span>
      {required && (
        <span className="text-destructive" aria-hidden="true">*</span>
      )}
      {required && <span className="sr-only">(required)</span>}
    </Label>
    {description && (
      <p id={`${id}-description`} className="text-xs text-muted-foreground">{description}</p>
    )}
    {children}
    {error && (
      <p id={`${id}-error`} role="alert" className="text-xs font-medium text-destructive">
        {error}
      </p>
    )}
  </div>
);

/** Shared non-success renderer for option/lookup states. */
export const MeansStateNotice: React.FC<{
  state: Exclude<BnMeansLoadState, 'SUCCESS'>;
  reason?: string;
  testId?: string;
}> = ({ state, reason, testId }) => {
  const copy: Record<string, string> = {
    LOADING: 'Loading…',
    EMPTY: 'No results',
    DENIED: 'Access denied',
    FAILED: 'Could not be loaded',
    NOT_IMPLEMENTED: 'Not implemented yet',
  };
  const destructive = state === 'FAILED' || state === 'DENIED';
  return (
    <div
      data-testid={testId}
      data-state={state}
      role={destructive ? 'alert' : 'status'}
      className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
        destructive
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : 'border-border bg-muted/40 text-muted-foreground'
      }`}
    >
      {state === 'LOADING' ? (
        <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
      ) : destructive ? (
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      ) : null}
      <span>
        <span className="font-medium">{copy[state]}</span>
        {reason ? <> — {reason}</> : null}
      </span>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* searchable lookup (remote / large datasets)                         */
/* ------------------------------------------------------------------ */

export interface MeansLookupRecord {
  id: string;
  /** Primary human-readable line (e.g. person name). */
  primary: string;
  /** Secondary line (e.g. masked SSN, reference). Never a raw UUID. */
  secondary?: string;
}

export interface MeansSearchLookupProps {
  id: string;
  label: string;
  description?: string;
  required?: boolean;
  placeholder?: string;
  value: MeansLookupRecord | null;
  onChange: (record: MeansLookupRecord | null) => void;
  /** Resolver owned by the calling epic; must classify its own failures. */
  onSearch: (term: string) => Promise<{
    state: BnMeansLoadState;
    records?: readonly MeansLookupRecord[];
    reason?: string;
  }>;
  error?: string | null;
}

export const MeansSearchLookup: React.FC<MeansSearchLookupProps> = ({
  id, label, description, required, placeholder, value, onChange, onSearch, error,
}) => {
  const [term, setTerm] = React.useState('');
  const [state, setState] = React.useState<BnMeansLoadState | null>(null);
  const [reason, setReason] = React.useState<string | undefined>();
  const [records, setRecords] = React.useState<readonly MeansLookupRecord[]>([]);

  async function run() {
    setState('LOADING');
    setReason(undefined);
    try {
      const result = await onSearch(term.trim());
      setRecords(result.records ?? []);
      setReason(result.reason);
      if (result.state === 'SUCCESS' && (result.records ?? []).length === 0) {
        setState('EMPTY');
      } else {
        setState(result.state);
      }
    } catch (err) {
      setRecords([]);
      setState('FAILED');
      setReason(err instanceof Error ? err.message : 'Unexpected lookup error');
    }
  }

  if (value) {
    return (
      <MeansFieldShell id={id} label={label} description={description} required={required} error={error}>
        <div
          data-testid={`${id}-selected`}
          className="flex items-start justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{value.primary}</p>
            {value.secondary && (
              <p className="truncate text-xs text-muted-foreground">{value.secondary}</p>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`Clear ${label}`}
            onClick={() => onChange(null)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </MeansFieldShell>
    );
  }

  return (
    <MeansFieldShell id={id} label={label} description={description} required={required} error={error}>
      <div className="flex gap-2">
        <Input
          id={id}
          value={term}
          placeholder={placeholder ?? 'Search…'}
          aria-describedby={description ? `${id}-description` : undefined}
          aria-invalid={error ? true : undefined}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void run();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={() => void run()} aria-label={`Search ${label}`}>
          <Search className="h-4 w-4" />
        </Button>
      </div>

      {state && state !== 'SUCCESS' && (
        <MeansStateNotice state={state} reason={reason} testId={`${id}-state`} />
      )}

      {state === 'SUCCESS' && records.length > 0 && (
        <ul className="max-h-56 divide-y overflow-auto rounded-md border" data-testid={`${id}-results`}>
          {records.map((record) => (
            <li key={record.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none"
                onClick={() => onChange(record)}
              >
                <span className="block font-medium">{record.primary}</span>
                {record.secondary && (
                  <span className="block text-xs text-muted-foreground">{record.secondary}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </MeansFieldShell>
  );
};

/* ------------------------------------------------------------------ */
/* governed dropdown                                                   */
/* ------------------------------------------------------------------ */

export interface MeansGovernedSelectProps {
  id: string;
  label: string;
  description?: string;
  required?: boolean;
  optionSet: BnMeansOptionSet;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  placeholder?: string;
}

/**
 * Native select on purpose: it is keyboard operable everywhere, is
 * announced correctly and cannot silently drop its options.
 */
export const MeansGovernedSelect: React.FC<MeansGovernedSelectProps> = ({
  id, label, description, required, optionSet, value, onChange, error, placeholder,
}) => {
  const usable = optionSet.state === 'SUCCESS' && optionSet.options.length > 0;

  return (
    <MeansFieldShell id={id} label={label} description={description} required={required} error={error}>
      {!usable ? (
        <MeansStateNotice
          state={optionSet.state === 'SUCCESS' ? 'EMPTY' : optionSet.state}
          reason={optionSet.reason}
          testId={`${id}-state`}
        />
      ) : (
        <select
          id={id}
          data-testid={id}
          value={value}
          required={required}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            [description ? `${id}-description` : null, error ? `${id}-error` : null]
              .filter(Boolean)
              .join(' ') || undefined
          }
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">{placeholder ?? 'Select…'}</option>
          {optionSet.options.map((opt: BnMeansOption) => (
            <option key={opt.value} value={opt.value} disabled={opt.isActive === false}>
              {opt.label}
              {opt.isActive === false ? ' (inactive)' : ''}
            </option>
          ))}
        </select>
      )}
      {usable && value && optionSet.options.find((x) => x.value === value)?.description && (
        <p className="text-xs text-muted-foreground">
          {optionSet.options.find((x) => x.value === value)?.description}
        </p>
      )}
    </MeansFieldShell>
  );
};

/* ------------------------------------------------------------------ */
/* money                                                               */
/* ------------------------------------------------------------------ */

export interface MeansMoneyValidation {
  valid: boolean;
  /** Value in minor units (integer) — never a binary float. */
  minorUnits: number | null;
  error: string | null;
}

/**
 * Validates and converts money using integer minor units. No binary
 * floating-point arithmetic is performed on monetary values.
 */
export function validateMeansMoney(
  raw: string,
  opts: { required?: boolean; allowNegative?: boolean; precision?: number; min?: number; max?: number } = {},
): MeansMoneyValidation {
  const precision = opts.precision ?? 2;
  const text = raw.trim().replace(/,/g, '');
  if (!text) {
    return opts.required
      ? { valid: false, minorUnits: null, error: 'This amount is required' }
      : { valid: true, minorUnits: null, error: null };
  }
  const re = new RegExp(`^-?\\d+(\\.\\d{1,${precision}})?$`);
  if (!re.test(text)) {
    return {
      valid: false,
      minorUnits: null,
      error: `Enter an amount with up to ${precision} decimal place${precision === 1 ? '' : 's'}`,
    };
  }
  const negative = text.startsWith('-');
  if (negative && !opts.allowNegative) {
    return { valid: false, minorUnits: null, error: 'A negative amount is not allowed here' };
  }
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  const padded = (fraction + '0'.repeat(precision)).slice(0, precision);
  const minor = Number(`${whole}${padded}`) * (negative ? -1 : 1);
  const major = minor / 10 ** precision;
  if (opts.min !== undefined && major < opts.min) {
    return { valid: false, minorUnits: null, error: `Must be at least ${opts.min}` };
  }
  if (opts.max !== undefined && major > opts.max) {
    return { valid: false, minorUnits: null, error: `Must be no more than ${opts.max}` };
  }
  return { valid: true, minorUnits: minor, error: null };
}

export interface MeansMoneyInputProps {
  id: string;
  label: string;
  description?: string;
  required?: boolean;
  currency: string;
  value: string;
  onChange: (raw: string, validation: MeansMoneyValidation) => void;
  allowNegative?: boolean;
  precision?: number;
  min?: number;
  max?: number;
  /** Derived values are displayed, never edited. */
  readOnly?: boolean;
  error?: string | null;
}

export const MeansMoneyInput: React.FC<MeansMoneyInputProps> = ({
  id, label, description, required, currency, value, onChange,
  allowNegative, precision = 2, min, max, readOnly, error,
}) => {
  const [touched, setTouched] = React.useState(false);
  const validation = validateMeansMoney(value, { required, allowNegative, precision, min, max });
  const shown = error ?? (touched ? validation.error : null);

  return (
    <MeansFieldShell id={id} label={label} description={description} required={required} error={shown}>
      <div className="flex items-center gap-2">
        <span className="shrink-0 rounded-md border bg-muted px-2 py-2 text-xs font-medium" aria-hidden="true">
          {currency}
        </span>
        <span className="sr-only">{`Amount in ${currency}`}</span>
        <Input
          id={id}
          data-testid={id}
          inputMode="decimal"
          value={value}
          readOnly={readOnly}
          aria-readonly={readOnly || undefined}
          aria-required={required || undefined}
          aria-invalid={shown ? true : undefined}
          aria-describedby={
            [description ? `${id}-description` : null, shown ? `${id}-error` : null]
              .filter(Boolean)
              .join(' ') || undefined
          }
          onBlur={() => setTouched(true)}
          onChange={(e) =>
            onChange(
              e.target.value,
              validateMeansMoney(e.target.value, { required, allowNegative, precision, min, max }),
            )
          }
        />
      </div>
    </MeansFieldShell>
  );
};

/* ------------------------------------------------------------------ */
/* percentage                                                          */
/* ------------------------------------------------------------------ */

export interface MeansPercentageValidation {
  valid: boolean;
  /** Backend representation: a fraction expressed in basis points. */
  basisPoints: number | null;
  error: string | null;
}

export function validateMeansPercentage(
  raw: string,
  opts: { required?: boolean; min?: number; max?: number; precision?: number } = {},
): MeansPercentageValidation {
  const precision = opts.precision ?? 2;
  const min = opts.min ?? 0;
  const max = opts.max ?? 100;
  const text = raw.trim().replace('%', '');
  if (!text) {
    return opts.required
      ? { valid: false, basisPoints: null, error: 'A percentage is required' }
      : { valid: true, basisPoints: null, error: null };
  }
  const re = new RegExp(`^\\d+(\\.\\d{1,${precision}})?$`);
  if (!re.test(text)) {
    return {
      valid: false,
      basisPoints: null,
      error: `Enter a percentage with up to ${precision} decimal place${precision === 1 ? '' : 's'}`,
    };
  }
  const [whole, fraction = ''] = text.split('.');
  const padded = (fraction + '00').slice(0, 2);
  const basisPoints = Number(`${whole}${padded}`);
  const value = basisPoints / 100;
  if (value < min || value > max) {
    return { valid: false, basisPoints: null, error: `Must be between ${min}% and ${max}%` };
  }
  return { valid: true, basisPoints, error: null };
}

export const MeansPercentageInput: React.FC<{
  id: string;
  label: string;
  description?: string;
  required?: boolean;
  value: string;
  onChange: (raw: string, validation: MeansPercentageValidation) => void;
  min?: number;
  max?: number;
  precision?: number;
  error?: string | null;
}> = ({ id, label, description, required, value, onChange, min, max, precision, error }) => {
  const [touched, setTouched] = React.useState(false);
  const validation = validateMeansPercentage(value, { required, min, max, precision });
  const shown = error ?? (touched ? validation.error : null);
  return (
    <MeansFieldShell id={id} label={label} description={description} required={required} error={shown}>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          inputMode="decimal"
          value={value}
          aria-required={required || undefined}
          aria-invalid={shown ? true : undefined}
          aria-describedby={
            [description ? `${id}-description` : null, shown ? `${id}-error` : null]
              .filter(Boolean)
              .join(' ') || undefined
          }
          onBlur={() => setTouched(true)}
          onChange={(e) =>
            onChange(e.target.value, validateMeansPercentage(e.target.value, { required, min, max, precision }))
          }
        />
        <span className="shrink-0 rounded-md border bg-muted px-2 py-2 text-xs font-medium" aria-hidden="true">%</span>
      </div>
    </MeansFieldShell>
  );
};

/* ------------------------------------------------------------------ */
/* date                                                                */
/* ------------------------------------------------------------------ */

export function validateMeansDate(
  raw: string,
  opts: { required?: boolean; minDate?: string; maxDate?: string } = {},
): { valid: boolean; error: string | null } {
  const text = raw.trim();
  if (!text) {
    return opts.required
      ? { valid: false, error: 'A date is required' }
      : { valid: true, error: null };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) {
    return { valid: false, error: 'Enter a valid date' };
  }
  if (opts.minDate && text < opts.minDate) {
    return { valid: false, error: `Cannot be earlier than ${opts.minDate}` };
  }
  if (opts.maxDate && text > opts.maxDate) {
    return { valid: false, error: `Cannot be later than ${opts.maxDate}` };
  }
  return { valid: true, error: null };
}

export const MeansDateField: React.FC<{
  id: string;
  label: string;
  description?: string;
  required?: boolean;
  value: string;
  onChange: (value: string, validation: { valid: boolean; error: string | null }) => void;
  minDate?: string;
  maxDate?: string;
  error?: string | null;
}> = ({ id, label, description, required, value, onChange, minDate, maxDate, error }) => {
  const [touched, setTouched] = React.useState(false);
  const validation = validateMeansDate(value, { required, minDate, maxDate });
  const shown = error ?? (touched ? validation.error : null);
  return (
    <MeansFieldShell id={id} label={label} description={description} required={required} error={shown}>
      <Input
        id={id}
        type="date"
        value={value}
        min={minDate}
        max={maxDate}
        aria-required={required || undefined}
        aria-invalid={shown ? true : undefined}
        aria-describedby={
          [description ? `${id}-description` : null, shown ? `${id}-error` : null]
            .filter(Boolean)
            .join(' ') || undefined
        }
        onBlur={() => setTouched(true)}
        onChange={(e) => onChange(e.target.value, validateMeansDate(e.target.value, { required, minDate, maxDate }))}
      />
    </MeansFieldShell>
  );
};

/* ------------------------------------------------------------------ */
/* boolean and decision controls                                       */
/* ------------------------------------------------------------------ */

export const MeansBooleanField: React.FC<{
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}> = ({ id, label, description, checked, onChange, disabled }) => (
  <div className="flex items-start justify-between gap-4 rounded-md border px-3 py-2">
    <div>
      <Label htmlFor={id}>{label}</Label>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
    <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label} />
  </div>
);

export const MeansDecisionRadioGroup: React.FC<{
  id: string;
  label: string;
  description?: string;
  required?: boolean;
  optionSet: BnMeansOptionSet;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
}> = ({ id, label, description, required, optionSet, value, onChange, error }) => {
  if (optionSet.state !== 'SUCCESS' || optionSet.options.length === 0) {
    return (
      <MeansFieldShell id={id} label={label} description={description} required={required} error={error}>
        <MeansStateNotice
          state={optionSet.state === 'SUCCESS' ? 'EMPTY' : optionSet.state}
          reason={optionSet.reason}
          testId={`${id}-state`}
        />
      </MeansFieldShell>
    );
  }
  return (
    <fieldset className="space-y-2" aria-describedby={description ? `${id}-description` : undefined}>
      <legend className="text-sm font-medium">
        {label}
        {required && <span className="sr-only"> (required)</span>}
      </legend>
      {description && <p id={`${id}-description`} className="text-xs text-muted-foreground">{description}</p>}
      <RadioGroup value={value} onValueChange={onChange} aria-label={label}>
        {optionSet.options.map((opt) => (
          <div key={opt.value} className="flex items-start gap-2">
            <RadioGroupItem id={`${id}-${opt.value}`} value={opt.value} disabled={opt.isActive === false} />
            <Label htmlFor={`${id}-${opt.value}`} className="font-normal">
              {opt.label}
              {opt.description && (
                <span className="block text-xs text-muted-foreground">{opt.description}</span>
              )}
            </Label>
          </div>
        ))}
      </RadioGroup>
      {error && <p role="alert" className="text-xs font-medium text-destructive">{error}</p>}
    </fieldset>
  );
};

/** Small status chip that never relies on colour alone. */
export const MeansStatusChip: React.FC<{ label: string; tone?: 'neutral' | 'warning' | 'positive' }> = ({
  label,
  tone = 'neutral',
}) => (
  <Badge variant={tone === 'warning' ? 'destructive' : tone === 'positive' ? 'default' : 'secondary'}>
    {label}
  </Badge>
);
