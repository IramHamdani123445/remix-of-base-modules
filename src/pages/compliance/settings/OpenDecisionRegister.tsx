import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { PermissionWrapper } from '@/components/ui/permission-wrapper';
import { ClipboardList, Loader2 } from 'lucide-react';

const PERMISSION = 'manage_compliance';

interface DecisionRow {
  id: string;
  decision_code: string;
  rule_code: string | null;
  title: string;
  status: string;
  blocker_class: string;
  production_blocker: boolean;
  demo_blocker: boolean;
  confirmed_basis: string | null;
  unconfirmed_items: string[] | null;
  runtime_guard: string | null;
  current_safe_behaviour: string | null;
  client_answer_required: string | null;
  decided_at: string | null;
  decided_by: string | null;
}

const CLASS_STYLE: Record<string, string> = {
  PRODUCTION_BLOCKER: 'bg-destructive/15 text-destructive',
  DEMO_BLOCKER: 'bg-destructive/15 text-destructive',
  NON_BLOCKING_PROVISIONAL: 'bg-amber-500/15 text-amber-700',
  INFORMATION_ONLY: 'bg-muted text-muted-foreground',
};

export default function OpenDecisionRegister() {
  return (
    <PermissionWrapper moduleName={PERMISSION}>
      <Inner />
    </PermissionWrapper>
  );
}

function Inner() {
  const { data, isLoading } = useQuery({
    queryKey: ['ce_open_business_decision_register'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ce_open_business_decision')
        .select('*')
        .order('blocker_class', { ascending: true })
        .order('decision_code', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as DecisionRow[];
    },
  });

  const open = (data ?? []).filter((d) => d.status === 'OPEN');
  const productionBlockers = open.filter((d) => d.production_blocker).length;
  const demoBlockers = open.filter((d) => d.demo_blocker).length;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ClipboardList className="h-6 w-6 text-primary" />
          Open Client Decision Register
        </h1>
        <p className="text-sm text-muted-foreground">
          Every business decision awaiting client confirmation, the safe behaviour the system applies meanwhile,
          and whether it blocks production or a demonstration.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Open decisions</CardDescription>
            <CardTitle className="text-3xl">{open.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Production blockers</CardDescription>
            <CardTitle className="text-3xl">{productionBlockers}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Demonstration blockers</CardDescription>
            <CardTitle className="text-3xl">{demoBlockers}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Decision register</CardTitle>
          <CardDescription className="text-xs">
            Provisional configuration is active and fail-safe; it is never presented as confirmed policy.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading register…
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Decision</TableHead>
                  <TableHead>Classification</TableHead>
                  <TableHead>Current safe behaviour</TableHead>
                  <TableHead>Client answer required</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data ?? []).map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="align-top">
                      <div className="font-medium text-sm">{d.decision_code}</div>
                      <div className="text-xs text-muted-foreground">{d.title}</div>
                      {d.rule_code && (
                        <Badge variant="outline" className="mt-1 text-[10px]">{d.rule_code}</Badge>
                      )}
                      {d.confirmed_basis && (
                        <div className="text-[11px] text-muted-foreground mt-1">
                          Confirmed: {d.confirmed_basis}
                        </div>
                      )}
                      {d.unconfirmed_items?.length ? (
                        <ul className="text-[11px] text-muted-foreground mt-1 list-disc pl-4">
                          {d.unconfirmed_items.map((i) => (
                            <li key={i}>{i}</li>
                          ))}
                        </ul>
                      ) : null}
                    </TableCell>
                    <TableCell className="align-top">
                      <Badge className={CLASS_STYLE[d.blocker_class] ?? ''}>
                        {d.blocker_class.replace(/_/g, ' ')}
                      </Badge>
                      <div className="text-[11px] text-muted-foreground mt-1">
                        Production blocker: {d.production_blocker ? 'Yes' : 'No'}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Demo blocker: {d.demo_blocker ? 'Yes' : 'No'}
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-xs max-w-sm">
                      {d.current_safe_behaviour || d.runtime_guard || '—'}
                    </TableCell>
                    <TableCell className="align-top text-xs max-w-xs">
                      {d.client_answer_required || '—'}
                    </TableCell>
                    <TableCell className="align-top">
                      <Badge variant={d.status === 'OPEN' ? 'secondary' : 'outline'}>{d.status}</Badge>
                      {d.decided_at && (
                        <div className="text-[11px] text-muted-foreground mt-1">
                          {new Date(d.decided_at).toLocaleDateString()} · {d.decided_by}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
