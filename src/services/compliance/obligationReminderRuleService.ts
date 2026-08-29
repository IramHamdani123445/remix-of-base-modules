import { supabase } from "@/integrations/supabase/client";

export interface ObligationReminderRuleRow {
  id: string;
  rule_code: string;
  label: string | null;
  obligation_type: string;
  is_enabled: boolean;
  offset_type: string;
  offset_value: number;
  audience: string | null;
  template_code: string | null;
  channels: string[] | null;
  consolidate_periods: boolean;
  sequence: number | null;
  notes: string | null;
  updated_at: string | null;
}

export async function fetchObligationReminderRules(): Promise<ObligationReminderRuleRow[]> {
  const { data, error } = await (supabase as any)
    .from("ce_obligation_reminder_rules")
    .select("*")
    .order("sequence", { ascending: true })
    .order("offset_value", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ObligationReminderRuleRow[];
}

export async function updateObligationReminderRule(
  id: string,
  patch: Partial<Pick<
    ObligationReminderRuleRow,
    "is_enabled" | "offset_value" | "offset_type" | "consolidate_periods" | "label" | "notes"
  >>,
): Promise<void> {
  const { error } = await (supabase as any)
    .from("ce_obligation_reminder_rules")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
}
