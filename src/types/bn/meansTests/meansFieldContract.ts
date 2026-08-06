/**
 * MEANS-TEST EPIC 0 — shared field-definition contract.
 *
 * This is deliberately NOT a generic form engine. Each epic still designs
 * its own screen and decides layout, grouping and narrative. The contract
 * only standardises *how a single field behaves*: which control renders it,
 * where its options come from, when it is visible, who may edit it and how
 * it is validated.
 */

/** Control types the shared Means-Test controls can render. */
export type BnMeansControlType =
  | 'TEXT'
  | 'TEXTAREA'
  | 'SEARCH_LOOKUP'
  | 'SELECT'
  | 'RADIO'
  | 'CHECKBOX'
  | 'DATE'
  | 'MONEY'
  | 'PERCENTAGE'
  | 'READ_ONLY';

/**
 * Canonical async state for every Means-Test read.
 *
 * A failed read is never an empty read, a denied read is never an empty
 * read, and an unimplemented surface never reports a count.
 */
export type BnMeansLoadState =
  | 'LOADING'
  | 'SUCCESS'
  | 'EMPTY'
  | 'DENIED'
  | 'FAILED'
  | 'NOT_IMPLEMENTED';

export interface BnMeansOption {
  /** Stored technical value (enumeration code or identifier). */
  value: string;
  /** Human-readable business label shown to officers. */
  label: string;
  /** Optional help text / description shown under the label. */
  description?: string;
  /** Inactive options remain visible for historic records but cannot be picked. */
  isActive?: boolean;
}

export interface BnMeansOptionSet {
  state: BnMeansLoadState;
  options: readonly BnMeansOption[];
  /** Present when state is DENIED / FAILED / NOT_IMPLEMENTED. */
  reason?: string;
}

/** Where a field's options come from. */
export type BnMeansOptionSource =
  | { kind: 'NONE' }
  | { kind: 'REFERENCE'; set: string }
  | { kind: 'LOOKUP'; entity: BnMeansLookupEntity }
  | { kind: 'STATIC'; options: readonly BnMeansOption[] };

export type BnMeansLookupEntity =
  | 'PERSON'
  | 'CLAIM'
  | 'AWARD'
  | 'EMPLOYER'
  | 'ASSESSMENT'
  | 'DMS_DOCUMENT';

export interface BnMeansValidationRule {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  /** Money and percentage bounds are expressed in display units. */
  min?: number;
  max?: number;
  /** Decimal places permitted by the control. */
  precision?: number;
  allowNegative?: boolean;
  /** ISO dates. */
  minDate?: string;
  maxDate?: string;
  pattern?: string;
  message?: string;
}

export interface BnMeansFieldDefinition {
  /** Technical field name as stored/sent to the backend. */
  fieldName: string;
  /** Business label shown to the officer. Always visible — never a placeholder. */
  label: string;
  description?: string;
  controlType: BnMeansControlType;
  required?: boolean;
  optionSource?: BnMeansOptionSource;
  /** Reference-data key or command payload key supplying the default. */
  defaultSource?: string;
  validation?: BnMeansValidationRule;
  /**
   * Conditional visibility, evaluated against the current form values by
   * the owning screen. Returning false hides the field entirely.
   */
  visibleWhen?: (values: Readonly<Record<string, unknown>>) => boolean;
  /** Module action required to edit this field (e.g. 'write', 'verify'). */
  permission?: string;
  /** Read-only rule, evaluated against form values and lifecycle state. */
  readOnlyWhen?: (values: Readonly<Record<string, unknown>>) => boolean;
  /** Derived fields are computed by the backend and never posted by the UI. */
  storage: 'STORED' | 'DERIVED';
}

/** Convenience: is this field editable right now? */
export function isMeansFieldEditable(
  field: BnMeansFieldDefinition,
  values: Readonly<Record<string, unknown>>,
  grants: ReadonlySet<string> | readonly string[],
): boolean {
  if (field.storage === 'DERIVED') return false;
  if (field.readOnlyWhen?.(values)) return false;
  if (!field.permission) return true;
  const held = grants instanceof Set ? grants : new Set(grants);
  return held.has(field.permission);
}

/** Convenience: should this field render at all? */
export function isMeansFieldVisible(
  field: BnMeansFieldDefinition,
  values: Readonly<Record<string, unknown>>,
): boolean {
  return field.visibleWhen ? field.visibleWhen(values) === true : true;
}

/**
 * Human-readable presentation of raw lifecycle / reason codes.
 * `INFORMATION_PENDING` becomes `Information pending`.
 */
export function humaniseMeansCode(code: string | null | undefined): string {
  if (!code) return '—';
  const cleaned = code.trim();
  if (!cleaned) return '—';
  const words = cleaned.toLowerCase().split(/[_\s]+/).filter(Boolean);
  if (words.length === 0) return '—';
  return words
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when a value is an internal identifier that must not be shown normally. */
export function isInternalIdentifier(value: unknown): boolean {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}
