/**
 * Runtime & Metadata Test Tab — Phase 2 of Rule Catalogue.
 *
 * Three sub-tabs:
 *  1. Metadata Test    — claim-independent. Validates a rule's structure,
 *                        fact linkage, resolver registration, operator,
 *                        snapshot/derivation metadata. No runtime needed.
 *  2. Single Rule      — runtime resolver test for one rule against an SSN
 *                        and claim (optional). Refreshes contribution
 *                        snapshot if the fact requires one.
 *  3. Product          — runs every active rule on a product version
 *                        against a real claim, with pickers (not raw UUIDs).
 */
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FlaskConical, PlayCircle, CheckCircle2, AlertTriangle, XCircle, BadgeCheck, Search } from 'lucide-react';
import { toast } from 'sonner';

import type { RuleCatalogueItem } from '@/services/bn/ruleCatalogueService';
import type { EligibilityFact } from '@/services/bn/eligibilityFactService';
import { resolveFact } from '@/services/bn/eligibility/eligibilityFactResolver';
import { ensureContributionSnapshot } from '@/services/bn/eligibility/contributionSnapshotService';
import { runProductEligibilityTest, type ProductTestResult } from '@/services/bn/eligibility/productEligibilityTest';
import { validateAllRules } from '@/services/bn/ruleValidationService';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  rules: RuleCatalogueItem[];
  factByKey: Map<string, EligibilityFact>;
  facts: EligibilityFact[];
}

interface ProductVersionOption {
  id: string;
  product_id: string;
  product_code: string;
  product_name: string;
  version_number: number;
  status: string;
}

interface ClaimOption {
  id: string;
  claim_number: string | null;
  ssn: string;
  product_code: string | null;
  claim_date: string;
}

export function RuntimeTestTab({ rules, factByKey, facts }: Props) {
  return (
    <Tabs defaultValue="metadata">
      <TabsList>
        <TabsTrigger value="metadata" className="gap-2"><BadgeCheck className="h-4 w-4" /> Metadata Test</TabsTrigger>
        <TabsTrigger value="single" className="gap-2"><FlaskConical className="h-4 w-4" /> Single Rule (Runtime)</TabsTrigger>
        <TabsTrigger value="product" className="gap-2"><PlayCircle className="h-4 w-4" /> Product Eligibility (Runtime)</TabsTrigger>
      </TabsList>
      <TabsContent value="metadata"><MetadataTestPanel rules={rules} facts={facts} /></TabsContent>
      <TabsContent value="single"><SingleRulePanel rules={rules} factByKey={factByKey} /></TabsContent>
      <TabsContent value="product"><ProductTestPanel /></TabsContent>
    </Tabs>
  );
}

/* ---------------- Metadata Test (no claim) ---------------- */
function MetadataTestPanel({ rules, facts }: { rules: RuleCatalogueItem[]; facts: EligibilityFact[] }) {
  const [search, setSearch] = useState('');
  const reports = useMemo(() => validateAllRules(rules, facts), [rules, facts]);

  const filtered = reports.filter(r => {
    if (!search) return true;
    const s = search.toLowerCase();
    return r.rule_code.toLowerCase().includes(s) || r.rule_name.toLowerCase().includes(s);
  });

  const passCount = reports.filter(r => r.overall === 'PASS').length;
  const warnCount = reports.filter(r => r.overall === 'WARNING').length;
  const failCount = reports.filter(r => r.overall === 'FAIL').length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Metadata Test — Claim-Independent</CardTitle>
        <p className="text-sm text-muted-foreground">
          Verifies rule structure, fact linkage, registered resolver, operator compatibility, snapshot &amp; derivation metadata.
          No SSN, Claim ID, or runtime data required.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Rules Passing</div><div className="text-2xl font-bold text-emerald-600">{passCount}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Warnings</div><div className="text-2xl font-bold text-amber-600">{warnCount}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Failures</div><div className="text-2xl font-bold text-destructive">{failCount}</div></CardContent></Card>
        </div>
        <div className="relative w-full md:w-80">
          <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search rules" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rule</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Checks</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(rep => {
              const issues = rep.checks.filter(c => c.result !== 'PASS');
              return (
                <TableRow key={rep.rule_id}>
                  <TableCell>
                    <div className="font-mono text-xs">{rep.rule_code}</div>
                    <div className="text-xs text-muted-foreground">{rep.rule_name}</div>
                  </TableCell>
                  <TableCell>
                    {rep.overall === 'FAIL' ? <Badge variant="destructive">FAIL</Badge>
                      : rep.overall === 'WARNING' ? <Badge variant="secondary">WARN</Badge>
                      : <Badge>PASS</Badge>}
                  </TableCell>
                  <TableCell className="text-xs">
                    {issues.length === 0 ? <span className="text-emerald-600">All {rep.checks.length} checks passed</span> : (
                      <ul className="space-y-0.5">
                        {issues.map((c, idx) => (
                          <li key={idx} className={c.result === 'FAIL' ? 'text-destructive' : 'text-amber-700'}>
                            • [{c.result}] {c.check}: {c.message}
                          </li>
                        ))}
                      </ul>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ---------------- Single Rule (Runtime) ---------------- */
function SingleRulePanel({ rules, factByKey }: { rules: RuleCatalogueItem[]; factByKey: Map<string, EligibilityFact> }) {
  const [ruleId, setRuleId] = useState('');
  const [ssn, setSsn] = useState('');
  const [claimId, setClaimId] = useState('');
  const [claimDate, setClaimDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  // Claim lookup, so no one has to type a UUID by hand.
  const [claimSearch, setClaimSearch] = useState('');
  const [claimResults, setClaimResults] = useState<ClaimOption[]>([]);
  const [claimSearched, setClaimSearched] = useState(false);
  const [claimBusy, setClaimBusy] = useState(false);

  const rule = rules.find(r => r.id === ruleId);
  const fact = rule?.fact_key ? factByKey.get(rule.fact_key) : null;

  const searchClaims = async () => {
    const term = claimSearch.trim();
    if (!term) { toast.info('Enter an SSN or claim number to search'); return; }
    setClaimBusy(true);
    try {
      const { data, error } = await (supabase as any)
        .from('bn_claim')
        .select('id, claim_number, ssn, claim_date, product:bn_product(benefit_code)')
        // Either identifier works — people quote whichever they have to hand.
        .or(`ssn.ilike.%${term}%,claim_number.ilike.%${term}%`)
        .order('claim_date', { ascending: false })
        .limit(25);
      if (error) { toast.error('Claim search failed', { description: error.message }); return; }
      const found: ClaimOption[] = ((data as any[]) ?? []).map(c => ({
        id: c.id, claim_number: c.claim_number, ssn: c.ssn,
        claim_date: c.claim_date, product_code: c.product?.benefit_code ?? null,
      }));
      setClaimResults(found);
      setClaimId('');
      setClaimSearched(true);
      if (found.length === 0) {
        toast.info('No claims matched', { description: 'Try a different SSN or claim number.' });
      }
    } finally {
      setClaimBusy(false);
    }
  };

  /** Choosing a claim fills every field it implies, so they cannot disagree. */
  const pickClaim = (id: string) => {
    setClaimId(id);
    const c = claimResults.find(x => x.id === id);
    if (c) {
      if (c.ssn) setSsn(c.ssn);
      if (c.claim_date) setClaimDate(c.claim_date);
    }
  };

  const run = async () => {
    if (!rule) { toast.error('Pick a rule'); return; }
    if (!fact) { setResult({ outcome: 'WARN', title: 'Rule has no linked fact' }); return; }
    if (fact.implementation_status === 'NOT_IMPLEMENTED') {
      setResult({ outcome: 'WARN', title: 'Fact is NOT_IMPLEMENTED',
        details: [`Source: ${fact.source_table}.${fact.source_column}`, `Resolver: ${fact.resolver_function}`] });
      return;
    }
    // A fact that reads claim data cannot be judged without a claim. The
    // resolvers return false in that case ("if (!ctx.claimId) return false"),
    // which the panel then reported as FAIL — telling the user the rule was
    // broken when in truth it was never evaluated. Say so instead: a check with
    // no input has no verdict to give.
    const needsClaim = /claim/i.test(fact.source_table ?? '') || !!fact.requires_snapshot;
    if (needsClaim && !claimId) {
      setResult({
        outcome: 'WARN',
        title: 'Cannot test this rule without a claim',
        details: [
          `Fact: ${fact.fact_key}`,
          `Reads from: ${fact.source_table}`,
          'Search for a claim above and pick one, then run the test again.',
        ],
      });
      return;
    }

    setBusy(true);
    try {
      if (fact.requires_snapshot && claimId) await ensureContributionSnapshot(claimId);
      const r = await resolveFact(fact.fact_key, { ssn: ssn || null, claimId: claimId || null, claimDate, extras: {} });
      const op = rule.operator, expected = rule.value_from;
      const a = r.value, num = Number(a), expNum = Number(expected);
      let pass = false;
      switch (op) {
        case 'GREATER_OR_EQUAL': pass = num >= expNum; break;
        case 'GREATER_THAN': pass = num > expNum; break;
        case 'LESS_OR_EQUAL': pass = num <= expNum; break;
        case 'LESS_THAN': pass = num < expNum; break;
        case 'EQUALS': pass = String(a) === String(expected); break;
        case 'NOT_EQUALS': pass = String(a) !== String(expected); break;
        case 'BOOLEAN': pass = String(a).toLowerCase() === String(expected).toLowerCase(); break;
        case 'EXISTS': pass = a !== null && a !== undefined && a !== ''; break;
        case 'IN': pass = Array.isArray(rule.values) && rule.values.map(String).includes(String(a)); break;
        case 'BETWEEN': pass = num >= Number(rule.value_from) && num <= Number(rule.value_to); break;
      }
      const outcome = r.reason ? 'WARN' : pass ? 'PASS' : 'FAIL';
      setResult({
        outcome,
        title: r.reason ?? (pass ? 'Rule passed' : (rule.failure_message_text ?? 'Rule failed')),
        resolved: r.value, expected,
        details: [
          `Fact: ${fact.fact_key}`,
          `Resolver: ${fact.resolver_function}`,
          `Source: ${r.source_table}.${r.source_column}`,
          `Operator: ${op}`,
          `Fail action: ${rule.default_fail_action}`,
        ],
      });
    } catch (e: any) {
      setResult({ outcome: 'WARN', title: e?.message ?? 'Resolution failed' });
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Single Rule — Runtime Simulation</CardTitle>
        <p className="text-sm text-muted-foreground">Resolves the fact against real BN/BEMA tables, then evaluates the operator.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Rule</Label>
            <Select value={ruleId} onValueChange={setRuleId}>
              <SelectTrigger><SelectValue placeholder="Pick a catalogue rule" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {rules.map(r => <SelectItem key={r.id} value={r.id}>{r.rule_code} — {r.rule_name}</SelectItem>)}
              </SelectContent>
            </Select>
            {fact && (
              <div className="text-xs text-muted-foreground">
                Fact <span className="font-mono">{fact.fact_key}</span> • resolver <span className="font-mono">{fact.resolver_function}</span>
              </div>
            )}
          </div>
          {/* The claim used to be identified by typing a raw UUID, which is
              unusable in practice — a partly-pasted id resolves nothing and the
              result reads as a rule failure rather than a mistyped claim.
              Search by SSN or claim number and pick the claim instead; choosing
              one fills the SSN, the claim id and the claim date together. */}
          <div className="space-y-2">
            <Label>Find a claim</Label>
            <div className="flex gap-2">
              <Input
                value={claimSearch}
                onChange={e => setClaimSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') searchClaims(); }}
                placeholder="SSN or claim number"
              />
              <Button variant="outline" onClick={searchClaims} disabled={claimBusy} className="gap-1">
                <Search className="h-4 w-4" /> {claimBusy ? 'Finding…' : 'Find'}
              </Button>
            </div>
            <Select value={claimId} onValueChange={pickClaim}>
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    claimResults.length ? 'Pick a claim'
                      : claimSearched ? 'No claims matched'
                      : 'Search, or leave empty for rules that need only an SSN'
                  }
                />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {claimResults.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.claim_number ?? c.id.slice(0, 8)} • SSN {c.ssn} • {c.claim_date}
                    {c.product_code ? ` • ${c.product_code}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="space-y-1">
                <Label className="text-xs">SSN</Label>
                <Input value={ssn} onChange={e => setSsn(e.target.value)} placeholder="6-digit" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Claim date</Label>
                <Input type="date" value={claimDate} onChange={e => setClaimDate(e.target.value)} />
              </div>
            </div>
            {claimId && (
              <p className="text-xs text-muted-foreground font-mono">claim {claimId}</p>
            )}
          </div>
        </div>
        <Button onClick={run} disabled={busy} className="gap-2"><FlaskConical className="h-4 w-4" /> {busy ? 'Resolving…' : 'Run Test'}</Button>
        {result && (
          <Alert variant={result.outcome === 'FAIL' ? 'destructive' : 'default'}>
            {result.outcome === 'PASS' ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            <AlertDescription>
              <div className="font-semibold mb-1">{result.outcome}: {result.title}</div>
              {(result.resolved !== undefined || result.expected !== undefined) && (
                <div className="text-xs grid grid-cols-2 gap-1 mb-2">
                  <div>Resolved: <span className="font-mono">{String(result.resolved ?? '—')}</span></div>
                  <div>Expected: <span className="font-mono">{String(result.expected ?? '—')}</span></div>
                </div>
              )}
              {result.details && (
                <ul className="text-xs space-y-0.5">{result.details.map((d: string, i: number) => <li key={i} className="font-mono">• {d}</li>)}</ul>
              )}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------- Product Eligibility (Runtime) ---------------- */
function ProductTestPanel() {
  const [versions, setVersions] = useState<ProductVersionOption[]>([]);
  /** Claims per product version. null when the count could not be loaded. */
  const [claimCounts, setClaimCounts] = useState<Map<string, number> | null>(null);
  const [versionId, setVersionId] = useState('');
  const [ssnSearch, setSsnSearch] = useState('');
  const [claims, setClaims] = useState<ClaimOption[]>([]);
  // Distinguishes "not searched yet" from "searched, nothing found".
  const [searched, setSearched] = useState(false);
  const [claimId, setClaimId] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ProductTestResult | null>(null);

  // Load active product versions on mount.
  useEffect(() => {
    (async () => {
      const { data, error } = await (supabase as any)
        .from('bn_product_version')
        .select('id, version_number, status, product:bn_product(id, benefit_code, benefit_name)')
        .in('status', ['ACTIVE', 'DRAFT', 'PUBLISHED'])
        .order('modified_at', { ascending: false })
        .limit(100);
      if (error) {
        // Surface the failure — an empty dropdown must not be how a broken
        // query presents itself.
        toast.error('Could not load product versions', { description: error.message });
        setVersions([]);
        return;
      }
      const rows: ProductVersionOption[] = ((data as any[]) ?? []).map(d => ({
        id: d.id,
        product_id: d.product?.id ?? '',
        product_code: d.product?.benefit_code ?? '',
        product_name: d.product?.benefit_name ?? '—',
        version_number: d.version_number,
        status: d.status,
      }));
      setVersions(rows);

      // BUG-42 — how many claims each version has.
      //
      // Only a minority of product versions have any claims against them, and
      // the dropdown gave no way to tell which. Users picked a version, pressed
      // Find, got nothing, and concluded the screen was broken — when it was
      // correctly reporting that the version has no claims to test with.
      // One query for the whole list; only the key column is fetched.
      const { data: claimRows, error: claimError } = await (supabase as any)
        .from('bn_claim')
        .select('product_version_id');
      if (claimError) {
        // Not fatal: the dropdown still works, it just cannot show counts.
        setClaimCounts(null);
        return;
      }
      const counts = new Map<string, number>();
      for (const c of (claimRows as any[]) ?? []) {
        if (!c.product_version_id) continue;
        counts.set(c.product_version_id, (counts.get(c.product_version_id) ?? 0) + 1);
      }
      setClaimCounts(counts);
    })();
  }, []);

  const searchClaims = async () => {
    if (!ssnSearch.trim() && !versionId) {
      // Guidance, not a failure — the user has simply not narrowed the search yet.
      toast.info('Enter an SSN, or pick a product version, to search for claims');
      return;
    }
    let q = (supabase as any)
      .from('bn_claim')
      .select('id, claim_number, ssn, claim_date, product:bn_product(benefit_code)')
      .order('claim_date', { ascending: false })
      .limit(25);
    if (ssnSearch.trim()) q = q.ilike('ssn', `%${ssnSearch.trim()}%`);
    if (versionId) q = q.eq('product_version_id', versionId);
    const { data, error } = await q;
    if (error) { toast.error('Claim search failed', { description: error.message }); return; }
    const found = ((data as any[]) ?? []).map(c => ({
      id: c.id, claim_number: c.claim_number, ssn: c.ssn,
      claim_date: c.claim_date, product_code: c.product?.benefit_code ?? null,
    }));
    setClaims(found);
    setClaimId('');
    setSearched(true);
    if (found.length === 0) {
      // No matches is a valid outcome, not a failure — but say which kind of
      // "none", because "this version has no claims at all" and "your SSN did
      // not match" call for different next steps.
      const versionHasNoClaims =
        !!versionId && !!claimCounts && (claimCounts.get(versionId) ?? 0) === 0;
      toast.info(
        versionHasNoClaims ? 'This product version has no claims' : 'No matching claims found',
        {
          description: versionHasNoClaims
            ? 'Pick a version showing a claim count to run an eligibility test.'
            : 'No claim on this version matches that SSN.',
        },
      );
    }
  };

  const run = async () => {
    if (!versionId || !claimId) { toast.error('Pick a product version and a claim'); return; }
    setBusy(true);
    try {
      const r = await runProductEligibilityTest(versionId, claimId);
      setRes(r);
    } catch (e: any) {
      toast.error(e?.message ?? 'Test failed');
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Product Eligibility — Runtime Simulation</CardTitle>
        <p className="text-sm text-muted-foreground">Refreshes the contribution snapshot, then evaluates every active rule of the chosen product version against a claim.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2 md:col-span-1">
            <Label>Product Version</Label>
            <Select value={versionId} onValueChange={setVersionId}>
              <SelectTrigger><SelectValue placeholder="Pick a product version" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {versions.map(v => {
                  // The claim count is the whole point of choosing a version
                  // here: a version with none cannot be tested against a claim.
                  const n = claimCounts?.get(v.id) ?? 0;
                  return (
                    <SelectItem key={v.id} value={v.id}>
                      {v.product_code} v{v.version_number} — {v.product_name}{' '}
                      <span className="text-muted-foreground">({v.status})</span>
                      {claimCounts && (
                        <span className={n > 0 ? 'text-emerald-600' : 'text-muted-foreground'}>
                          {' · '}{n > 0 ? `${n} claim${n === 1 ? '' : 's'}` : 'no claims'}
                        </span>
                      )}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 md:col-span-1">
            <Label>Find Claim by SSN</Label>
            <div className="flex gap-2">
              <Input value={ssnSearch} onChange={e => setSsnSearch(e.target.value)} placeholder="SSN or partial" />
              <Button variant="outline" onClick={searchClaims} className="gap-1"><Search className="h-4 w-4" /> Find</Button>
            </div>
          </div>
          <div className="space-y-2 md:col-span-1">
            <Label>Claim</Label>
            <Select value={claimId} onValueChange={setClaimId}>
              {/* Say which of the three situations this is. "No claims found"
                  after a search on a version that has none was indistinguishable
                  from a broken screen. */}
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    claims.length
                      ? 'Pick a claim'
                      : versionId && claimCounts && (claimCounts.get(versionId) ?? 0) === 0
                        ? 'This version has no claims'
                        : searched
                          ? 'No claims matched'
                          : 'Press Find'
                  }
                />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {claims.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.claim_number ?? c.id.slice(0, 8)} • SSN {c.ssn} • {c.claim_date} {c.product_code ? `• ${c.product_code}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button onClick={run} disabled={busy} className="gap-2"><PlayCircle className="h-4 w-4" /> {busy ? 'Running…' : 'Run Eligibility'}</Button>
        {res && (
          <>
            <div className="flex items-center gap-2">
              <Badge variant={res.overall === 'PASS' ? 'default' : 'destructive'}>{res.overall}</Badge>
              <span className="text-xs text-muted-foreground">Snapshot {res.snapshot_refreshed ? 'refreshed' : 'reused'} • Product: {res.product_code ?? '—'} • {res.rows.length} rule(s)</span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rule</TableHead>
                  <TableHead>Fact</TableHead>
                  <TableHead>Operator</TableHead>
                  <TableHead>Expected</TableHead>
                  <TableHead>Actual</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Fail Action</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {res.rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell><div className="font-mono text-xs">{r.rule_code}</div><div className="text-xs text-muted-foreground">{r.rule_name}</div></TableCell>
                    <TableCell className="font-mono text-xs">{r.fact_key ?? '—'}</TableCell>
                    <TableCell className="text-xs">{r.operator}</TableCell>
                    <TableCell className="font-mono text-xs">{Array.isArray(r.expected) ? r.expected.join(', ') : String(r.expected ?? '—')}</TableCell>
                    <TableCell className="font-mono text-xs">{String(r.actual ?? '—')}</TableCell>
                    <TableCell className="font-mono text-xs">{r.source ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={r.result === 'PASS' ? 'default' : r.result === 'FAIL' ? 'destructive' : 'secondary'}>{r.result}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{r.fail_action}</TableCell>
                    <TableCell className="text-xs">{r.message ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
