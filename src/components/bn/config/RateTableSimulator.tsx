/**
 * RateTableSimulator — interactive lookup tester for a rate/matrix table.
 * Renders one input per dimension, runs `lookupRate()` and shows matched row + trace.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Play, CheckCircle2, AlertTriangle } from 'lucide-react';
import { lookupRate, type LookupResult } from '@/services/bn/calc/rateTableLookup';
import { BnBusyButton } from '@/components/bn/shared';

interface Dim { dimension_key: string; dimension_label: string; match_type: 'RANGE' | 'EXACT' | 'IN' }

export function RateTableSimulator({ tableCode, dimensions }: { tableCode: string; dimensions: Dim[] }) {
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [result, setResult] = useState<LookupResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const parsed: Record<string, unknown> = {};
      for (const d of dimensions) {
        const v = inputs[d.dimension_key];
        if (v === undefined || v === '') continue;
        const n = Number(v);
        parsed[d.dimension_key] = Number.isFinite(n) && d.match_type === 'RANGE' ? n : v;
      }
      const r = await lookupRate(tableCode, parsed);
      setResult(r);
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-3">
      <div className="text-sm font-medium">Simulate Lookup</div>
      <div className="grid grid-cols-2 gap-2">
        {dimensions.map((d) => (
          <div key={d.dimension_key} className="space-y-1">
            <Label className="text-xs flex items-center gap-1.5">
              <span className="font-mono">{d.dimension_key}</span>
              <Badge variant="outline" className="text-[9px] py-0 px-1">{d.match_type}</Badge>
            </Label>
            <Input
              className="h-8 text-xs"
              value={inputs[d.dimension_key] ?? ''}
              onChange={(e) => setInputs({ ...inputs, [d.dimension_key]: e.target.value })}
              placeholder={d.dimension_label}
            />
          </div>
        ))}
      </div>
      <BnBusyButton loading={busy} size="sm" variant="outline" onClick={run} disabled={busy || !dimensions.length} className="gap-1.5">
        <Play className="h-3.5 w-3.5" /> Run
      </BnBusyButton>
      {result && (
        <div className={`text-xs rounded-md border p-2 ${result.value != null ? 'bg-background' : 'bg-destructive/10 border-destructive/40'}`}>
          {result.value != null ? (
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <span className="text-muted-foreground">Matched row #{result.rowOrder} →</span>
              <span className="font-mono font-semibold">{String(result.value)}</span>
              <Badge variant="outline">{result.outputType}</Badge>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              <span>{result.trace.reason ?? 'No match'}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
