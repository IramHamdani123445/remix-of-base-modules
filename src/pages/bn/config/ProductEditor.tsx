import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Save, Plus, History, Info } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useBnProduct, useCreateBnProduct, useUpdateBnProduct, useBnProductVersions, useCreateBnProductVersion, useCopyBnVersionRules, useCloneBnVersionToDraft } from '@/hooks/bn/useBnProduct';
import { auditAttemptedActiveMutation } from '@/services/bn/productService';
import { LiveVersionGuardDialog } from '@/components/bn/config/LiveVersionGuardDialog';
import { useBnSchemes, useBnBranches, useBnCountries } from '@/hooks/bn/useBnConfig';
import { BN_CATEGORY_LABELS, BN_PRODUCT_STATUS_LABELS } from '@/types/bn';
import type { BnProduct, BnProductVersion, BnProductStatus } from '@/types/bn';
import { EligibilityTabRedesigned as EligibilityRulesTab } from '@/components/bn/config/EligibilityTabRedesigned';
import { CalculationRulesTab } from '@/components/bn/config/CalculationRulesTab';
import { CalculationBuilder } from '@/components/bn/config/CalculationBuilder';
import { CalculationV2Panel } from '@/components/bn/config/CalculationV2Panel';
import { TimelineRulesTab } from '@/components/bn/config/TimelineRulesTab';
import { DocumentRulesTab } from '@/components/bn/config/DocumentRulesTab';
import { WorkflowTab } from '@/components/bn/config/WorkflowTab';
import { ScreenTemplateTab } from '@/components/bn/config/ScreenTemplateTab';
import ParticipantWorkflowTab from '@/components/bn/config/ParticipantWorkflowTab';
import PublicFormRulesTab from '@/components/bn/config/PublicFormRulesTab';
import { InteractionRulesTab } from '@/components/bn/config/InteractionRulesTab';
import { ApprovalPoliciesTab } from '@/components/bn/config/ApprovalPoliciesTab';
import { VersionHistoryTab } from '@/components/bn/config/VersionHistoryTab';
import { PreviewTab } from '@/components/bn/config/PreviewTab';
import { ChannelsTab } from '@/components/bn/config/ChannelsTab';
import { CommunicationsTab } from '@/components/bn/config/CommunicationsTab';
import { ProductOmniCommsPanel } from '@/components/bn/config/ProductOmniCommsPanel';
import { resolveOrganizationContext } from '@/lib/org/organizationContextResolver';
import { ReadOnlyVersionBanner } from '@/components/bn/smart';
import { useQuery } from '@tanstack/react-query';
import { assertVersionReadiness } from '@/services/bn/rulesAdminService';
import { useBnReturnToDraft } from '@/hooks/bn/useBnRulesAdmin';
import { useUserCode } from '@/hooks/useUserCode';

import { VisualBuilderTab } from '@/components/bn/config/VisualBuilderTab';
import { ConflictDetectionPanel } from '@/components/bn/config/ConflictDetectionPanel';
import { VersionReadinessPanel } from '@/components/bn/config/VersionReadinessPanel';

import { BnPlatformConsumptionPanel } from '@/components/bn/config/BnPlatformConsumptionPanel';

const statusBadge: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  DRAFT: 'secondary', PENDING_APPROVAL: 'outline', ACTIVE: 'default', SUSPENDED: 'destructive', ARCHIVED: 'outline',
};

export default function ProductEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const isNew = id === 'new';

  const { data: existingProduct, isLoading } = useBnProduct(id);
  const { data: versions = [] } = useBnProductVersions(isNew ? undefined : id);
  const { data: schemes = [] } = useBnSchemes();
  const { data: branches = [] } = useBnBranches();
  const { data: countries = [] } = useBnCountries();
  const activeCountries = useMemo(() => (countries as any[]).filter(c => c.is_active), [countries]);

  /**
   * The highest version number that is live, or null when none is.
   * Publishing a version did not write bn_product.status, so the stored value
   * cannot be trusted for display.
   */
  const liveVersionNumber = useMemo(() => {
    const live = (versions as any[])
      .filter(v => String(v.status).toUpperCase() === 'ACTIVE')
      .map(v => Number(v.version_number))
      .filter(n => Number.isFinite(n));
    return live.length ? Math.max(...live) : null;
  }, [versions]);

  /** Highest APPROVED (awaiting publish) version number, or null. */
  const approvedVersionNumber = useMemo(() => {
    const approved = (versions as any[])
      .filter(v => String(v.status).toUpperCase() === 'APPROVED')
      .map(v => Number(v.version_number))
      .filter(n => Number.isFinite(n));
    return approved.length ? Math.max(...approved) : null;
  }, [versions]);


  
  const createMutation = useCreateBnProduct();
  const updateMutation = useUpdateBnProduct();
  const createVersionMutation = useCreateBnProductVersion();

  const [form, setForm] = useState<Partial<BnProduct>>({
    benefit_code: '', benefit_name: '', description: '', category: 'SHORT_TERM',
    branch: 'GENERAL', payment_type: 'PERIODIC', country_code: '', status: 'DRAFT', sort_order: 0,
  });
  const [selectedVersionId, setSelectedVersionId] = useState<string | undefined>();
  const [activeTab, setActiveTab] = useState('definition');

  const [omniCommsOrganizationId, setOmniCommsOrganizationId] = useState<string | null>(null);

  /**
   * Product status derived from its versions: Active when a version is live,
   * Approved when one is approved and awaiting publish, otherwise the stored
   * value. The Status control renders this and is read-only when derived, so
   * the field can never contradict the versions.
   */
  const derivedProductStatus =
    liveVersionNumber !== null ? 'ACTIVE' : approvedVersionNumber !== null ? 'APPROVED' : null;
  const effectiveProductStatus = derivedProductStatus ?? form.status;


  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const ctx = await resolveOrganizationContext({ moduleCode: 'BENEFITS' });
        if (!cancelled) setOmniCommsOrganizationId(ctx?.organization?.id ?? null);
      } catch {
        if (!cancelled) setOmniCommsOrganizationId(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Reset form and version when product id changes
  useEffect(() => {
    setForm({
      benefit_code: '', benefit_name: '', description: '', category: 'SHORT_TERM',
      branch: 'GENERAL', payment_type: 'PERIODIC', country_code: '', status: 'DRAFT', sort_order: 0,
    });
    setSelectedVersionId(undefined);
  }, [id]);

  // For new products, default country to SKN if available, else first active country.
  useEffect(() => {
    if (!isNew || form.country_code || activeCountries.length === 0) return;
    const preferred =
      activeCountries.find(c => c.country_code === 'SKN')?.country_code ??
      activeCountries[0].country_code;
    setForm(f => ({ ...f, country_code: preferred }));
  }, [isNew, activeCountries, form.country_code]);

  useEffect(() => {
    if (existingProduct) setForm(existingProduct);
  }, [existingProduct]);

  useEffect(() => {
    if (versions.length > 0 && !selectedVersionId) {
      setSelectedVersionId(versions[0].id);
    }
  }, [versions, selectedVersionId]);

  const handleSave = async () => {
    if (!form.benefit_code || !form.benefit_name) {
      toast({ title: 'Validation Error', description: 'Code and Name are required.', variant: 'destructive' });
      return;
    }
    if (!form.country_code) {
      toast({ title: 'Validation Error', description: 'Country is required.', variant: 'destructive' });
      return;
    }
    const countryRow = (countries as any[]).find(c => c.country_code === form.country_code);
    if (!countryRow) {
      toast({ title: 'Invalid Country', description: `Country "${form.country_code}" does not exist in Country Master.`, variant: 'destructive' });
      return;
    }
    if (form.status === 'ACTIVE' && !countryRow.is_active) {
      toast({ title: 'Invalid Country', description: `Country "${form.country_code}" is inactive — cannot activate product.`, variant: 'destructive' });
      return;
    }
    // Activation guard: block ACTIVE status unless formula bindings are healthy.
    if (!isNew && form.status === 'ACTIVE' && existingProduct?.status !== 'ACTIVE') {
      try {
        const { supabase } = await import('@/integrations/supabase/client');
        const { data, error } = await (supabase as any).rpc('bn_product_can_activate', { _product_id: id });
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        if (row && row.can_activate === false) {
          toast({
            title: 'Cannot activate product',
            description: `${row.blocker_code}: ${row.blocker_message}`,
            variant: 'destructive',
          });
          return;
        }
      } catch (err: any) {
        toast({ title: 'Activation check failed', description: err?.message ?? 'Unable to verify formula bindings.', variant: 'destructive' });
        return;
      }
    }
    // Keep the legacy `branch` text column in sync with `branch_id` — both are
    // written together in the original seed data, but the UI only ever set branch_id.
    const resolvedBranchName = form.branch_id
      ? (branches as any[]).find(b => b.id === form.branch_id)?.branch_name ?? 'GENERAL'
      : 'GENERAL';
    // A product with a live version is Active by definition — never let an
    // unrelated edit write a stale DRAFT back over it.
    const resolvedStatus = liveVersionNumber !== null ? 'ACTIVE' : form.status;
    const payload = { ...form, branch: resolvedBranchName, status: resolvedStatus };

    try {
      if (isNew) {
        const created = await createMutation.mutateAsync(payload);
        toast({ title: 'Success', description: 'Benefit product created.' });
        navigate(`/bn/config/products/${created.id}`);
      } else {
        await updateMutation.mutateAsync({ id: id!, updates: payload });
        toast({ title: 'Success', description: 'Benefit product updated.' });
      }
    } catch (err: any) {
      // Shielded error per docs/bn/BENEFITS_MODULE_COMPLETE.md §12.4 — log the raw
      // technical detail, never show it directly to the user.
      console.error('Product save failed:', err);
      const raw = String(err?.message || '');
      let friendly = 'Something went wrong while saving this product. Please try again.';
      if (/duplicate key value|unique constraint/i.test(raw)) {
        friendly = 'A product with this code already exists for the selected country. Choose a different code.';
      } else if (/permission denied/i.test(raw)) {
        friendly = 'You do not have permission to save this change.';
      }
      toast({ title: 'Error', description: friendly, variant: 'destructive' });
    }
  };


  const activeVersion = versions.find((v: BnProductVersion) => v.id === selectedVersionId);
  const isEditableVersion = activeVersion?.status === 'DRAFT';
  const copyRulesMutation = useCopyBnVersionRules();
  const cloneToDraftMutation = useCloneBnVersionToDraft();
  const returnToDraftMutation = useBnReturnToDraft();

  // Readiness for the selected version — only meaningful while it is locked
  // awaiting approval or approved but unpublishable.
  const readinessRelevant = activeVersion?.status === 'PENDING_APPROVAL' || activeVersion?.status === 'APPROVED';
  const { data: readinessReport } = useQuery({
    queryKey: ['bn', 'version-readiness', selectedVersionId],
    queryFn: () => assertVersionReadiness(selectedVersionId!),
    enabled: !!selectedVersionId && readinessRelevant,
    staleTime: 60_000,
    retry: false,
  });
  const blockingIssues = readinessRelevant && readinessReport && !readinessReport.ok
    ? readinessReport.errors
    : [];

  const { userCode } = useUserCode();
  const handleReturnToDraft = () => {
    if (!activeVersion) return;
    returnToDraftMutation.mutate({
      versionId: activeVersion.id,
      userCode: userCode || 'system',
      reason: 'Returned for correction of blocking configuration issues',
    });
  };



  const [guard, setGuard] = useState<{ open: boolean; intent: 'EDIT' | 'DELETE' }>({ open: false, intent: 'EDIT' });

  // Clone current (locked) version into a new DRAFT and navigate the user to it.
  const handleCloneToDraft = async () => {
    if (!id || isNew || !activeVersion) return;
    try {
      const result = await cloneToDraftMutation.mutateAsync({
        productId: id,
        sourceVersionId: activeVersion.id,
      });
      toast({
        title: 'Draft version created',
        description: 'You can now make changes safely.',
      });
      setSelectedVersionId(result.newVersionId);
      setGuard({ open: false, intent: 'EDIT' });
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed to clone version.', variant: 'destructive' });
    }
  };

  const openEditGuard = async () => {
    if (activeVersion) {
      // Non-blocking audit of the attempt
      auditAttemptedActiveMutation(activeVersion.id, 'EDIT').catch(() => {});
    }
    setGuard({ open: true, intent: 'EDIT' });
  };

  const handleCreateVersion = async () => {
    if (!id || isNew) return;

    // If user is on a non-DRAFT version, open the guided dialog instead of
    // jumping straight into the legacy "empty draft" flow.
    if (activeVersion && activeVersion.status !== 'DRAFT') {
      openEditGuard();
      return;
    }

    const nextNum = versions.length > 0 ? Math.max(...versions.map((v: BnProductVersion) => v.version_number)) + 1 : 1;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const created = await createVersionMutation.mutateAsync({ product_id: id, version_number: nextNum, status: 'DRAFT', effective_from: today });
      toast({ title: 'Success', description: `Version ${nextNum} created (empty draft).` });
      setSelectedVersionId(created.id);
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed to create version.', variant: 'destructive' });
    }
  };

  const updateField = (field: string, value: unknown) => setForm(prev => ({ ...prev, [field]: value }));

  if (!isNew && isLoading) {
    return <div className="flex min-h-[400px] items-center justify-center"><p className="text-muted-foreground">Loading...</p></div>;
  }


  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/bn/config/products')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="t-page-title">
                {isNew ? 'Create Benefit Product' : form.benefit_name}
              </h1>
              {/* Derived, exactly as the Product Catalogue derives it: a product
                  with a live version is Active, whatever bn_product.status still
                  says. The stored column was never written when a version was
                  published, so a live product read "Draft" here while the
                  catalogue read "Active" — the same product, two answers. The
                  Status dropdown below is deliberately left on the stored value,
                  because it writes. */}
              {!isNew && effectiveProductStatus && (
                <Badge variant={statusBadge[effectiveProductStatus] || 'outline'}>
                  {BN_PRODUCT_STATUS_LABELS[effectiveProductStatus as BnProductStatus] || effectiveProductStatus}
                </Badge>
              )}
              {!isNew && liveVersionNumber !== null && (
                <span className="text-xs text-muted-foreground">live on v{liveVersionNumber}</span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {isNew ? 'Define a new configurable benefit product' : `Code: ${form.benefit_code} · ${BN_CATEGORY_LABELS[form.category || ''] || form.category}`}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {!isNew && (
            <Button variant="outline" onClick={handleCreateVersion} className="gap-2">
              <Plus className="h-4 w-4" /> New Version
            </Button>
          )}
          <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending} className="gap-2">
            <Save className="h-4 w-4" />
            {(createMutation.isPending || updateMutation.isPending) ? 'Saving...' : 'Save Product'}
          </Button>
        </div>
      </div>

      {/* Version Selector */}
      {!isNew && versions.length > 0 && (
        <Card>
          <CardContent className="space-y-3 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <History className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm font-medium">Selected Version:</Label>
              <Select value={selectedVersionId || '__none__'} onValueChange={v => setSelectedVersionId(v === '__none__' ? undefined : v)}>
                <SelectTrigger className="w-[320px]">
                  <SelectValue placeholder="Select version" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select version</SelectItem>
                  {versions.map((v: BnProductVersion) => (
                    <SelectItem key={v.id} value={v.id}>
                      V{v.version_number} — {v.effective_from} {v.effective_to ? `to ${v.effective_to}` : '(open)'} [{v.status}]
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {activeVersion && (
                <Badge variant={statusBadge[activeVersion.status] || 'outline'}>
                  {BN_PRODUCT_STATUS_LABELS[activeVersion.status as BnProductStatus] || activeVersion.status}
                </Badge>
              )}
              {activeVersion && (
                <Badge variant={isEditableVersion ? 'default' : 'secondary'}>
                  {isEditableVersion ? 'Editable' : 'Read-only'}
                </Badge>
              )}
            </div>
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              Claims use the product version active on the claim date. Draft versions are for future rule changes.
            </p>
            {activeVersion && (
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border bg-muted/30 px-3 py-2 text-xs sm:grid-cols-4">
                <div><span className="text-muted-foreground">Effective From:</span> <span className="font-medium">{activeVersion.effective_from || '—'}</span></div>
                <div><span className="text-muted-foreground">Effective To:</span> <span className="font-medium">{activeVersion.effective_to || 'Open-ended'}</span></div>
                <div><span className="text-muted-foreground">Workflow:</span> <span className="font-medium">{activeVersion.workflow_template_id ? 'Assigned' : 'Not set'}</span></div>
                <div><span className="text-muted-foreground">Screen Template:</span> <span className="font-medium">{activeVersion.screen_template_id ? 'Assigned' : 'Not set'}</span></div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!isNew && activeVersion && (
        <ReadOnlyVersionBanner
          status={activeVersion.status}
          draftActionLabel="modify eligibility, calculation, documents, workflow or any assembly tab"
          onCreateDraft={activeVersion.status !== 'DRAFT' ? handleCloneToDraft : undefined}
          creatingDraft={cloneToDraftMutation.isPending}
          blockingIssues={blockingIssues}
          onReturnToDraft={handleReturnToDraft}
          returningToDraft={returnToDraftMutation.isPending}

        />
      )}

      <LiveVersionGuardDialog
        open={guard.open}
        onOpenChange={(o) => setGuard(prev => ({ ...prev, open: o }))}
        intent={guard.intent}
        status={activeVersion?.status ?? 'ACTIVE'}
        versionLabel={activeVersion ? `Version ${activeVersion.version_number}` : 'This version'}
        busy={cloneToDraftMutation.isPending}
        onCreateDraft={handleCloneToDraft}
        onViewCurrent={() => setGuard({ open: false, intent: 'EDIT' })}
      />

      {!isNew && selectedVersionId && (
        <>
          <VersionReadinessPanel versionId={selectedVersionId} onJumpToTab={setActiveTab} />
          <ConflictDetectionPanel versionId={selectedVersionId} compact onJumpToTab={setActiveTab} />
        </>
      )}


      {/* Commented per manager request — display-only panel, not consumed by any claim/product-creation logic. {!isNew && <BnPlatformConsumptionPanel />} */}


      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="definition">Definition</TabsTrigger>
          <TabsTrigger value="builder" disabled={isNew}>Visual Builder</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
          <TabsTrigger value="eligibility" disabled={isNew}>Eligibility</TabsTrigger>
          <TabsTrigger value="calculation" disabled={isNew}>Calculation</TabsTrigger>
          <TabsTrigger value="timelines" disabled={isNew}>Timelines</TabsTrigger>
          <TabsTrigger value="documents" disabled={isNew}>Documents</TabsTrigger>
          <TabsTrigger value="workflow" disabled={isNew}>Workflow</TabsTrigger>
          <TabsTrigger value="screens" disabled={isNew}>Screens</TabsTrigger>
          <TabsTrigger value="participants" disabled={isNew}>Participant Workflow</TabsTrigger>
          <TabsTrigger value="public-rules" disabled={isNew}>Public Form Rules</TabsTrigger>
          <TabsTrigger value="channels" disabled={isNew}>Application Channels</TabsTrigger>
          <TabsTrigger value="communications" disabled={isNew}>Communications</TabsTrigger>
          <TabsTrigger value="interactions" disabled={isNew}>Interactions</TabsTrigger>
         <TabsTrigger value="approval-policies" disabled={isNew}>Approval / Override Policies</TabsTrigger>
          <TabsTrigger value="preview" disabled={isNew}>Preview</TabsTrigger>
        </TabsList>

        {/* Definition Tab */}
        <TabsContent value="definition" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Product Definition</CardTitle>
              <CardDescription>Core product identity and classification</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Benefit Code *</Label>
                <Input value={form.benefit_code || ''} onChange={e => updateField('benefit_code', e.target.value.toUpperCase())} placeholder="e.g. SICK" maxLength={20} disabled={!isNew} />
              </div>
              <div className="space-y-2">
                <Label>Benefit Name *</Label>
                <Input value={form.benefit_name || ''} onChange={e => updateField('benefit_name', e.target.value)} placeholder="Sickness Benefit" />
              </div>
              <div className="space-y-2">
                <Label>Scheme</Label>
                <Select value={form.scheme_id || '__none__'} onValueChange={v => updateField('scheme_id', v === '__none__' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Select scheme" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {schemes.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.scheme_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Branch</Label>
                <Select value={form.branch_id || '__none__'} onValueChange={v => updateField('branch_id', v === '__none__' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {branches.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={form.category || 'SHORT_TERM'} onValueChange={v => updateField('category', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(BN_CATEGORY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Payment Type</Label>
                <Select value={form.payment_type || 'PERIODIC'} onValueChange={v => updateField('payment_type', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PERIODIC">Periodic</SelectItem>
                    <SelectItem value="LUMP_SUM">Lump Sum</SelectItem>
                    <SelectItem value="BOTH">Both</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Country *</Label>
                <Select value={form.country_code || ''} onValueChange={v => updateField('country_code', v)}>
                  <SelectTrigger className={!form.country_code ? 'border-destructive' : ''}>
                    <SelectValue placeholder="Select country" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeCountries.map((c: any) => (
                      <SelectItem key={c.country_code} value={c.country_code}>{c.country_name} ({c.country_code})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Determines the Country Pack (legal refs, currency, payment config) applied to this product.</p>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status || 'DRAFT'} onValueChange={v => updateField('status', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(BN_PRODUCT_STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
                {/* Explains the difference between this field and the badge
                    above, so the mismatch does not look like a fault and nobody
                    sets ACTIVE by hand to "correct" it. */}
                {liveVersionNumber !== null && form.status !== 'ACTIVE' && (
                  <p className="text-xs text-muted-foreground">
                    This product is already live on <span className="font-medium">v{liveVersionNumber}</span>.
                    A product becomes Active by publishing a version — you do not need to set it here.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Sort Order</Label>
                <Input type="number" value={form.sort_order ?? 0} onChange={e => updateField('sort_order', parseInt(e.target.value) || 0)} />
              </div>
              <div className="col-span-full space-y-2">
                <Label>Description</Label>
                <Textarea value={form.description || ''} onChange={e => updateField('description', e.target.value)} rows={3} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="builder" className="mt-6">
          <VisualBuilderTab versionId={selectedVersionId} versionStatus={activeVersion?.status} />
        </TabsContent>

        <TabsContent value="versions" className="mt-6">
          <VersionHistoryTab productId={isNew ? undefined : id} versions={versions} onCreateVersion={handleCreateVersion} />
        </TabsContent>


        <TabsContent value="eligibility" className="mt-6">
          <EligibilityRulesTab versionId={selectedVersionId} isReadOnly={!isEditableVersion} versionStatus={activeVersion?.status} productCode={form.benefit_code} />
        </TabsContent>

        <TabsContent value="calculation" className="mt-6 space-y-6">
          {existingProduct?.id && selectedVersionId && (
            <CalculationV2Panel
              productId={existingProduct.id}
              productVersionId={selectedVersionId}
              isReadOnly={!isEditableVersion}
            />
          )}
          <details className="rounded-md border bg-muted/30">
            <summary className="cursor-pointer px-4 py-2 text-sm font-medium">Legacy: visual builder & per-version rules</summary>
            <div className="space-y-4 p-4 pt-0">
              <CalculationBuilder versionId={selectedVersionId} isReadOnly={!isEditableVersion} />
              <CalculationRulesTab versionId={selectedVersionId} isReadOnly={!isEditableVersion} versionStatus={activeVersion?.status} />
            </div>
          </details>
        </TabsContent>

        <TabsContent value="timelines" className="mt-6">
          <TimelineRulesTab versionId={selectedVersionId} isReadOnly={!isEditableVersion} versionStatus={activeVersion?.status} />
        </TabsContent>

        <TabsContent value="documents" className="mt-6">
          <DocumentRulesTab productId={isNew ? undefined : id} versionId={selectedVersionId} isReadOnly={!isEditableVersion} versionStatus={activeVersion?.status} />
        </TabsContent>

        <TabsContent value="workflow" className="mt-6">
          <WorkflowTab versionId={selectedVersionId} isReadOnly={!isEditableVersion} versionStatus={activeVersion?.status} />
        </TabsContent>

        <TabsContent value="screens" className="mt-6">
          <ScreenTemplateTab versionId={selectedVersionId} isReadOnly={!isEditableVersion} versionStatus={activeVersion?.status} />
        </TabsContent>

        <TabsContent value="participants" className="mt-6">
          <ParticipantWorkflowTab versionId={selectedVersionId} isReadOnly={!isEditableVersion} versionStatus={activeVersion?.status} />
        </TabsContent>

        <TabsContent value="public-rules" className="mt-6">
          <PublicFormRulesTab versionId={selectedVersionId} isReadOnly={!isEditableVersion} />
        </TabsContent>

        <TabsContent value="channels" className="mt-6">
          <ChannelsTab productId={isNew ? undefined : id} versionId={selectedVersionId} isReadOnly={!isEditableVersion} versionStatus={activeVersion?.status} />
        </TabsContent>

        <TabsContent value="communications" className="mt-6 space-y-6">
          <CommunicationsTab versionId={selectedVersionId} isReadOnly={!isEditableVersion} versionStatus={activeVersion?.status} />
          <ProductOmniCommsPanel organizationId={omniCommsOrganizationId} productId={isNew ? null : id} />
        </TabsContent>

        <TabsContent value="interactions" className="mt-6">
          <InteractionRulesTab productId={isNew ? undefined : id} isReadOnly={!isEditableVersion} versionStatus={activeVersion?.status} />
        </TabsContent>

        <TabsContent value="approval-policies" className="mt-6">
          <ApprovalPoliciesTab versionId={selectedVersionId} isReadOnly={!isEditableVersion} />
        </TabsContent>

        <TabsContent value="preview" className="mt-6">
          <PreviewTab productId={isNew ? undefined : id} versionId={selectedVersionId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
