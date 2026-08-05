/**
 * BN Medical Reviews — approved-provider picker.
 *
 * Providers are ONLY chosen from the secured provider-search RPC. Free-text
 * entry of a provider UUID is deliberately impossible: the control renders a
 * search box and a result list, and the selected id can only come from a row
 * the server returned.
 */
import React, { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Search, ShieldCheck, ShieldAlert } from 'lucide-react';
import {
  medicalReviewQueryService,
  type ProviderSearchRow,
} from '@/services/bn/medicalReviewQueryService';
import { describeMedicalReviewFailure } from '@/features/bn/medical-reviews/model/errors';

export const PROVIDER_SEARCH_MIN_CHARS = 3;

interface Props {
  value: string | null;
  onChange: (providerId: string | null, row: ProviderSearchRow | null) => void;
  reviewType?: string | null;
  productId?: string | null;
  disabled?: boolean;
}

const detail = (row: ProviderSearchRow, keys: string[]): string => {
  for (const k of keys) {
    const v = row.raw[k];
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (typeof v === 'number') return String(v);
  }
  return '—';
};

export const ProviderPicker: React.FC<Props> = ({
  value,
  onChange,
  reviewType,
  productId,
  disabled,
}) => {
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState<ProviderSearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (term.trim().length < PROVIDER_SEARCH_MIN_CHARS) {
      setRows([]);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      medicalReviewQueryService
        .providerSearch(term.trim(), { reviewType: reviewType ?? null, productId: productId ?? null })
        .then((r) => {
          if (!cancelled) setRows(r.rows);
        })
        .catch((e) => {
          if (!cancelled) setError(describeMedicalReviewFailure(e));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term, reviewType, productId]);

  return (
    <div className="space-y-2" data-testid="mr-provider-picker">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-8"
          value={term}
          disabled={disabled}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search approved providers by name, registration or specialty…"
          aria-label="Search approved medical providers"
        />
      </div>

      {term.trim().length > 0 && term.trim().length < PROVIDER_SEARCH_MIN_CHARS && (
        <p className="text-xs text-muted-foreground" data-testid="mr-provider-search-min">
          Enter at least {PROVIDER_SEARCH_MIN_CHARS} characters to search.
        </p>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading && <Skeleton className="h-16 w-full" />}

      <div className="max-h-64 space-y-2 overflow-y-auto">
        {rows.map((row) => {
          const selected = value === row.providerId;
          return (
            <button
              key={row.providerId}
              type="button"
              disabled={disabled || !row.eligible}
              onClick={() => onChange(row.providerId, row)}
              data-testid={`mr-provider-option-${row.providerId}`}
              className={`w-full rounded-md border p-3 text-left text-sm transition ${
                selected ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
              } ${row.eligible ? '' : 'opacity-60'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{row.displayName ?? 'Provider'}</span>
                <Badge variant="outline">
                  {row.eligible ? (
                    <ShieldCheck className="mr-1 h-3 w-3" />
                  ) : (
                    <ShieldAlert className="mr-1 h-3 w-3" />
                  )}
                  {row.eligible ? 'Eligible' : 'Not eligible'}
                </Badge>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <div><dt className="inline font-medium">Status: </dt><dd className="inline">{detail(row, ['provider_status', 'status'])}</dd></div>
                <div><dt className="inline font-medium">Classification: </dt><dd className="inline">{row.providerType ?? '—'}</dd></div>
                <div><dt className="inline font-medium">Licence: </dt><dd className="inline">{detail(row, ['licence_status', 'registration_status'])}</dd></div>
                <div><dt className="inline font-medium">Licence expiry: </dt><dd className="inline">{detail(row, ['licence_expiry_date', 'registration_expiry_date'])}</dd></div>
                <div><dt className="inline font-medium">Specialties: </dt><dd className="inline">{row.specialties.join(', ') || '—'}</dd></div>
                <div><dt className="inline font-medium">Facility: </dt><dd className="inline">{detail(row, ['facility_name', 'facility'])}</dd></div>
                <div><dt className="inline font-medium">Product approval: </dt><dd className="inline">{detail(row, ['product_approved', 'review_type_approved'])}</dd></div>
                <div><dt className="inline font-medium">Conflict check: </dt><dd className="inline">{detail(row, ['conflict_result', 'conflict_status'])}</dd></div>
                <div><dt className="inline font-medium">Accountable practitioner: </dt><dd className="inline">{detail(row, ['accountable_practitioner', 'accountable_practitioner_name'])}</dd></div>
                <div><dt className="inline font-medium">Fee responsibility: </dt><dd className="inline">{detail(row, ['fee_responsibility', 'fee_responsibility_code'])}</dd></div>
              </dl>
              {!row.eligible && row.ineligibleReason && (
                <p className="mt-1 text-xs text-destructive">{row.ineligibleReason}</p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ProviderPicker;
