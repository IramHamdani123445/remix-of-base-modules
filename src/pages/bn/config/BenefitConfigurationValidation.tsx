import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, RefreshCw, FlaskConical, Info, Download } from 'lucide-react';
import { toast } from 'sonner';
import {
  validateAllProducts,
  type ProductValidationReport,
  type ValidationStatus,
  type CheckResult,
} from '@/services/bn/configurationValidationService';
import {
  seedBaselineTestCases,
  runAllProductTests,
  buildValidationReportCsv,
  type TestRunResult,
} from '@/services/bn/productTestCaseService';
import { findBaselineByCode } from '@/services/bn/skn/sknBenefitCatalogueBaseline';
import { RegistryConformanceCard } from '@/components/bn/validation/RegistryConformanceCard';
import { BnConfigReconciliationCard } from '@/components/bn/validation/BnConfigReconciliationCard';
import { CountryLegalValidationCard } from '@/components/bn/validation/CountryLegalValidationCard';
import { RuleGovernanceStatusCard } from '@/components/bn/governance/RuleGovernanceStatusCard';
import { ClaimGovernanceReadinessCard } from '@/components/bn/governance/ClaimGovernanceReadinessCard';
import { HandoffReadinessCard } from '@/components/bn/governance/HandoffReadinessCard';
import { QueueAccessHealthPanel } from '@/components/bn/config/QueueAccessHealthPanel';


const STATUS_VARIANT: Record<ValidationStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  PASS: 'default',
  WARNING: 'secondary',
  NEEDS_REVIEW: 'secondary',
  FAIL: 'destructive',
  NOT_APPLICABLE: 'outline',
};

function StatusBadge({ status }: { status: ValidationStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{status}</Badge>;
}

function CheckCell({ check }: { check: CheckResult }) {
  return (
    <div className="flex flex-col gap-1">
      <StatusBadge status={check.status} />
      <span className="text-xs text-muted-foreground">{check.message}</span>
    </div>
  );
}

export default function BenefitConfigurationValidation() {
  const [reports, setReports] = useState<ProductValidationReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [selected, setSelected] = useState<ProductValidationReport | null>(null);
  const [testResults, setTestResults] = useState<TestRunResult[] | null>(null);
  const [runningTests, setRunningTests] = useState(false);
  const [showFailedOnly, setShowFailedOnly] = useState(false);
  const [runningAll, setRunningAll] = useState(false);
  const [allResults, setAllResults] = useState<TestRunResult[]>([]);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await validateAllProducts();
      setReports(r);
    } catch (e) {
      toast.error('Validation failed', { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const summary = useMemo(() => {
    const counts: Record<ValidationStatus, number> = {
      PASS: 0,
      WARNING: 0,
      NEEDS_REVIEW: 0,
      FAIL: 0,
      NOT_APPLICABLE: 0,
    };
    reports.forEach((r) => {
      counts[r.overall_status] += 1;
    });
    return counts;
  }, [reports]);

  const handleSeedTests = async () => {
    setSeeding(true);
    try {
      const n = await seedBaselineTestCases();
      toast.success(`Seeded ${n} baseline test case(s)`);
      await refresh();
    } catch (e) {
      toast.error('Seeding failed', { description: (e as Error).message });
    } finally {
      setSeeding(false);
    }
  };

  const handleRunTests = async (report: ProductValidationReport) => {
    if (!report.product_id) return;
    setRunningTests(true);
    try {
      const r = await runAllProductTests(report.product_id);
      setTestResults(r);
    } catch (e) {
      toast.error('Run failed', { description: (e as Error).message });
    } finally {
      setRunningTests(false);
    }
  };

  const handleRunAllTests = async () => {
    setRunningAll(true);
    try {
      const all: TestRunResult[] = [];
      for (const r of reports) {
        if (!r.product_id) continue;
        const res = await runAllProductTests(r.product_id);
        all.push(...res);
      }
      setAllResults(all);
      const failed = all.filter((x) => !x.passed).length;
      toast.success(`Ran ${all.length} test(s) — ${failed} failed`);
    } catch (e) {
      toast.error('Run failed', { description: (e as Error).message });
    } finally {
      setRunningAll(false);
    }
  };

  const exportReport = () => {
    const blob = new Blob([JSON.stringify(reports, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bn-validation-report-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportTestCsv = () => {
    if (allResults.length === 0) {
      toast.error('Run tests first');
      return;
    }
    const csv = buildValidationReportCsv(allResults);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bn-test-results-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="t-page-title">
            Benefit Configuration Validation
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Compares each SKN benefit product against the official catalogue baseline. Flags missing
            or suspicious configuration as <strong>NEEDS_REVIEW</strong> — does not auto-fix.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportReport} disabled={reports.length === 0}>
            <Download className="mr-2 h-4 w-4" /> Export Config JSON
          </Button>
          <Button variant="outline" onClick={exportTestCsv} disabled={allResults.length === 0}>
            <Download className="mr-2 h-4 w-4" /> Export Validation Report
          </Button>
          <Button variant="outline" onClick={handleSeedTests} disabled={seeding}>
            {seeding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-2 h-4 w-4" />}
            Seed Baseline Tests
          </Button>
          <Button variant="outline" onClick={handleRunAllTests} disabled={runningAll || reports.length === 0}>
            {runningAll ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-2 h-4 w-4" />}
            Run All Tests
          </Button>
          <Button onClick={refresh} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Re-validate
          </Button>
        </div>
      </div>

      <QueueAccessHealthPanel compact />



      {allResults.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>
              Test Run Summary — {allResults.filter((r) => r.passed).length}/{allResults.length} passed
            </CardTitle>
            <Button
              size="sm"
              variant={showFailedOnly ? 'default' : 'outline'}
              onClick={() => setShowFailedOnly((v) => !v)}
            >
              {showFailedOnly ? 'Show All' : 'View Failed Tests'}
            </Button>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Benefit</TableHead>
                    <TableHead>Scenario</TableHead>
                    <TableHead>Eligibility</TableHead>
                    <TableHead>Calc</TableHead>
                    <TableHead>Docs</TableHead>
                    <TableHead>Workflow</TableHead>
                    <TableHead>Acceptance</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Diffs</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allResults
                    .filter((r) => !showFailedOnly || !r.passed)
                    .map((r) => (
                      <TableRow key={r.test_case_id}>
                        <TableCell className="font-mono text-xs">{r.test_case_code}</TableCell>
                        <TableCell className="text-xs">{r.benefit_code}</TableCell>
                        <TableCell><Badge variant="outline">{r.scenario_type}</Badge></TableCell>
                        <TableCell className="text-xs">{r.checks.eligibility}</TableCell>
                        <TableCell className="text-xs">{r.checks.calculation}</TableCell>
                        <TableCell className="text-xs">{r.checks.documents}</TableCell>
                        <TableCell className="text-xs">{r.checks.workflow_start}</TableCell>
                        <TableCell className="text-xs">{r.checks.claim_acceptance}</TableCell>
                        <TableCell>
                          <Badge variant={r.passed ? 'default' : 'destructive'}>
                            {r.passed ? 'PASS' : 'FAIL'}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-xs text-xs text-muted-foreground">
                          {r.diffs.join(' | ')}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Validation only — does not change configuration</AlertTitle>
        <AlertDescription>
          Use this dashboard to surface gaps. Apply fixes through Product Catalog so that audit and
          version governance remain intact.
        </AlertDescription>
      </Alert>

      <RuleGovernanceStatusCard />

      <ClaimGovernanceReadinessCard />

      <HandoffReadinessCard />

      <RegistryConformanceCard />

      <BnConfigReconciliationCard />

      <CountryLegalValidationCard />


      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {(Object.keys(summary) as ValidationStatus[]).map((s) => (
          <Card key={s}>
            <CardContent className="flex items-center justify-between p-4">
              <StatusBadge status={s} />
              <span className="text-2xl font-semibold">{summary[s]}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Products ({reports.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="py-8 text-center text-muted-foreground">Running validation…</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Active Ver.</TableHead>
                    <TableHead>Overlap</TableHead>
                    <TableHead>Eligibility</TableHead>
                    <TableHead>Calculation</TableHead>
                    <TableHead>Formulas</TableHead>
                    <TableHead>Documents</TableHead>
                    <TableHead>Doc Library</TableHead>
                    <TableHead>Workflow</TableHead>
                    <TableHead>WF Exists</TableHead>
                    <TableHead>Screen</TableHead>
                    <TableHead>Timeline</TableHead>
                    <TableHead>Tests</TableHead>
                    <TableHead>Offline</TableHead>
                    <TableHead>Online</TableHead>
                    <TableHead>Governance</TableHead>
                    <TableHead>Overall</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports.map((r) => (
                    <TableRow
                      key={r.benefit_code}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => {
                        setSelected(r);
                        setTestResults(null);
                      }}
                    >
                      <TableCell className="font-mono text-xs">{r.benefit_code}</TableCell>
                      <TableCell className="font-medium">{r.benefit_name}</TableCell>
                      <TableCell><CheckCell check={r.product_exists} /></TableCell>
                      <TableCell><CheckCell check={r.active_version} /></TableCell>
                      <TableCell><CheckCell check={r.overlap_versions} /></TableCell>
                      <TableCell><CheckCell check={r.eligibility} /></TableCell>
                      <TableCell><CheckCell check={r.calculation} /></TableCell>
                      <TableCell><CheckCell check={r.formula_resolvable} /></TableCell>
                      <TableCell><CheckCell check={r.documents} /></TableCell>
                      <TableCell><CheckCell check={r.documents_library} /></TableCell>
                      <TableCell><CheckCell check={r.workflow} /></TableCell>
                      <TableCell><CheckCell check={r.workflow_exists} /></TableCell>
                      <TableCell><CheckCell check={r.screen_template} /></TableCell>
                      <TableCell><CheckCell check={r.timeline} /></TableCell>
                      <TableCell><CheckCell check={r.test_cases} /></TableCell>
                      <TableCell><CheckCell check={r.offline_channel} /></TableCell>
                      <TableCell><CheckCell check={r.online_channel} /></TableCell>
                      <TableCell><CheckCell check={r.version_governance} /></TableCell>
                      <TableCell><StatusBadge status={r.overall_status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) { setSelected(null); setTestResults(null); } }}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {selected.benefit_code} — {selected.benefit_name}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <h3 className="mb-2 font-semibold">Validation Issues & Warnings</h3>
                  {selected.issues.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No issues recorded.</p>
                  ) : (
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                      {selected.issues.map((i, idx) => (
                        <li key={idx}>{i}</li>
                      ))}
                    </ul>
                  )}
                </div>

                {(() => {
                  const baseline = findBaselineByCode(selected.benefit_code);
                  if (!baseline) return null;
                  return (
                    <div className="space-y-3">
                      <div>
                        <h3 className="mb-2 font-semibold">Expected Eligibility Field Keys</h3>
                        <div className="flex flex-wrap gap-2">
                          {baseline.expected_eligibility_keys.map((k) => (
                            <Badge key={k} variant="outline">{k}</Badge>
                          ))}
                        </div>
                      </div>
                      <div>
                        <h3 className="mb-2 font-semibold">Expected Documents</h3>
                        <div className="flex flex-wrap gap-2">
                          {baseline.expected_documents.map((d) => (
                            <Badge key={d} variant="outline">{d}</Badge>
                          ))}
                        </div>
                      </div>
                      <div>
                        <h3 className="mb-2 font-semibold">Calculation Expectations</h3>
                        <p className="text-sm text-muted-foreground">{baseline.expected_calculation_notes}</p>
                      </div>
                    </div>
                  );
                })()}

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => handleRunTests(selected)}
                    disabled={runningTests || !selected.product_id}
                  >
                    {runningTests ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-2 h-4 w-4" />}
                    Run Tests
                  </Button>
                </div>

                {testResults && (
                  <div>
                    <h3 className="mb-2 font-semibold">Test Results (Expected vs Actual)</h3>
                    {testResults.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No test cases. Click "Seed Baseline Tests" on the main dashboard.
                      </p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Code</TableHead>
                            <TableHead>Expected</TableHead>
                            <TableHead>Actual</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {testResults.map((t) => (
                            <TableRow key={t.test_case_id}>
                              <TableCell className="font-mono text-xs">{t.test_case_code}</TableCell>
                              <TableCell><pre className="whitespace-pre-wrap text-xs">{JSON.stringify(t.expected, null, 2)}</pre></TableCell>
                              <TableCell><pre className="whitespace-pre-wrap text-xs">{JSON.stringify(t.actual, null, 2)}</pre></TableCell>
                              <TableCell>
                                <Badge variant={t.passed ? 'default' : 'secondary'}>
                                  {t.passed ? 'PASS' : 'PENDING'}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
