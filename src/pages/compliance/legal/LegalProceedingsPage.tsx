import React, { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Gavel, Eye, Search, Loader2, Inbox } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

const stageColor = (stage: string): 'destructive' | 'default' | 'secondary' | 'outline' => {
  if (['Writ of Execution', 'Commitment/JDS'].includes(stage)) return 'destructive';
  if (['Summons', 'Judgment Summons'].includes(stage)) return 'default';
  if (stage === 'Recovery Monitoring') return 'secondary';
  return 'outline';
};

type Proceeding = {
  id: string;
  case_number: string | null;
  employer_name: string | null;
  reg_no: string | null;
  stage: string;
  arrears: number | null;
  filed_date: string | null;
  next_hearing: string | null;
  court: string | null;
  solicitor: string | null;
  outcome: string | null;
};

const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="space-y-1">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-sm font-medium text-foreground break-words">{value ?? '—'}</p>
  </div>
);

const LegalProceedingsPage = () => {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Proceeding | null>(null);


  const { data: proceedings = [], isLoading } = useQuery({
    queryKey: ['ce_legal_proceedings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('ce_legal_proceedings').select('*').order('filed_date', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const filtered = proceedings.filter(p =>
    search === '' || p.employer_name?.toLowerCase().includes(search.toLowerCase()) || p.case_number?.toLowerCase().includes(search.toLowerCase())
  );

  if (isLoading) return <div className="flex items-center justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  const totalArrears = proceedings.reduce((sum, p) => sum + Number(p.arrears || 0), 0);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Gavel className="h-6 w-6 text-primary" />
          <h1 className="text-3xl font-semibold text-foreground">Legal Proceedings</h1>
        </div>
        <p className="text-muted-foreground">Active legal cases, court proceedings, and enforcement tracking</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Total Active</p><p className="text-2xl font-bold text-foreground">{proceedings.length}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Court Stage</p><p className="text-2xl font-bold text-destructive">{proceedings.filter(p => ['Summons','Judgment Summons','Writ of Execution','Commitment/JDS'].includes(p.stage)).length}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Recovery Phase</p><p className="text-2xl font-bold text-success">{proceedings.filter(p => p.stage === 'Recovery Monitoring').length}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Total Arrears</p><p className="text-2xl font-bold text-primary">${(totalArrears / 1000).toFixed(0)}K</p></CardContent></Card>
      </div>

      {proceedings.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center justify-center py-12"><Inbox className="h-12 w-12 text-muted-foreground mb-3" /><p className="text-muted-foreground">No legal proceedings recorded</p></CardContent></Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search by case number or employer..." className="pl-10" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 text-muted-foreground font-medium">Case No</th>
                    <th className="text-left py-2 px-3 text-muted-foreground font-medium">Employer</th>
                    <th className="text-center py-2 px-3 text-muted-foreground font-medium">Stage</th>
                    <th className="text-right py-2 px-3 text-muted-foreground font-medium">Arrears</th>
                    <th className="text-left py-2 px-3 text-muted-foreground font-medium">Court</th>
                    <th className="text-left py-2 px-3 text-muted-foreground font-medium">Next Hearing</th>
                    <th className="text-left py-2 px-3 text-muted-foreground font-medium">Solicitor</th>
                    <th className="text-center py-2 px-3 text-muted-foreground font-medium">Outcome</th>
                    <th className="text-right py-2 px-3 text-muted-foreground font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(p => (
                    <tr key={p.id} className="border-b last:border-0 border-border hover:bg-muted/50">
                      <td className="py-2 px-3 font-mono text-xs font-medium text-foreground">{p.case_number}</td>
                      <td className="py-2 px-3">
                        <p className="font-medium text-foreground">{p.employer_name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{p.reg_no}</p>
                      </td>
                      <td className="py-2 px-3 text-center"><Badge variant={stageColor(p.stage)} className="text-[10px]">{p.stage}</Badge></td>
                      <td className="py-2 px-3 text-right font-medium text-foreground">${Number(p.arrears).toLocaleString()}</td>
                      <td className="py-2 px-3 text-foreground">{p.court}</td>
                      <td className="py-2 px-3 text-foreground">{p.next_hearing || '—'}</td>
                      <td className="py-2 px-3 text-foreground">{p.solicitor}</td>
                      <td className="py-2 px-3 text-center"><Badge variant={p.outcome === 'Judgment Granted' ? 'default' : 'outline'} className="text-[10px]">{p.outcome}</Badge></td>
                      <td className="py-2 px-3 text-right"><Button variant="ghost" size="sm" aria-label={`View ${p.case_number ?? 'proceeding'}`} onClick={() => setSelected(p as Proceeding)}><Eye className="h-4 w-4" /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Legal Proceeding {selected?.case_number}</DialogTitle>
            <DialogDescription>Case details and current enforcement status</DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <Field label="Case Number" value={selected.case_number} />
              <Field label="Employer" value={selected.employer_name} />
              <Field label="Registration No" value={selected.reg_no} />
              <Field label="Stage" value={<Badge variant={stageColor(selected.stage)}>{selected.stage}</Badge>} />
              <Field label="Arrears" value={`$${Number(selected.arrears || 0).toLocaleString()}`} />
              <Field label="Court" value={selected.court} />
              <Field label="Filed Date" value={selected.filed_date} />
              <Field label="Next Hearing" value={selected.next_hearing} />
              <Field label="Solicitor" value={selected.solicitor} />
              <Field label="Outcome" value={selected.outcome} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>

  );
};

export default LegalProceedingsPage;
