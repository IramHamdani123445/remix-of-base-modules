import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BellRing, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  fetchObligationReminderRules,
  updateObligationReminderRule,
  ObligationReminderRuleRow,
} from "@/services/compliance/obligationReminderRuleService";

const OFFSET_LABEL: Record<string, string> = {
  reporting_day_of_month: "Day of the reporting month",
  days_before_due: "Days before the due date",
  days_after_due: "Days after the due date",
};

export function ObligationReminderRulesCard() {
  const queryClient = useQueryClient();

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ["ce_obligation_reminder_rules"],
    queryFn: fetchObligationReminderRules,
  });

  const mutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ObligationReminderRuleRow> }) =>
      updateObligationReminderRule(id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ce_obligation_reminder_rules"] });
      toast.success("Reminder rule updated");
    },
    onError: () => toast.error("Failed to update reminder rule"),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <BellRing className="h-5 w-5 text-primary" />
          <CardTitle>Obligation Reminder Notices</CardTitle>
        </div>
        <CardDescription>
          Reminder cycles used by the C3 obligation lifecycle worker. Each enabled cycle issues one
          consolidated notice per employer listing every outstanding period.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading reminder rules…
          </div>
        )}

        {!isLoading && rules.length === 0 && (
          <p className="text-center text-muted-foreground py-8">No reminder rules configured</p>
        )}

        {rules.map((rule) => (
          <div key={rule.id} className="rounded-lg border p-4 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-foreground">{rule.label || rule.rule_code}</p>
                  <Badge variant="outline" className="font-mono text-xs">{rule.rule_code}</Badge>
                  <Badge variant="secondary">{rule.obligation_type}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {OFFSET_LABEL[rule.offset_type] ?? rule.offset_type}
                  {rule.channels?.length ? ` · ${rule.channels.join(", ")}` : ""}
                </p>
              </div>
              <Switch
                checked={rule.is_enabled}
                onCheckedChange={(checked) =>
                  mutation.mutate({ id: rule.id, patch: { is_enabled: checked } })
                }
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor={`offset-${rule.id}`}>Offset value</Label>
                <Input
                  id={`offset-${rule.id}`}
                  type="number"
                  min={1}
                  max={31}
                  defaultValue={rule.offset_value}
                  onBlur={(e) => {
                    const next = parseInt(e.target.value, 10);
                    if (Number.isFinite(next) && next !== rule.offset_value) {
                      mutation.mutate({ id: rule.id, patch: { offset_value: next } });
                    }
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>Consolidate outstanding periods</Label>
                <div className="flex h-10 items-center">
                  <Switch
                    checked={rule.consolidate_periods}
                    onCheckedChange={(checked) =>
                      mutation.mutate({ id: rule.id, patch: { consolidate_periods: checked } })
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default ObligationReminderRulesCard;
