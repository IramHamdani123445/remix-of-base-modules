import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Info, ArrowRight, Users, Layers, Gavel, DollarSign } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

interface DetectionRuleRow {
  id: string;
  rule_code: string;
  name: string;
  is_enabled: boolean | null;
  parameters: Record<string, any> | null;
}

const SWITCHES: { key: string; label: string; icon: any; help: string }[] = [
  { key: 'include_voluntary', label: 'Include voluntary contributors', icon: Users, help: 'Applies the same obligation timeline to voluntary contributors as to self-employed persons.' },
  { key: 'consolidate_reminders', label: 'Consolidate multi-period reminders', icon: Layers, help: 'Sends one communication covering every outstanding period rather than one per period.' },
  { key: 'auto_legal_escalation', label: 'Automatic legal escalation', icon: Gavel, help: 'Deliberately OFF per client decision — self-employed cases are never auto-referred to Legal. Referral stays a manual action.' },
  { key: 'over_contribution_creates_credit', label: 'Over-contribution creates credit', icon: DollarSign, help: 'Over-contribution is recorded as a credit/offset only, never an automatic cash refund. Refund handling is a later Finance hand-off.' },
];

export default function SelfEmployedCompliance() {
  const navigate = useNavigate();

  const { data: rule, isLoading } = useQuery({
    queryKey: ['ce_detection_rules_self_employed'],
    queryFn: async (): Promise<DetectionRuleRow | null> => {
      const { data, error } = await supabase
        .from('ce_detection_rules')
        .select('id, rule_code, name, is_enabled, parameters')
        .eq('trigger_event', 'self_employed_non_compliance')
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as DetectionRuleRow) || null;
    },
  });

  const params = rule?.parameters || {};

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Self-Employed Compliance (DR-013)"
        subtitle="Read-only summary of the self-employed / voluntary contributor switches — edited in the Rule Engine"
        breadcrumbs={[{ label: 'Compliance', href: '/compliance/dashboard' }, { label: 'Settings', href: '/compliance/admin/settings' }, { label: 'Self-Employed Compliance' }]}
      />

      <Card className="border-warning/40 bg-warning/5">
        <CardContent className="py-4 flex gap-3 items-start">
          <Info className="h-5 w-5 text-warning shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground">These four switches are owned in exactly one editable place: the Rule Engine.</p>
            <p>This page is a read-only summary so the settings are discoverable without duplicating the parameter editor. Use "Open in Rule Engine" below to change them.</p>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center min-h-[30vh]"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>{rule ? `${rule.rule_code} — ${rule.name}` : 'Self-Employed Non-Compliance Rule'}</CardTitle>
              <CardDescription>
                {rule ? (
                  <span className="flex items-center gap-2 mt-1">
                    <Badge variant={rule.is_enabled ? 'default' : 'secondary'}>{rule.is_enabled ? 'Enabled' : 'Disabled'}</Badge>
                  </span>
                ) : 'No detection rule configured yet for self-employed non-compliance.'}
              </CardDescription>
            </div>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => navigate('/compliance/admin/settings/rule-engine')}
            >
              Open in Rule Engine <ArrowRight className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {SWITCHES.map(s => {
                const Icon = s.icon;
                const value = params[s.key];
                return (
                  <div key={s.key} className="flex items-start gap-3 border border-border rounded-md p-3">
                    <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground">{s.label}</span>
                        <Badge variant={value === true ? 'default' : value === false ? 'secondary' : 'outline'}>
                          {value === true ? 'ON' : value === false ? 'OFF' : 'Not set'}
                        </Badge>
                        {s.key === 'auto_legal_escalation' && (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">Deliberately OFF by default</Badge>
                        )}
                        {s.key === 'over_contribution_creates_credit' && (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">Credit/offset only — no auto refund</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{s.help}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
