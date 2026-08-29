import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Target } from 'lucide-react';
import RiskModelTab from './risk-policy/RiskModelTab';
import RiskFactorsTab from './risk-policy/RiskFactorsTab';
import RiskPoliciesTab from './risk-policy/RiskPoliciesTab';
import RiskBandsTab from './risk-policy/RiskBandsTab';
import LegalEscalationTab from './risk-policy/LegalEscalationTab';

const VALID_TABS = ['factors', 'policies', 'bands', 'escalation'];

export default function RiskRulePolicy() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab = VALID_TABS.includes(tabParam ?? '') ? (tabParam as string) : 'factors';
  const setActiveTab = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams);
      params.set('tab', next);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );


  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Target className="h-6 w-6 text-primary" />
          <h1 className="text-3xl font-semibold text-foreground">Risk & Escalation Policy</h1>
        </div>
        <p className="text-muted-foreground">
          Configure risk factors, scoring policies, risk band behaviours, and legal escalation thresholds
        </p>
        <div className="flex gap-2">
          <Badge variant="outline" className="text-xs">
            Risk factors drive employer scoring → Bands determine monitoring intensity → Escalation rules trigger legal referral
          </Badge>
        </div>
      </div>

      {/* Tabs */}
      <Card className="p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4 mb-6">
            <TabsTrigger value="factors">Risk Factors & Weights</TabsTrigger>
            <TabsTrigger value="policies">Risk Policies</TabsTrigger>
            <TabsTrigger value="bands">Risk Bands & Behaviour</TabsTrigger>
            <TabsTrigger value="escalation">Legal Escalation</TabsTrigger>
          </TabsList>

          <TabsContent value="factors" className="space-y-4">
            <RiskFactorsTab />
          </TabsContent>

          <TabsContent value="policies" className="space-y-4">
            <RiskPoliciesTab />
          </TabsContent>

          <TabsContent value="bands" className="space-y-4">
            <RiskBandsTab />
          </TabsContent>

          <TabsContent value="escalation" className="space-y-4">
            <LegalEscalationTab />
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}
