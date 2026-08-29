import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Scale, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  listComplianceCandidateItems,
  type ComplianceCandidateItem,
} from "@/services/legal/coreLegalReferralItemService";
import { createComplianceLegalReferral } from "@/services/legal/complianceForwardingService";
import {
  loadComplianceHistory,
  type ComplianceContext,
} from "@/services/legal/legalReferralHistoryService";
import {
  evaluateEligibility,
  type EligibilityResult,
} from "@/services/legalHandoffService";
import type { ReferralDocumentDraft } from "@/services/legal/coreLegalReferralDocumentService";
import ReferralDocumentSelector from "@/components/legal/lg/ReferralDocumentSelector";
import HistoryTimelinePanel from "@/components/legal/lg/HistoryTimelinePanel";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";

const sb = supabase as any;

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "XCD" }).format(n);

const REASON_CODES = [
  { code: "OLD_ARREARS_RECOVERY", label: "Old Arrears Recovery" },
  { code: "PAYMENT_ARRANGEMENT_DEFAULT", label: "Payment Arrangement Default" },
  { code: "NON_COMPLIANCE_AFTER_NOTICE", label: "Non-Compliance After Notice" },
  { code: "FAILURE_TO_FILE_C3", label: "Failure to File C3" },
  { code: "FAILURE_TO_PAY_CONTRIBUTIONS", label: "Failure to Pay Contributions" },
  { code: "AUDIT_FINDING_RECOVERY", label: "Audit Finding Recovery" },
  { code: "EMPLOYER_DISPUTE", label: "Employer Dispute" },
  { code: "COURT_ACTION_REQUIRED", label: "Court Action Required" },
  { code: "OTHER", label: "Other" },
];

const STEPS = [
  "Source",
  "Reason",
  "Items",
  "History",
  "Documents",
  "Review",
] as const;

export default function ComplianceLegalReferralWizard() {
  const { ceCaseId: ceCaseIdParam } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { profile } = useSupabaseAuth();
  const userCode = profile?.user_code ?? null;

  // --- state -------------------------------------------------------------
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Step 1: Source / employer
  const [employerId, setEmployerId] = useState<string | null>(
    search.get("employerId") ?? null,
  );
  const [employerName, setEmployerName] = useState<string | null>(null);
  const [ceCaseId, setCeCaseId] = useState<string | null>(
    ceCaseIdParam ?? search.get("ceCaseId") ?? null,
  );
  const [ceCase, setCeCase] = useState<any>(null);
  const [employerSearch, setEmployerSearch] = useState("");
  const [employerOptions, setEmployerOptions] = useState<any[]>([]);
  const [caseOptions, setCaseOptions] = useState<any[]>([]);
  const [paymentArrangementId, setPaymentArrangementId] = useState<string | null>(
    search.get("paymentArrangementId") ?? null,
  );
  const [auditId, setAuditId] = useState<string | null>(search.get("auditId") ?? null);
  const [inspectionId, setInspectionId] = useState<string | null>(
    search.get("inspectionId") ?? null,
  );

  // Step 2: Reason
  const [reasonCode, setReasonCode] = useState(
    search.get("reasonCode") ?? "OLD_ARREARS_RECOVERY",
  );
  const [priority, setPriority] = useState("MEDIUM");
  const [reasonText, setReasonText] = useState("");

  // Step 3: Items
  const [candidates, setCandidates] = useState<ComplianceCandidateItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<Record<string, boolean>>({});
  const [minAge, setMinAge] = useState<number>(150);
  const [includeCurrent, setIncludeCurrent] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);

  // Step 4: History
  const [history, setHistory] = useState<ComplianceContext | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Step 5: Documents
  const [documents, setDocuments] = useState<ReferralDocumentDraft[]>([]);

  // Step 6: Confirmation
  const [acceptedNonFinancial, setAcceptedNonFinancial] = useState(false);
  const [overrideMissingDocs, setOverrideMissingDocs] = useState("");

  // Legal handoff rule evaluation (ce_legal_handoff_rules is the authority)
  const [eligibility, setEligibility] = useState<EligibilityResult | null>(null);
  const [eligibilityLoading, setEligibilityLoading] = useState(false);
  const [handoffOverride, setHandoffOverride] = useState("");

  // --- initial load ------------------------------------------------------
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        if (ceCaseIdParam) {
          const { data: cc } = await sb
            .from("ce_cases")
            .select("*")
            .eq("id", ceCaseIdParam)
            .maybeSingle();
          setCeCase(cc);
          setCeCaseId(cc?.id ?? null);
          setEmployerId(cc?.employer_id ?? null);
          setEmployerName(cc?.employer_name ?? null);
        } else if (employerId) {
          await loadEmployer(employerId);
          await loadCasesForEmployer(employerId);
        }
      } catch (e: any) {
        toast.error("Failed to load", { description: e?.message });
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ceCaseIdParam]);

  async function loadEmployer(id: string) {
    try {
      const { data } = await sb
        .from("er_master")
        .select("regno, name")
        .eq("regno", id)
        .maybeSingle();
      setEmployerName(data?.name ?? null);
    } catch { /* ignore */ }
  }

  async function loadCasesForEmployer(id: string) {
    try {
      const { data } = await sb
        .from("ce_cases")
        .select("id, case_number, status, total_amount, created_at")
        .eq("employer_id", id)
        .in("status", ["OPEN", "ACTIVE", "PENDING", "ESCALATED"])
        .order("created_at", { ascending: false })
        .limit(20);
      setCaseOptions(data ?? []);
    } catch { /* ignore */ }
  }

  async function searchEmployer() {
    if (!employerSearch.trim() || employerSearch.length < 2) {
      setEmployerOptions([]);
      return;
    }
    const q = employerSearch.trim();
    try {
      const { data } = await sb
        .from("er_master")
        .select("regno, name")
        .or(`regno.ilike.%${q}%,name.ilike.%${q}%`)
        .limit(20);
      setEmployerOptions(data ?? []);
    } catch (e: any) {
      toast.error("Search failed", { description: e?.message });
    }
  }

  // --- step 3: load items when employer changes --------------------------
  async function loadCandidateItems() {
    if (!employerId) return;
    setItemsLoading(true);
    try {
      const items = await listComplianceCandidateItems({
        employerId,
        ceCaseId: ceCaseId ?? undefined,
        minAgeDays: minAge,
        includeCurrent,
      });
      setCandidates(items);
    } catch (e: any) {
      toast.error("Failed to load arrears", { description: e?.message });
    } finally {
      setItemsLoading(false);
    }
  }

  // --- step 4: load history ---------------------------------------------
  async function loadHistory() {
    if (!employerId && !ceCaseId) return;
    setHistoryLoading(true);
    try {
      const ctx = await loadComplianceHistory({ employerId, ceCaseId });
      setHistory(ctx);
    } catch (e: any) {
      toast.error("Failed to load history", { description: e?.message });
    } finally {
      setHistoryLoading(false);
    }
  }

  // --- legal handoff rule evaluation (configuration-driven gate) ----------
  async function loadEligibility() {
    setEligibilityLoading(true);
    try {
      const ctx = history ?? (await loadComplianceHistory({ employerId, ceCaseId }));
      if (!history) setHistory(ctx);
      const referredTotal = candidates
        .filter((c) => selectedItems[c.key])
        .reduce((s, c) => s + (c.outstanding || 0), 0);
      const result = await evaluateEligibility({
        fund: candidates.find((c) => selectedItems[c.key])?.fund_code ?? null,
        severity: ceCase?.severity ?? ceCase?.priority ?? null,
        outstandingAmount: referredTotal,
        noticesSent: ctx.notices_count,
        daysSinceFinalNotice: ceCase?.last_notice_date
          ? Math.floor(
              (Date.now() - new Date(ceCase.last_notice_date).getTime()) / 86_400_000,
            )
          : 0,
        repeatDefault: (ctx.breaches_count ?? 0) > 0 || (ctx.notices_count ?? 0) >= 3,
        arrangementBreach: (ctx.breaches_count ?? 0) > 0,
        evidenceTypes: documents.length ? ["CASE_SUMMARY"] : [],
        daysSinceEmployerResponse: null,
      });
      setEligibility(result);
    } catch (e: any) {
      toast.error("Failed to evaluate legal handoff rules", { description: e?.message });
      setEligibility(null);
    } finally {
      setEligibilityLoading(false);
    }
  }

  // Auto-load when entering steps
  useEffect(() => {
    if (step === 2 && employerId && candidates.length === 0) loadCandidateItems();
    if (step === 3 && history === null) loadHistory();
    if (step === 5) loadEligibility();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    if (step === 2 && employerId) loadCandidateItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minAge, includeCurrent]);

  // --- totals ------------------------------------------------------------
  const totals = useMemo(() => {
    let referred = 0;
    let retained = 0;
    let count = 0;
    for (const c of candidates) {
      if (selectedItems[c.key]) {
        referred += c.outstanding;
        count++;
      } else {
        retained += c.outstanding;
      }
    }
    return { referred, retained, count };
  }, [candidates, selectedItems]);

  const NON_FINANCIAL_REASONS = ["EMPLOYER_DISPUTE", "FAILURE_TO_FILE_C3", "COURT_ACTION_REQUIRED"];
  const reasonAllowsNoItems = NON_FINANCIAL_REASONS.includes(reasonCode);

  // --- validation per step ----------------------------------------------
  function canAdvance(): { ok: boolean; reason?: string } {
    if (step === 0) {
      if (!employerId) return { ok: false, reason: "Select an employer to continue" };
      return { ok: true };
    }
    if (step === 1) {
      if (!reasonText.trim()) return { ok: false, reason: "Provide a referral reason" };
      return { ok: true };
    }
    if (step === 2) {
      if (totals.count === 0 && !reasonAllowsNoItems && !acceptedNonFinancial) {
        return {
          ok: false,
          reason: "Select at least one liability item, or check the non-financial confirmation",
        };
      }
      return { ok: true };
    }
    if (step === 4) {
      if (documents.length === 0 && !overrideMissingDocs.trim()) {
        return {
          ok: false,
          reason: "Attach at least one document or provide an override reason",
        };
      }
      return { ok: true };
    }
    return { ok: true };
  }

  function next() {
    const c = canAdvance();
    if (!c.ok) {
      toast.error(c.reason ?? "Validation error");
      return;
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  }

  function back() {
    setStep((s) => Math.max(0, s - 1));
  }

  function toggleItem(k: string) {
    setSelectedItems((s) => ({ ...s, [k]: !s[k] }));
  }
  function selectAllItems(v: boolean) {
    const next: Record<string, boolean> = {};
    candidates.forEach((c) => (next[c.key] = v));
    setSelectedItems(next);
  }

  // --- submit ------------------------------------------------------------
  async function submit() {
    if (!ceCaseId) {
      toast.error("A Compliance case is required to submit. Pick one in Step 1.");
      return;
    }
    if (eligibility && eligibility.integrationMode === "DISABLED") {
      toast.error("Legal handoff is disabled by the configured handoff rule.");
      return;
    }
    if (eligibility && !eligibility.eligible && !handoffOverride.trim()) {
      toast.error("Legal handoff criteria not met", {
        description: "Record a documented override reason to proceed.",
      });
      return;
    }
    setSubmitting(true);
    try {
      const items = candidates
        .filter((c) => selectedItems[c.key])
        .map((c) => ({
          source_record_type: c.source_record_type,
          source_record_id: c.source_record_id,
          source_reference_no: c.source_reference_no,
          debtor_type: "EMPLOYER" as const,
          debtor_id: c.debtor_id,
          debtor_name: c.debtor_name,
          item_type: "LIABILITY" as const,
          liability_head_code: c.liability_head_code,
          fund_code: c.fund_code,
          period_from: c.period_from,
          period_to: c.period_to,
          principal_amount: c.principal,
          penalty_amount: c.penalty,
          interest_amount: c.interest,
          cost_amount: 0,
          total_amount: c.outstanding,
          amount_referred: c.outstanding,
          amount_retained_by_source: 0,
          referral_reason_code: reasonCode,
          source_payload: { raw: c.raw, age_days: c.age_days },
        }));

      const r = await createComplianceLegalReferral({
        ce_case_id: ceCaseId,
        referral_reason: reasonText.trim() +
          (overrideMissingDocs ? ` [no-docs override: ${overrideMissingDocs}]` : ""),
        referral_reason_code: reasonCode,
        priority_code: priority,
        payment_arrangement_id: paymentArrangementId,
        user_code: userCode,
        created_via: "REFERRAL_WIZARD",
        items,
        documents,
      });
      toast.success(`Referral ${r.referral_no} created as DRAFT`, {
        description: `${r.items_count} item(s), ${documents.length} document(s). Next: complete the legal pack and send for approval — the case is not escalated yet.`,
      });
      navigate(`/compliance/legal/pack-preparation?referral=${encodeURIComponent(r.referral_id)}`);

    } catch (e: any) {
      toast.error("Referral failed", { description: e?.message });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="p-8 text-muted-foreground">Loading…</div>;

  return (
    <div className="flex-1 p-8 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Compliance → Legal Referral</h1>
          <p className="text-sm text-muted-foreground">
            {employerName ? <>Employer <strong>{employerName}</strong> ({employerId}) · </> : null}
            {ceCase?.case_number ? <>Case <strong>{ceCase.case_number}</strong></> : null}
          </p>
        </div>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 flex-wrap">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <button
              onClick={() => setStep(i)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm border transition-colors ${
                i === step
                  ? "bg-primary text-primary-foreground border-primary"
                  : i < step
                  ? "bg-muted border-muted-foreground/20"
                  : "border-border"
              }`}
            >
              <span
                className={`flex items-center justify-center h-5 w-5 rounded-full text-xs ${
                  i < step
                    ? "bg-primary text-primary-foreground"
                    : i === step
                    ? "bg-primary-foreground text-primary"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {i < step ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              {label}
            </button>
            {i < STEPS.length - 1 && <span className="text-muted-foreground">›</span>}
          </div>
        ))}
      </div>

      {/* STEP 1: SOURCE */}
      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Step 1 — Employer &amp; Source</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!ceCaseIdParam && (
              <>
                <div className="flex gap-2">
                  <Input
                    placeholder="Search employer by number or name…"
                    value={employerSearch}
                    onChange={(e) => setEmployerSearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && searchEmployer()}
                  />
                  <Button variant="secondary" onClick={searchEmployer}>
                    Search
                  </Button>
                </div>
                {employerOptions.length > 0 && (
                  <div className="border rounded-md divide-y max-h-48 overflow-y-auto">
                    {employerOptions.map((o) => (
                      <button
                        key={o.regno}
                        className="w-full text-left p-2 text-sm hover:bg-muted"
                        onClick={async () => {
                          setEmployerId(o.regno);
                          setEmployerName(o.name);
                          setEmployerOptions([]);
                          await loadCasesForEmployer(o.regno);
                        }}
                      >
                        <strong>{o.name}</strong>{" "}
                        <span className="text-muted-foreground font-mono">{o.regno}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {employerId && (
              <>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <Field label="Employer No" value={employerId} />
                  <Field label="Employer Name" value={employerName ?? "—"} />
                </div>

                <div>
                  <Label>Compliance Case (required for submission)</Label>
                  {ceCaseIdParam ? (
                    <div className="border rounded-md p-2 text-sm">
                      <strong>{ceCase?.case_number}</strong> · {ceCase?.status}
                    </div>
                  ) : (
                    <Select value={ceCaseId ?? ""} onValueChange={(v) => setCeCaseId(v || null)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a case" />
                      </SelectTrigger>
                      <SelectContent>
                        {caseOptions.length === 0 ? (
                          <SelectItem value="__none__" disabled>
                            No open cases for this employer
                          </SelectItem>
                        ) : (
                          caseOptions.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.case_number} · {c.status} · {fmtMoney(Number(c.total_amount ?? 0))}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label>Linked Audit (optional)</Label>
                    <Input
                      value={auditId ?? ""}
                      onChange={(e) => setAuditId(e.target.value || null)}
                      placeholder="Audit report ID"
                    />
                  </div>
                  <div>
                    <Label>Linked Inspection (optional)</Label>
                    <Input
                      value={inspectionId ?? ""}
                      onChange={(e) => setInspectionId(e.target.value || null)}
                      placeholder="Inspection ID"
                    />
                  </div>
                  <div>
                    <Label>Linked Payment Arrangement (optional)</Label>
                    <Input
                      value={paymentArrangementId ?? ""}
                      onChange={(e) => setPaymentArrangementId(e.target.value || null)}
                      placeholder="Arrangement ID"
                    />
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* STEP 2: REASON */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Step 2 — Referral Reason</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Reason Code *</Label>
                <Select value={reasonCode} onValueChange={setReasonCode}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REASON_CODES.map((r) => (
                      <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Priority</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOW">Low</SelectItem>
                    <SelectItem value="MEDIUM">Medium</SelectItem>
                    <SelectItem value="HIGH">High</SelectItem>
                    <SelectItem value="URGENT">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Reason (free text) *</Label>
              <Textarea
                rows={5}
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                placeholder="Explain the legal recovery scope, supporting facts, and what Legal should pursue"
              />
            </div>
            {NON_FINANCIAL_REASONS.includes(reasonCode) && (
              <p className="text-xs text-amber-600">
                Reason "{reasonCode}" allows submission without liability items selected.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* STEP 3: ITEMS */}
      {step === 2 && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Step 3 — Select Liability Items</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <Label>Minimum age (days)</Label>
                  <Input
                    type="number"
                    value={minAge}
                    onChange={(e) => setMinAge(Number(e.target.value) || 0)}
                  />
                </div>
                <div className="flex items-end gap-2">
                  <Checkbox
                    id="include-current"
                    checked={includeCurrent}
                    onCheckedChange={(v) => setIncludeCurrent(Boolean(v))}
                  />
                  <Label htmlFor="include-current">Include current items</Label>
                </div>
                <div className="md:col-span-2 flex items-end justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => selectAllItems(true)}>
                    Select all
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => selectAllItems(false)}>
                    Clear
                  </Button>
                </div>
              </div>

              {itemsLoading ? (
                <div className="text-sm text-muted-foreground py-6 text-center">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading arrears…
                </div>
              ) : candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No matching arrears. Lower the minimum age or include current items.
                </p>
              ) : (
                <div className="border rounded-md overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs uppercase">
                      <tr>
                        <th className="p-2 w-10"></th>
                        <th className="p-2 text-left">Type</th>
                        <th className="p-2 text-left">Reference</th>
                        <th className="p-2 text-left">Head</th>
                        <th className="p-2 text-left">Fund</th>
                        <th className="p-2 text-left">Period</th>
                        <th className="p-2 text-right">Age</th>
                        <th className="p-2 text-right">Principal</th>
                        <th className="p-2 text-right">Penalty</th>
                        <th className="p-2 text-right">Interest</th>
                        <th className="p-2 text-right">Outstanding</th>
                      </tr>
                    </thead>
                    <tbody>
                      {candidates.map((c) => (
                        <tr
                          key={c.key}
                          className={`border-t hover:bg-muted/30 ${selectedItems[c.key] ? "bg-primary/5" : ""}`}
                        >
                          <td className="p-2">
                            <Checkbox
                              checked={!!selectedItems[c.key]}
                              onCheckedChange={() => toggleItem(c.key)}
                            />
                          </td>
                          <td className="p-2">
                            <Badge variant="outline" className="text-xs">{c.source_record_type}</Badge>
                          </td>
                          <td className="p-2 font-mono text-xs">{c.source_reference_no ?? "—"}</td>
                          <td className="p-2 text-xs">{c.liability_head_code ?? "—"}</td>
                          <td className="p-2">{c.fund_code ?? "—"}</td>
                          <td className="p-2 text-xs">
                            {c.period_from ? new Date(c.period_from).toLocaleDateString() : "—"}
                          </td>
                          <td className="p-2 text-right">{c.age_days ?? "—"}</td>
                          <td className="p-2 text-right">{fmtMoney(c.principal)}</td>
                          <td className="p-2 text-right">{fmtMoney(c.penalty)}</td>
                          <td className="p-2 text-right">{fmtMoney(c.interest)}</td>
                          <td className="p-2 text-right font-semibold">{fmtMoney(c.outstanding)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex justify-between text-sm border-t pt-3">
                <span>Selected: <strong>{totals.count}</strong></span>
                <span className="text-destructive">
                  Refer: <strong>{fmtMoney(totals.referred)}</strong>
                </span>
                <span className="text-muted-foreground">
                  Retain in Compliance: <strong>{fmtMoney(totals.retained)}</strong>
                </span>
              </div>

              {totals.count === 0 && reasonAllowsNoItems && (
                <label className="flex items-center gap-2 text-sm border rounded-md p-2 bg-amber-50">
                  <Checkbox
                    checked={acceptedNonFinancial}
                    onCheckedChange={(v) => setAcceptedNonFinancial(Boolean(v))}
                  />
                  Confirm this is a non-financial referral (no liability items required for "{reasonCode}").
                </label>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* STEP 4: HISTORY */}
      {step === 3 && (
        <HistoryTimelinePanel
          title="Step 4 — Officer &amp; Compliance History"
          loading={historyLoading}
          events={history?.events ?? []}
          summary={
            history
              ? [
                  { label: "Notices", value: history.notices_count },
                  { label: "Visits", value: history.visits_count },
                  { label: "Inspections", value: history.inspections_count },
                  { label: "Audits", value: history.audits_count },
                  { label: "Arrangements", value: history.arrangements_count },
                  { label: "Breaches", value: history.breaches_count },
                ]
              : undefined
          }
        />
      )}

      {/* STEP 5: DOCUMENTS */}
      {step === 4 && (
        <ReferralDocumentSelector
          sourceModule="COMPLIANCE"
          employerId={employerId}
          ceCaseId={ceCaseId}
          documents={documents}
          onChange={setDocuments}
        />
      )}

      {step === 4 && documents.length === 0 && (
        <Card>
          <CardContent className="pt-4">
            <Label>Override: reason for submitting without documents</Label>
            <Textarea
              rows={2}
              value={overrideMissingDocs}
              onChange={(e) => setOverrideMissingDocs(e.target.value)}
              placeholder="e.g. all documentation already in central DMS under employer file"
            />
          </CardContent>
        </Card>
      )}

      {/* STEP 6: REVIEW */}
      {step === 5 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Step 6 — Review Referral Packet</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Field label="Employer" value={`${employerName ?? "?"} (${employerId})`} />
              <Field label="Compliance Case" value={ceCase?.case_number ?? ceCaseId ?? "—"} />
              <Field label="Reason" value={reasonCode} />
              <Field label="Priority" value={priority} />
            </div>
            <Separator />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Field label="Items referred" value={`${totals.count}`} />
              <Field label="Amount referred" value={fmtMoney(totals.referred)} />
              <Field label="Amount retained" value={fmtMoney(totals.retained)} />
              <Field label="Documents attached" value={`${documents.length}`} />
            </div>
            <Separator />
            <Field label="Recommended legal action" value="Contribution Recovery (Non-Compliance)" />
            <Field
              label="Audit / Inspection / Arrangement links"
              value={[auditId, inspectionId, paymentArrangementId].filter(Boolean).join(", ") || "none"}
            />
            <Separator />
            <div>
              <Label className="text-xs text-muted-foreground">Reason text</Label>
              <p className="text-sm mt-1">{reasonText}</p>
            </div>
            {history && (
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-xs">
                <Tag>{history.notices_count} notices</Tag>
                <Tag>{history.visits_count} visits</Tag>
                <Tag>{history.inspections_count} inspections</Tag>
                <Tag>{history.audits_count} audits</Tag>
                <Tag>{history.arrangements_count} arrangements</Tag>
                <Tag>{history.breaches_count} breaches</Tag>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={back} disabled={step === 0 || submitting}>
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={next}>
            Next <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        ) : (
          <Button onClick={submit} disabled={submitting}>
            {submitting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Scale className="h-4 w-4 mr-2" />
            )}
            Submit Referral Packet
          </Button>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-muted text-muted-foreground">
      {children}
    </span>
  );
}
