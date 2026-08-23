/**
 * Breaches — list arrangement breaches with manual detection trigger.
 * Reuses ce_arrangement_breaches; uses detectBreaches() to scan now.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/shared/PageHeader';
import { PermissionWrapper } from '@/components/ui/permission-wrapper';
import { PermissionButton } from '@/components/ui/permission-button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ShieldAlert, Loader2, ScanLine } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { detectBreaches } from '@/services/arrangementWorkflowService';
import { useUserCode } from '@/hooks/useUserCode';

const MODULE = 'manage_compliance';

export default function BreachesPage() {
  const qc = useQueryClient();
  const { userCode } = useUserCode();

  const { data = [], isLoading } = useQuery({
    queryKey: ['ce_arrangement_breaches_full'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ce_arrangement_breaches')
        .select('*, ce_payment_arrangements!inner(arrangement_number,employer_id,employer_name,status,case_id)')
        .order('detected_at', { ascending: false }).limit(500);
      if (error) throw error;
      return data || [];
    },
  });

  const scanMut = useMutation({
    mutationFn: () => detectBreaches({ userCode: userCode || 'system' }),
    onSuccess: (results) => {
      toast.success(results.length ? `Detected ${results.length} new breach(es)` : 'No new breaches detected');
      qc.invalidateQueries({ queryKey: ['ce_arrangement_breaches_full'] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const { data: register = [] } = useQuery({
    queryKey: ['ce_v_arrangement_register'],
    queryFn: fetchArrangementRegister,
  });
  const watchlist = register.filter(
    (a) => a.health_status === 'BREACHED' || a.health_status === 'AT_RISK' || Number(a.overdue_count) > 0,
  );

  return (
    <PermissionWrapper moduleName={MODULE}>
      <div className="container mx-auto p-6 space-y-4">
        <PageHeader title="Breaches & Defaults" subtitle="Arrangement breaches detected manually or by the automation job, with the current default watchlist." />
        <div className="flex justify-end">
          <PermissionButton moduleName={MODULE} actionName="edit" onClick={() => scanMut.mutate()} disabled={scanMut.isPending}>
            <ScanLine className="h-4 w-4 mr-1" /> {scanMut.isPending ? 'Scanning…' : 'Run Detection Now'}
          </PermissionButton>
        </div>

        {/* Default watchlist — server-derived arrears position */}
        <Card>
          <CardContent className="p-0">
            <div className="px-4 py-3 border-b flex items-center gap-2 text-sm font-semibold">
              <ShieldAlert className="h-4 w-4 text-destructive" />
              Default watchlist ({watchlist.length})
            </div>
            {watchlist.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground text-sm">
                No arrangement is currently in arrears.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Arrangement</TableHead>
                    <TableHead>Employer</TableHead>
                    <TableHead className="text-center">Overdue</TableHead>
                    <TableHead className="text-right">Past due</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead className="text-center">Health</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {watchlist.map((a) => (
                    <TableRow key={a.arrangement_id}>
                      <TableCell className="font-medium">{a.arrangement_number}</TableCell>
                      <TableCell>{a.employer_name || a.employer_id}</TableCell>
                      <TableCell className="text-center text-destructive font-semibold">{a.overdue_count}</TableCell>
                      <TableCell className="text-right">{formatXCD(a.past_due_amount)}</TableCell>
                      <TableCell className="text-right">{formatXCD(a.outstanding)}</TableCell>
                      <TableCell className="text-center"><ArrangementHealthBadge health={a.health_status} /></TableCell>
                      <TableCell className="text-right">
                        <button
                          className="text-primary hover:underline text-xs"
                          onClick={() => navigate(`/compliance/enforcement/arrangements?arr=${a.arrangement_id}`)}
                        >
                          Open
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-12 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Detected</TableHead>
                    <TableHead>Arrangement</TableHead>
                    <TableHead>Employer</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Resolution</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No breaches on record.</TableCell></TableRow>
                  )}
                  {data.map((b: any) => (
                    <TableRow key={b.id}>
                      <TableCell className="text-xs">{b.detected_at ? new Date(b.detected_at).toLocaleString('en-GB') : '—'}</TableCell>
                      <TableCell className="font-medium">{b.ce_payment_arrangements?.arrangement_number}</TableCell>
                      <TableCell>{b.ce_payment_arrangements?.employer_name || b.ce_payment_arrangements?.employer_id}</TableCell>
                      <TableCell><Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">{b.breach_type}</Badge></TableCell>
                      <TableCell className="text-sm max-w-md truncate">{b.description}</TableCell>
                      <TableCell className="text-xs">{b.resolution || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </PermissionWrapper>
  );
}
