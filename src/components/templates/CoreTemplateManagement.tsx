import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Eye, Pencil, Plus, Save, Copy, Power, PowerOff, FileDown, History, Sparkles, Scale, Trash2, AlertTriangle, CheckCircle2, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { LgDataGrid, buildLgRowActions, type LgColumnDef, type LgRowAction, type LgBulkAction } from "@/components/legal/grid";

import {
  coreTemplateService,
  CoreTemplate,
  CoreTemplateLayout,
  CoreTemplateToken,
  CoreTemplateVersion,
} from "@/services/coreTemplateService";
import { coreDocumentGenerationService } from "@/services/coreDocumentGenerationService";
import { coreTemplateLegalRefService, TemplateLegalRefLink } from "@/services/coreTemplateLegalRefService";
import { coreTemplateChannelService, CoreTemplateChannel } from "@/services/coreTemplateChannelService";
import { supabase } from "@/integrations/supabase/client";
import type { LegalReference } from "@/services/legal-reference/types";

type AugmentedTemplate = CoreTemplate & {
  _layout_code?: string;
  _ref_count: number;
  _variant_codes: string[];
  _missing_channels: string[];
  _has_active_version: boolean;
  _invalid_tokens: string[];
  _used_by_count: number;
};
const EXPECTED_CHANNELS = ["EMAIL", "PRINT_LETTER", "PDF", "SMS", "PORTAL_MSG"];
const ALL = "__all__";


interface Props {
  fixedModuleCode?: string;
  title?: string;
  description?: string;
  showAllModules?: boolean;
  /** Preset template_type filter (e.g. EMAIL, LETTER, SMS, IN_APP). Locks the type filter when set. */
  presetType?: string;
  /** Preset channel filter (e.g. EMAIL, PRINT_LETTER, SMS, WHATSAPP, PORTAL_MSG, PDF). Locks the channel filter when set. */
  presetChannel?: string;
}

const TEMPLATE_TYPES = [
  "LETTER", "NOTICE", "EMAIL", "SMS", "WHATSAPP", "IN_APP",
  "PDF", "CERTIFICATE", "STATEMENT", "RECEIPT", "REPORT", "DOCUMENT", "FORM",
];
const MODULES = ["LEGAL", "BENEFITS", "COMPLIANCE", "EMPLOYER", "PAYMENTS", "MEMBER", "AUDIT", "ORG", "COMMON"];

// Map module → doc ref prefix used by core_document_sequence
const REF_PREFIX_BY_TYPE: Record<string, string> = {
  NOTICE: "LG-NOT",
  LETTER: "LG-LTR",
  PDF: "LG-PDF",
  FORM: "LG-FRM",
  EMAIL: "LG-EML",
  SMS: "LG-SMS",
};

export default function CoreTemplateManagement({
  fixedModuleCode,
  title,
  description,
  showAllModules = false,
  presetType,
  presetChannel,
}: Props) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<CoreTemplate[]>([]);
  const [layouts, setLayouts] = useState<CoreTemplateLayout[]>([]);
  const [tokens, setTokens] = useState<CoreTemplateToken[]>([]);
  const [channels, setChannels] = useState<CoreTemplateChannel[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [moduleFilter, setModuleFilter] = useState<string>(fixedModuleCode || "ALL");
  const [search, setSearch] = useState("");

  // Legal-grid filters
  const [fStatus, setFStatus] = useState(ALL);
  const [fType, setFType] = useState<string>(presetType || ALL);
  const [fCategory, setFCategory] = useState(ALL);
  const [fChannel, setFChannel] = useState<string>(presetChannel || ALL);
  const [fLayout, setFLayout] = useState(ALL);
  const [fHasRef, setFHasRef] = useState(ALL); // YES | NO
  const [fMissingChannel, setFMissingChannel] = useState(ALL); // YES | NO

  const [variantMap, setVariantMap] = useState<Record<string, string[]>>({});
  const [refCountMap, setRefCountMap] = useState<Record<string, number>>({});

  const [editing, setEditing] = useState<CoreTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [previewTpl, setPreviewTpl] = useState<CoreTemplate | null>(null);
  const [previewVer, setPreviewVer] = useState<CoreTemplateVersion | null>(null);
  const [previewLinks, setPreviewLinks] = useState<TemplateLegalRefLink[]>([]);
  const [historyTpl, setHistoryTpl] = useState<CoreTemplate | null>(null);
  const [historyRows, setHistoryRows] = useState<CoreTemplateVersion[]>([]);
  const [sampleResult, setSampleResult] = useState<{ ref: string; html: string; subject?: string } | null>(null);

  const isLegal = fixedModuleCode === "LEGAL";

  const layoutById = useMemo(() => {
    const m: Record<string, CoreTemplateLayout> = {};
    layouts.forEach((l) => (m[l.id] = l));
    return m;
  }, [layouts]);

  const tokenCodeSet = useMemo(() => new Set(tokens.map((t) => t.token_code)), [tokens]);

  const reload = async () => {
    setLoading(true);
    try {
      const filters: any = {};
      if (fixedModuleCode) filters.module_code = fixedModuleCode;
      else if (moduleFilter !== "ALL") filters.module_code = moduleFilter;
      const [t, l, k, ch, cats] = await Promise.all([
        coreTemplateService.listTemplates(filters),
        coreTemplateService.listLayouts(),
        coreTemplateService.listTokens(fixedModuleCode),
        coreTemplateChannelService.listChannels().catch(() => []),
        (supabase as any).from("core_template_category").select("*").order("module_code").order("sort_order")
          .then((r: any) => r.data || []).catch(() => []),
      ]);
      setTemplates(t);
      setLayouts(l);
      setTokens(k);
      setChannels(ch);
      setCategories(cats);

      // Augment with variant + ref counts in a single query each
      const ids = t.map((x) => x.id);
      if (ids.length) {
        // DEF-A-03 — channel variants hang off core_template_version, not the
        // template directly; resolve version -> template before counting.
        const [{ data: versions }, { data: refs }] = await Promise.all([
          (supabase as any).from("core_template_version")
            .select("id, template_id").in("template_id", ids),
          (supabase as any).from("core_template_legal_reference")
            .select("template_id").in("template_id", ids),
        ]);
        const versionToTemplate: Record<string, string> = {};
        (versions || []).forEach((v: any) => { versionToTemplate[v.id] = v.template_id; });
        const versionIds = Object.keys(versionToTemplate);
        let variants: any[] = [];
        if (versionIds.length) {
          const { data: vr } = await (supabase as any).from("core_template_channel_variant")
            .select("template_version_id, channel_code")
            .in("template_version_id", versionIds).eq("is_active", true);
          variants = vr || [];
        }
        const vm: Record<string, string[]> = {};
        variants.forEach((v: any) => {
          const tid = versionToTemplate[v.template_version_id];
          if (!tid) return;
          const list = (vm[tid] ||= []);
          if (!list.includes(v.channel_code)) list.push(v.channel_code);
        });
        const rm: Record<string, number> = {};
        (refs || []).forEach((r: any) => { rm[r.template_id] = (rm[r.template_id] || 0) + 1; });
        setVariantMap(vm);
        setRefCountMap(rm);

      } else {
        setVariantMap({}); setRefCountMap({});
      }
    } catch (e: any) {
      toast({ title: "Failed to load templates", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [fixedModuleCode, moduleFilter]);

  const augmented: AugmentedTemplate[] = useMemo(() => {
    return templates.map((t) => {
      const variants = variantMap[t.id] || [];
      const body = ""; // body not loaded in list; invalid-token detection requires version body — skip per row, computed on demand
      const tokenMatches: string[] = [];
      const invalid: string[] = [];
      // Optional: parse body_metadata? Not stored on list. Leave invalid empty here; the editor flags it.
      return {
        ...t,
        _layout_code: layoutById[t.default_layout_id || ""]?.code,
        _ref_count: refCountMap[t.id] || 0,
        _variant_codes: variants,
        _missing_channels: EXPECTED_CHANNELS.filter((c) => !variants.includes(c)),
        _has_active_version: !!t.active_version_id,
        _invalid_tokens: invalid,
        _used_by_count: 0,
      };
    });
  }, [templates, variantMap, refCountMap, layoutById]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return augmented.filter((t) => {
      if (q && !t.name.toLowerCase().includes(q) && !t.code.toLowerCase().includes(q)) return false;
      if (fStatus !== ALL && t.status !== fStatus) return false;
      if (fType !== ALL && t.template_type !== fType) return false;
      if (fCategory !== ALL && (t.template_category || "") !== fCategory) return false;
      if (fChannel !== ALL && !t._variant_codes.includes(fChannel)) return false;
      if (fLayout !== ALL && (t.default_layout_id || "") !== fLayout) return false;
      if (fHasRef === "YES" && t._ref_count === 0) return false;
      if (fHasRef === "NO" && t._ref_count > 0) return false;
      if (fMissingChannel === "YES" && t._missing_channels.length === 0) return false;
      if (fMissingChannel === "NO" && t._missing_channels.length > 0) return false;
      return true;
    });
  }, [augmented, search, fStatus, fType, fCategory, fChannel, fLayout, fHasRef, fMissingChannel]);


  const openPreview = async (tpl: CoreTemplate) => {
    setPreviewTpl(tpl);
    const [ver, links] = await Promise.all([
      coreTemplateService.getActiveVersion(tpl.id),
      coreTemplateLegalRefService.listForTemplate(tpl.id).catch(() => [] as TemplateLegalRefLink[]),
    ]);
    setPreviewVer(ver);
    setPreviewLinks(links);
  };


  const handleClone = async (tpl: CoreTemplate) => {
    try {
      const newCode = `${tpl.code}-COPY-${Date.now().toString(36).toUpperCase()}`;
      const ver = await coreTemplateService.getActiveVersion(tpl.id);
      const cloned = await coreTemplateService.createTemplate({
        code: newCode,
        name: `${tpl.name} (Copy)`,
        module_code: tpl.module_code,
        country_code: tpl.country_code,
        institution_code: tpl.institution_code,
        template_type: tpl.template_type,
        template_category: tpl.template_category || undefined,
        owning_department: tpl.owning_department || undefined,
        status: "DRAFT",
        source_system: "CORE",
        is_active: true,
        default_layout_id: tpl.default_layout_id || null,
      } as any);
      if (ver?.body_html) {
        const nv = await coreTemplateService.createDraftVersion(
          cloned.id,
          ver.body_html,
          ver.subject || undefined,
          tpl.default_layout_id || null
        );
        await coreTemplateService.publishVersion(nv.id);
      }
      toast({ title: "Template cloned", description: newCode });
      reload();
    } catch (e: any) {
      toast({ title: "Clone failed", description: e.message, variant: "destructive" });
    }
  };

  const setStatus = async (tpl: CoreTemplate, status: "ACTIVE" | "RETIRED") => {
    try {
      await coreTemplateService.updateTemplate(tpl.id, { status, is_active: status === "ACTIVE" } as any);
      toast({ title: `Template ${status === "ACTIVE" ? "published" : "retired"}` });
      reload();
    } catch (e: any) {
      toast({ title: "Status change failed", description: e.message, variant: "destructive" });
    }
  };

  const generateSample = async (tpl: CoreTemplate) => {
    try {
      const prefix = REF_PREFIX_BY_TYPE[tpl.template_type] || `${tpl.module_code}-DOC`;
      const result = await coreDocumentGenerationService.generate({
        template_id: tpl.id,
        module_code: tpl.module_code,
        doc_type_code: tpl.template_type,
        prefix,
        tokens: Object.fromEntries(tokens.map((k) => [k.token_code, k.sample_value || `{{${k.token_code}}}`])),
        layout_id: tpl.default_layout_id || null,
        generated_by: "SAMPLE",
      });
      setSampleResult({ ref: result.reference_no, html: result.generated_html, subject: undefined });
      toast({ title: "Sample generated", description: result.reference_no });
    } catch (e: any) {
      toast({ title: "Sample failed", description: e.message, variant: "destructive" });
    }
  };

  const openHistory = async (tpl: CoreTemplate) => {
    setHistoryTpl(tpl);
    const rows = await coreTemplateService.listVersions(tpl.id);
    setHistoryRows(rows);
  };

  const exportCsv = () => {
    const header = ["code", "name", "type", "category", "layout", "status", "channels", "refs", "updated_at"];
    const rows = filtered.map((t) => [
      t.code, t.name, t.template_type, t.template_category || "",
      layoutById[t.default_layout_id || ""]?.code || "",
      t.status, t._variant_codes.join("|"), String(t._ref_count), t.updated_at,
    ]);
    const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fixedModuleCode || "templates"}-export.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openEdit = (t: CoreTemplate) => {
    if ((fixedModuleCode || t.module_code) === "LEGAL") navigate(`/legal/admin/templates/${t.id}/edit`);
    else setEditing(t);
  };

  const deleteDraft = async (t: CoreTemplate) => {
    if (t.status !== "DRAFT") {
      toast({ title: "Only DRAFT templates can be deleted", variant: "destructive" });
      return;
    }
    if (!window.confirm(`Delete draft template "${t.name}"? This cannot be undone.`)) return;
    try {
      await coreTemplateService.updateTemplate(t.id, { status: "RETIRED", is_active: false } as any);
      const { error } = await (supabase as any).from("core_template").delete().eq("id", t.id);
      if (error) throw error;
      toast({ title: "Draft deleted" });
      reload();
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    }
  };

  // Bulk actions
  const bulkRetireDrafts = async (rows: AugmentedTemplate[]) => {
    const drafts = rows.filter((r) => r.status === "DRAFT");
    if (!drafts.length) { toast({ title: "No drafts selected" }); return; }
    try {
      await Promise.all(drafts.map((r) =>
        coreTemplateService.updateTemplate(r.id, { status: "RETIRED", is_active: false } as any)));
      toast({ title: `Retired ${drafts.length} draft(s)` });
      reload();
    } catch (e: any) {
      toast({ title: "Bulk retire failed", description: e.message, variant: "destructive" });
    }
  };
  const bulkValidate = (rows: AugmentedTemplate[]) => {
    const issues = rows.filter((r) => !r._has_active_version || r._missing_channels.length > 0 || (isLegal && r._ref_count === 0));
    toast({
      title: `Validation: ${rows.length - issues.length}/${rows.length} OK`,
      description: issues.length ? `${issues.length} need attention (missing channels/refs/version).` : "All selected templates pass.",
    });
  };
  const bulkGenerateSamples = async (rows: AugmentedTemplate[]) => {
    const ready = rows.filter((r) => r._has_active_version);
    if (!ready.length) { toast({ title: "No active versions in selection", variant: "destructive" }); return; }
    try {
      await Promise.all(ready.map((r) => generateSample(r)));
      toast({ title: `Generated ${ready.length} sample(s)` });
    } catch (e: any) {
      toast({ title: "Bulk sample failed", description: e.message, variant: "destructive" });
    }
  };
  const bulkExport = (rows: AugmentedTemplate[]) => {
    const header = ["code", "name", "type", "category", "status", "channels", "refs"];
    const out = rows.map((t) => [t.code, t.name, t.template_type, t.template_category || "", t.status, t._variant_codes.join("|"), String(t._ref_count)]);
    const csv = [header, ...out].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `templates-selected.csv`; a.click();
    URL.revokeObjectURL(url);
  };


  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{title || "Template Management"}</h1>
          <p className="text-muted-foreground">{description || "Manage central templates"}</p>
        </div>
        <Button size="lg" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4 mr-2" />New Template
        </Button>
      </div>

      <Tabs defaultValue="templates">

        <TabsList>
          <TabsTrigger value="templates">Templates ({templates.length})</TabsTrigger>
          <TabsTrigger value="layouts">Layouts ({layouts.length})</TabsTrigger>
          <TabsTrigger value="tokens">Tokens ({tokens.length})</TabsTrigger>
          <TabsTrigger value="channels">Channels ({channels.length})</TabsTrigger>
          <TabsTrigger value="categories">Categories ({categories.length})</TabsTrigger>
          {(fixedModuleCode === "LEGAL" || !fixedModuleCode) && (
            <TabsTrigger value="completeness">Completeness Report</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="templates">
          {isLegal ? (
            <LegalTemplatesGrid
              data={filtered}
              loading={loading}
              layouts={layouts}
              categories={categories.filter((c: any) => c.module_code === "LEGAL")}
              channels={channels}
              search={search}
              onSearch={setSearch}
              filterState={{ fStatus, fType, fCategory, fChannel, fLayout, fHasRef, fMissingChannel }}
              setFilter={{ setFStatus, setFType, setFCategory, setFChannel, setFLayout, setFHasRef, setFMissingChannel }}
              onRefresh={reload}
              onCreate={() => setCreating(true)}
              onPreview={openPreview}
              onEdit={openEdit}
              onClone={handleClone}
              onHistory={openHistory}
              onGenerateSample={generateSample}
              onPublish={(t) => setStatus(t, "ACTIVE")}
              onRetire={(t) => setStatus(t, "RETIRED")}
              onDeleteDraft={deleteDraft}
              bulkRetireDrafts={bulkRetireDrafts}
              bulkValidate={bulkValidate}
              bulkGenerateSamples={bulkGenerateSamples}
              bulkExport={bulkExport}
            />
          ) : (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-end gap-3 justify-between">
                <div className="flex flex-wrap items-end gap-3">
                  {showAllModules && (
                    <div>
                      <Label className="text-xs">Module</Label>
                      <Select value={moduleFilter} onValueChange={setModuleFilter}>
                        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ALL">All</SelectItem>
                          {MODULES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div>
                    <Label className="text-xs">Search</Label>
                    <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or code" className="w-64" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={exportCsv}><FileDown className="h-4 w-4 mr-2" />Export</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-sm text-muted-foreground">Loading…</div>
              ) : filtered.length === 0 ? (
                <div className="text-sm text-muted-foreground">No templates</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Name</TableHead>
                      {showAllModules && <TableHead>Module</TableHead>}
                      <TableHead>Scope</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Layout</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last Updated</TableHead>
                      <TableHead className="w-[220px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((t) => {
                      const layout = layoutById[t.default_layout_id || ""];
                      const isLegacy = t.source_system === "COMPLIANCE_LEGACY";
                      const scope = (t as any).scope || "COUNTRY";
                      return (
                        <TableRow key={t.id}>
                          <TableCell className="font-mono text-xs">{t.code}</TableCell>
                          <TableCell>{t.name}</TableCell>
                          {showAllModules && <TableCell><Badge variant="outline">{t.module_code}</Badge></TableCell>}
                          <TableCell>
                            <Badge variant={scope === "GLOBAL" ? "secondary" : "outline"} className="text-xs">
                              {scope === "GLOBAL" ? "GLOBAL" : `${t.country_code}`}
                            </Badge>
                          </TableCell>
                          <TableCell>{t.template_type}</TableCell>
                          <TableCell>{t.template_category || "-"}</TableCell>
                          <TableCell className="text-xs">{layout?.code || "-"}</TableCell>
                          <TableCell>
                            <Badge variant={t.status === "ACTIVE" ? "default" : t.status === "RETIRED" ? "destructive" : "secondary"}>
                              {t.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(t.updated_at).toLocaleDateString("en-GB")}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button size="icon" variant="ghost" className="h-8 w-8" title="Preview" onClick={() => openPreview(t)}>
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8" title="Edit" disabled={isLegacy} onClick={() => openEdit(t)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8" title="Clone" onClick={() => handleClone(t)}>
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8" title="Version History" onClick={() => openHistory(t)}>
                              <History className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8" title="Generate Sample" disabled={!t.active_version_id} onClick={() => generateSample(t)}>
                              <Sparkles className="h-3.5 w-3.5" />
                            </Button>
                            {t.status !== "ACTIVE" ? (
                              <Button size="icon" variant="ghost" className="h-8 w-8" title="Publish" disabled={isLegacy} onClick={() => setStatus(t, "ACTIVE")}>
                                <Power className="h-3.5 w-3.5" />
                              </Button>
                            ) : (
                              <Button size="icon" variant="ghost" className="h-8 w-8" title="Retire" disabled={isLegacy} onClick={() => setStatus(t, "RETIRED")}>
                                <PowerOff className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          )}
        </TabsContent>


        <TabsContent value="layouts">
          <Card>
            <CardHeader><CardTitle>Layouts</CardTitle><CardDescription>Letterhead and document layout presets</CardDescription></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Code</TableHead><TableHead>Name</TableHead>
                  <TableHead>Letterhead</TableHead><TableHead>Page #s</TableHead>
                  <TableHead>Pre-Printed</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {layouts.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-mono text-xs">{l.code}</TableCell>
                      <TableCell>{l.name}</TableCell>
                      <TableCell>{l.has_letterhead ? "Yes" : "No"}</TableCell>
                      <TableCell>{l.show_page_numbers ? "Yes" : "No"}</TableCell>
                      <TableCell>{l.is_pre_printed ? "Yes" : "No"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tokens">
          <Card>
            <CardHeader><CardTitle>Tokens</CardTitle><CardDescription>Available merge tokens (use as <code>{`{{token.code}}`}</code> in templates)</CardDescription></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Token</TableHead><TableHead>Label</TableHead>
                  <TableHead>Module</TableHead><TableHead>Entity</TableHead>
                  <TableHead>Sample</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {tokens.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-mono text-xs">{`{{${t.token_code}}}`}</TableCell>
                      <TableCell>{t.token_label}</TableCell>
                      <TableCell><Badge variant="outline">{t.module_code}</Badge></TableCell>
                      <TableCell>{t.entity_type || "-"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{t.sample_value || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="channels">
          <Card>
            <CardHeader>
              <CardTitle>Delivery Channels</CardTitle>
              <CardDescription>Channels available for template variants (PDF, Email, SMS, In-App, Webhook, Print)</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Code</TableHead><TableHead>Name</TableHead>
                  <TableHead>Group</TableHead><TableHead>Mode</TableHead>
                  <TableHead>HTML</TableHead><TableHead>Text</TableHead>
                  <TableHead>Max Length</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {channels.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs">{c.channel_code}</TableCell>
                      <TableCell>{c.channel_name}</TableCell>
                      <TableCell><Badge variant="outline">{c.channel_group}</Badge></TableCell>
                      <TableCell className="text-xs">{c.delivery_mode}</TableCell>
                      <TableCell>{c.supports_html ? "Yes" : "No"}</TableCell>
                      <TableCell>{c.supports_text ? "Yes" : "No"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.max_length ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="categories">
          <Card>
            <CardHeader>
              <CardTitle>Template Categories</CardTitle>
              <CardDescription>Normalized categories per module (Legal, Benefits, Compliance)</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Module</TableHead><TableHead>Code</TableHead>
                  <TableHead>Name</TableHead><TableHead>Description</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {categories.map((c: any) => (
                    <TableRow key={c.id}>
                      <TableCell><Badge variant="outline">{c.module_code}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{c.category_code}</TableCell>
                      <TableCell>{c.category_name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.description || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {(fixedModuleCode === "LEGAL" || !fixedModuleCode) && (
          <TabsContent value="completeness">
            <CompletenessReport moduleCode="LEGAL" country="KN" onEdit={(id) => navigate(`/legal/admin/templates/${id}/edit`)} />
          </TabsContent>
        )}
      </Tabs>

      {/* Preview */}
      <Dialog open={!!previewTpl} onOpenChange={(o) => { if (!o) { setPreviewTpl(null); setPreviewVer(null); setPreviewLinks([]); } }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{previewTpl?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="text-xs text-muted-foreground">Code: {previewTpl?.code} · Type: {previewTpl?.template_type}</div>
            {previewVer?.subject && <div><strong>Subject:</strong> {previewVer.subject}</div>}
            <div className="border rounded p-4 max-h-96 overflow-auto prose prose-sm"
                 dangerouslySetInnerHTML={{ __html: previewVer?.body_html || "<em>No active version</em>" }} />
            {previewLinks.length > 0 && (
              <div className="border rounded p-3 bg-muted/30">
                <div className="text-xs font-semibold mb-2 flex items-center gap-1"><Scale className="h-3.5 w-3.5" />Linked Legal References ({previewLinks.length})</div>
                <ol className="text-xs space-y-1 list-decimal pl-4">
                  {previewLinks.map((l) => (
                    <li key={l.id}>
                      <span className="font-mono">{l.legal_reference?.ref_code}</span> · {l.legal_reference?.short_title}
                      {l.legal_reference?.section && <> · §{l.legal_reference.section}</>}
                      {l.required_flag && <Badge variant="outline" className="ml-1 text-[10px]">required</Badge>}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>


      {/* Version History */}
      <Dialog open={!!historyTpl} onOpenChange={(o) => { if (!o) { setHistoryTpl(null); setHistoryRows([]); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Version History — {historyTpl?.name}</DialogTitle></DialogHeader>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Version</TableHead><TableHead>Status</TableHead>
              <TableHead>Published</TableHead><TableHead>Updated</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {historyRows.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>v{v.version_no}</TableCell>
                  <TableCell><Badge variant={v.status === "PUBLISHED" ? "default" : "secondary"}>{v.status}</Badge></TableCell>
                  <TableCell className="text-xs">{v.published_at ? new Date(v.published_at).toLocaleString("en-GB") : "-"}</TableCell>
                  <TableCell className="text-xs">{new Date((v as any).updated_at).toLocaleDateString("en-GB")}</TableCell>
                </TableRow>
              ))}
              {historyRows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground text-sm">No versions</TableCell></TableRow>}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>

      {/* Sample preview */}
      <Dialog open={!!sampleResult} onOpenChange={(o) => { if (!o) setSampleResult(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Generated Sample</DialogTitle>
            <DialogDescription>Reference: <span className="font-mono">{sampleResult?.ref}</span></DialogDescription>
          </DialogHeader>
          <div className="border rounded p-4 max-h-[60vh] overflow-auto prose prose-sm"
               dangerouslySetInnerHTML={{ __html: sampleResult?.html || "" }} />
        </DialogContent>
      </Dialog>

      {/* Create / Edit */}
      <TemplateFormDialog
        open={creating || !!editing}
        template={editing}
        defaultModule={fixedModuleCode}
        layouts={layouts}
        tokens={tokens}
        onClose={() => { setCreating(false); setEditing(null); }}
        onSaved={() => { setCreating(false); setEditing(null); reload(); }}
      />
    </div>
  );
}


function TemplateFormDialog({
  open, template, defaultModule, layouts, tokens, onClose, onSaved,
}: {
  open: boolean;
  template: CoreTemplate | null;
  defaultModule?: string;
  layouts: CoreTemplateLayout[];
  tokens: CoreTemplateToken[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<any>({});
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [layoutId, setLayoutId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (template) {
      setForm({
        code: template.code, name: template.name,
        module_code: template.module_code,
        template_type: template.template_type,
        template_category: template.template_category || "",
        description: template.description || "",
      });
      setLayoutId(template.default_layout_id || "");
      coreTemplateService.getActiveVersion(template.id).then(v => {
        setBody(v?.body_html || "");
        setSubject(v?.subject || "");
      });
    } else if (open) {
      setForm({
        code: "", name: "",
        module_code: defaultModule || "LEGAL",
        template_type: "LETTER",
        template_category: "",
        description: "",
      });
      setBody(""); setSubject(""); setLayoutId(layouts[0]?.id || "");
    }
  }, [template, open, defaultModule, layouts]);

  const save = async () => {
    if (!form.code || !form.name) {
      toast({ title: "Code and Name required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      let tpl = template;
      if (!tpl) {
        tpl = await coreTemplateService.createTemplate({
          ...form, status: "DRAFT", source_system: "CORE", is_active: true,
          default_layout_id: layoutId || null,
        });
      } else {
        tpl = await coreTemplateService.updateTemplate(tpl.id, {
          name: form.name, description: form.description,
          template_type: form.template_type, template_category: form.template_category,
          default_layout_id: layoutId || null,
        });
      }
      const ver = await coreTemplateService.createDraftVersion(tpl.id, body, subject, layoutId || null);
      await coreTemplateService.publishVersion(ver.id);
      toast({ title: "Template saved" });
      onSaved();
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{template ? "Edit Template" : "New Template"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Code *</Label>
            <Input value={form.code || ""} disabled={!!template}
                   onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </div>
          <div>
            <Label>Name *</Label>
            <Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <Label>Type</Label>
            <Select value={form.template_type} onValueChange={(v) => setForm({ ...form, template_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TEMPLATE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Category</Label>
            <Input value={form.template_category || ""} onChange={(e) => setForm({ ...form, template_category: e.target.value })} />
          </div>
          <div className="col-span-2">
            <Label>Layout</Label>
            <Select value={layoutId} onValueChange={setLayoutId}>
              <SelectTrigger><SelectValue placeholder="Choose layout" /></SelectTrigger>
              <SelectContent>
                {layouts.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Subject</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label>Body (HTML, supports {`{{tokens}}`})</Label>
            <Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
            {tokens.length > 0 && (
              <div className="mt-2 text-xs text-muted-foreground">
                <div className="mb-1">Available tokens (click to copy):</div>
                <div className="flex flex-wrap gap-1 max-h-24 overflow-auto">
                  {tokens.map((tk) => (
                    <button
                      key={tk.id}
                      type="button"
                      className="font-mono px-1.5 py-0.5 rounded bg-muted hover:bg-accent text-[10px]"
                      onClick={() => navigator.clipboard.writeText(`{{${tk.token_code}}}`)}
                      title={tk.token_label}
                    >{`{{${tk.token_code}}}`}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {template && (template.module_code === "LEGAL" || form.module_code === "LEGAL") && (
            <div className="col-span-2">
              <TemplateLegalReferencesPanel templateId={template.id} countryCode={template.country_code || "KN"} />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />{saving ? "Saving…" : "Save & Publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplateLegalReferencesPanel({ templateId, countryCode }: { templateId: string; countryCode: string }) {
  const { toast } = useToast();
  const [links, setLinks] = useState<TemplateLegalRefLink[]>([]);
  const [available, setAvailable] = useState<LegalReference[]>([]);
  const [selectedRefId, setSelectedRefId] = useState<string>("");
  const [requiredFlag, setRequiredFlag] = useState(false);
  const [loading, setLoading] = useState(true);

  const country = countryCode === "KN" ? "SKN" : countryCode;

  const reload = async () => {
    setLoading(true);
    try {
      const [l, a] = await Promise.all([
        coreTemplateLegalRefService.listForTemplate(templateId),
        coreTemplateLegalRefService.listAvailableRefs(country),
      ]);
      setLinks(l);
      setAvailable(a);
    } catch (e: any) {
      toast({ title: "Failed to load legal references", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (templateId) reload(); /* eslint-disable-next-line */ }, [templateId, country]);

  const linkedIds = useMemo(() => new Set(links.map((l) => l.legal_reference_id)), [links]);
  const selectable = useMemo(() => available.filter((r) => !linkedIds.has(r.id)), [available, linkedIds]);

  const addRef = async () => {
    if (!selectedRefId) return;
    try {
      await coreTemplateLegalRefService.addLink({
        template_id: templateId,
        legal_reference_id: selectedRefId,
        required_flag: requiredFlag,
        display_order: links.length,
      });
      setSelectedRefId(""); setRequiredFlag(false);
      reload();
    } catch (e: any) {
      toast({ title: "Add failed", description: e.message, variant: "destructive" });
    }
  };

  const removeLink = async (id: string) => {
    try {
      await coreTemplateLegalRefService.removeLink(id);
      reload();
    } catch (e: any) {
      toast({ title: "Remove failed", description: e.message, variant: "destructive" });
    }
  };

  const toggleRequired = async (l: TemplateLegalRefLink) => {
    try {
      await coreTemplateLegalRefService.updateLink(l.id, { required_flag: !l.required_flag });
      reload();
    } catch (e: any) {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="border rounded-md p-3 bg-muted/20">
      <div className="flex items-center gap-2 mb-2">
        <Scale className="h-4 w-4" />
        <Label className="mb-0">Linked Legal References ({country})</Label>
      </div>
      <p className="text-xs text-muted-foreground mb-2">
        Only ACTIVE references for {country} can be linked. Generated letters will cite these and snapshot the exact version used.
      </p>

      <div className="flex gap-2 items-end mb-3">
        <div className="flex-1">
          <Label className="text-xs">Add reference</Label>
          <Select value={selectedRefId} onValueChange={setSelectedRefId}>
            <SelectTrigger><SelectValue placeholder={selectable.length === 0 ? "All available linked" : "Choose reference"} /></SelectTrigger>
            <SelectContent className="max-h-72">
              {selectable.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  <span className="font-mono text-xs">{r.ref_code}</span> · {r.short_title}
                  {r.section && <> · §{r.section}</>}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-1 text-xs mb-2">
          <input type="checkbox" checked={requiredFlag} onChange={(e) => setRequiredFlag(e.target.checked)} />
          Required
        </label>
        <Button size="sm" onClick={addRef} disabled={!selectedRefId}>
          <Plus className="h-3.5 w-3.5 mr-1" />Add
        </Button>
      </div>

      {loading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : links.length === 0 ? (
        <div className="text-xs text-muted-foreground italic">No legal references linked yet.</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Ref Code</TableHead>
              <TableHead>Title / Section</TableHead>
              <TableHead className="w-24">Version</TableHead>
              <TableHead className="w-20">Required</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {links.map((l, idx) => (
              <TableRow key={l.id}>
                <TableCell className="text-xs">{idx + 1}</TableCell>
                <TableCell className="font-mono text-xs">{l.legal_reference?.ref_code}</TableCell>
                <TableCell className="text-xs">
                  {l.legal_reference?.short_title}
                  {l.legal_reference?.section && <span className="text-muted-foreground"> · §{l.legal_reference.section}</span>}
                  {l.legal_reference?.act_name && <div className="text-[10px] text-muted-foreground">{l.legal_reference.act_name}</div>}
                </TableCell>
                <TableCell className="text-xs">v{l.legal_reference?.version_number}</TableCell>
                <TableCell>
                  <button type="button" onClick={() => toggleRequired(l)} title="Toggle required">
                    <Badge variant={l.required_flag ? "default" : "outline"} className="text-[10px] cursor-pointer">
                      {l.required_flag ? "Required" : "Optional"}
                    </Badge>
                  </button>
                </TableCell>
                <TableCell>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeLink(l.id)} title="Remove">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function CompletenessReport({ moduleCode, country, onEdit }: { moduleCode: string; country: string; onEdit: (id: string) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"ALL" | "INCOMPLETE">("INCOMPLETE");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await (supabase as any).rpc("lg_template_completeness", {
        p_module_code: moduleCode, p_country: country,
      });
      if (!error) setRows((data || []) as any[]);
      setLoading(false);
    })();
  }, [moduleCode, country]);

  const filtered = filter === "INCOMPLETE" ? rows.filter(r => r.completion_pct < 100) : rows;
  const avg = rows.length ? Math.round(rows.reduce((s, r) => s + (r.completion_pct || 0), 0) / rows.length) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Template Completeness Report</CardTitle>
        <CardDescription>
          Module: {moduleCode} · Country: {country} · Templates: {rows.length} · Average completeness: <strong>{avg}%</strong>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2 mb-3">
          <Button size="sm" variant={filter === "INCOMPLETE" ? "default" : "outline"} onClick={() => setFilter("INCOMPLETE")}>
            Show Below 100%
          </Button>
          <Button size="sm" variant={filter === "ALL" ? "default" : "outline"} onClick={() => setFilter("ALL")}>
            Show All
          </Button>
        </div>
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Subject</TableHead>
                <TableHead className="text-center">Body</TableHead>
                <TableHead className="text-center">Blocks</TableHead>
                <TableHead className="text-center">Refs</TableHead>
                <TableHead className="text-center">Sig</TableHead>
                <TableHead className="text-center">Footer</TableHead>
                <TableHead className="text-center">Channels</TableHead>
                <TableHead className="text-right">Completion</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r: any) => (
                <TableRow key={r.template_id}>
                  <TableCell className="font-mono text-xs">{r.code}</TableCell>
                  <TableCell>{r.name}</TableCell>
                  <TableCell><Badge variant={r.status === "ACTIVE" ? "default" : "secondary"}>{r.status}</Badge></TableCell>
                  <TableCell className="text-center">{r.has_subject ? "✓" : "—"}</TableCell>
                  <TableCell className="text-center">{r.has_body ? "✓" : "—"}</TableCell>
                  <TableCell className="text-center">{r.has_structure ? "✓" : "—"}</TableCell>
                  <TableCell className="text-center">{r.has_legal_refs ? "✓" : "—"}</TableCell>
                  <TableCell className="text-center">{r.has_signature ? "✓" : "—"}</TableCell>
                  <TableCell className="text-center">{r.has_footer ? "✓" : "—"}</TableCell>
                  <TableCell className="text-center">{r.channel_count}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant={r.completion_pct >= 100 ? "default" : r.completion_pct >= 70 ? "secondary" : "destructive"}>
                      {r.completion_pct}%
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => onEdit(r.template_id)}>
                      <Pencil className="h-3.5 w-3.5"/>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// =====================================================================
// LegalTemplatesGrid — standardized LgDataGrid listing for Legal module
// =====================================================================
function LegalTemplatesGrid(props: {
  data: AugmentedTemplate[];
  loading: boolean;
  layouts: CoreTemplateLayout[];
  categories: any[];
  channels: CoreTemplateChannel[];
  search: string;
  onSearch: (v: string) => void;
  filterState: {
    fStatus: string; fType: string; fCategory: string; fChannel: string;
    fLayout: string; fHasRef: string; fMissingChannel: string;
  };
  setFilter: {
    setFStatus: (v: string) => void; setFType: (v: string) => void;
    setFCategory: (v: string) => void; setFChannel: (v: string) => void;
    setFLayout: (v: string) => void; setFHasRef: (v: string) => void;
    setFMissingChannel: (v: string) => void;
  };
  onRefresh: () => void;
  onCreate: () => void;
  onPreview: (t: CoreTemplate) => void;
  onEdit: (t: CoreTemplate) => void;
  onClone: (t: CoreTemplate) => void;
  onHistory: (t: CoreTemplate) => void;
  onGenerateSample: (t: CoreTemplate) => void;
  onPublish: (t: CoreTemplate) => void;
  onRetire: (t: CoreTemplate) => void;
  onDeleteDraft: (t: CoreTemplate) => void;
  bulkRetireDrafts: (r: AugmentedTemplate[]) => void;
  bulkValidate: (r: AugmentedTemplate[]) => void;
  bulkGenerateSamples: (r: AugmentedTemplate[]) => void;
  bulkExport: (r: AugmentedTemplate[]) => void;
}) {
  const {
    data, loading, layouts, categories, channels,
    filterState: { fStatus, fType, fCategory, fChannel, fLayout, fHasRef, fMissingChannel },
    setFilter: { setFStatus, setFType, setFCategory, setFChannel, setFLayout, setFHasRef, setFMissingChannel },
    onRefresh, onCreate, onPreview, onEdit, onClone, onHistory,
    onGenerateSample, onPublish, onRetire, onDeleteDraft,
    bulkRetireDrafts, bulkValidate, bulkGenerateSamples, bulkExport,
  } = props;

  const columns: LgColumnDef<AugmentedTemplate>[] = useMemo(() => [
    {
      accessorKey: "code",
      header: "Template Code",
      meta: { label: "Template Code", pinLeft: true },
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
    },
    { accessorKey: "name", header: "Template Name", meta: { label: "Template Name" } },
    {
      accessorKey: "template_category",
      header: "Category",
      meta: { label: "Category" },
      cell: ({ getValue }) => (getValue() as string) || <span className="text-muted-foreground">—</span>,
    },
    {
      accessorKey: "template_type",
      header: "Type",
      meta: { label: "Type" },
      cell: ({ getValue }) => <Badge variant="outline" className="text-xs">{getValue() as string}</Badge>,
    },
    {
      id: "channels",
      header: "Channel Coverage",
      meta: { label: "Channel Coverage" },
      cell: ({ row }) => {
        const vc = row.original._variant_codes;
        if (!vc.length) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {vc.map((c) => (
              <Badge key={c} variant="secondary" className="text-[10px] font-mono">{c}</Badge>
            ))}
          </div>
        );
      },
    },
    {
      id: "layout",
      header: "Layout",
      meta: { label: "Layout" },
      cell: ({ row }) => (
        <span className="text-xs">{row.original._layout_code || <span className="text-muted-foreground">—</span>}</span>
      ),
    },
    {
      id: "refs",
      header: "Legal Refs",
      meta: { label: "Legal Refs", align: "center" },
      cell: ({ row }) => {
        const n = row.original._ref_count;
        return n > 0
          ? <Badge variant="outline" className="text-xs"><Scale className="h-3 w-3 mr-1" />{n}</Badge>
          : <span className="text-xs text-muted-foreground">—</span>;
      },
    },
    {
      id: "version",
      header: "Active Version",
      meta: { label: "Active Version", align: "center" },
      cell: ({ row }) => row.original._has_active_version
        ? <Badge variant="default" className="text-[10px]">Published</Badge>
        : <Badge variant="destructive" className="text-[10px]">None</Badge>,
    },
    {
      accessorKey: "status",
      header: "Status",
      meta: { label: "Status" },
      cell: ({ getValue }) => {
        const s = getValue() as string;
        return (
          <Badge variant={s === "ACTIVE" ? "default" : s === "RETIRED" ? "destructive" : "secondary"}>{s}</Badge>
        );
      },
    },
    {
      accessorKey: "updated_at",
      header: "Last Updated",
      meta: { label: "Last Updated" },
      cell: ({ getValue }) => (
        <span className="text-xs text-muted-foreground">
          {new Date(getValue() as string).toLocaleDateString("en-GB")}
        </span>
      ),
    },
    {
      id: "warnings",
      header: "Validation",
      meta: { label: "Validation" },
      cell: ({ row }) => {
        const t = row.original;
        const warnings: string[] = [];
        if (!t._has_active_version) warnings.push("No active version");
        if (t._ref_count === 0) warnings.push("Missing legal references");
        if (t._missing_channels.length) warnings.push(`Missing channels: ${t._missing_channels.join(", ")}`);
        if (!t.default_layout_id) warnings.push("Incomplete layout");
        if (!warnings.length) {
          return <Badge variant="outline" className="text-[10px]"><CheckCircle2 className="h-3 w-3 mr-1" />OK</Badge>;
        }
        return (
          <div className="flex items-center gap-1" title={warnings.join(" • ")}>
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
            <span className="text-[10px] text-amber-700">{warnings.length} issue{warnings.length > 1 ? "s" : ""}</span>
          </div>
        );
      },
    },
    {
      id: "used_by",
      header: "Used By",
      meta: { label: "Used By", align: "center", defaultHidden: true },
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original._used_by_count || "—"}</span>,
    },
  ], []);

  const rowActions: LgRowAction<AugmentedTemplate>[] = useMemo(() => [
    { key: "view", label: "View / Preview", icon: <Eye className="h-3.5 w-3.5" />, onClick: onPreview },
    { key: "edit", label: "Edit (full-screen)", icon: <Pencil className="h-3.5 w-3.5" />, onClick: onEdit,
      disabled: (r) => r.source_system === "COMPLIANCE_LEGACY" },
    { key: "clone", label: "Clone", icon: <Copy className="h-3.5 w-3.5" />, onClick: onClone },
    { key: "sample", label: "Generate Sample", icon: <Sparkles className="h-3.5 w-3.5" />,
      onClick: onGenerateSample, disabled: (r) => !r._has_active_version },
    { key: "history", label: "Version History", icon: <History className="h-3.5 w-3.5" />, onClick: onHistory },
    { key: "publish", label: "Publish", icon: <Power className="h-3.5 w-3.5" />, onClick: onPublish,
      hidden: (r) => r.status === "ACTIVE" },
    { key: "retire", label: "Retire", icon: <PowerOff className="h-3.5 w-3.5" />, onClick: onRetire,
      hidden: (r) => r.status !== "ACTIVE" },
    { key: "delete", label: "Delete Draft", icon: <Trash2 className="h-3.5 w-3.5" />, variant: "destructive",
      onClick: onDeleteDraft, hidden: (r) => r.status !== "DRAFT" },
  ], [onPreview, onEdit, onClone, onGenerateSample, onHistory, onPublish, onRetire, onDeleteDraft]);

  const bulkActions: LgBulkAction<AugmentedTemplate>[] = useMemo(() => [
    { key: "exp", label: "Export Selected", icon: <FileDown className="h-3.5 w-3.5" />, onClick: bulkExport },
    { key: "val", label: "Validate Selected", icon: <CheckCircle2 className="h-3.5 w-3.5" />, onClick: bulkValidate },
    { key: "gen", label: "Generate Sample Previews", icon: <Sparkles className="h-3.5 w-3.5" />, onClick: bulkGenerateSamples },
    { key: "ret", label: "Retire Selected Drafts", icon: <PowerOff className="h-3.5 w-3.5" />,
      variant: "destructive", onClick: bulkRetireDrafts },
  ], [bulkExport, bulkValidate, bulkGenerateSamples, bulkRetireDrafts]);

  const categoryOptions = useMemo(() => {
    const codes = new Set<string>();
    data.forEach((t) => { if (t.template_category) codes.add(t.template_category); });
    categories.forEach((c: any) => codes.add(c.category_code));
    return [{ value: ALL, label: "All categories" }, ...Array.from(codes).sort().map((c) => ({ value: c, label: c }))];
  }, [data, categories]);

  const toolbarFilters = [
    { key: "status", label: "Status", value: fStatus, onChange: setFStatus, options: [
      { value: ALL, label: "All statuses" },
      { value: "DRAFT", label: "Draft" },
      { value: "ACTIVE", label: "Published" },
      { value: "RETIRED", label: "Retired" },
    ]},
    { key: "type", label: "Type", value: fType, onChange: setFType, options: [
      { value: ALL, label: "All types" },
      ...TEMPLATE_TYPES.map((t) => ({ value: t, label: t })),
    ]},
    { key: "category", label: "Category", value: fCategory, onChange: setFCategory, options: categoryOptions },
    { key: "channel", label: "Channel", value: fChannel, onChange: setFChannel, options: [
      { value: ALL, label: "All channels" },
      ...channels.map((c) => ({ value: c.channel_code, label: c.channel_code })),
    ]},
    { key: "layout", label: "Layout", value: fLayout, onChange: setFLayout, options: [
      { value: ALL, label: "All layouts" },
      ...layouts.map((l) => ({ value: l.id, label: l.code })),
    ]},
    { key: "ref", label: "Legal Reference", value: fHasRef, onChange: setFHasRef, options: [
      { value: ALL, label: "Any" },
      { value: "YES", label: "Has reference" },
      { value: "NO", label: "No reference" },
    ]},
    { key: "mc", label: "Missing Channel Variant", value: fMissingChannel, onChange: setFMissingChannel, options: [
      { value: ALL, label: "Any" },
      { value: "YES", label: "Has missing variant" },
      { value: "NO", label: "All channels covered" },
    ]},
  ];

  const summary = [
    { label: "Total", value: data.length, tone: "default" as const },
    { label: "Published", value: data.filter((d) => d.status === "ACTIVE").length, tone: "success" as const },
    { label: "Draft", value: data.filter((d) => d.status === "DRAFT").length, tone: "info" as const },
    { label: "Missing Channel", value: data.filter((d) => d._missing_channels.length > 0).length, tone: "warning" as const },
    { label: "No Legal Refs", value: data.filter((d) => d._ref_count === 0).length, tone: "warning" as const },
    { label: "No Active Version", value: data.filter((d) => !d._has_active_version).length, tone: "danger" as const },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Legal Templates</CardTitle>
        <CardDescription>Standard LgDataGrid listing — filter, validate, publish, and dispatch.</CardDescription>
      </CardHeader>
      <CardContent>
        <LgDataGrid
          id="lg.templates"
          columns={columns}
          data={data}
          isLoading={loading}
          searchPlaceholder="Search by name or code..."
          toolbarFilters={toolbarFilters}
          summary={summary}
          rowActions={rowActions}
          bulkActions={bulkActions}
          onRefresh={onRefresh}
          onCreate={onCreate}
          defaultPageSize={25}
          exportFilename="legal-templates"
          emptyMessage="No templates match the current filters"
        />
      </CardContent>
    </Card>
  );
}


