/**
 * RateTableHeaderForm — create/edit dialog for a bn_rate_table header + its dimensions.
 *
 * Improvements over v1:
 *  - Country pulled from Country Pack registry (default SKN), not free text.
 *  - Table Type / Lookup Mode use business labels.
 *  - Status is read-only on the form; lifecycle actions (Save Draft / Submit / Activate / Retire)
 *    are exposed as explicit buttons.
 *  - Dimensions configured via DimensionSourcePicker — keys/labels/types/match-types auto-filled
 *    from Fact, Derived Fact, Product Parameter, or Field registries.
 *  - Match Type dropdown restricted to combinations valid for the chosen dimension type.
 *  - Responsive modal via BNModalShell (sticky header/footer, internal scroll, max-h 85vh).
 *  - Pre-save validation: blank keys, duplicate keys, invalid country, missing effective date
 *    when moving to ACTIVE.
 */
import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Loader2, Save, Send, CheckCircle2, Archive, AlertTriangle } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { requireUserCode } from '@/lib/bn/requireUserCode';
import { clearRateTableCache } from '@/services/bn/calc/rateTableLookup';
import { BNModalShell } from '@/components/bn/shared/BNModalShell';
import { useBnCountries } from '@/hooks/bn/useBnConfig';
import { DimensionSourcePicker } from './DimensionSourcePicker';
import {
  DIMENSION_TYPES, matchTypesFor, type DimensionType, type MatchType, type DimensionSourceKind,
} from '@/services/bn/rateTableDimensionSources';
import { useReferenceValues } from '@/hooks/bn/useReferenceData';
import { BN_REF_GROUPS } from '@/services/bn/referenceDataService';
import { BnBusyButton } from '@/components/bn/shared';

// Fallback values (used only if the reference-data tables are unreachable).
const TABLE_TYPES_FALLBACK = [
  { value: 'TIER', label: 'Tier Table', description: 'Stepped tiers (e.g. age bands)' },
  { value: 'RATE_TABLE', label: 'Rate Table', description: 'Single rate per row' },
  { value: 'MATRIX', label: 'Matrix Table', description: 'Multi-dimension cross lookup' },
  { value: 'CAP_TABLE', label: 'Cap Table', description: 'Min/max limits' },
  { value: 'SHARE_TABLE', label: 'Share Table', description: 'Beneficiary % shares' },
  { value: 'CONDITION_TABLE', label: 'Condition Table', description: 'Flag / boolean lookup' },
];
/**
 * The database permits exactly these four:
 *   CHECK (lookup_mode IN ('FIRST_MATCH','EXACT_MATCH','RANGE_MATCH','MATRIX_MATCH'))
 *
 * This list previously offered SINGLE and COMPOSITE — neither of which is
 * allowed — so every rate table and matrix save was rejected with
 * "violates check constraint bn_rate_table_lookup_mode_check", whichever
 * button was pressed. The reference-data group these options are meant to come
 * from does not exist in this database, so the fallback is always what the user
 * sees; it therefore has to be right.
 *
 * Labels describe the behaviour, since the codes do not explain themselves.
 */
const LOOKUP_MODES_FALLBACK = [
  { value: 'EXACT_MATCH', label: 'Exact match', description: 'Row value must equal the input exactly' },
  { value: 'RANGE_MATCH', label: 'Range match', description: 'Input falls between the row’s from/to values' },
  { value: 'FIRST_MATCH', label: 'First match', description: 'First row whose conditions are met wins' },
  { value: 'MATRIX_MATCH', label: 'Matrix match', description: 'Cross-lookup on two or more dimensions' },
];

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  REVIEW: 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200',
  ACTIVE: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200',
  RETIRED: 'bg-slate-200 text-slate-700 dark:bg-slate-700/40 dark:text-slate-300',
};

interface DimDraft {
  id?: string;
  dimension_key: string;
  dimension_label: string;
  dimension_type: DimensionType;
  match_type: MatchType;
  sequence_no: number;
  source_kind?: DimensionSourceKind;
  _dirty?: boolean;
  _new?: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  rateTableId?: string | null;
  onSaved?: (id: string) => void;
  /**
   * Which kind of table is being created. The Rate / Tier and Matrix tabs open
   * this same dialog, so without this the Matrix tab showed "New Rate Table".
   * Ignored when editing, where the stored table type is authoritative.
   */
  kind?: 'RATE' | 'MATRIX';
}

const db = supabase as any;

export function RateTableHeaderForm({ open, onClose, rateTableId, onSaved, kind = 'RATE' }: Props) {
  const { profile } = useSupabaseAuth();
  const { data: countries = [] } = useBnCountries();
  const { options: TABLE_TYPES } = useReferenceValues(BN_REF_GROUPS.RATE_TABLE_TYPE, TABLE_TYPES_FALLBACK);
  const { options: LOOKUP_MODES } = useReferenceValues(BN_REF_GROUPS.LOOKUP_MODE, LOOKUP_MODES_FALLBACK);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [header, setHeader] = useState({
    table_code: '', table_name: '', table_type: 'TIER' as string,
    // A permitted value — 'SINGLE' was rejected by the table's CHECK constraint.
    lookup_mode: 'EXACT_MATCH' as string, country_code: 'SKN', version_no: 1,
    status: 'DRAFT', description: '', effective_from: '',
  });
  const [dims, setDims] = useState<DimDraft[]>([]);

  // Default country to SKN if available, else the first active country.
  useEffect(() => {
    if (!countries.length) return;
    const has = countries.some((c: any) => c.country_code === header.country_code);
    if (!has) {
      const skn = countries.find((c: any) => c.country_code === 'SKN' && c.is_active);
      const first = countries.find((c: any) => c.is_active);
      setHeader((h) => ({ ...h, country_code: (skn ?? first)?.country_code ?? h.country_code }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countries.length]);

  useEffect(() => {
    if (!open) return;
    if (!rateTableId) {
      setHeader({
        table_code: '', table_name: '', table_type: 'TIER', lookup_mode: 'EXACT_MATCH',
        country_code: 'SKN', version_no: 1, status: 'DRAFT', description: '', effective_from: '',
      });
      setDims([]);
      return;
    }
    let alive = true;
    (async () => {
      setLoading(true);
      const [h, d] = await Promise.all([
        db.from('bn_rate_table').select('*').eq('id', rateTableId).single(),
        db.from('bn_rate_table_dimension').select('*').eq('rate_table_id', rateTableId).order('sequence_no'),
      ]);
      if (!alive) return;
      if (h.data) setHeader({
        table_code: h.data.table_code, table_name: h.data.table_name, table_type: h.data.table_type,
        lookup_mode: h.data.lookup_mode, country_code: h.data.country_code, version_no: h.data.version_no,
        status: h.data.status, description: h.data.description ?? '', effective_from: h.data.effective_from ?? '',
      });
      setDims(((d.data ?? []) as any[]).map((x) => ({
        ...x,
        dimension_type: (x.dimension_type ?? 'NUMBER') as DimensionType,
      })));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [open, rateTableId]);

  const addDim = () => setDims((arr) => [...arr, {
    dimension_key: '', dimension_label: '', dimension_type: 'NUMBER',
    match_type: 'RANGE', sequence_no: (arr[arr.length - 1]?.sequence_no ?? 0) + 1,
    _new: true, _dirty: true,
  }]);

  const updateDim = (idx: number, patch: Partial<DimDraft>) =>
    setDims((arr) => arr.map((d, i) => {
      if (i !== idx) return d;
      const next = { ...d, ...patch, _dirty: true };
      // if dimension_type changed and match_type no longer allowed → reset to first allowed
      if (patch.dimension_type) {
        const allowed = matchTypesFor(patch.dimension_type);
        if (!allowed.includes(next.match_type)) next.match_type = allowed[0];
      }
      return next;
    }));

  const removeDim = async (idx: number) => {
    const d = dims[idx];
    if (d.id) {
      const { error } = await db.from('bn_rate_table_dimension').delete().eq('id', d.id);
      if (error) { toast.error(error.message); return; }
    }
    setDims((arr) => arr.filter((_, i) => i !== idx));
  };

  /**
   * Existing tables, so a clash is caught at the field rather than by the
   * database at the end of the form.
   *
   * Uniqueness is UNIQUE(table_code, country_code, version_no) — the same code
   * is legitimate for a different version or a different country pack, which is
   * how rate tables are versioned. So all three are compared, and the message
   * points at the version number, since bumping it is usually what the user
   * actually wants.
   */
  const [existing, setExisting] = useState<Array<{
    id: string; table_code: string; country_code: string; version_no: number; table_name: string; status: string;
  }>>([]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      const { data } = await db.from('bn_rate_table')
        .select('id, table_code, country_code, version_no, table_name, status');
      if (alive) setExisting((data ?? []) as any[]);
    })();
    return () => { alive = false; };
  }, [open]);

  const duplicate = useMemo(() => {
    const code = header.table_code.trim().toUpperCase();
    if (!code) return null;
    return existing.find(t =>
      t.table_code?.toUpperCase() === code &&
      t.country_code === header.country_code &&
      Number(t.version_no) === Number(header.version_no) &&
      t.id !== rateTableId,          // editing a table is not a clash with itself
    ) ?? null;
  }, [existing, header.table_code, header.country_code, header.version_no, rateTableId]);

  /** Next free version number for this code and country. */
  const suggestedVersion = useMemo(() => {
    if (!duplicate) return null;
    const code = header.table_code.trim().toUpperCase();
    const taken = existing
      .filter(t => t.table_code?.toUpperCase() === code && t.country_code === header.country_code)
      .map(t => Number(t.version_no))
      .filter(n => Number.isFinite(n));
    return taken.length ? Math.max(...taken) + 1 : null;
  }, [duplicate, existing, header.table_code, header.country_code]);

  const validationErrors = useMemo(() => {
    const errs: string[] = [];
    if (!header.table_code.trim()) errs.push('Code is required');
    if (!header.table_name.trim()) errs.push('Name is required');
    if (duplicate) {
      errs.push(
        `${duplicate.table_code} v${duplicate.version_no} already exists for ${duplicate.country_code}` +
        ` — “${duplicate.table_name}” (${duplicate.status})` +
        (suggestedVersion ? `. Use version ${suggestedVersion}, or edit the existing table.` : '.'),
      );
    }
    if (!header.country_code || !countries.some((c: any) => c.country_code === header.country_code)) {
      errs.push('Pick a valid country pack');
    }
    const keys = new Set<string>();
    for (const d of dims) {
      if (!d.dimension_key.trim()) { errs.push(`Dimension #${d.sequence_no} has no field`); continue; }
      if (keys.has(d.dimension_key)) errs.push(`Duplicate dimension "${d.dimension_key}"`);
      keys.add(d.dimension_key);
    }
    return errs;
  }, [header, dims, countries]);

  const persist = async (nextStatus: string) => {
    let userCode: string;
    try { userCode = requireUserCode(profile?.user_code, 'save rate table'); }
    catch (e: any) { toast.error(e.message); return; }

    const errs = [...validationErrors];
    if (nextStatus === 'ACTIVE' && !header.effective_from) errs.push('Effective date is required to activate');
    if (errs.length) { toast.error(errs[0]); return; }

    setSaving(true);
    setPendingStatus(nextStatus);
    try {
      let id = rateTableId;
      const payload = {
        table_code: header.table_code, table_name: header.table_name, table_type: header.table_type,
        lookup_mode: header.lookup_mode, country_code: header.country_code, version_no: header.version_no,
        status: nextStatus, description: header.description || null,
        effective_from: header.effective_from || null, modified_by: userCode,
      };
      if (!id) {
        const { data, error } = await db.from('bn_rate_table').insert({ ...payload, entered_by: userCode }).select('id').single();
        if (error) throw error;
        id = data.id;
      } else {
        const { error } = await db.from('bn_rate_table').update(payload).eq('id', id);
        if (error) throw error;
      }
      for (const d of dims.filter((x) => x._dirty)) {
        const dPayload = {
          rate_table_id: id, dimension_key: d.dimension_key, dimension_label: d.dimension_label,
          dimension_type: d.dimension_type, match_type: d.match_type, sequence_no: d.sequence_no,
        };
        if (d._new || !d.id) {
          const { error } = await db.from('bn_rate_table_dimension').insert(dPayload);
          if (error) throw error;
        } else {
          const { error } = await db.from('bn_rate_table_dimension').update(dPayload).eq('id', d.id);
          if (error) throw error;
        }
      }
      clearRateTableCache();
      setHeader((h) => ({ ...h, status: nextStatus }));
      toast.success(`Saved (${nextStatus})`);
      onSaved?.(id!);
      onClose();
    } catch (e: any) {
      // Safety net: two users can submit the same code, country and version at
      // the same moment, so the constraint stays the final arbiter — but its
      // wording must never reach the user.
      const msg = String(e?.message ?? '');
      if (/duplicate key|bn_rate_table_table_code/i.test(msg)) {
        toast.error('This table already exists', {
          description: `${header.table_code} v${header.version_no} for ${header.country_code} was just created. Use a different version number.`,
        });
      } else {
        toast.error(msg || 'Save failed');
      }
    } finally {
      setSaving(false);
      setPendingStatus(null);
    }
  };

  const activeCountries = countries.filter((c: any) => c.is_active);
  const status = header.status;

  const footer = (
    <div className="flex flex-wrap items-center gap-2 w-full justify-end">
      <BnBusyButton loading={saving} variant="ghost" onClick={onClose} disabled={saving}>Cancel</BnBusyButton>
      <Button variant="outline" onClick={() => persist('DRAFT')} disabled={saving}>
        {saving && pendingStatus === 'DRAFT' ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
        Save Draft
      </Button>
      {status !== 'ACTIVE' && status !== 'RETIRED' && (
        <Button variant="outline" onClick={() => persist('REVIEW')} disabled={saving}>
          {saving && pendingStatus === 'REVIEW' ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
          Submit for Review
        </Button>
      )}
      {status !== 'ACTIVE' && status !== 'RETIRED' && (
        <Button onClick={() => persist('ACTIVE')} disabled={saving}>
          {saving && pendingStatus === 'ACTIVE' ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
          Activate
        </Button>
      )}
      {status === 'ACTIVE' && (
        <Button variant="destructive" onClick={() => persist('RETIRED')} disabled={saving}>
          {saving && pendingStatus === 'RETIRED' ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Archive className="h-4 w-4 mr-1" />}
          Retire
        </Button>
      )}
    </div>
  );

  return (
    <BNModalShell
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={rateTableId ? 'Edit Table' : kind === 'MATRIX' ? 'Create Matrix' : 'Create Rate Table'}
      size="4xl"
      mode="edit"
      footer={footer}
    >
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-2">
            <Badge className={STATUS_COLORS[status] ?? ''}>{status}</Badge>
            <span className="text-xs text-muted-foreground">Status changes only via the lifecycle actions below.</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Code *</Label>
              <Input value={header.table_code}
                onChange={(e) => setHeader({ ...header, table_code: e.target.value.toUpperCase() })}
                placeholder="AGE_PENSION_RATE_TABLE"
                aria-invalid={!!duplicate}
                className={duplicate ? 'border-destructive' : undefined} />
              {/* Told at the field, not by the database after the whole form is
                  filled in. The version number is named because bumping it is
                  usually what the user wants — the same code with a new version
                  is legitimate. */}
              {duplicate && (
                <p className="mt-1 text-xs text-destructive">
                  <span className="font-mono">{duplicate.table_code}</span> v{duplicate.version_no} already
                  exists for {duplicate.country_code} — “{duplicate.table_name}” ({duplicate.status}).
                  {suggestedVersion && <> Use version <span className="font-medium">{suggestedVersion}</span>, or edit the existing table.</>}
                </p>
              )}
            </div>
            <div>
              <Label>Name *</Label>
              <Input value={header.table_name}
                onChange={(e) => setHeader({ ...header, table_name: e.target.value })} />
            </div>

            <div>
              <Label>Table type</Label>
              <Select value={header.table_type} onValueChange={(v) => setHeader({ ...header, table_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TABLE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      <div className="flex flex-col">
                        <span>{t.label}</span>
                        {t.description && <span className="text-xs text-muted-foreground">{t.description}</span>}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Lookup mode</Label>
              <Select value={header.lookup_mode} onValueChange={(v) => setHeader({ ...header, lookup_mode: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LOOKUP_MODES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Country</Label>
              <Select value={header.country_code} onValueChange={(v) => setHeader({ ...header, country_code: v })}>
                <SelectTrigger><SelectValue placeholder="Select country pack" /></SelectTrigger>
                <SelectContent>
                  {activeCountries.map((c: any) => (
                    <SelectItem key={c.country_code} value={c.country_code}>
                      {c.country_name} ({c.country_code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Version</Label>
              <Input type="number" value={header.version_no}
                onChange={(e) => setHeader({ ...header, version_no: Number(e.target.value) })} />
            </div>

            <div>
              <Label>Effective from {status === 'ACTIVE' && <span className="text-destructive">*</span>}</Label>
              <Input type="date" value={header.effective_from}
                onChange={(e) => setHeader({ ...header, effective_from: e.target.value })} />
            </div>
          </div>

          <div>
            <Label>Description</Label>
            <Textarea rows={2} value={header.description}
              onChange={(e) => setHeader({ ...header, description: e.target.value })} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <Label>Dimensions</Label>
                <p className="text-xs text-muted-foreground">
                  Pick fields from a registered source. Keys, labels, data types and allowed match
                  types are filled in automatically.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={addDim}>
                <Plus className="h-4 w-4 mr-1" />Add dimension
              </Button>
            </div>
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-14">Seq</TableHead>
                    <TableHead className="min-w-[320px]">Source &amp; Field</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead className="w-32">Type</TableHead>
                    <TableHead className="w-32">Match</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dims.map((d, idx) => {
                    const allowed = matchTypesFor(d.dimension_type);
                    return (
                      <TableRow key={d.id ?? `n-${idx}`} className={d._dirty ? 'bg-accent/30' : ''}>
                        <TableCell>
                          <Input type="number" value={d.sequence_no}
                            onChange={(e) => updateDim(idx, { sequence_no: Number(e.target.value) })}
                            className="h-8 w-14" />
                        </TableCell>
                        <TableCell>
                          <DimensionSourcePicker
                            value={{ kind: d.source_kind, dimension_key: d.dimension_key }}
                            onPick={(item) => updateDim(idx, {
                              source_kind: item.kind,
                              dimension_key: item.dimension_key,
                              dimension_label: item.label,
                              dimension_type: item.dimension_type,
                              match_type: item.allowed_match_types[0],
                            })}
                            compact
                          />
                          {d.dimension_key && (
                            <code className="text-[10px] text-muted-foreground font-mono block mt-1">
                              {d.dimension_key}
                            </code>
                          )}
                        </TableCell>
                        <TableCell>
                          <Input value={d.dimension_label}
                            onChange={(e) => updateDim(idx, { dimension_label: e.target.value })}
                            className="h-8" />
                        </TableCell>
                        <TableCell>
                          <Select value={d.dimension_type}
                            onValueChange={(v) => updateDim(idx, { dimension_type: v as DimensionType })}>
                            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {DIMENSION_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Select value={d.match_type}
                            onValueChange={(v) => updateDim(idx, { match_type: v as MatchType })}>
                            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {allowed.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-8 w-8"
                            onClick={() => removeDim(idx)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!dims.length && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-4 text-sm">
                        No dimensions yet — click "Add dimension".
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {validationErrors.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
              <div className="flex items-center gap-1.5 font-medium text-destructive mb-1">
                <AlertTriangle className="h-3.5 w-3.5" />
                Please fix before saving
              </div>
              <ul className="list-disc pl-5 space-y-0.5 text-destructive">
                {validationErrors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </BNModalShell>
  );
}
