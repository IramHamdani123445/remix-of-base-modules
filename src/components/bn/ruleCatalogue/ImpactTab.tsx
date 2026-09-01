import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { getFactImpact, type FactImpact } from '@/services/bn/factImpactService';
import { useCoverageTypes, useCoverageTypeRules } from '@/hooks/bn/useCoverageTypes';
import type { RuleCatalogueItem } from '@/services/bn/ruleCatalogueService';
import type { EligibilityFact } from '@/services/bn/eligibilityFactService';
import { BnBusyButton } from '@/components/bn/shared';

export function ImpactTab({ rules, facts }: { rules: RuleCatalogueItem[]; facts: EligibilityFact[] }) {
  const { data: cts = [] } = useCoverageTypes();
  const { data: ctRules = [] } = useCoverageTypeRules();
  const [factKey, setFactKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [impact, setImpact] = useState<FactImpact | null>(null);

  const factOptions = useMemo(() => facts.slice().sort((a, b) => a.fact_key.localeCompare(b.fact_key)), [facts]);

  const run = async () => {
    if (!factKey) { toast.error('Pick a fact'); return; }
    setBusy(true);
    try {
      const r = await getFactImpact(factKey, rules, cts, ctRules);
      setImpact(r);
    } catch (e: any) {
      toast.error('Impact analysis failed', { description: e?.message });
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fact Impact Analysis</CardTitle>
        <p className="text-sm text-muted-foreground">Before modifying a fact, see every rule, coverage type, and product version it affects.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-2">
            <Label>Fact</Label>
            <Select value={factKey} onValueChange={setFactKey}>
              <SelectTrigger><SelectValue placeholder="Pick a fact" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {factOptions.map(f => <SelectItem key={f.fact_key} value={f.fact_key}>{f.fact_key} — {f.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <BnBusyButton loading={busy} onClick={run} disabled={busy}>{busy ? 'Analyzing…' : 'Analyze Impact'}</BnBusyButton>
        </div>

        {impact && (
          <>
            <div className="grid grid-cols-3 gap-4">
              <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Rules Affected</div><div className="text-2xl font-bold">{impact.rules.length}</div></CardContent></Card>
              <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Coverage Types Impacted</div><div className="text-2xl font-bold">{impact.coverage_types.length}</div></CardContent></Card>
              <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Product Versions Using</div><div className="text-2xl font-bold">{impact.product_version_count}</div></CardContent></Card>
            </div>

            <div>
              <div className="text-sm font-semibold mb-2">Rules referencing this fact</div>
              {impact.rules.length === 0 ? <p className="text-sm text-muted-foreground italic">None.</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Active</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {impact.rules.map(r => (
                      <TableRow key={r.rule_id}>
                        <TableCell className="font-mono text-xs">{r.rule_code}</TableCell>
                        <TableCell>{r.rule_name}</TableCell>
                        <TableCell>{r.is_active ? <Badge>Yes</Badge> : <Badge variant="secondary">No</Badge>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            <div>
              <div className="text-sm font-semibold mb-2">Coverage types impacted</div>
              {impact.coverage_types.length === 0 ? <p className="text-sm text-muted-foreground italic">None.</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {impact.coverage_types.map(ct => (
                      <TableRow key={ct.coverage_type_id}>
                        <TableCell className="font-mono text-xs">{ct.coverage_code}</TableCell>
                        <TableCell>{ct.coverage_name}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
