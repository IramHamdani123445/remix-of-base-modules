import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileText, Plus, Eye, Clock, CheckCircle, XCircle, DollarSign, Loader2, Inbox } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import ReviewWaiverDialog from './ReviewWaiverDialog';
import NewWaiverRequestDialog from './NewWaiverRequestDialog';

const statusIcon = (status: string) => {
  if (status === 'Approved') return <CheckCircle className="h-3.5 w-3.5 text-success" />;
  if (status === 'Rejected') return <XCircle className="h-3.5 w-3.5 text-destructive" />;
  return <Clock className="h-3.5 w-3.5 text-warning" />;
};

const statusVariant = (status: string): 'default' | 'destructive' | 'secondary' | 'outline' => {
  if (status === 'Approved') return 'default';
  if (status === 'Rejected') return 'destructive';
  return 'secondary';
};

const WaiversOverrides = () => {
  const [reviewing, setReviewing] = useState<any | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const { data: waivers = [], isLoading } = useQuery({
    queryKey: ['ce_waivers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('ce_waivers').select('*').order('requested_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  if (isLoading) return <div className="flex items-center justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" />
            <h1 className="text-3xl font-semibold text-foreground">Waivers & Overrides</h1>
          </div>
          <p className="text-muted-foreground">Manage waiver requests, penalty overrides, and exception approvals</p>
        </div>
        <Button className="gap-2" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" />New Waiver Request</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Total Requests</p><p className="text-2xl font-bold text-foreground">{waivers.length}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Pending</p><p className="text-2xl font-bold text-warning">{waivers.filter(w => w.status?.startsWith('Pending')).length}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Approved</p><p className="text-2xl font-bold text-success">{waivers.filter(w => w.status === 'Approved').length}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Rejected</p><p className="text-2xl font-bold text-destructive">{waivers.filter(w => w.status === 'Rejected').length}</p></CardContent></Card>
      </div>

      {waivers.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center justify-center py-12"><Inbox className="h-12 w-12 text-muted-foreground mb-3" /><p className="text-muted-foreground">No waiver requests</p></CardContent></Card>
      ) : (
        <div className="space-y-3">
          {waivers.map(w => (
            <Card key={w.id} className="hover:shadow-md transition-shadow">
              <CardContent className="py-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm font-medium text-foreground">{w.waiver_number}</span>
                      <Badge variant="outline" className="text-[10px]">{w.waiver_type}</Badge>
                      <Badge variant={statusVariant(w.status || '')} className="text-[10px] flex items-center gap-1">
                        {statusIcon(w.status || '')} {w.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <Badge variant="outline" className="font-mono text-[10px]">{w.employer_id}</Badge>
                      <span className="font-medium text-foreground flex items-center gap-1"><DollarSign className="h-3.5 w-3.5 text-muted-foreground" />${Number(w.amount_requested).toLocaleString()}</span>
                    </div>
                    {w.justification && <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">Justification:</span> {w.justification}</p>}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>Requested by: {w.requested_by}</span>
                      <span>Date: {w.requested_at}</span>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" className="ml-4" onClick={() => setReviewing(w)}>
                    <Eye className="h-4 w-4 mr-1" />Review
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ReviewWaiverDialog
        open={!!reviewing}
        waiver={reviewing}
        onClose={() => setReviewing(null)}
      />
      <NewWaiverRequestDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
};

export default WaiversOverrides;
