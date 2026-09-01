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
  listBenefitsCandidatesByClaim,
  type BenefitsCandidateItem,
  type ReferralItemType,
} from "@/services/legal/coreLegalReferralItemService";
import { forwardBenefitsClaimToLegal } from "@/services/legal/benefitsForwardingService";
import {
  loadBenefitsHistory,
  type BenefitsContext,
} from "@/services/legal/legalReferralHistoryService";
import type { ReferralDocumentDraft } from "@/services/legal/coreLegalReferralDocumentService";
import ReferralDocumentSelector from "@/components/legal/lg/ReferralDocumentSelector";
import HistoryTimelinePanel from "@/components/legal/lg/HistoryTimelinePanel";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";

const sb = supabase as any;

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "XCD" }).format(n);

const REASON_CODES = [
  { code: "BENEFIT_OVERPAYMENT", label: "Benefit Overpayment" },
  { code: "PAYMENT_AFTER_DEATH", label: "Payment After Death" },
  { code: "BENEFIT_APPEAL", label: "Benefit Appeal" },
  { code: "BENEFIT_RECOVERY_FAILED", label: "Benefit Recovery Failed" },
  { code: "FRAUD_MISREPRESENTATION", label: "Fraud / Misrepresentation" },
  { code: "ESTATE_RECOVERY", label: "Estate Recovery" },
  { code: "ELIGIBILITY_DISPUTE", label: "Eligibility Dispute" },
];

const MATTER_TYPES = [
  { code: "BENEFIT_OVERPAYMENT", label: "Benefit Overpayment" },
  { code: "PAYMENT_AFTER_DEATH", label: "Payment After Death" },
  { code: "BENEFIT_APPEAL", label: "Appeal / Review Dispute" },
  { code: "FRAUD_REVIEW", label: "Fraud / Misrepresentation" },
  { code: "ESTATE_RECOVERY", label: "Estate Recovery" },
  { code: "BENEFIT_DISPUTE", label: "Benefit Dispute (Generic)" },
];

const NON_FINANCIAL_REASONS = ["BENEFIT_APPEAL", "ELIGIBILITY_DISPUTE"];

const STEPS = ["Source", "Reason", "Items", "History", "Documents", "Review"] as const;

export default function BenefitsLegalReferralWizard() {
  const { claimId: claimIdParam } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { profile } = useSupabaseAuth();
  const userCode = profile?.user_code ?? null;

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Step 1
  const [claimId, setClaimId] = useState<string | null>(claimIdParam ?? search.get("claimId") ?? null);
  const [claim, setClaim] = useState<any>(null);
  const [claimSearch, setClaimSearch] = useState("");
  const [claimOptions, setClaimOptions] = useState<any[]>([]);

  // Step 2
  const [matterType, setMatterType] = useState(search.get("matter") ?? "BENEFIT_OVERPAYMENT");
  const [reasonCode, setReasonCode] = useState(search.get("reasonCode") ?? "BENEFIT_OVERPAYMENT");
  const [priority, setPriority] = useState("MEDIUM");
  const [reasonText, setReasonText] = useState("");

  // Step 3
  const [candidates, setCandidates] = useState<BenefitsCandidateItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<Record<string, boolean>>({});
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [itemsLoading, setItemsLoading] = useState(false);
  const [acceptedNonFinancial, setAcceptedNonFinancial] = useState(false);

  // Step 4
  const [history, setHistory] = useState<BenefitsContext | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Step 5
  const [documents, setDocuments] = useState<ReferralDocumentDraft[]>([]);
  const [overrideMissingDocs, setOverrideMissingDocs] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        if (claimId) await loadClaim(claimId);
      } catch (e: any) {
        toast.error("Failed to load claim", { description: e?.message });
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimId]);

  async function loadClaim(id: string) {
    const { data } = await sb.from("bn_claim").select("*").eq("id", id).maybeSingle();
    setClaim(data);
  }

  async function searchClaim() {
    if (!claimSearch.trim() || claimSearch.length < 2) return;
    const q = claimSearch.trim();
    try {
      const { data: byNum } = await sb
        .from("bn_claim")
        .select("id, claim_number, ssn, status, entered_at")
        .or(`claim_number.ilike.%${q}%,ssn.ilike.%${q}%`)
        .order("entered_at", { ascending: false })
        .limit(15);
      let rows = byNum ?? [];

      if (rows.length === 0) {
        const { data: ssns } = await sb
          .from("ip_master")
          .select("ssn")
          .or(`surname.ilike.%${q}%,firstname.ilike.%${q}%`)
          .limit(50);
        const ssnList = (ssns ?? []).map((s: any) => s.ssn).filter(Boolean);
        if (ssnList.length) {
          const { data: byName } = await sb
            .from("bn_claim")
            .select("id, claim_number, ssn, status, entered_at")
            .in("ssn", ssnList)
            .order("entered_at", { ascending: false })
            .limit(15);
          rows = byName ?? [];
        }
      }
      setClaimOptions(rows);
    } catch (e: any) {
      toast.error("Search failed", { description: e?.message });
    }
  }

  async function loadCandidateItems() {
    if (!claimId) return;
    setItemsLoading(true);
    try {
      const items = await listBenefitsCandidatesByClaim(claimId);
      setCandidates(items);
      const init: Record<string, boolean> = {};
      items.forEach((it) => {
        if (it.source_record_type === "OVERPAYMENT") init[it.key] = true;
      });
      setSelectedItems(init);
    } catch (e: any) {
      toast.error("Failed to load items", { description: e?.message });
    } finally {
      setItemsLoading(false);
    }
  }

  async function loadHistory() {
    if (!claimId) return;
    setHistoryLoading(true);
    try {
      const ctx = await loadBenefitsHistory({ claimId, ssn: claim?.ssn ?? null });
      setHistory(ctx);
    } catch (e: any) {
      toast.error("Failed to load history", { description: e?.message });
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (step === 2 && claimId && candidates.length === 0) loadCandidateItems();
    if (step === 3 && history === null) loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const totals = useMemo(() => {
    let referred = 0;
    let count = 0;
    for (const c of candidates) {
      if (selectedItems[c.key]) {
        referred += overrides[c.key] ?? c.outstanding;
        count++;
      }
    }
    return { referred, count };
  }, [candidates, selectedItems, overrides]);

  const reasonAllowsNoItems = NON_FINANCIAL_REASONS.includes(reasonCode);

  function itemTypeFor(rt: BenefitsCandidateItem["source_record_type"]): ReferralItemType {
    if (rt === "OVERPAYMENT") return "OVERPAYMENT";
    if (rt === "APPEAL") return "APPEAL";
    if (rt === "FRAUD") return "FRAUD";
    return "CLAIM";
  }

  function canAdvance(): { ok: boolean; reason?: string } {
    if (step === 0 && !claimId) return { ok: false, reason: "Select a claim to continue" };
    if (step === 1 && !reasonText.trim()) return { ok: false, reason: "Provide a referral reason" };
    if (step === 2 && totals.count === 0 && !reasonAllowsNoItems && !acceptedNonFinancial) {
      return { ok: false, reason: "Select at least one item or confirm non-financial referral" };
    }
    if (step === 4 && documents.length === 0 && !overrideMissingDocs.trim()) {
      return { ok: false, reason: "Attach a document or provide an override reason" };
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

  async function submit() {
    if (!claimId) return;
    setSubmitting(true);
    try {
      const items = candidates
        .filter((c) => selectedItems[c.key])
        .map((c) => {
          const amount = overrides[c.key] ?? c.outstanding;
          return {
            source_record_type: c.source_record_type,
            source_record_id: c.source_record_id,
            source_reference_no: c.source_reference_no,
            debtor_type: c.debtor_type,
            debtor_id: c.debtor_id,
            debtor_name: c.debtor_name,
            item_type: itemTypeFor(c.source_record_type),
            principal_amount: amount,
            penalty_amount: 0,
            interest_amount: 0,
            cost_amount: 0,
            total_amount: amount,
            amount_referred: amount,
            amount_retained_by_source: Math.max(0, c.outstanding - amount),
            period_from: c.period_from,
            period_to: c.period_to,
            referral_reason_code: reasonCode,
            source_payload: { raw: c.raw },
          };
        });

      const r = await forwardBenefitsClaimToLegal({
        bn_claim_id: claimId,
        matter_type_code: matterType,
        referral_reason:
          reasonText.trim() +
          (overrideMissingDocs ? ` [no-docs override: ${overrideMissingDocs}]` : ""),
        referral_reason_code: reasonCode,
        priority_code: priority,
        exposure_amount: totals.referred,
        user_code: userCode,
        items,
        documents,
      });
      toast.success(`Referral ${r.referral_no} submitted to Legal`, {
        description: `${r.items_count} item(s), ${documents.length} document(s). Track status from Legal Referrals.`,
      });
      navigate(`/bn/legal-referrals?highlight=${encodeURIComponent(r.referral_no)}`);
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
          <h1 className="text-2xl font-bold">Benefits → Legal Referral</h1>
          <p className="text-sm text-muted-foreground">
            {claim ? (
              <>
                Claim <strong>{claim.claim_number ?? claim.id}</strong> · SSN{" "}
                <strong>{claim.ssn ?? "—"}</strong>
              </>
            ) : (
              "Select a claim to begin"
            )}
          </p>
        </div>
      </div>

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

      {/* STEP 1 */}
      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Step 1 — Claim / Person</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!claimIdParam && (
              <>
                <div className="flex gap-2">
                  <Input
                    placeholder="Claim number, SSN, or last name…"
                    value={claimSearch}
                    onChange={(e) => setClaimSearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && searchClaim()}
                  />
                  <Button variant="secondary" onClick={searchClaim}>Search</Button>
                </div>
                {claimOptions.length > 0 && (
                  <div className="border rounded-md divide-y max-h-48 overflow-y-auto">
                    {claimOptions.map((o) => (
                      <button
                        key={o.id}
                        className="w-full text-left p-2 text-sm hover:bg-muted"
                        onClick={() => {
                          setClaimId(o.id);
                          setClaim(o);
                          setClaimOptions([]);
                        }}
                      >
                        <strong>{o.claim_number}</strong>{" "}
                        <span className="text-muted-foreground">· SSN {o.ssn} · {o.status}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            {claim && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                <Field label="Claim Number" value={claim.claim_number} />
                <Field label="SSN" value={claim.ssn ?? "—"} />
                <Field label="Status" value={claim.status ?? "—"} />
                <Field label="Product" value={claim.product_code ?? "—"} />
                <Field label="Employer" value={claim.employer_id ?? claim.employer_regno ?? "—"} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* STEP 2 */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Step 2 — Referral Reason</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>Matter Type *</Label>
                <Select value={matterType} onValueChange={setMatterType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MATTER_TYPES.map((m) => (
                      <SelectItem key={m.code} value={m.code}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
                placeholder="Describe the matter, the legal action sought, and supporting facts"
              />
            </div>
            {NON_FINANCIAL_REASONS.includes(reasonCode) && (
              <p className="text-xs text-amber-600">
                Reason "{reasonCode}" allows submission without monetary items.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* STEP 3 */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>Step 3 — Select Items</span>
              <span className="text-sm font-normal">
                Selected <strong>{totals.count}</strong> · Refer{" "}
                <strong className="text-destructive">{fmtMoney(totals.referred)}</strong>
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {itemsLoading ? (
              <div className="text-sm text-muted-foreground py-6 text-center">
                <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…
              </div>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No referable items found for this claim.
              </p>
            ) : (
              <div className="border rounded-md overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase">
                    <tr>
                      <th className="p-2 w-10"></th>
                      <th className="p-2 text-left">Type</th>
                      <th className="p-2 text-left">Reference</th>
                      <th className="p-2 text-left">Debtor</th>
                      <th className="p-2 text-left">Period</th>
                      <th className="p-2 text-right">Outstanding</th>
                      <th className="p-2 text-right w-32">Refer Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((c) => (
                      <tr
                        key={c.key}
                        className={`border-t ${selectedItems[c.key] ? "bg-primary/5" : ""}`}
                      >
                        <td className="p-2">
                          <Checkbox
                            checked={!!selectedItems[c.key]}
                            onCheckedChange={() =>
                              setSelectedItems((s) => ({ ...s, [c.key]: !s[c.key] }))
                            }
                          />
                        </td>
                        <td className="p-2"><Badge variant="outline">{c.source_record_type}</Badge></td>
                        <td className="p-2 font-mono text-xs">
                          {c.source_reference_no ?? c.source_record_id.slice(0, 8)}
                        </td>
                        <td className="p-2">{c.debtor_name ?? c.debtor_id ?? "—"}</td>
                        <td className="p-2 text-xs">
                          {c.period_from ? new Date(c.period_from).toLocaleDateString() : "—"}
                        </td>
                        <td className="p-2 text-right">{fmtMoney(c.outstanding)}</td>
                        <td className="p-2 text-right">
                          <Input
                            type="number"
                            className="text-right h-8"
                            value={overrides[c.key] ?? c.outstanding}
                            onChange={(e) =>
                              setOverrides((o) => ({ ...o, [c.key]: Number(e.target.value) || 0 }))
                            }
                            disabled={!selectedItems[c.key]}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {totals.count === 0 && reasonAllowsNoItems && (
              <label className="flex items-center gap-2 text-sm border rounded-md p-2 bg-amber-50">
                <Checkbox
                  checked={acceptedNonFinancial}
                  onCheckedChange={(v) => setAcceptedNonFinancial(Boolean(v))}
                />
                Confirm non-financial referral (no monetary items for "{reasonCode}").
              </label>
            )}
          </CardContent>
        </Card>
      )}

      {/* STEP 4 */}
      {step === 3 && (
        <HistoryTimelinePanel
          title="Step 4 — Claim &amp; Payment History"
          loading={historyLoading}
          events={history?.events ?? []}
          summary={
            history
              ? [
                  { label: "Payments", value: history.payments_count },
                  { label: "Overpayments", value: history.overpayments_count },
                  { label: "Appeals", value: history.appeals_count },
                ]
              : undefined
          }
        />
      )}

      {/* STEP 5 */}
      {step === 4 && (
        <>
          <ReferralDocumentSelector
            sourceModule="BENEFITS"
            claimId={claimId}
            ssn={claim?.ssn ?? null}
            documents={documents}
            onChange={setDocuments}
          />
          {documents.length === 0 && (
            <Card>
              <CardContent className="pt-4">
                <Label>Override: reason for submitting without documents</Label>
                <Textarea
                  rows={2}
                  value={overrideMissingDocs}
                  onChange={(e) => setOverrideMissingDocs(e.target.value)}
                  placeholder="e.g. medical records on file with provider — request via subpoena"
                />
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* STEP 6 */}
      {step === 5 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Step 6 — Review Referral Packet</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Field label="Claim" value={claim?.claim_number ?? "—"} />
              <Field label="SSN" value={claim?.ssn ?? "—"} />
              <Field label="Matter" value={matterType} />
              <Field label="Reason" value={reasonCode} />
            </div>
            <Separator />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Field label="Items referred" value={`${totals.count}`} />
              <Field label="Exposure" value={fmtMoney(totals.referred)} />
              <Field label="Documents attached" value={`${documents.length}`} />
              <Field label="Priority" value={priority} />
            </div>
            <Separator />
            <div>
              <Label className="text-xs text-muted-foreground">Reason text</Label>
              <p className="text-sm mt-1">{reasonText}</p>
            </div>
            {history && (
              <div className="grid grid-cols-3 gap-2 text-xs">
                <Tag>{history.payments_count} payments</Tag>
                <Tag>{history.overpayments_count} overpayments</Tag>
                <Tag>{history.appeals_count} appeals</Tag>
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
