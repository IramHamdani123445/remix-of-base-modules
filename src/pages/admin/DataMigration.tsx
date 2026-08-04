import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Database, 
  Download, 
  Upload, 
  Info, 
  CheckCircle, 
  AlertCircle,
  FileJson,
  RefreshCw,
  GitCompare,
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  Minus,
  Plus,
  AlertTriangle,
  X,
  Search,
  Settings2,
  Loader2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";

// ─── Table Import Order (for import) ───
const getTableImportOrder = (tables: string[]): string[] => {
  const priorityPrefixes = [
    "tb_", "roles", "app_", "module_", "role_", "password_", "mfa_", "api_",
    "office_", "department", "designation", "workflow_def", "workflow_step",
    "workflow_", "notification_", "data_", "field_", "profile", "user_",
    "inspector_", "er_", "ip_", "legal_", "compliance_", "bema_", "c3_",
    "contribution_", "audit_", "system_",
  ];
  return [...tables].sort((a, b) => {
    const aPriority = priorityPrefixes.findIndex(p => a.startsWith(p) || a === p.replace("_", ""));
    const bPriority = priorityPrefixes.findIndex(p => b.startsWith(p) || b === p.replace("_", ""));
    const aOrder = aPriority === -1 ? 999 : aPriority;
    const bOrder = bPriority === -1 ? 999 : bPriority;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.localeCompare(b);
  });
};

interface ImportResult {
  table: string;
  success: boolean;
  inserted: number;
  error?: string;
}

// ─── Environment Sync Types ───
interface RecordDiff {
  id: string;
  type: "missing_in_live" | "missing_in_test" | "mismatch";
  testRecord?: Record<string, unknown>;
  liveRecord?: Record<string, unknown>;
  changedFields?: { field: string; testValue: unknown; liveValue: unknown }[];
}

interface TableAnalysis {
  tableName: string;
  pkField?: string;
  testCount: number;
  liveCount: number;
  missingInLive: number;
  missingInTest: number;
  mismatches: number;
  diffs: RecordDiff[];
  error?: string;
}

interface AnalysisResponse {
  success: boolean;
  analyzedAt: string;
  summary: {
    tablesAnalyzed: number;
    tablesWithDiffs: number;
    tablesWithErrors: number;
    totalDiffs: number;
  };
  results: TableAnalysis[];
}

interface SyncResponse {
  success: boolean;
  syncedAt: string;
  summary: {
    totalItems: number;
    successCount: number;
    failCount: number;
    tablesAffected: string[];
  };
  results: { tableName: string; recordId: string; success: boolean; action: string; error?: string }[];
}

interface AnalysisTableRow {
  id: string;
  table_name: string;
  primary_key_field: string;
  category: string | null;
}

// ─── Manage Analysis Tables Sub-Component ───
const ManageAnalysisTables = () => {
  const { toast } = useToast();
  const [analysisTables, setAnalysisTables] = useState<AnalysisTableRow[]>([]);
  const [allPublicTables, setAllPublicTables] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [stagedTables, setStagedTables] = useState<string[]>([]);
  const [radioValue, setRadioValue] = useState("");
  const [searchAvailable, setSearchAvailable] = useState("");

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [tablesRes, publicRes] = await Promise.all([
        supabase.from("migration_analysis_tables" as any).select("*").order("table_name"),
        supabase.rpc("get_all_public_tables" as any),
      ]);
      if (tablesRes.data) setAnalysisTables(tablesRes.data as any[]);
      if (publicRes.data) setAllPublicTables((publicRes.data as any[]).map((t: any) => t.table_name));
    } catch (err) {
      console.error("Failed to load analysis tables:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const existingTableNames = new Set(analysisTables.map(t => t.table_name));
  const stagedSet = new Set(stagedTables);
  const availableTables = allPublicTables
    .filter(t => !existingTableNames.has(t) && !stagedSet.has(t))
    .sort();

  const filteredAvailable = availableTables.filter(t =>
    t.toLowerCase().includes(searchAvailable.toLowerCase())
  );

  const handleRadioSelect = (value: string) => {
    setRadioValue("");
    if (value && !stagedSet.has(value) && !existingTableNames.has(value)) {
      setStagedTables(prev => [...prev, value]);
    }
  };

  const handleRemoveFromStaging = (table: string) => {
    setStagedTables(prev => prev.filter(t => t !== table));
  };

  const handleBatchAdd = async () => {
    if (stagedTables.length === 0) return;
    setIsAdding(true);
    try {
      const inserts = stagedTables.map(t => ({
        table_name: t,
        primary_key_field: "id",
      }));
      const { error } = await supabase.from("migration_analysis_tables" as any).insert(inserts as any);
      if (error) throw error;

      // Audit log
      try {
        const { data: { user } } = await supabase.auth.getUser();
        await supabase.from("system_audit_trail").insert({
          action: "add_analysis_tables",
          entity_type: "migration_analysis_tables",
          entity_id: `batch-${Date.now()}`,
          module: "admin",
          user_id: user?.id,
          user_name: user?.email?.split("@")[0]?.substring(0, 5) || "SYSTEM",
          after_value: { tables: stagedTables },
          severity: "info",
        });
      } catch (auditErr) {
        console.error("Audit log failed:", auditErr);
      }

      toast({ title: "Tables Added", description: `${stagedTables.length} table(s) added to analysis list` });
      setStagedTables([]);
      await fetchData();
    } catch (err: any) {
      toast({ title: "Failed to add tables", description: err.message, variant: "destructive" });
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemove = async (row: AnalysisTableRow) => {
    setRemovingId(row.id);
    try {
      const { error } = await supabase.from("migration_analysis_tables" as any).delete().eq("id", row.id);
      if (error) throw error;

      // Audit log
      try {
        const { data: { user } } = await supabase.auth.getUser();
        await supabase.from("system_audit_trail").insert({
          action: "remove_analysis_table",
          entity_type: "migration_analysis_tables",
          entity_id: row.id,
          module: "admin",
          user_id: user?.id,
          user_name: user?.email?.split("@")[0]?.substring(0, 5) || "SYSTEM",
          before_value: { table_name: row.table_name },
          severity: "info",
        });
      } catch (auditErr) {
        console.error("Audit log failed:", auditErr);
      }

      toast({ title: "Table Removed", description: `${row.table_name} removed from analysis list` });
      await fetchData();
    } catch (err: any) {
      toast({ title: "Failed to remove table", description: err.message, variant: "destructive" });
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <Card>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <div className="flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/50 rounded-t-lg">
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <Settings2 className="h-5 w-5 text-primary" />
            <div className="flex-1">
              <h3 className="font-semibold text-sm">Manage Analysis Tables</h3>
              <p className="text-xs text-muted-foreground">
                Add or remove tables from the environment sync analysis list ({analysisTables.length} tables configured)
              </p>
            </div>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 space-y-4">
            {isLoading ? (
              <div className="text-sm text-muted-foreground text-center py-4">Loading...</div>
            ) : (
              <>
                {/* Two-panel layout */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Left Panel — Available Tables */}
                  <div className="border rounded-lg">
                    <div className="p-3 border-b bg-muted/30">
                      <h4 className="text-sm font-medium mb-2">Available Tables ({filteredAvailable.length})</h4>
                      <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search tables..."
                          value={searchAvailable}
                          onChange={(e) => setSearchAvailable(e.target.value)}
                          className="pl-8 h-9"
                        />
                      </div>
                    </div>
                    <ScrollArea className="h-[280px]">
                      <RadioGroup value={radioValue} onValueChange={handleRadioSelect} className="p-2 space-y-0.5">
                        {filteredAvailable.length === 0 ? (
                          <div className="text-center py-6 text-sm text-muted-foreground">
                            {searchAvailable ? `No tables match "${searchAvailable}"` : "All tables are already configured or staged"}
                          </div>
                        ) : (
                          filteredAvailable.map(t => (
                            <div
                              key={t}
                              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                              onClick={() => handleRadioSelect(t)}
                            >
                              <RadioGroupItem value={t} id={`avail-${t}`} />
                              <Label htmlFor={`avail-${t}`} className="text-sm font-mono cursor-pointer flex-1">{t}</Label>
                            </div>
                          ))
                        )}
                      </RadioGroup>
                    </ScrollArea>
                  </div>

                  {/* Right Panel — Staged (Shortlisted) */}
                  <div className="border rounded-lg">
                    <div className="p-3 border-b bg-muted/30 flex items-center justify-between">
                      <h4 className="text-sm font-medium">Shortlisted for Addition ({stagedTables.length})</h4>
                      {stagedTables.length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-destructive hover:text-destructive"
                          onClick={() => setStagedTables([])}
                        >
                          Clear All
                        </Button>
                      )}
                    </div>
                    <ScrollArea className="h-[230px]">
                      {stagedTables.length === 0 ? (
                        <div className="text-center py-10 text-sm text-muted-foreground">
                          <Plus className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                          Select tables from the left panel
                        </div>
                      ) : (
                        <div className="p-2 space-y-1">
                          {stagedTables.map(t => (
                            <div key={t} className="flex items-center justify-between px-2 py-1.5 rounded bg-primary/5 border border-primary/20">
                              <span className="text-sm font-mono">{t}</span>
                              <button
                                onClick={() => handleRemoveFromStaging(t)}
                                className="rounded-full hover:bg-destructive/20 p-0.5 transition-colors"
                                title={`Remove ${t}`}
                              >
                                <X className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </ScrollArea>
                    <div className="p-3 border-t">
                      <Button
                        className="w-full"
                        onClick={handleBatchAdd}
                        disabled={stagedTables.length === 0 || isAdding}
                      >
                        {isAdding ? (
                          <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Adding...</>
                        ) : (
                          <><Plus className="h-4 w-4 mr-1" />Add {stagedTables.length > 0 ? `${stagedTables.length} Table${stagedTables.length > 1 ? "s" : ""}` : "Tables"}</>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Already Configured Tables */}
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground mb-2">
                    Configured Tables ({analysisTables.length})
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {analysisTables.map(row => (
                      <Badge
                        key={row.id}
                        variant="outline"
                        className="text-xs font-mono flex items-center gap-1 pr-1"
                      >
                        {row.table_name}
                        <button
                          onClick={() => handleRemove(row)}
                          disabled={removingId === row.id}
                          className="ml-1 rounded-full hover:bg-destructive/20 p-0.5 transition-colors"
                          title={`Remove ${row.table_name}`}
                        >
                          {removingId === row.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                          )}
                        </button>
                      </Badge>
                    ))}
                    {analysisTables.length === 0 && (
                      <p className="text-sm text-muted-foreground">No tables configured. Add tables above to enable analysis.</p>
                    )}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};

// ─── Helpers to detect missing tables ───
const isMissingTableError = (error?: string) =>
  error && error.toLowerCase().includes("does not exist");

const getMissingSide = (error?: string): "test" | "live" | null => {
  if (!error) return null;
  if (error.startsWith("Test DB error")) return "test";
  if (error.startsWith("Live DB error")) return "live";
  return null;
};

// ─── Environment Sync Component ───
const EnvironmentSyncTab = () => {
  const { toast } = useToast();
  const { user } = useSupabaseAuth();

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResponse | null>(null);
  const [selectedDiffs, setSelectedDiffs] = useState<Set<string>>(new Set());
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  const [isSyncing, setIsSyncing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResponse | null>(null);
  const [syncProgress, setSyncProgress] = useState(0);



  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    setAnalysisResult(null);
    setSelectedDiffs(new Set());
    setSyncResult(null);

    try {
      const { data, error } = await supabase.functions.invoke("data-migration-analyze", {
        body: {},
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      setAnalysisResult(data as AnalysisResponse);
      
      const tablesWithDiffs = new Set(
        (data as AnalysisResponse).results
          .filter(r => r.diffs.length > 0)
          .map(r => r.tableName)
      );
      setExpandedTables(tablesWithDiffs);

      toast({
        title: "Analysis Complete",
        description: `${data.summary.totalDiffs} discrepancies found across ${data.summary.tablesWithDiffs} tables`,
      });
    } catch (err: any) {
      console.error("Analysis error:", err);
      toast({
        title: "Analysis Failed",
        description: err.message || "An error occurred during analysis",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const getDiffKey = (tableName: string, recordId: string) => `${tableName}::${recordId}`;

  const toggleDiff = (tableName: string, recordId: string) => {
    const key = getDiffKey(tableName, recordId);
    setSelectedDiffs(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleTable = (tableName: string, diffs: RecordDiff[]) => {
    const syncableDiffs = diffs.filter(d => d.type !== "missing_in_test");
    const allSelected = syncableDiffs.every(d => selectedDiffs.has(getDiffKey(tableName, d.id)));
    
    setSelectedDiffs(prev => {
      const next = new Set(prev);
      for (const d of syncableDiffs) {
        const key = getDiffKey(tableName, d.id);
        if (allSelected) next.delete(key);
        else next.add(key);
      }
      return next;
    });
  };

  const selectAllSyncable = () => {
    if (!analysisResult) return;
    const next = new Set<string>();
    for (const table of analysisResult.results) {
      for (const d of table.diffs) {
        if (d.type !== "missing_in_test") {
          next.add(getDiffKey(table.tableName, d.id));
        }
      }
    }
    setSelectedDiffs(next);
  };

  const clearSelection = () => setSelectedDiffs(new Set());

  const toggleExpand = (tableName: string) => {
    setExpandedTables(prev => {
      const next = new Set(prev);
      if (next.has(tableName)) next.delete(tableName);
      else next.add(tableName);
      return next;
    });
  };

  const handleSync = async () => {
    setShowConfirm(false);
    setIsSyncing(true);
    setSyncProgress(10);
    setSyncResult(null);

    try {
      if (!analysisResult) throw new Error("No analysis data");

      const items: { tableName: string; recordId: string; type: string; testRecord: Record<string, unknown>; primaryKeyField?: string }[] = [];

      for (const table of analysisResult.results) {
        for (const diff of table.diffs) {
          const key = getDiffKey(table.tableName, diff.id);
          if (selectedDiffs.has(key) && diff.type !== "missing_in_test" && diff.testRecord) {
            items.push({
              tableName: table.tableName,
              recordId: diff.id,
              type: diff.type,
              testRecord: diff.testRecord,
              primaryKeyField: table.pkField || "id",
            });
          }
        }
      }

      if (items.length === 0) {
        toast({ title: "Nothing to sync", description: "No syncable items selected", variant: "destructive" });
        setIsSyncing(false);
        return;
      }

      setSyncProgress(30);

      const { data, error } = await supabase.functions.invoke("data-migration-sync", {
        body: {
          items,
          userId: user?.id,
          userCode: user?.email?.split("@")[0]?.substring(0, 5) || "ADMIN",
        },
      });

      setSyncProgress(90);

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      setSyncResult(data as SyncResponse);
      setSyncProgress(100);

      const summary = (data as SyncResponse).summary;
      toast({
        title: "Sync Complete",
        description: `${summary.successCount} records synced successfully${summary.failCount > 0 ? `, ${summary.failCount} failed` : ""}`,
        variant: summary.failCount > 0 ? "destructive" : "default",
      });
    } catch (err: any) {
      console.error("Sync error:", err);
      toast({
        title: "Sync Failed",
        description: err.message || "An error occurred during sync",
        variant: "destructive",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const selectedCount = selectedDiffs.size;
  const totalSyncable = analysisResult
    ? analysisResult.results.reduce(
        (sum, r) => sum + r.diffs.filter(d => d.type !== "missing_in_test").length,
        0
      )
    : 0;

  const getDiffTypeBadge = (type: RecordDiff["type"]) => {
    switch (type) {
      case "missing_in_live":
        return <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30"><Plus className="h-3 w-3 mr-1" />Missing in Live</Badge>;
      case "missing_in_test":
        return <Badge className="bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30"><Minus className="h-3 w-3 mr-1" />Extra in Live</Badge>;
      case "mismatch":
        return <Badge className="bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30"><AlertTriangle className="h-3 w-3 mr-1" />Mismatch</Badge>;
    }
  };

  return (
    <div className="space-y-4">
      {/* Manage Analysis Tables */}
      <ManageAnalysisTables />

      {/* Action Bar */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <GitCompare className="h-6 w-6 text-primary" />
              <div>
                <h3 className="font-semibold">Test → Live Environment Sync</h3>
                <p className="text-sm text-muted-foreground">
                  Compare configuration and master data between test and live databases
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={handleAnalyze} disabled={isAnalyzing}>
                {isAnalyzing ? (
                  <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Analyzing...</>
                ) : (
                  <><GitCompare className="h-4 w-4 mr-2" />Analyze Differences</>
                )}
              </Button>
              {analysisResult && selectedCount > 0 && (
                <Button 
                  variant="default" 
                  onClick={() => setShowConfirm(true)} 
                  disabled={isSyncing}
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {isSyncing ? (
                    <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Syncing...</>
                  ) : (
                    <><ArrowRightLeft className="h-4 w-4 mr-2" />Sync {selectedCount} Record{selectedCount > 1 ? "s" : ""}</>
                  )}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sync Progress */}
      {isSyncing && (
        <Card>
          <CardContent className="pt-6">
            <Progress value={syncProgress} />
            <p className="text-xs text-center text-muted-foreground mt-2">{syncProgress}% complete</p>
          </CardContent>
        </Card>
      )}

      {/* Sync Result */}
      {syncResult && (
        <Card className={syncResult.summary.failCount > 0 ? "border-destructive/30" : "border-green-500/30"}>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {syncResult.summary.failCount > 0 ? (
                <AlertCircle className="h-5 w-5 text-destructive" />
              ) : (
                <CheckCircle className="h-5 w-5 text-green-600" />
              )}
              Sync Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="text-center p-3 rounded-lg bg-muted">
                <div className="text-2xl font-bold">{syncResult.summary.totalItems}</div>
                <div className="text-xs text-muted-foreground">Total</div>
              </div>
              <div className="text-center p-3 rounded-lg bg-green-50 dark:bg-green-950">
                <div className="text-2xl font-bold text-green-700 dark:text-green-400">{syncResult.summary.successCount}</div>
                <div className="text-xs text-muted-foreground">Succeeded</div>
              </div>
              <div className="text-center p-3 rounded-lg bg-red-50 dark:bg-red-950">
                <div className="text-2xl font-bold text-destructive">{syncResult.summary.failCount}</div>
                <div className="text-xs text-muted-foreground">Failed</div>
              </div>
            </div>
            {syncResult.results.filter(r => !r.success).length > 0 && (
              <div className="space-y-1">
                <h4 className="text-sm font-medium text-destructive">Failed Items:</h4>
                {syncResult.results.filter(r => !r.success).map((r, i) => (
                  <div key={i} className="text-xs text-destructive bg-destructive/5 p-2 rounded">
                    <strong>{r.tableName}</strong> [{r.recordId}]: {r.error}
                  </div>
                ))}
              </div>
            )}
            <Button variant="outline" className="mt-4 w-full" onClick={handleAnalyze} disabled={isAnalyzing}>
              <RefreshCw className="h-4 w-4 mr-2" />Re-analyze to Verify
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Analysis Summary */}
      {analysisResult && (
        <>
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-4 gap-4 mb-4">
                <div className="text-center p-3 rounded-lg bg-muted">
                  <div className="text-2xl font-bold">{analysisResult.summary.tablesAnalyzed}</div>
                  <div className="text-xs text-muted-foreground">Tables Analyzed</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted">
                  <div className="text-2xl font-bold">{analysisResult.summary.tablesWithDiffs}</div>
                  <div className="text-xs text-muted-foreground">With Differences</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted">
                  <div className="text-2xl font-bold">{analysisResult.summary.totalDiffs}</div>
                  <div className="text-xs text-muted-foreground">Total Discrepancies</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted">
                  <div className="text-2xl font-bold">{selectedCount}/{totalSyncable}</div>
                  <div className="text-xs text-muted-foreground">Selected to Sync</div>
                </div>
              </div>
              {totalSyncable > 0 && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={selectAllSyncable}>Select All Syncable</Button>
                  <Button variant="outline" size="sm" onClick={clearSelection}>Clear Selection</Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Table-by-table results */}
          <div className="space-y-2">
            {analysisResult.results
              .filter(r => r.diffs.length > 0 || r.error)
              .map(table => {
                const syncableDiffs = table.diffs.filter(d => d.type !== "missing_in_test");
                const allTableSelected = syncableDiffs.length > 0 && syncableDiffs.every(d => selectedDiffs.has(getDiffKey(table.tableName, d.id)));
                const someTableSelected = syncableDiffs.some(d => selectedDiffs.has(getDiffKey(table.tableName, d.id)));
                const isExpanded = expandedTables.has(table.tableName);
                const missingTable = isMissingTableError(table.error);
                const missingSide = getMissingSide(table.error);
                

                return (
                  <Card key={table.tableName} className={table.error ? "border-destructive/30" : ""}>
                    <Collapsible open={isExpanded} onOpenChange={() => toggleExpand(table.tableName)}>
                      <CollapsibleTrigger asChild>
                        <div className="flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/50 rounded-t-lg">
                          {syncableDiffs.length > 0 && (
                            <Checkbox
                              checked={allTableSelected}
                              ref={el => {
                                if (el && someTableSelected && !allTableSelected) {
                                  (el as any).indeterminate = true;
                                }
                              }}
                              onCheckedChange={(e) => {
                                e;
                                toggleTable(table.tableName, table.diffs);
                              }}
                              onClick={(e) => e.stopPropagation()}
                            />
                          )}
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          <span className="font-mono text-sm font-medium">{table.tableName}</span>
                          <div className="flex items-center gap-2 ml-auto">
                            {table.error && !missingTable && (
                              <Badge variant="destructive" className="text-xs">{table.error.substring(0, 40)}</Badge>
                            )}
                            {missingTable && missingSide && (
                              <Badge className="bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/30 text-xs">
                                <Database className="h-3 w-3 mr-1" />
                                Missing in {missingSide === "test" ? "Test" : "Live"}
                              </Badge>
                            )}


                            {table.missingInLive > 0 && (
                              <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30 text-xs">
                                +{table.missingInLive} missing
                              </Badge>
                            )}
                            {table.mismatches > 0 && (
                              <Badge className="bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30 text-xs">
                                {table.mismatches} changed
                              </Badge>
                            )}
                            {table.missingInTest > 0 && (
                              <Badge className="bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30 text-xs">
                                {table.missingInTest} extra in live
                              </Badge>
                            )}
                            <span className="text-xs text-muted-foreground">
                              Test: {table.testCount} / Live: {table.liveCount}
                            </span>
                          </div>
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="border-t px-4 pb-4 pt-2 space-y-2">
                          {/* Missing table: read-only notice. Browser-driven DDL retired (BN Phase 0 security closure). */}
                          {missingTable && missingSide && (
                            <div className="p-4 rounded-lg border border-purple-500/30 bg-purple-500/5 space-y-3">
                              <div className="flex items-center gap-2">
                                <AlertTriangle className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                                <span className="text-sm font-medium">
                                  Table <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">{table.tableName}</code> does not exist in the <strong>{missingSide === "test" ? "Test" : "Live"}</strong> database.
                                </span>
                              </div>
                              <Alert className="border-purple-500/30">
                                <AlertCircle className="h-4 w-4" />
                                <AlertDescription className="text-xs">
                                  Creating tables from this screen has been permanently disabled. Cross-environment
                                  schema changes must be applied through the controlled migration process, not from
                                  the browser. Environment comparison here remains read-only.
                                </AlertDescription>
                              </Alert>
                            </div>
                          )}


                          {/* Normal diff rows */}
                          {table.diffs.map(diff => {
                            const key = getDiffKey(table.tableName, diff.id);
                            const isSyncable = diff.type !== "missing_in_test";
                            const isSelected = selectedDiffs.has(key);

                            return (
                              <div
                                key={diff.id}
                                className={`flex items-start gap-3 p-3 rounded-lg border text-sm ${
                                  isSelected ? "border-primary/40 bg-primary/5" : "border-border"
                                }`}
                              >
                                {isSyncable && (
                                  <Checkbox
                                    checked={isSelected}
                                    onCheckedChange={() => toggleDiff(table.tableName, diff.id)}
                                    className="mt-0.5"
                                  />
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-mono text-xs text-muted-foreground truncate max-w-[200px]">{diff.id}</span>
                                    {getDiffTypeBadge(diff.type)}
                                  </div>
                                  {diff.type === "mismatch" && diff.changedFields && (
                                    <div className="mt-2 space-y-1">
                                      {diff.changedFields.map(cf => (
                                        <div key={cf.field} className="text-xs grid grid-cols-3 gap-2">
                                          <span className="font-medium text-muted-foreground">{cf.field}</span>
                                          <span className="text-green-700 dark:text-green-400 truncate" title={String(cf.testValue)}>
                                            Test: {cf.testValue === null ? <em>null</em> : String(cf.testValue).substring(0, 60)}
                                          </span>
                                          <span className="text-red-700 dark:text-red-400 truncate" title={String(cf.liveValue)}>
                                            Live: {cf.liveValue === null ? <em>null</em> : String(cf.liveValue).substring(0, 60)}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {diff.type === "missing_in_live" && diff.testRecord && (
                                    <div className="mt-1 text-xs text-muted-foreground">
                                      {Object.entries(diff.testRecord)
                                        .filter(([k]) => !["created_at", "updated_at"].includes(k))
                                        .slice(0, 5)
                                        .map(([k, v]) => (
                                          <span key={k} className="inline-block mr-3">
                                            <span className="font-medium">{k}:</span> {String(v).substring(0, 30)}
                                          </span>
                                        ))}
                                    </div>
                                  )}
                                  {diff.type === "missing_in_test" && (
                                    <div className="mt-1 text-xs text-blue-600 dark:text-blue-400">
                                      This record exists in Live but not in Test (will not be deleted)
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </Card>
                );
              })}

            {/* Tables with no diffs */}
            {analysisResult.results.filter(r => r.diffs.length === 0 && !r.error).length > 0 && (
              <Card>
                <CardContent className="pt-6">
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    Tables in Sync ({analysisResult.results.filter(r => r.diffs.length === 0 && !r.error).length})
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {analysisResult.results
                      .filter(r => r.diffs.length === 0 && !r.error)
                      .map(r => (
                        <Badge key={r.tableName} variant="outline" className="text-xs font-mono">
                          {r.tableName} ({r.testCount})
                        </Badge>
                      ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}

      {/* Confirmation Dialog */}
      <ConfirmDialog
        open={showConfirm}
        onOpenChange={setShowConfirm}
        title="Confirm Sync to Live"
        description={`You are about to push ${selectedCount} selected record(s) from the Test database to the Live database. This will insert missing records and update mismatched records in Live. This action cannot be undone. Are you sure you want to proceed?`}
        confirmLabel={`Yes, Sync ${selectedCount} Records`}
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={handleSync}
        isLoading={isSyncing}
      />
    </div>
  );
};

// ─── Config table prefixes for quick filter ───
const CONFIG_PREFIXES = ["app_", "module_", "role", "password_", "mfa_", "api_", "tb_", "c3_", "workflow_", "security_", "data_scope_", "field_security_"];

// ─── Main DataMigration Component ───
const DataMigration = () => {
  const { toast } = useToast();
  const { user } = useSupabaseAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [allTables, setAllTables] = useState<string[]>([]);
  const [isLoadingTables, setIsLoadingTables] = useState(true);
  
  useEffect(() => {
    const fetchTables = async () => {
      try {
        const { data, error } = await supabase.rpc('get_all_public_tables');
        if (error) throw error;
        setAllTables((data || []).map((t: { table_name: string }) => t.table_name));
      } catch (err) {
        console.error('Failed to fetch tables:', err);
        setAllTables([]);
      } finally {
        setIsLoadingTables(false);
      }
    };
    fetchTables();
  }, []);
  
  // Individual table selection for Export/Import — all unchecked by default
  const [selectedTables, setSelectedTables] = useState<string[]>([]);

  const selectedSet = useMemo(() => new Set(selectedTables), [selectedTables]);

  const [tableSearch, setTableSearch] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [exportComplete, setExportComplete] = useState(false);
  const [lastExportCount, setLastExportCount] = useState(0);

  const availableForExport = useMemo(() => 
    allTables.filter(t => !selectedSet.has(t)).sort(),
    [allTables, selectedSet]
  );

  const filteredForExport = useMemo(() =>
    availableForExport.filter(t => t.toLowerCase().includes(tableSearch.toLowerCase())),
    [availableForExport, tableSearch]
  );

  const handleSelectToExport = (table: string) => {
    setSelectedTables(prev => prev.includes(table) ? prev : [...prev, table]);
  };
  const handleDeselectFromExport = (table: string) => {
    setSelectedTables(prev => prev.filter(t => t !== table));
  };
  const handleSelectAll = () => setSelectedTables([...allTables]);
  const handleSelectNone = () => setSelectedTables([]);
  const handleSelectConfig = () => {
    const configTables = allTables.filter(t => 
      CONFIG_PREFIXES.some(p => t.startsWith(p)) || t === "roles"
    );
    setSelectedTables(configTables);
  };
  
  const handleRefreshTables = async () => {
    setIsLoadingTables(true);
    try {
      const { data, error } = await supabase.rpc('get_all_public_tables');
      if (error) throw error;
      const tables = (data || []).map((t: { table_name: string }) => t.table_name);
      setAllTables(tables);
      setSelectedTables([]);
      toast({ title: "Tables Refreshed", description: `Found ${data?.length || 0} tables` });
    } catch (err) {
      console.error('Failed to fetch tables:', err);
      toast({ title: "Refresh Failed", variant: "destructive" });
    } finally {
      setIsLoadingTables(false);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    setExportComplete(false);
    try {
      const tables = selectedTables;
      const exportData: Record<string, any> = {
        version: "1.0",
        exportedAt: new Date().toISOString(),
        exportedBy: user?.email || "unknown",
        projectId: import.meta.env.VITE_SUPABASE_PROJECT_ID || "unknown",
        tableOrder: tables,
        meta: {},
        data: {},
      };
      let totalRecords = 0;
      for (const table of tables) {
        try {
          const { data, error } = await supabase.from(table as any).select("*");
          if (error) {
            exportData.meta[table] = { count: 0, error: error.message };
            exportData.data[table] = [];
          } else {
            exportData.meta[table] = { count: data?.length || 0 };
            exportData.data[table] = data || [];
            totalRecords += data?.length || 0;
          }
        } catch (err) {
          exportData.meta[table] = { count: 0, error: "Export failed" };
          exportData.data[table] = [];
        }
      }
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `seed-data-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setLastExportCount(totalRecords);
      setExportComplete(true);
      toast({ title: "Export Complete", description: `Exported ${tables.length} tables with ${totalRecords} records` });
    } catch (error) {
      console.error("Export error:", error);
      toast({ title: "Export Failed", description: "An error occurred during export", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setImportFile(file);
      setImportResults([]);
    }
  };

  const handleImport = async () => {
    if (!importFile) return;
    setIsImporting(true);
    setImportProgress(0);
    setImportResults([]);
    try {
      const text = await importFile.text();
      const data = JSON.parse(text);
      if (!data.tableOrder || !data.data) throw new Error("Invalid export file format");
      setImportProgress(20);
      const { data: response, error } = await supabase.functions.invoke("import-seed-data", {
        body: { seedData: data },
      });
      setImportProgress(80);
      if (error) throw new Error(error.message);
      const results: ImportResult[] = [];
      if (response?.results) {
        for (const [table, result] of Object.entries(response.results as Record<string, { success: number; errors: string[] }>)) {
          results.push({
            table,
            success: result.errors.length === 0,
            inserted: result.success,
            error: result.errors.length > 0 ? result.errors.join("; ") : undefined,
          });
        }
      }
      const importOrder = getTableImportOrder(results.map(r => r.table));
      results.sort((a, b) => importOrder.indexOf(a.table) - importOrder.indexOf(b.table));
      setImportResults(results);
      setImportProgress(100);
      const successCount = results.filter(r => r.success && r.inserted > 0).length;
      const failCount = results.filter(r => !r.success).length;
      const totalRecords = results.reduce((sum, r) => sum + r.inserted, 0);
      toast({
        title: "Import Complete",
        description: `${successCount} tables imported with ${totalRecords} total records${failCount > 0 ? `, ${failCount} had errors` : ""}`,
        variant: failCount > 0 ? "destructive" : "default",
      });
    } catch (error: any) {
      console.error("Import error:", error);
      toast({ title: "Import Failed", description: error.message || "An error occurred during import", variant: "destructive" });
    } finally {
      setIsImporting(false);
    }
  };

  const handleLoadSeedFile = async () => {
    try {
      const response = await fetch("/seed-data-2026-01-12-2.json");
      if (!response.ok) throw new Error("Failed to load seed file");
      const blob = await response.blob();
      const file = new File([blob], "seed-data-2026-01-12-2.json", { type: "application/json" });
      setImportFile(file);
      setImportResults([]);
      toast({ title: "Seed File Loaded", description: "The seed data file is ready to import" });
    } catch (error: any) {
      toast({ title: "Load Failed", description: error.message || "Failed to load seed file", variant: "destructive" });
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Database className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-3xl font-bold text-foreground">Data Migration</h1>
          <p className="text-muted-foreground">
            Export, import, and sync database data across environments
          </p>
        </div>
      </div>

      <Tabs defaultValue="export-import">
        <TabsList>
          <TabsTrigger value="export-import">Export / Import</TabsTrigger>
          <TabsTrigger value="env-sync">
            <GitCompare className="h-4 w-4 mr-1" />
            Environment Sync
          </TabsTrigger>
        </TabsList>

        <TabsContent value="export-import" className="space-y-6">
          {/* Instructions Card */}
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                <div className="space-y-2">
                  <h3 className="font-semibold">How to use</h3>
                  <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                    <li><strong>Export:</strong> Select individual tables and click "Export Data" to download a JSON file</li>
                    <li><strong>Import:</strong> Upload a JSON file and click "Start Import"</li>
                    <li>Use quick filters to select <span className="text-primary font-medium">Config Only</span> tables for migration</li>
                  </ol>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Export Section — Two Panel */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Download className="h-5 w-5" />Export Data</CardTitle>
                <CardDescription>Select tables to export — shortlisted tables appear on the right</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={handleSelectAll} disabled={isLoadingTables}>Select All</Button>
                  <Button variant="outline" size="sm" onClick={handleSelectNone} disabled={isLoadingTables}>Select None</Button>
                  <Button variant="outline" size="sm" onClick={handleSelectConfig} disabled={isLoadingTables}>Config Only</Button>
                  <Button variant="outline" size="sm" onClick={handleRefreshTables} disabled={isLoadingTables}>
                    <RefreshCw className={`h-4 w-4 mr-1 ${isLoadingTables ? 'animate-spin' : ''}`} />Refresh
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Left Panel — Available Tables */}
                  <div className="border rounded-lg">
                    <div className="p-3 border-b bg-muted/30">
                      <h4 className="text-sm font-medium mb-2">Available Tables ({availableForExport.length})</h4>
                      <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search tables..."
                          value={tableSearch}
                          onChange={(e) => setTableSearch(e.target.value)}
                          className="pl-8 h-9"
                        />
                      </div>
                    </div>
                    <ScrollArea className="h-[300px]">
                      <div className="p-2 space-y-0.5">
                        {isLoadingTables ? (
                          <div className="text-center py-4 text-muted-foreground">Loading tables...</div>
                        ) : filteredForExport.length === 0 ? (
                          <div className="text-center py-6 text-sm text-muted-foreground">
                            {tableSearch ? `No tables match "${tableSearch}"` : "All tables have been selected"}
                          </div>
                        ) : (
                          filteredForExport.map(t => (
                            <div
                              key={t}
                              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                              onClick={() => handleSelectToExport(t)}
                            >
                              <Checkbox checked={false} onCheckedChange={() => handleSelectToExport(t)} />
                              <span className="text-sm font-mono">{t}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </div>

                  {/* Right Panel — Selected for Export */}
                  <div className="border rounded-lg">
                    <div className="p-3 border-b bg-muted/30 flex items-center justify-between">
                      <h4 className="text-sm font-medium">Selected for Export ({selectedTables.length})</h4>
                      {selectedTables.length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-destructive hover:text-destructive"
                          onClick={handleSelectNone}
                        >
                          Clear All
                        </Button>
                      )}
                    </div>
                    <ScrollArea className="h-[250px]">
                      {selectedTables.length === 0 ? (
                        <div className="text-center py-10 text-sm text-muted-foreground">
                          <Download className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                          Select tables from the left panel
                        </div>
                      ) : (
                        <div className="p-2 space-y-1">
                          {[...selectedTables].sort().map(t => (
                            <div key={t} className="flex items-center justify-between px-2 py-1.5 rounded bg-primary/5 border border-primary/20">
                              <span className="text-sm font-mono">{t}</span>
                              <button
                                onClick={() => handleDeselectFromExport(t)}
                                className="rounded-full hover:bg-destructive/20 p-0.5 transition-colors"
                                title={`Remove ${t}`}
                              >
                                <X className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </ScrollArea>
                    <div className="p-3 border-t">
                      <Button className="w-full" onClick={handleExport} disabled={isExporting || selectedTables.length === 0}>
                        {isExporting ? <>Exporting...</> : <><Download className="mr-2 h-4 w-4" />Export {selectedTables.length > 0 ? `${selectedTables.length} Tables` : "Data"}</>}
                      </Button>
                    </div>
                  </div>
                </div>

                {exportComplete && (
                  <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <AlertDescription className="text-green-800 dark:text-green-200">
                      Export Complete - Exported {lastExportCount} records successfully
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            {/* Import Section */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Upload className="h-5 w-5" />Import Data</CardTitle>
                <CardDescription>Upload an exported JSON file to import data</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button variant="outline" className="w-full mb-4" onClick={handleLoadSeedFile}>
                  <FileJson className="mr-2 h-4 w-4" />Load Seed Data File
                </Button>
                <div
                  className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input ref={fileInputRef} type="file" accept=".json" onChange={handleFileSelect} className="hidden" />
                  <FileJson className="h-12 w-12 mx-auto text-primary/60 mb-3" />
                  {importFile ? (
                    <p className="text-sm font-medium">{importFile.name}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">Click to select a <span className="text-primary font-medium">JSON</span> file</p>
                  )}
                </div>
                <Button className="w-full" onClick={handleImport} disabled={isImporting || !importFile}>
                  {isImporting ? <>Importing...</> : <><Upload className="mr-2 h-4 w-4" />Start Import</>}
                </Button>
                {isImporting && (
                  <div className="space-y-2">
                    <Progress value={importProgress} />
                    <p className="text-xs text-center text-muted-foreground">{importProgress}% complete</p>
                  </div>
                )}
                {importResults.length > 0 && (
                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    <h4 className="font-medium text-sm">Import Results:</h4>
                    {importResults.map((result) => (
                      <div
                        key={result.table}
                        className={`flex items-center justify-between p-2 rounded text-sm ${
                          result.success ? "bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-200" : "bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-200"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {result.success ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                          <span>{result.table}</span>
                        </div>
                        <span>{result.success ? `${result.inserted} records` : result.error?.substring(0, 50)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="env-sync">
          <EnvironmentSyncTab />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default DataMigration;
