import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { 
  Settings, 
  Calendar, 
  DollarSign, 
  AlertCircle,
  Save,
  History,
  Plus,
  CheckCircle2,
  XCircle,
  Loader2
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchCompliancePolicies,
  fetchActiveCompliancePolicy,
  updateCompliancePolicy,
  activateNewPolicy,
  CompliancePolicyRow,
} from "@/services/compliancePolicyService";
import { format } from "date-fns";
import { ObligationReminderRulesCard } from "@/components/compliance/settings/ObligationReminderRulesCard";
import { PartialPaymentPolicyCard } from "@/components/compliance/settings/PartialPaymentPolicyCard";


export default function ComplianceSettings() {
  const queryClient = useQueryClient();
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);
  const [showNewPolicyDialog, setShowNewPolicyDialog] = useState(false);
  const [newPolicyEffectiveFrom, setNewPolicyEffectiveFrom] = useState('');
  const [newPolicyNotes, setNewPolicyNotes] = useState('');
  const [formData, setFormData] = useState<Partial<CompliancePolicyRow>>({});
  const [formDirty, setFormDirty] = useState(false);

  const { data: activePolicy, isLoading: loadingActive } = useQuery({
    queryKey: ['ce_compliance_policies', 'active'],
    queryFn: fetchActiveCompliancePolicy,
    meta: { onSettled: (_: any, err: any) => { if (err) toast.error('Failed to load active policy'); } },
  });

  const { data: allPolicies = [], isLoading: loadingHistory } = useQuery({
    queryKey: ['ce_compliance_policies'],
    queryFn: fetchCompliancePolicies,
  });

  // Sync form when active policy loads
  const currentFormPolicyId = (formData as any)?.id;
  if (activePolicy && activePolicy.id !== currentFormPolicyId && !formDirty) {
    setFormData(activePolicy);
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!activePolicy) throw new Error('No active policy');
      return updateCompliancePolicy(activePolicy.id, {
        c3_grace_period_days: formData.c3_grace_period_days,
        penalty_rate_percent: formData.penalty_rate_percent,
        interest_rate_percent: formData.interest_rate_percent,
        arrears_escalation_threshold: formData.arrears_escalation_threshold,
        min_audit_frequency_months: formData.min_audit_frequency_months,
        auto_violation_rules: formData.auto_violation_rules,
        violation_prefix_config: formData.violation_prefix_config,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ce_compliance_policies'] });
      setFormDirty(false);
      toast.success('Compliance settings updated successfully');
    },
    onError: () => toast.error('Failed to save settings'),
  });

  const activateMutation = useMutation({
    mutationFn: () => {
      if (!newPolicyEffectiveFrom) throw new Error('Date required');
      const nextVersion = `v${allPolicies.length + 1}.0`;
      const nextCode = `POL-${new Date().getFullYear()}-${String(allPolicies.length + 1).padStart(3, '0')}`;
      return activateNewPolicy(activePolicy?.id || null, {
        ...formData,
        policy_code: nextCode,
        policy_version: nextVersion,
        effective_from: newPolicyEffectiveFrom,
        notes: newPolicyNotes,
        created_by: 'current.user',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ce_compliance_policies'] });
      setShowNewPolicyDialog(false);
      setNewPolicyEffectiveFrom('');
      setNewPolicyNotes('');
      setFormDirty(false);
      toast.success('New policy activated successfully');
    },
    onError: () => toast.error('Failed to activate new policy'),
  });

  const updateForm = (patch: Partial<CompliancePolicyRow>) => {
    setFormData(prev => ({ ...prev, ...patch }));
    setFormDirty(true);
  };

  const handleRuleToggle = (ruleId: string, enabled: boolean) => {
    const rules = (formData.auto_violation_rules || []) as any[];
    const updated = rules.map((r: any) => r.ruleId === ruleId ? { ...r, enabled } : r);
    updateForm({ auto_violation_rules: updated });
  };

  if (loadingActive) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!activePolicy && !loadingActive) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-12 text-muted-foreground">No active policy found</div>
      </div>
    );
  }

  const prefixConfig = (formData.violation_prefix_config || {}) as any;
  const autoRules = (formData.auto_violation_rules || []) as any[];

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Compliance Settings</h1>
          <p className="text-muted-foreground">Configure rules, grace periods, and automation</p>
          {activePolicy && (
            <div className="flex items-center gap-3 mt-2">
              <Badge variant="default" className="gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Active Policy: {activePolicy.policy_version}
              </Badge>
              <span className="text-sm text-muted-foreground">
                Effective from {format(new Date(activePolicy.effective_from), 'MMM dd, yyyy')}
              </span>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={() => setShowHistoryDialog(true)}>
            <History className="h-4 w-4" />Policy History
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => setShowNewPolicyDialog(true)}>
            <Plus className="h-4 w-4" />Activate New Policy
          </Button>
          <Button className="gap-2" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !formDirty}>
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Changes
          </Button>
        </div>
      </div>

      {/* C3 Submission Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            <CardTitle>C3 Submission Rules</CardTitle>
          </div>
          <CardDescription>Configure grace periods and submission deadlines</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="gracePeriod">Grace Period (days)</Label>
              <Input id="gracePeriod" type="number" value={formData.c3_grace_period_days || 0}
                onChange={(e) => updateForm({ c3_grace_period_days: parseInt(e.target.value) })} />
              <p className="text-xs text-muted-foreground">Days after month-end before late case is created</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="submissionDeadline">Submission & Payment Deadline</Label>
              <Input id="submissionDeadline" type="text" value="End of Coming Month" disabled className="bg-muted" />
              <p className="text-xs text-muted-foreground">Both C3 submission and payment are due by the last day of the coming month</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Obligation Reminder Notices */}
      <ObligationReminderRulesCard />

      {/* Partial Payment Policy (DR-004) */}
      <PartialPaymentPolicyCard />




      {/* Payment & Penalty Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            <CardTitle>Payment & Penalty Rules</CardTitle>
          </div>
          <CardDescription>Configure payment due dates and penalty calculations</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Penalty Rate (%)</Label>
              <Input type="number" step="0.01" value={formData.penalty_rate_percent || 0}
                onChange={(e) => updateForm({ penalty_rate_percent: parseFloat(e.target.value) })} />
            </div>
            <div className="space-y-2">
              <Label>Interest Rate (% per month)</Label>
              <Input type="number" step="0.01" value={formData.interest_rate_percent || 0}
                onChange={(e) => updateForm({ interest_rate_percent: parseFloat(e.target.value) })} />
            </div>
            <div className="space-y-2">
              <Label>Arrears Escalation Threshold (XCD)</Label>
              <Input type="number" value={formData.arrears_escalation_threshold || 0}
                onChange={(e) => updateForm({ arrears_escalation_threshold: parseInt(e.target.value) })} />
              <p className="text-xs text-muted-foreground">Automatic legal escalation if arrears exceed this amount</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Audit & Inspection */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-primary" />
            <CardTitle>Audit & Inspection Rules</CardTitle>
          </div>
          <CardDescription>Configure audit frequency and risk-based rules</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Minimum Audit Frequency (months)</Label>
              <Input type="number" value={formData.min_audit_frequency_months || 0}
                onChange={(e) => updateForm({ min_audit_frequency_months: parseInt(e.target.value) })} />
              <p className="text-xs text-muted-foreground">Every employer must be audited at least once in this period</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Violation Prefix Config */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-primary" />
            <CardTitle>Violation Prefix Configuration</CardTitle>
          </div>
          <CardDescription>Configure violation number prefixes and formatting</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Automatic Creation Prefix</Label>
              <Input value={prefixConfig.automaticPrefix || 'VIOA'}
                onChange={(e) => updateForm({ violation_prefix_config: { ...prefixConfig, automaticPrefix: e.target.value } })} />
              <p className="text-xs text-muted-foreground">Prefix for automatically created violations</p>
            </div>
            <div className="space-y-2">
              <Label>Manual Creation Prefix</Label>
              <Input value={prefixConfig.manualPrefix || 'VIOM'}
                onChange={(e) => updateForm({ violation_prefix_config: { ...prefixConfig, manualPrefix: e.target.value } })} />
              <p className="text-xs text-muted-foreground">Prefix for manually created violations</p>
            </div>
            <div className="space-y-2">
              <Label>Number Format</Label>
              <Input value={prefixConfig.numberFormat || 'YYYY-NNNN'}
                onChange={(e) => updateForm({ violation_prefix_config: { ...prefixConfig, numberFormat: e.target.value } })} />
              <p className="text-xs text-muted-foreground">YYYY = Year, NNNN = Sequential Number</p>
            </div>
            <div className="space-y-2">
              <Label>Current Number</Label>
              <Input type="number" value={prefixConfig.currentNumber || 1}
                onChange={(e) => updateForm({ violation_prefix_config: { ...prefixConfig, currentNumber: parseInt(e.target.value) } })} />
              <p className="text-xs text-muted-foreground">Next violation number to be assigned</p>
            </div>
          </div>
          <div className="p-3 bg-muted rounded-lg">
            <p className="text-sm font-medium mb-2">Example Violation Numbers:</p>
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>Automatic: <span className="font-mono font-medium text-foreground">{prefixConfig.automaticPrefix || 'VIOA'}-{new Date().getFullYear()}-{String(prefixConfig.currentNumber || 1).padStart(4, '0')}</span></p>
              <p>Manual: <span className="font-mono font-medium text-foreground">{prefixConfig.manualPrefix || 'VIOM'}-{new Date().getFullYear()}-{String(prefixConfig.currentNumber || 1).padStart(4, '0')}</span></p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Auto Violation Rules */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-primary" />
            <CardTitle>Automatic Violation Creation Rules</CardTitle>
          </div>
          <CardDescription>Enable or disable automatic violation creation triggers</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {autoRules.map((rule: any) => (
            <div key={rule.ruleId} className="flex items-start justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-foreground">{rule.triggerEvent}</p>
                  <Badge variant={rule.enabled ? "default" : "secondary"} className="gap-1">
                    {rule.enabled ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                    {rule.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{rule.description}</p>
                <p className="text-xs text-muted-foreground">Creates violation type: <span className="font-mono">{rule.violationType}</span></p>
              </div>
              <Switch checked={rule.enabled} onCheckedChange={(checked) => handleRuleToggle(rule.ruleId, checked)} />
            </div>
          ))}
          {autoRules.length === 0 && (
            <p className="text-center text-muted-foreground py-8">No auto-violation rules configured</p>
          )}
        </CardContent>
      </Card>

      {/* Policy History Dialog */}
      <Dialog open={showHistoryDialog} onOpenChange={setShowHistoryDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Policy History</DialogTitle>
            <DialogDescription>View all compliance policy versions and their effective periods</DialogDescription>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>Effective From</TableHead>
                <TableHead>Effective To</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created By</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allPolicies.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.policy_version}</TableCell>
                  <TableCell>{format(new Date(p.effective_from), 'MMM dd, yyyy')}</TableCell>
                  <TableCell>{p.effective_to ? format(new Date(p.effective_to), 'MMM dd, yyyy') : 'Present'}</TableCell>
                  <TableCell><Badge variant={p.is_active ? "default" : "secondary"}>{p.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                  <TableCell>{p.created_by}</TableCell>
                  <TableCell className="max-w-xs truncate">{p.notes || '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>

      {/* New Policy Dialog */}
      <Dialog open={showNewPolicyDialog} onOpenChange={setShowNewPolicyDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Activate New Policy</DialogTitle>
            <DialogDescription>Create a new policy version with current settings. The current policy will be deactivated.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Effective From Date</Label>
              <Input type="date" value={newPolicyEffectiveFrom}
                onChange={(e) => setNewPolicyEffectiveFrom(e.target.value)}
                min={format(new Date(), 'yyyy-MM-dd')} />
            </div>
            <div className="space-y-2">
              <Label>Notes (Optional)</Label>
              <Textarea placeholder="Describe the changes in this policy version..."
                value={newPolicyNotes} onChange={(e) => setNewPolicyNotes(e.target.value)} rows={4} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewPolicyDialog(false)}>Cancel</Button>
            <Button onClick={() => activateMutation.mutate()} disabled={activateMutation.isPending}>
              {activateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Activate Policy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
