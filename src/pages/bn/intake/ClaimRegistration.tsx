/**
 * Staff-Assisted Smart Intake — /bn/intake/register
 *
 * Eleven-step flow:
 *   1. Search SSN
 *   2. Confirm claimant
 *   3. Select benefit
 *   4. Enter claim date
 *   5. Resolve active product version
 *   6. Auto-load eligibility pre-checks
 *   7. Auto-load required documents
 *   8. Enter benefit-specific facts only
 *   9. Internal options (priority, basket, notes, escalation)
 *   10. Submit claim
 *   11. Workflow auto-started; claim routed to Worklist / Queue / My Tasks
 *
 * Internal-only capabilities (channel = STAFF_OFFLINE):
 *   - Pending verification (when SSN not found)         → audit
 *   - Legacy lookup (cl_head)
 *   - Document pending status                           → audit
 *   - Document waiver request (permission gated)        → audit
 *   - Internal notes
 *   - Priority
 *   - Workflow basket routing (permission gated)        → audit
 *   - Supervisor escalation                             → audit
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  ArrowLeft, ArrowRight, Save, Search, ShieldCheck, AlertCircle,
  AlertTriangle, Loader2, FileText, CheckCircle2, Link2, UserPlus,
  StickyNote, FlagTriangleRight, Inbox, ListChecks, Stethoscope, Banknote,
} from 'lucide-react';
import { toast } from 'sonner';

import { PermissionWrapper } from '@/components/ui/permission-wrapper';
import { useBnProducts } from '@/hooks/bn/useBnProduct';
import { useBnClaimIntake } from '@/hooks/bn/useBnClaimIntake';
import type { BnProduct } from '@/types/bn';
import { formatDate as formatDateForDisplay } from '@/lib/culture/culture';
import { useAuth } from '@/contexts/AuthContext';
import {
  auditWorkflowAction,
  auditDocumentAction,
  auditClaimAction,
} from '@/services/bn/audit/bnAuditService';
import WorkbasketSelector from '@/components/bn/selectors/WorkbasketSelector';
import ReasonCaptureDialog from '@/components/bn/intake/ReasonCaptureDialog';
import { DEFAULT_PAYMENT_POLICY, type BnPaymentPolicy, type BnPaymentProfile } from '@/types/bnPaymentProfile';
import { resolveProductVersion, type ResolvedProductVersion } from '@/services/bn/productVersionResolver';
import {
  lookupPersonBySSN,
  getDependants,
  getExistingClaims,
  getContributionSummary,
  getRequiredDocuments,
  lookupLegacyClaims,
  type ContributionSummaryResult,
  type RequiredDocumentLite,
  type ExistingClaimRecord,
  type LegacyClaimRecord,
} from '@/services/bn/forms/formLookupService';
import { fetchEligibilityRules } from '@/services/bn/productService';
import {
  evaluateEligibilityRules,
  summariseEligibility,
  type EligibilityRuleTrace,
} from '@/services/bn/eligibility/eligibilityEvaluator';
import { summariseBlockingRules } from '@/services/bn/eligibility/ruleMessage';
import {
  getDefaultFieldsForBenefit,
  normalizeBenefitKey,
  type FormFieldDef,
} from '@/services/bn/forms/sectionCatalogue';
import type { PersonSummary, Dependant } from '@/services/bn/integration';
import PaymentDetailsSection from '@/components/bn/payment/PaymentDetailsSection';


type DocStatus = 'PROVIDED' | 'PENDING' | 'WAIVED';
interface DocState {
  status: DocStatus;
  pendingReason?: string;
  waiverReason?: string;
}

const STEPS = [
  { key: 'ssn', label: 'Search SSN', icon: Search },
  { key: 'confirm', label: 'Confirm Claimant', icon: UserPlus },
  { key: 'benefit', label: 'Select Benefit', icon: ListChecks },
  { key: 'claim-date', label: 'Claim Date', icon: FileText },
  { key: 'version', label: 'Product Version', icon: ShieldCheck },
  { key: 'eligibility', label: 'Eligibility Pre-checks', icon: CheckCircle2 },
  { key: 'documents', label: 'Required Documents', icon: ListChecks },
  { key: 'facts', label: 'Benefit Facts', icon: Stethoscope },
  { key: 'banking', label: 'Banking / Payment', icon: Banknote },
  { key: 'internal', label: 'Internal Options', icon: StickyNote },
  { key: 'review', label: 'Review & Submit', icon: Save },
] as const;
type StepKey = (typeof STEPS)[number]['key'];

export default function ClaimRegistration() {
  const navigate = useNavigate();
  const { user, hasPermission } = useAuth();
  const userCode: string = (user as any)?.user_code ?? user?.email ?? user?.name ?? 'STAFF';
  const can = (perm: string) => hasPermission(perm);

  const { data: products = [] } = useBnProducts();
  const activeProducts = useMemo(
    () => (products as BnProduct[]).filter(p => p.status === 'ACTIVE'),
    [products],
  );
  const intake = useBnClaimIntake();

  // ─── Wizard state ────────────────────────────────────────────────
  const [step, setStep] = useState<StepKey>('ssn');
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Step 1–2: SSN + claimant
  const [ssn, setSsn] = useState('');
  const [person, setPerson] = useState<PersonSummary | null>(null);
  const [personLoading, setPersonLoading] = useState(false);
  const [personError, setPersonError] = useState<string | null>(null);
  const [pendingVerification, setPendingVerification] = useState(false);
  const [pendingPerson, setPendingPerson] = useState({ firstName: '', lastName: '', dob: '', gender: 'N' as 'M' | 'F' | 'N' });
  const [dependants, setDependants] = useState<Dependant[]>([]);
  const [existingClaims, setExistingClaims] = useState<ExistingClaimRecord[]>([]);
  const [legacyMatches, setLegacyMatches] = useState<LegacyClaimRecord[]>([]);

  // Step 3–4: benefit + date
  const [productId, setProductId] = useState('');
  const [claimDate, setClaimDate] = useState(new Date().toISOString().slice(0, 10));

  // Step 5: resolved version
  const [resolvedVersion, setResolvedVersion] = useState<ResolvedProductVersion | null>(null);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [resolvingVersion, setResolvingVersion] = useState(false);

  // Step 6: eligibility
  const [eligRules, setEligRules] = useState<any[]>([]);
  // BUG-29 — step 6 used to list rules with a static tick and never compare a
  // value, so an unqualified claimant read "Eligibility PASSED". The pre-check
  // now evaluates every rule and blocks registration on any failure or on any
  // rule that could not be evaluated.
  const [eligTraces, setEligTraces] = useState<EligibilityRuleTrace[]>([]);
  const [eligEvaluating, setEligEvaluating] = useState(false);
  const [eligError, setEligError] = useState<string | null>(null);
  const [contribution, setContribution] = useState<ContributionSummaryResult | null>(null);

  // Step 7: documents
  const [docs, setDocs] = useState<RequiredDocumentLite[]>([]);
  const [docState, setDocState] = useState<Record<string, DocState>>({});

  // Step 8: benefit-specific facts
  const [factValues, setFactValues] = useState<Record<string, any>>({});

  // Step 9: internal options
  const [priority, setPriority] = useState<'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'>('NORMAL');
  const [source, setSource] = useState<'WALK_IN' | 'PAPER' | 'PHONE'>('PAPER');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  // Bank/EFT details are captured via the unified PaymentDetailsSection
  // (bn_payment_profile) — no longer stored as free-text on the application.
  const [internalNotes, setInternalNotes] = useState('');
  const [workbasket, setWorkbasket] = useState('');
  const [escalateSupervisor, setEscalateSupervisor] = useState(false);
  const [escalationReason, setEscalationReason] = useState('');

  // Payment policy resolved by PaymentDetailsSection; used to enforce intake gates.
  const [paymentPolicy, setPaymentPolicy] = useState<BnPaymentPolicy>(DEFAULT_PAYMENT_POLICY);
  const [paymentProfile, setPaymentProfile] = useState<BnPaymentProfile | null>(null);

  // Reason-capture dialog state (replaces window.prompt for doc pending/waiver).
  const [reasonDialog, setReasonDialog] = useState<
    | null
    | { kind: 'PENDING' | 'WAIVE'; code: string; title: string; description?: string }
  >(null);

  const selectedProduct = useMemo(
    () => activeProducts.find(p => p.id === productId),
    [activeProducts, productId],
  );
  const benefitKey = useMemo(
    () => normalizeBenefitKey((selectedProduct as any)?.benefit_code ?? null),
    [selectedProduct],
  );

  // ─── Step 1 — SSN lookup ─────────────────────────────────────────
  async function handleSsnLookup() {
    const v = ssn.trim();
    if (!v) {
      setErrors(e => ({ ...e, ssn: 'SSN is required' }));
      return;
    }
    setErrors(e => { const n = { ...e }; delete n.ssn; return n; });
    setPersonLoading(true);
    setPersonError(null);
    try {
      const res = await lookupPersonBySSN(v);
      if (res.found && res.person) {
        setPerson(res.person);
        setPendingVerification(false);
        setContactPhone(prev => prev || res.person!.phone || '');
        setContactEmail(prev => prev || res.person!.email || '');
        const [deps, existing] = await Promise.all([
          getDependants(res.person.ssn),
          getExistingClaims(res.person.ssn),
        ]);
        setDependants(deps);
        setExistingClaims(existing);
        setStep('confirm');
      } else {
        setPerson(null);
        setPersonError(res.reason === 'NOT_FOUND' ? `No person found for SSN ${v}.` : (res.error ?? 'Lookup failed.'));
      }
    } catch (e: any) {
      setPersonError(e?.message ?? 'Lookup failed.');
    } finally {
      setPersonLoading(false);
    }
  }

  async function togglePendingVerification(on: boolean) {
    setPendingVerification(on);
    if (on) {
      await auditClaimAction({
        action: 'PENDING_VERIFICATION_ENABLED',
        entityType: 'bn_claim_intake',
        entityId: ssn || 'unknown',
        performedBy: userCode,
        severity: 'warning',
        afterValue: { ssn, reason: 'SSN not found in ip_master' },
      });
    }
  }

  async function runLegacyLookup() {
    const key = ssn.trim();
    if (!key) return;
    const rows = await lookupLegacyClaims(key);
    setLegacyMatches(rows);
    toast.info(rows.length ? `${rows.length} legacy claim(s) found.` : 'No legacy claims found.');
  }

  // ─── Step 5 — Resolve version when benefit + date set ─────────────
  useEffect(() => {
    let cancel = false;
    async function run() {
      if (step !== 'version' || !selectedProduct || !claimDate) return;
      setResolvingVersion(true);
      setVersionError(null);
      try {
        const code = (selectedProduct as any).benefit_code ?? (selectedProduct as any).code;
        const v = await resolveProductVersion(code, claimDate);
        if (!cancel) setResolvedVersion(v);
      } catch (e: any) {
        if (!cancel) {
          setResolvedVersion(null);
          setVersionError(e?.message ?? 'Could not resolve an active product version.');
        }
      } finally {
        if (!cancel) setResolvingVersion(false);
      }
    }
    run();
    return () => { cancel = true; };
  }, [step, selectedProduct, claimDate]);

  // BUG-46 — 'INTAKE' holds document rules back. The claim does not exist yet,
  // so nothing can be attached to it; a missing certificate at the counter is
  // not a finding that the claimant does not qualify. They are judged at
  // approval, where checkApprovalPreconditions refuses on DOCUMENTS_OUTSTANDING.
  const eligSummary = useMemo(
    () => summariseEligibility(eligTraces, { phase: 'INTAKE' }),
    [eligTraces],
  );
  /** Rule codes held back, so the list below can label them instead of failing them. */
  const deferredCodes = useMemo(
    () => new Set(eligSummary.deferred.map((t) => t.rule_code)),
    [eligSummary.deferred],
  );
  /**
   * Every requirement this product carries is documentary, so there was nothing
   * to compare at the counter. Distinguished from a genuine gap because the
   * screen must not say "refer for manual review" about a claim it will happily
   * register (BUG-46).
   */
  const onlyEvidenceRemains =
    eligSummary.evaluatedCount === 0 &&
    eligSummary.unevaluated.length === 0 &&
    eligSummary.deferred.length > 0;

  const effectiveSsnForElig = person?.ssn ?? (pendingVerification ? ssn : '');

  // Evaluates every active rule for the resolved version against this claimant.
  // Returns the traces so callers can await a fresh result.
  const runEligibilityPrecheck = useCallback(
    async (rules: any[]): Promise<EligibilityRuleTrace[]> => {
      if (!resolvedVersion || !effectiveSsnForElig || rules.length === 0) {
        setEligTraces([]);
        return [];
      }
      setEligEvaluating(true);
      setEligError(null);
      try {
        const traces = await evaluateEligibilityRules(rules, {
          ssn: effectiveSsnForElig,
          claimDate,
          benefitType: (selectedProduct as any)?.benefit_code,
        });
        setEligTraces(traces);
        return traces;
      } catch (err: any) {
        // A pre-check that cannot run must not read as a pass.
        setEligTraces([]);
        setEligError(err?.message ?? 'Eligibility pre-check could not be completed.');
        return [];
      } finally {
        setEligEvaluating(false);
      }
    },
    [resolvedVersion, effectiveSsnForElig, claimDate, selectedProduct],
  );

  // ─── Step 6+7 — Load eligibility & documents when version known ──
  useEffect(() => {
    let cancel = false;
    async function run() {
      if (!resolvedVersion) return;
      const [rules, docList] = await Promise.all([
        fetchEligibilityRules(resolvedVersion.version.id).catch(() => []),
        getRequiredDocuments(resolvedVersion.version.id, 'INTERNAL'),
      ]);
      if (cancel) return;
      setEligRules(rules);
      setDocs(docList);
      void runEligibilityPrecheck(rules);
      setDocState(prev => {
        const n = { ...prev };
        for (const d of docList) if (!n[d.document_type_code]) n[d.document_type_code] = { status: 'PROVIDED' };
        return n;
      });
      // Contribution context for eligibility display
      const effectiveSsn = person?.ssn ?? (pendingVerification ? ssn : '');
      if (effectiveSsn) {
        const summary = await getContributionSummary(effectiveSsn, claimDate, resolvedVersion.version.id);
        if (!cancel) setContribution(summary);
      }
      // Audit precheck run (non-blocking)
      if (userCode) {
        void auditClaimAction({
          action: 'ELIGIBILITY_PRECHECK_RUN',
          entityType: 'bn_claim_intake',
          entityId: resolvedVersion.version.id,
          performedBy: userCode,
          afterValue: {
            productCode: (selectedProduct as any)?.benefit_code,
            ssn: effectiveSsn || null,
            claimDate,
            ruleCount: rules.length,
          },
          critical: false,
        }).catch(() => {});
      }
    }
    run();
    return () => { cancel = true; };
  }, [resolvedVersion, claimDate, person, pendingVerification, ssn]);

  // ─── Document operations (audited) ───────────────────────────────
  async function markDocPending(code: string, reason: string) {
    setDocState(prev => ({ ...prev, [code]: { status: 'PENDING', pendingReason: reason } }));
    await auditDocumentAction({
      action: 'DOCUMENT_MARKED_PENDING',
      entityType: 'bn_claim_intake',
      entityId: code,
      performedBy: userCode,
      afterValue: { ssn: person?.ssn ?? ssn, productCode: (selectedProduct as any)?.benefit_code, document: code, reason },
    });
  }

  async function requestDocWaiver(code: string, reason: string) {
    if (!can('benefits.document_waiver')) {
      toast.error('You do not have permission to waive documents.');
      return;
    }
    setDocState(prev => ({ ...prev, [code]: { status: 'WAIVED', waiverReason: reason } }));
    await auditDocumentAction({
      action: 'DOCUMENT_WAIVER_REQUESTED',
      entityType: 'bn_claim_intake',
      entityId: code,
      performedBy: userCode,
      severity: 'warning',
      afterValue: { ssn: person?.ssn ?? ssn, productCode: (selectedProduct as any)?.benefit_code, document: code, reason },
    });
  }

  async function setBasketWithAudit(value: string) {
    setWorkbasket(value);
    if (value) {
      await auditWorkflowAction({
        action: 'WORKFLOW_BASKET_OVERRIDE',
        entityType: 'bn_claim_intake',
        entityId: person?.ssn ?? ssn,
        performedBy: userCode,
        severity: 'warning',
        afterValue: { workbasket: value, productCode: (selectedProduct as any)?.benefit_code },
      });
    }
  }

  async function toggleEscalation(on: boolean) {
    setEscalateSupervisor(on);
    if (on) {
      await auditWorkflowAction({
        action: 'SUPERVISOR_ESCALATION_REQUESTED',
        entityType: 'bn_claim_intake',
        entityId: person?.ssn ?? ssn,
        performedBy: userCode,
        severity: 'warning',
        afterValue: { reason: escalationReason || '(not yet supplied)', productCode: (selectedProduct as any)?.benefit_code },
      });
    }
  }

  // ─── Benefit-specific facts list ─────────────────────────────────
  const factFields: FormFieldDef[] = useMemo(() => {
    if (!benefitKey) return [];
    return getDefaultFieldsForBenefit(benefitKey).filter(f => {
      const skipSections = new Set([
        'claimant_details',
        'insured_person_details',
        'benefit_selection',
        'employment_details',
        'contribution_context',
        'banking_payee_details',
        'documents',
        'declaration_consent',
        'internal_review',
      ]);
      return !skipSections.has(f.section_code);
    });
  }, [benefitKey]);

  // ─── Step navigation guards ──────────────────────────────────────
  function canAdvanceFrom(s: StepKey): string | null {
    switch (s) {
      case 'ssn': return person || pendingVerification ? null : 'Look up an SSN or enable pending verification.';
      case 'confirm':
        if (pendingVerification && (!pendingPerson.firstName || !pendingPerson.lastName || !pendingPerson.dob))
          return 'Provide name and DOB for pending verification.';
        return null;
      case 'benefit': return productId ? null : 'Select a benefit.';
      case 'claim-date': return claimDate ? null : 'Enter a claim date.';
      case 'version': return resolvedVersion ? null : 'Active product version must resolve.';
      case 'eligibility': {
        // BUG-29 — a check with no input must not read as a pass.
        // BUG-30 — nor is "nothing failed" a pass. The verdict stays honest.
        //
        // BUG-48 — but the verdict does not bar registration. A claim must
        // always be lodgeable: registration is what brings the claim into
        // existence, and a refusal has to be a formal decision the claimant can
        // appeal. Turning someone away at the counter produces no decision to
        // appeal against, and no record that they ever came.
        //
        // So the pre-check informs and is recorded, and the entitlement
        // decision belongs to adjudication — where checkApprovalPreconditions
        // already refuses on eligibility, documents, calculation and amount.
        //
        // What still blocks is only what the officer can resolve right now.
        if (eligEvaluating) return 'Eligibility pre-check is still running.';
        if (eligError) return eligError;
        if (!effectiveSsnForElig) return 'A verified SSN is required before eligibility can be checked.';
        // The pre-check must have been run, so its finding is on the record and
        // travels with the claim. Its result is not a condition of proceeding.
        if (eligRules.length > 0 && eligTraces.length === 0) {
          return 'Run the eligibility pre-check before continuing.';
        }
        return null;
      }
      case 'documents':
      case 'facts':
        return null;
      case 'banking':
        // Honour product policy: if payment is required at application, a profile must exist.
        if (
          paymentPolicy.payment_required_at_application &&
          paymentPolicy.payment_details_visibility !== 'HIDE' &&
          !paymentProfile
        ) {
          return 'This product requires payment details before continuing.';
        }
        return null;
      case 'internal':
        return null;
      case 'review': return null;
    }
    return null;
  }

  function nextStep() {
    const i = STEPS.findIndex(s => s.key === step);
    if (i < 0 || i === STEPS.length - 1) return;
    const block = canAdvanceFrom(step);
    if (block) { toast.error(block); return; }
    setStep(STEPS[i + 1].key);
  }
  function prevStep() {
    const i = STEPS.findIndex(s => s.key === step);
    if (i > 0) setStep(STEPS[i - 1].key);
  }

  // ─── Submit ──────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!selectedProduct) { toast.error('Select a benefit.'); return; }
    if (!resolvedVersion) { toast.error('No active product version resolved.'); return; }
    const effectiveSsn = (person?.ssn ?? ssn).trim();
    if (!effectiveSsn) { toast.error('SSN is required.'); return; }

    const pendingDocs = Object.entries(docState)
      .filter(([, v]) => v.status === 'PENDING')
      .map(([code, v]) => ({ document_type_code: code, reason: v.pendingReason ?? '' }));
    const waivedDocs = Object.entries(docState)
      .filter(([, v]) => v.status === 'WAIVED')
      .map(([code, v]) => ({ document_type_code: code, reason: v.waiverReason ?? '' }));
    const providedDocs = Object.entries(docState)
      .filter(([, v]) => v.status === 'PROVIDED')
      .map(([code]) => code);

    try {
      const result = await intake.mutateAsync({
        ssn: effectiveSsn,
        productCode: (selectedProduct as any).benefit_code,
        claimDate,
        channel: 'STAFF_OFFLINE',
        employerRegno: null,
        submittedByUserId: user?.id ?? null,
        formPayload: {
          source,
          priority,
          contact_phone: contactPhone,
          contact_email: contactEmail,
          // Bank/EFT details handled via bn_payment_profile (PaymentDetailsSection)
          payment_profile_source: 'bn_payment_profile',
          internal_notes: internalNotes,
          workbasket_override: workbasket || null,
          supervisor_escalation: escalateSupervisor
            ? { requested: true, reason: escalationReason }
            : null,
          pending_verification: pendingVerification
            ? { ...pendingPerson, reason: 'SSN not found' }
            : null,
          legacy_links: legacyMatches.map(l => l.legacy_ref),
          benefit_facts: factValues,
          documents: {
            provided: providedDocs,
            pending: pendingDocs,
            waived: waivedDocs,
          },
          declaration_accepted: true,
        },
      });
      toast.success(`Claim ${result.claimNumber} registered`);
      // Registered is not the same as payable. The officer should leave the
      // counter knowing what adjudication will have to resolve (BUG-48).
      if (eligSummary.verdict === 'FAILED') {
        toast.warning('Registered with an unmet requirement', {
          description:
            `${summariseBlockingRules(eligSummary.failed)}. Recorded on the claim — ` +
            'the entitlement decision is made at adjudication.',
          duration: 20_000,
        });
      } else if (eligSummary.verdict === 'NOT_DETERMINED' && eligSummary.unevaluated.length > 0) {
        toast.warning('Registered with eligibility unproven', {
          description:
            `${summariseBlockingRules(eligSummary.unevaluated)}. Refer for manual review.`,
          duration: 20_000,
        });
      }
      // BUG-33 — the officer must be told where the claim went. A claim that
      // reached no queue has no owner, and a successful-looking submission used
      // to be the only thing shown.
      if (result.routing?.outcome === 'UNASSIGNED') {
        toast.error('Claim has no owner', {
          description: result.routing.summary,
          duration: 30_000,
        });
      } else if (result.routing?.outcome === 'DIRECT_ASSIGNMENT') {
        toast.warning('Assigned without a workflow', {
          description: result.routing.summary,
          duration: 20_000,
        });
      } else if (result.routing?.workbasketName) {
        toast.info(`Routed to ${result.routing.workbasketName}.`);
      } else if (result.workflowInstanceId) {
        toast.info('Workflow started and routed to worklist.');
      }
      // Audit application-registered event (critical)
      void auditClaimAction({
        action: 'APPLICATION_REGISTERED',
        entityType: 'bn_claim',
        entityId: result.claimId,
        performedBy: userCode,
        afterValue: {
          claimNumber: result.claimNumber,
          productCode: (selectedProduct as any).benefit_code,
          channel: 'STAFF_OFFLINE',
          workflowInstanceId: result.workflowInstanceId ?? null,
          workbasket: workbasket || null,
          priority,
          // BUG-48 — the pre-check no longer bars registration, so its finding
          // must travel with the claim. Recorded here rather than left on the
          // screen the officer is about to leave: adjudication needs to know
          // what was known at the counter, and on what it rested.
          eligibilityPrecheck: {
            verdict: eligSummary.verdict,
            coverage: eligSummary.coverageLabel,
            failed: eligSummary.failed.map((t) => t.rule_code),
            unevaluated: eligSummary.unevaluated.map((t) => t.rule_code),
            deferredForEvidence: eligSummary.deferred.map((t) => t.rule_code),
            ruleCount: eligRules.length,
          },
        },
        critical: true,
      }).catch(() => {});
      navigate(`/bn/claims/${result.claimId}`);
    } catch (e: any) {
      toast.error('Failed to register claim', { description: e?.message });
    }
  }

  // ─── Render ──────────────────────────────────────────────────────
  return (
    <PermissionWrapper moduleName="bn_claims">
      <div className="p-6 space-y-4">
        <header className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/bn/claims')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h1 className="t-page-title">Register / Assist Application</h1>
            <p className="t-page-subtitle mt-1">
              Staff-assisted smart intake. Identity, employer, and contribution data come from the platform registry.
            </p>
          </div>
          <Badge variant="outline">Channel: STAFF_OFFLINE</Badge>
        </header>

        <div className="grid gap-4 lg:grid-cols-[260px_1fr_320px]">
          {/* Stepper rail */}
          <Card className="h-fit">
            <CardHeader className="pb-2"><CardTitle className="text-sm">Intake Steps</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              {STEPS.map((s, i) => {
                const Icon = s.icon;
                const active = s.key === step;
                const done = STEPS.findIndex(x => x.key === step) > i;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setStep(s.key)}
                    className={`w-full text-left flex items-center gap-2 rounded px-2 py-1.5 ${active ? 'bg-primary/10 text-primary font-medium' : done ? 'text-muted-foreground' : ''}`}
                  >
                    {done ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Icon className="h-3.5 w-3.5" />}
                    <span className="text-[13px]">{i + 1}. {s.label}</span>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          {/* Active step panel */}
          <div className="space-y-4">
            {step === 'ssn' && (
              <StepCard title="1. Search SSN" desc="Find the insured person by SSN. If no record exists, you may proceed with pending verification.">
                <div className="flex gap-2">
                  <Input
                    placeholder="Enter SSN…"
                    value={ssn}
                    onChange={e => setSsn(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSsnLookup()}
                  />
                  <Button onClick={handleSsnLookup} disabled={personLoading}>
                    {personLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    <span className="ml-1">Search</span>
                  </Button>
                </div>
                {personError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>{personError}</AlertTitle>
                    <AlertDescription>
                      You can enable pending verification and capture basic identity, or look up legacy claims.
                    </AlertDescription>
                  </Alert>
                )}
                {personError && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" onClick={() => togglePendingVerification(true)}>
                      <UserPlus className="h-4 w-4 mr-1" /> Enable Pending Verification
                    </Button>
                    <Button variant="outline" onClick={runLegacyLookup}>
                      <Link2 className="h-4 w-4 mr-1" /> Search Legacy Claims
                    </Button>
                  </div>
                )}
                {legacyMatches.length > 0 && (
                  <div className="rounded border p-2 text-xs space-y-1">
                    <div className="font-medium">Legacy claims</div>
                    {legacyMatches.map(l => (
                      <div key={l.legacy_ref}>
                        {l.legacy_ref} — {l.product_code ?? '—'} ({l.status ?? '—'}, {l.effective_date ?? '—'})
                      </div>
                    ))}
                  </div>
                )}
              </StepCard>
            )}

            {step === 'confirm' && (
              <StepCard title="2. Confirm Claimant" desc={pendingVerification ? 'Capture basic identity for pending verification.' : 'Confirm the resolved person.'}>
                {!pendingVerification && person && (
                  <div className="rounded border bg-muted/30 p-3 text-sm space-y-1">
                    <div className="flex items-center gap-2 font-medium">
                      <ShieldCheck className="h-4 w-4 text-emerald-600" />
                      {person.fullName}
                      <Badge variant="outline" className="ml-auto">{person.status}</Badge>
                    </div>
                    <Detail k="SSN" v={person.ssn} />
                    <Detail k="DOB" v={formatDateForDisplay(person.dateOfBirth)} />
                    <Detail k="Gender" v={person.gender} />
                    {person.phone && <Detail k="Phone" v={person.phone} />}
                    {person.email && <Detail k="Email" v={person.email} />}
                  </div>
                )}
                {pendingVerification && (
                  <div className="space-y-3">
                    <Alert>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>Pending Verification</AlertTitle>
                      <AlertDescription>Identity is unverified. An audit event has been recorded.</AlertDescription>
                    </Alert>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="First Name">
                        <Input value={pendingPerson.firstName} onChange={e => setPendingPerson(p => ({ ...p, firstName: e.target.value }))} />
                      </Field>
                      <Field label="Last Name">
                        <Input value={pendingPerson.lastName} onChange={e => setPendingPerson(p => ({ ...p, lastName: e.target.value }))} />
                      </Field>
                      <Field label="Date of Birth">
                        <Input type="date" value={pendingPerson.dob} onChange={e => setPendingPerson(p => ({ ...p, dob: e.target.value }))} />
                      </Field>
                      <Field label="Gender">
                        <Select value={pendingPerson.gender} onValueChange={v => setPendingPerson(p => ({ ...p, gender: v as any }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="M">Male</SelectItem>
                            <SelectItem value="F">Female</SelectItem>
                            <SelectItem value="N">Not-Specified</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>
                  </div>
                )}
                {existingClaims.length > 0 && (
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Existing claims for this person</AlertTitle>
                    <AlertDescription>
                      <ul className="text-xs mt-1 space-y-0.5">
                        {existingClaims.slice(0, 5).map(c => (
                          <li key={c.id}>{c.claim_number ?? c.id} — {c.product_code ?? '—'} ({c.status ?? '—'})</li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}
              </StepCard>
            )}

            {step === 'benefit' && (
              <StepCard title="3. Select Benefit" desc="Choose which benefit this application is for.">
                <Select value={productId} onValueChange={setProductId}>
                  <SelectTrigger><SelectValue placeholder="Select benefit" /></SelectTrigger>
                  <SelectContent>
                    {activeProducts.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {(p as any).benefit_name ?? (p as any).name} ({(p as any).benefit_code ?? (p as any).code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </StepCard>
            )}

            {step === 'claim-date' && (
              <StepCard title="4. Claim Date" desc="The active product version is resolved by this date.">
                <Field label="Claim Date">
                  <Input type="date" value={claimDate} onChange={e => setClaimDate(e.target.value)} />
                </Field>
              </StepCard>
            )}

            {step === 'version' && (
              <StepCard title="5. Resolve Active Product Version" desc="Versions are date-effective. Only the one active on the claim date is used.">
                {resolvingVersion && <div className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Resolving…</div>}
                {versionError && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>{versionError}</AlertTitle></Alert>}
                {resolvedVersion && (
                  <div className="rounded border bg-muted/30 p-3 text-sm space-y-1">
                    <div className="flex items-center gap-2 font-medium">
                      <ShieldCheck className="h-4 w-4 text-emerald-600" />
                      v{resolvedVersion.version.version_number} <Badge variant="outline">{resolvedVersion.version.status}</Badge>
                    </div>
                    <Detail k="Effective From" v={formatDateForDisplay(resolvedVersion.version.effective_from)} />
                    <Detail k="Effective To" v={resolvedVersion.version.effective_to ? formatDateForDisplay(resolvedVersion.version.effective_to) : '(open)'} />
                  </div>
                )}
              </StepCard>
            )}

            {step === 'eligibility' && (
              <StepCard title="6. Eligibility Pre-checks" desc="Loaded from the resolved product version. Editable values come later.">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {eligTraces.length > 0
                      ? eligSummary.coverageLabel
                      : `${eligRules.length} rule${eligRules.length === 1 ? '' : 's'} loaded — none evaluated yet.`}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!resolvedVersion}
                    onClick={async () => {
                      if (!resolvedVersion) return;
                      const fresh = await fetchEligibilityRules(resolvedVersion.version.id).catch(() => []);
                      setEligRules(fresh);
                      const traces = await runEligibilityPrecheck(fresh);
                      const sum = summariseEligibility(traces, { phase: 'INTAKE' });
                      void auditClaimAction({
                        action: 'ELIGIBILITY_PRECHECK_RUN',
                        entityType: 'bn_claim_intake',
                        entityId: resolvedVersion.version.id,
                        performedBy: userCode,
                        afterValue: {
                          trigger: 'manual',
                          productCode: (selectedProduct as any)?.benefit_code,
                          ssn: person?.ssn ?? (pendingVerification ? ssn : null),
                          claimDate,
                          ruleCount: fresh.length,
                          // What the verdict rests on, and what it deliberately
                          // did not judge (BUG-46).
                          verdict: sum.verdict,
                          deferredForEvidence: sum.deferred.map((t) => t.rule_code),
                        },
                        critical: false,
                      }).catch(() => {});
                      if (sum.verdict === 'PASSED') {
                        toast.success('Eligibility PASSED', { description: sum.coverageLabel });
                      } else if (sum.verdict === 'FAILED') {
                        toast.error('Claimant does not qualify', {
                          description: `${sum.failed.length} rule(s) failed — ${sum.coverageLabel}.`,
                        });
                      } else if (
                        sum.evaluatedCount === 0 &&
                        sum.unevaluated.length === 0 &&
                        sum.deferred.length > 0
                      ) {
                        toast.info('Evidence required later', {
                          description:
                            `${sum.deferred.length} document requirement(s). Registration may proceed; ` +
                            'approval will be refused until the evidence is verified.',
                        });
                      } else {
                        toast.warning('Eligibility could not be determined', {
                          description: `${sum.coverageLabel}. This is not a pass.`,
                        });
                      }
                    }}
                  >
                    <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Run Pre-check
                  </Button>
                </div>
                {eligRules.length === 0 && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Eligibility COULD NOT BE DETERMINED — 0 of 0 rules evaluated</AlertTitle>
                    <AlertDescription>
                      This product version has no eligibility rules attached, so nothing was
                      checked. Registration cannot proceed on an unchecked claim — refer for
                      manual review, or attach the product’s rules before registering.
                    </AlertDescription>
                  </Alert>
                )}

                {eligRules.length > 0 && !effectiveSsnForElig && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Eligibility not checked</AlertTitle>
                    <AlertDescription>
                      A verified SSN is required before the claimant's age and contribution
                      record can be compared against the product rules.
                    </AlertDescription>
                  </Alert>
                )}

                {eligError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Pre-check failed to run</AlertTitle>
                    <AlertDescription>{eligError}</AlertDescription>
                  </Alert>
                )}

                {eligEvaluating && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Evaluating rules against this claimant…
                  </p>
                )}

                {!eligEvaluating && eligTraces.length > 0 && (
                  <Alert
                    variant={
                      eligSummary.verdict === 'PASSED' || onlyEvidenceRemains
                        ? 'default'
                        : 'destructive'
                    }
                  >
                    {eligSummary.verdict === 'PASSED' ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : onlyEvidenceRemains ? (
                      <FileText className="h-4 w-4" />
                    ) : eligSummary.verdict === 'FAILED' ? (
                      <AlertTriangle className="h-4 w-4" />
                    ) : (
                      <AlertCircle className="h-4 w-4" />
                    )}
                    <AlertTitle className="mb-1">
                      {eligSummary.verdict === 'PASSED'
                        ? 'Eligibility passed'
                        : onlyEvidenceRemains
                          ? 'Evidence required later'
                          : eligSummary.verdict === 'FAILED'
                            ? 'Claimant does not qualify'
                            : 'Eligibility could not be determined'}
                    </AlertTitle>
                    <AlertDescription className="space-y-2">
                      <p className="leading-relaxed">
                        {eligSummary.verdict === 'PASSED'
                          ? 'Every requirement was compared against the claimant’s record and satisfied.'
                          : onlyEvidenceRemains
                            ? 'This benefit’s only requirements are documentary, so there is nothing to compare at the counter. The evidence is attached at step 7, or after submission.'
                            : eligSummary.verdict === 'FAILED'
                              ? 'The claimant’s record does not meet the requirements below. This is recorded on the claim; registration may still proceed, and the entitlement decision is made at adjudication.'
                              : eligSummary.evaluatedCount === 0
                                ? 'Not one requirement was compared against this claimant, so entitlement is unproven. This is not a pass — refer for manual review. Registration may still proceed.'
                                : 'Some requirements could not be compared against the claimant’s record, so entitlement is unproven. Refer for manual review. Registration may still proceed.'}
                      </p>

                      {/* Counts as chips rather than run into the title, which
                          wrapped mid-sentence and read as one broken line. */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {eligSummary.passed.length > 0 && (
                          <Badge variant="outline" className="border-emerald-600/40 text-emerald-700">
                            {eligSummary.passed.length} met
                          </Badge>
                        )}
                        {eligSummary.failed.length > 0 && (
                          <Badge variant="outline" className="border-destructive/40 text-destructive">
                            {eligSummary.failed.length} not met
                          </Badge>
                        )}
                        {eligSummary.unevaluated.length > 0 && (
                          <Badge variant="outline" className="border-amber-500/40 text-amber-700">
                            {eligSummary.unevaluated.length} not checked
                          </Badge>
                        )}
                        {eligSummary.deferred.length > 0 && (
                          <Badge variant="outline" className="text-muted-foreground">
                            {eligSummary.deferred.length} required later
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {eligSummary.coverageLabel}
                        </span>
                      </div>

                      {eligSummary.deferred.length > 0 && !onlyEvidenceRemains && (
                        <p className="text-xs leading-relaxed">
                          Document requirements are not judged at this step. They do not block
                          registration, but the claim cannot be approved until they are verified.
                        </p>
                      )}
                    </AlertDescription>
                  </Alert>
                )}

                {eligTraces.length > 0 && (
                  <ul className="divide-y rounded-md border text-sm">
                    {eligTraces.map((t) => {
                      // A deferred rule is neither passed nor failed at this
                      // step, so it must not be dressed as either (BUG-46).
                      const isDeferred = deferredCodes.has(t.rule_code);
                      const state = isDeferred ? 'DEFERRED' : t.result_state;
                      const tone =
                        state === 'PASS' ? 'text-emerald-700' :
                        state === 'FAIL' ? 'text-destructive' :
                        state === 'UNEVALUATED' ? 'text-amber-700' :
                        'text-muted-foreground';
                      const label =
                        state === 'PASS' ? 'Met' :
                        state === 'FAIL' ? 'Not met' :
                        state === 'UNEVALUATED' ? 'Not checked' :
                        state === 'DEFERRED' ? 'Required later' :
                        state === 'OVERRIDDEN' ? 'Overridden' : 'Note';
                      const Icon =
                        state === 'PASS' ? CheckCircle2 :
                        state === 'FAIL' ? AlertTriangle :
                        state === 'UNEVALUATED' ? AlertCircle : FileText;
                      return (
                        <li key={t.rule_code} className="flex items-start gap-3 px-3 py-2">
                          <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${tone}`} />
                          {/* min-w-0 lets long requirement text wrap inside its
                              own column instead of pushing the badge along. */}
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <p className="font-medium leading-snug">
                              {t.requirement || t.rule_name || t.rule_code}
                            </p>
                            {t.detail && (
                              <p className="text-xs text-muted-foreground leading-snug">{t.detail}</p>
                            )}
                            {t.reference && (
                              <p className="text-[11px] text-muted-foreground/80 italic leading-snug">
                                {t.reference}
                              </p>
                            )}
                          </div>
                          <Badge
                            variant="outline"
                            className={`shrink-0 text-[11px] font-medium ${tone}`}
                          >
                            {label}
                          </Badge>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {/* Rules loaded but not yet evaluated — never presented as passed. */}
                {eligTraces.length === 0 && !eligEvaluating && eligRules.length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {eligRules.map((r: any) => (
                      <li key={r.id} className="flex items-start gap-2">
                        <AlertCircle className="h-3.5 w-3.5 mt-0.5 text-muted-foreground" />
                        <span>
                          <span className="font-medium">{r.rule_code ?? r.name}</span>
                          <span className="ml-2 text-xs text-muted-foreground">NOT CHECKED</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </StepCard>
            )}

            {step === 'documents' && (
              <StepCard title="7. Required Documents" desc="Mark each document as Provided, Pending, or request a Waiver (audited).">
                {docs.length === 0 && <p className="text-sm text-muted-foreground">No documents configured.</p>}
                {docs.map(d => {
                  const s = docState[d.document_type_code] ?? { status: 'PROVIDED' };
                  return (
                    <div key={d.id} className="rounded border p-2 space-y-2">
                      <div className="flex items-center gap-2 text-sm">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{d.description ?? d.document_type_code}</span>
                        {(d.requirement_level === 'MANDATORY' || d.blocks_submission) && (
                          <Badge variant="destructive" className="ml-1">Mandatory</Badge>
                        )}
                        <div className="ml-auto flex gap-1">
                          {(['PROVIDED', 'PENDING', 'WAIVED'] as DocStatus[]).map(opt => (
                            <Button
                              key={opt}
                              size="sm"
                              variant={s.status === opt ? 'default' : 'outline'}
                              className="h-7 text-xs"
                              disabled={opt === 'WAIVED' && !can('benefits.document_waiver')}
                              onClick={() => {
                                if (opt === 'PROVIDED') {
                                  setDocState(prev => ({ ...prev, [d.document_type_code]: { status: 'PROVIDED' } }));
                                } else if (opt === 'PENDING') {
                                  setReasonDialog({
                                    kind: 'PENDING',
                                    code: d.document_type_code,
                                    title: 'Mark document as pending',
                                    description: d.description ?? d.document_type_code,
                                  });
                                } else {
                                  setReasonDialog({
                                    kind: 'WAIVE',
                                    code: d.document_type_code,
                                    title: 'Request document waiver',
                                    description: d.description ?? d.document_type_code,
                                  });
                                }
                              }}
                            >
                              {opt}
                            </Button>
                          ))}
                        </div>
                      </div>
                      {s.status === 'PENDING' && s.pendingReason && (
                        <p className="text-xs text-amber-600">Pending: {s.pendingReason}</p>
                      )}
                      {s.status === 'WAIVED' && s.waiverReason && (
                        <p className="text-xs text-violet-600">Waived: {s.waiverReason}</p>
                      )}
                    </div>
                  );
                })}
              </StepCard>
            )}

            {step === 'facts' && (
              <StepCard title="8. Benefit-Specific Facts" desc="Only event/claim-specific data. Identity, employer, and contribution data are not re-entered.">
                {factFields.length === 0 && <p className="text-sm text-muted-foreground">No benefit-specific fields configured.</p>}
                <div className="grid gap-3 md:grid-cols-2">
                  {factFields.map(f => (
                    <Field key={f.field_code} label={f.field_label}>
                      <FactInput
                        field={f}
                        value={factValues[f.field_code]}
                        onChange={v => setFactValues(prev => ({ ...prev, [f.field_code]: v }))}
                        existingClaims={existingClaims}
                      />
                    </Field>
                  ))}
                </div>
              </StepCard>
            )}

            {step === 'banking' && paymentPolicy.payment_details_visibility !== 'HIDE' && (
              <StepCard title="9. Banking / Payment Details" desc="Captured via the unified Payment Details framework — same form, validation, and policy as the claimant portal and online application.">
                {ssn ? (
                  <>
                    <PaymentDetailsSection
                      mode="edit"
                      channel="STAFF_OFFLINE"
                      productId={productId || null}
                      personSsn={ssn}
                      userCode={userCode}
                      onPolicyResolved={(pol, prof) => { setPaymentPolicy(pol); setPaymentProfile(prof); }}
                      onSaved={(saved) => {
                        // Optimistically reflect the new profile in policy gating.
                        if ((saved as any)?.payment_method) setPaymentProfile(saved as any);
                      }}
                    />
                    {paymentPolicy.payment_required_at_application && !paymentProfile && (
                      <Alert variant="destructive" className="mt-2">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Payment details required</AlertTitle>
                        <AlertDescription>
                          This product requires bank/payment details to be captured before the application can progress.
                        </AlertDescription>
                      </Alert>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Bank / payment details become available once an SSN is captured.
                  </p>
                )}
              </StepCard>
            )}

            {step === 'banking' && paymentPolicy.payment_details_visibility === 'HIDE' && (
              <StepCard title="9. Banking / Payment Details" desc="Skipped — this product does not collect payment details at application.">
                <p className="text-sm text-muted-foreground">No action required. Payment details will be captured later in the lifecycle.</p>
              </StepCard>
            )}

            {step === 'internal' && (
              <StepCard title="10. Internal Options" desc="Priority, notes, basket routing, and supervisor escalation.">
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Priority">
                    <Select value={priority} onValueChange={v => setPriority(v as any)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="LOW">Low</SelectItem>
                        <SelectItem value="NORMAL">Normal</SelectItem>
                        <SelectItem value="HIGH">High</SelectItem>
                        <SelectItem value="URGENT">Urgent</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Source">
                    <Select value={source} onValueChange={v => setSource(v as any)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PAPER">Paper</SelectItem>
                        <SelectItem value="WALK_IN">Walk-in</SelectItem>
                        <SelectItem value="PHONE">Phone</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Contact Phone"><Input value={contactPhone} onChange={e => setContactPhone(e.target.value)} /></Field>
                  <Field label="Contact Email"><Input value={contactEmail} onChange={e => setContactEmail(e.target.value)} /></Field>
                </div>
                <Field label="Internal Notes">
                  <Textarea value={internalNotes} onChange={e => setInternalNotes(e.target.value)} rows={3} maxLength={500} />
                </Field>
                {can('benefits.workflow_routing') && paymentPolicy.allow_manual_workbasket_override && (
                  <Field label="Workflow Basket Override">
                    <WorkbasketSelector
                      value={workbasket}
                      onChange={(b) => setBasketWithAudit(b?.basket_code ?? '')}
                      productCategory={(selectedProduct as any)?.benefit_code ?? null}
                    />
                    <p className="text-xs text-muted-foreground mt-1">Only active workbaskets are selectable. Override is audited.</p>
                  </Field>
                )}
                {can('benefits.workflow_routing') && !paymentPolicy.allow_manual_workbasket_override && (
                  <p className="text-xs text-muted-foreground">
                    Manual workbasket override is disabled by product policy — routing is automatic.
                  </p>
                )}
                <div className="rounded border p-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <Checkbox checked={escalateSupervisor} onCheckedChange={v => toggleEscalation(!!v)} />
                    <Label className="text-sm font-medium">Escalate to supervisor</Label>
                    <FlagTriangleRight className="h-4 w-4 ml-auto text-amber-600" />
                  </div>
                  {escalateSupervisor && (
                    <Textarea
                      placeholder="Escalation reason…"
                      value={escalationReason}
                      onChange={e => setEscalationReason(e.target.value)}
                      rows={2}
                    />
                  )}
                </div>
              </StepCard>
            )}

            {step === 'review' && (
              <StepCard title="10. Review & Submit" desc="Submitting creates the claim, captures snapshots, and starts the workflow.">
                <ReviewLine k="Claimant" v={person ? `${person.fullName} (${person.ssn})` : pendingVerification ? `${pendingPerson.firstName} ${pendingPerson.lastName} (pending verification)` : '—'} />
                <ReviewLine k="Benefit" v={selectedProduct ? `${(selectedProduct as any).benefit_name} (${(selectedProduct as any).benefit_code})` : '—'} />
                <ReviewLine k="Claim Date" v={formatDateForDisplay(claimDate)} />
                <ReviewLine k="Product Version" v={resolvedVersion ? `v${resolvedVersion.version.version_number} (${resolvedVersion.version.effective_from} → ${resolvedVersion.version.effective_to ?? 'open'})` : '—'} />
                <ReviewLine k="Eligibility Rules Loaded" v={String(eligRules.length)} />
                <ReviewLine k="Documents" v={`${Object.values(docState).filter(s => s.status === 'PROVIDED').length} provided · ${Object.values(docState).filter(s => s.status === 'PENDING').length} pending · ${Object.values(docState).filter(s => s.status === 'WAIVED').length} waived`} />
                <ReviewLine k="Priority" v={priority} />
                {workbasket && <ReviewLine k="Workbasket" v={workbasket} />}
                {escalateSupervisor && <ReviewLine k="Escalation" v={escalationReason || '(reason missing)'} />}
                <div className="flex justify-end pt-2">
                  <Button onClick={handleSubmit} disabled={intake.isPending}>
                    {intake.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                    Submit Claim
                  </Button>
                </div>
              </StepCard>
            )}

            {/* Step nav */}
            <div className="flex justify-between">
              <Button variant="ghost" onClick={prevStep} disabled={step === 'ssn'}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              {step !== 'review' && (
                <Button onClick={nextStep}>Next <ArrowRight className="h-4 w-4 ml-1" /></Button>
              )}
            </div>
          </div>

          {/* Sticky context panel */}
          <ContextPanel
            person={person}
            pending={pendingVerification ? pendingPerson : null}
            product={selectedProduct as any}
            version={resolvedVersion}
            contribution={contribution}
            dependants={dependants}
            existingClaims={existingClaims}
          />
        </div>
      </div>

      <ReasonCaptureDialog
        open={!!reasonDialog}
        title={reasonDialog?.title ?? ''}
        description={reasonDialog?.description}
        label={reasonDialog?.kind === 'WAIVE' ? 'Waiver justification' : 'Reason'}
        confirmLabel={reasonDialog?.kind === 'WAIVE' ? 'Request waiver' : 'Mark pending'}
        onCancel={() => setReasonDialog(null)}
        onConfirm={(reason) => {
          const d = reasonDialog;
          setReasonDialog(null);
          if (!d || !reason) return;
          if (d.kind === 'PENDING') void markDocPending(d.code, reason);
          else void requestDocWaiver(d.code, reason);
        }}
      />
    </PermissionWrapper>
  );
}

// ────────────────────────────────────────────────────────────────────
// Small helpers
// ────────────────────────────────────────────────────────────────────

function StepCard({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        {desc && <CardDescription>{desc}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function Detail({ k, v }: { k: string; v: any }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium">{String(v ?? '—')}</span>
    </div>
  );
}

function ReviewLine({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between text-sm border-b py-1 last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium text-right">{v}</span>
    </div>
  );
}

function FactInput({
  field,
  value,
  onChange,
  existingClaims,
}: {
  field: FormFieldDef;
  value: any;
  onChange: (v: any) => void;
  existingClaims: ExistingClaimRecord[];
}) {
  // Special case: Prior Injury Claim Reference must be picked from the
  // claimant's prior injury claims, not entered as free text.
  if (field.field_code === 'prior_injury_claim_ref') {
    const injuryClaims = existingClaims.filter(c => {
      const code = (c.product_code ?? '').toUpperCase();
      return code.includes('EI') || code.includes('INJ');
    });
    if (injuryClaims.length === 0) {
      return (
        <Input value="" disabled placeholder="No prior injury claims on file" />
      );
    }
    return (
      <Select value={value ?? ''} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="Select prior injury claim…" /></SelectTrigger>
        <SelectContent>
          {injuryClaims.map(c => (
            <SelectItem key={c.id} value={c.claim_number ?? c.id}>
              {(c.claim_number ?? c.id)} — {c.product_code ?? '—'} · {c.status ?? '—'}
              {c.claim_date ? ` · ${formatDateForDisplay(c.claim_date)}` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  switch (field.field_type) {
    case 'TEXTAREA':
      return <Textarea value={value ?? ''} onChange={e => onChange(e.target.value)} />;
    case 'NUMBER':
      return <Input type="number" value={value ?? ''} onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))} />;
    case 'DATE':
      return <Input type="date" value={value ?? ''} onChange={e => onChange(e.target.value)} />;
    case 'CHECKBOX':
      return (
        <div className="flex items-center gap-2 pt-1">
          <Checkbox checked={!!value} onCheckedChange={v => onChange(!!v)} />
          <span className="text-xs text-muted-foreground">{field.help_text}</span>
        </div>
      );
    case 'SELECT': {
      const opts: string[] = field.validation_rules?.options ?? [];
      return (
        <Select value={value ?? ''} onValueChange={onChange}>
          <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
          <SelectContent>{opts.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
        </Select>
      );
    }
    default:
      return <Input value={value ?? ''} onChange={e => onChange(e.target.value)} />;
  }
}

function ContextPanel({
  person, pending, product, version, contribution, dependants, existingClaims,
}: {
  person: PersonSummary | null;
  pending: { firstName: string; lastName: string; dob: string; gender: string } | null;
  product: any;
  version: ResolvedProductVersion | null;
  contribution: ContributionSummaryResult | null;
  dependants: Dependant[];
  existingClaims: ExistingClaimRecord[];
}) {
  return (
    <div className="space-y-3 lg:sticky lg:top-4 h-fit">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Claimant</CardTitle></CardHeader>
        <CardContent className="text-xs space-y-1">
          {person && (
            <>
              <div className="font-medium text-sm flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> {person.fullName}
              </div>
              <Detail k="SSN" v={person.ssn} />
              <Detail k="DOB" v={formatDateForDisplay(person.dateOfBirth)} />
              <Detail k="Status" v={person.status} />
            </>
          )}
          {!person && pending && (
            <>
              <Badge variant="outline">Pending Verification</Badge>
              <Detail k="Name" v={`${pending.firstName} ${pending.lastName}`} />
              <Detail k="DOB" v={formatDateForDisplay(pending.dob)} />
              <Detail k="Gender" v={pending.gender} />
            </>
          )}
          {!person && !pending && <p className="text-muted-foreground">No claimant yet.</p>}
        </CardContent>
      </Card>

      {(product || version) && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Benefit / Version</CardTitle></CardHeader>
          <CardContent className="text-xs space-y-1">
            {product && <Detail k="Benefit" v={`${product.benefit_name} (${product.benefit_code})`} />}
            {version && <Detail k="Version" v={`v${version.version.version_number} (${version.version.status})`} />}
            {version && <Detail k="Effective" v={`${formatDateForDisplay(version.version.effective_from)} → ${version.version.effective_to ? formatDateForDisplay(version.version.effective_to) : 'open'}`} />}
          </CardContent>
        </Card>
      )}

      {contribution && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Contribution Window</CardTitle></CardHeader>
          <CardContent className="text-xs space-y-1">
            <Detail k="Window" v={`${contribution.windowStart} → ${contribution.windowEnd}`} />
            <Detail k="Total Weeks" v={contribution.totalWeeks} />
            <Detail k="Paid" v={contribution.paidWeeks} />
            <Detail k="Credited" v={contribution.creditedWeeks} />
            <Detail k="Avg Weekly Wage" v={contribution.averageWeeklyWage.toFixed(2)} />
          </CardContent>
        </Card>
      )}

      {dependants.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Dependants ({dependants.length})</CardTitle></CardHeader>
          <CardContent className="text-xs space-y-1">
            {dependants.slice(0, 5).map((d, i) => (
              <div key={i} className="flex justify-between">
                <span>{d.fullName}</span>
                <span className="text-muted-foreground">{d.relationship}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {existingClaims.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1"><Inbox className="h-3.5 w-3.5" />Existing Claims</CardTitle></CardHeader>
          <CardContent className="text-xs space-y-1">
            {existingClaims.slice(0, 5).map(c => (
              <div key={c.id} className="flex justify-between">
                <span>{c.claim_number ?? c.id.slice(0, 8)}</span>
                <span className="text-muted-foreground">{c.status ?? '—'}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
