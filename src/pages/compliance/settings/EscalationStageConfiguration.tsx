/**
 * Administration → Escalation Stage Configuration.
 *
 * The single authoritative source for the active St Kitts escalation sequence
 * (Warning → Demand → Legal eligibility) and for the management arrears
 * threshold (average of the latest N monthly liabilities × multiplier).
 * Notice generation and legal eligibility both consume these rows, so a change
 * here changes runtime behaviour without a deployment.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  listAllStages,
  updateStage,
  type EscalationStageConfig,
} from "@/services/compliance/escalationStageService";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, AlertTriangle } from "lucide-react";

interface ManagementPolicy {
  id: string;
  policy_code: string;
  policy_name: string;
  is_active: boolean;
  history_period_count: number;
  multiplier: number;
  liability_basis: string;
  action_on_breach: string;
  retired_at: string | null;
}

const sb = supabase as any;

export default function EscalationStageConfiguration() {
  const [stages, setStages] = useState<EscalationStageConfig[]>([]);
  const [policies, setPolicies] = useState<ManagementPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [policyDraft, setPolicyDraft] = useState<Record<string, { periods: string; multiplier: string }>>({});

  async function load() {
    setLoading(true);
    try {
      const [s, p] = await Promise.all([
        listAllStages(),
        sb
          .from("ce_management_escalation_policy")
          .select("*")
          .order("is_active", { ascending: false }),
      ]);
      setStages(s);
      setPolicies((p.data || []) as ManagementPolicy[]);
      setDraft(Object.fromEntries(s.map((x) => [x.id, x.delay_days == null ? "" : String(x.delay_days)])));
      setPolicyDraft(
        Object.fromEntries(
          ((p.data || []) as ManagementPolicy[]).map((x) => [
            x.id,
            { periods: String(x.history_period_count), multiplier: String(x.multiplier) },
          ]),
        ),
      );
    } catch (e: any) {
      toast.error("Unable to load escalation configuration", { description: e.message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function saveStage(stage: EscalationStageConfig) {
    setSaving(stage.id);
    try {
      const raw = draft[stage.id];
      const delay = raw === "" ? null : Number(raw);
      if (delay !== null && (!Number.isInteger(delay) || delay < 0 || delay > 3650)) {
        toast.error("Waiting period must be a whole number of days (0–3650)");
        return;
      }
      await updateStage(stage.id, { delay_days: delay }, null);
      toast.success(`${stage.stage_name} updated`, {
        description:
          delay === null
            ? "Waiting period cleared — this stage will not issue notices until configured."
            : `Waiting period set to ${delay} day(s). Runtime picks this up immediately.`,
      });
      load();
    } catch (e: any) {
      toast.error("Update refused", { description: e.message });
    } finally {
      setSaving(null);
    }
  }

  async function toggleStage(stage: EscalationStageConfig, enabled: boolean) {
    try {
      await updateStage(
        stage.id,
        enabled
          ? { is_enabled: true, retired_at: null }
          : { is_enabled: false, retired_at: new Date().toISOString() },
        null,
      );
      toast.success(`${stage.stage_name} ${enabled ? "enabled" : "retired"}`);
      load();
    } catch (e: any) {
      toast.error("Update refused", { description: e.message });
    }
  }

  async function savePolicy(policy: ManagementPolicy) {
    setSaving(policy.id);
    try {
      const d = policyDraft[policy.id];
      const { error } = await sb
        .from("ce_management_escalation_policy")
        .update({
          history_period_count: Number(d.periods),
          multiplier: Number(d.multiplier),
          updated_at: new Date().toISOString(),
        })
        .eq("id", policy.id);
      if (error) throw error;
      toast.success("Management escalation policy updated", {
        description: `Threshold = average of the latest ${d.periods} monthly liabilities × ${d.multiplier}.`,
      });
      load();
    } catch (e: any) {
      toast.error("Update refused", { description: e.message });
    } finally {
      setSaving(null);
    }
  }

  if (loading) return <div className="p-8 text-muted-foreground">Loading…</div>;

  return (
    <div className="flex-1 p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Escalation Stage Configuration</h1>
        <p className="text-sm text-muted-foreground">
          Active sequence: Warning Notice → Demand Notice → Legal eligibility. Notice generation and
          legal eligibility read these rows directly — no timings are held in code.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Escalation stages</CardTitle>
          <CardDescription>
            A stage with no waiting period cannot issue notices; the scheduler reports it as a
            configuration error instead of guessing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Follows</TableHead>
                <TableHead>Waiting period (days)</TableHead>
                <TableHead>Measured from</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Approval</TableHead>
                <TableHead>Active</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {stages.map((s) => (
                <TableRow key={s.id} className={s.is_enabled ? "" : "opacity-60"}>
                  <TableCell>{s.stage_order}</TableCell>
                  <TableCell>
                    <div className="font-medium">{s.stage_name}</div>
                    <div className="text-xs text-muted-foreground">{s.stage_code}</div>
                    {s.retired_reason && (
                      <div className="text-xs text-muted-foreground mt-1">{s.retired_reason}</div>
                    )}
                  </TableCell>
                  <TableCell>{s.prerequisite_stage_code ?? "—"}</TableCell>
                  <TableCell className="w-36">
                    <Input
                      value={draft[s.id] ?? ""}
                      placeholder="not configured"
                      onChange={(e) => setDraft((d) => ({ ...d, [s.id]: e.target.value }))}
                    />
                    {s.delay_days == null && (
                      <div className="flex items-center gap-1 text-xs text-destructive mt-1">
                        <AlertTriangle className="h-3 w-3" />
                        {s.open_decision_code ? `Open decision: ${s.open_decision_code}` : "Not configured"}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{s.delay_basis}</TableCell>
                  <TableCell className="text-xs">{s.notice_template_code ?? "—"}</TableCell>
                  <TableCell>
                    {s.requires_approval ? <Badge>Required</Badge> : <Badge variant="outline">—</Badge>}
                  </TableCell>
                  <TableCell>
                    <Switch checked={s.is_enabled} onCheckedChange={(v) => toggleStage(s, v)} />
                  </TableCell>
                  <TableCell>
                    <Button size="sm" onClick={() => saveStage(s)} disabled={saving === s.id}>
                      {saving === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Management arrears escalation</CardTitle>
          <CardDescription>
            Threshold = average of the latest N valid monthly contribution liabilities × multiplier.
            Breaching the threshold raises a management review — it never refers a case to Legal
            automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {policies.map((p) => (
            <div key={p.id} className="border rounded-md p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{p.policy_name}</div>
                  <div className="text-xs text-muted-foreground">{p.policy_code}</div>
                </div>
                <Badge variant={p.is_active ? "default" : "outline"}>
                  {p.is_active ? "Active" : p.retired_at ? "Retired" : "Inactive"}
                </Badge>
              </div>
              {p.is_active && (
                <div className="flex flex-wrap items-end gap-4">
                  <div>
                    <Label className="text-xs">History periods (N)</Label>
                    <Input
                      className="w-28"
                      value={policyDraft[p.id]?.periods ?? ""}
                      onChange={(e) =>
                        setPolicyDraft((d) => ({
                          ...d,
                          [p.id]: { ...d[p.id], periods: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Multiplier</Label>
                    <Input
                      className="w-28"
                      value={policyDraft[p.id]?.multiplier ?? ""}
                      onChange={(e) =>
                        setPolicyDraft((d) => ({
                          ...d,
                          [p.id]: { ...d[p.id], multiplier: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Basis: {p.liability_basis} · On breach: {p.action_on_breach}
                  </div>
                  <Button size="sm" onClick={() => savePolicy(p)} disabled={saving === p.id}>
                    {saving === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
