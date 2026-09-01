import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Loader2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const INSPECTION_TYPES = ['Routine', 'Targeted', 'Follow-up', 'Complaint', 'Registration Verification'];
const TERRITORIES = ['St Kitts', 'Nevis'];

const EMPTY = {
  employerId: '',
  employerName: '',
  inspectionType: 'Routine',
  territory: 'St Kitts',
  scheduledDate: '',
  scheduledTime: '',
  inspectorName: '',
  locationAddress: '',
  purpose: '',
};

export default function ScheduleInspectionDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const set = (k: keyof typeof EMPTY, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const schedule = useMutation({
    mutationFn: async () => {
      const { data: userRes } = await supabase.auth.getUser();
      const actor = userRes?.user?.email ?? 'SYSTEM';

      const { data, error } = await supabase
        .from('ce_inspections')
        .insert({
          inspection_number: `INS-${Date.now()}`,
          employer_id: form.employerId.trim(),
          employer_name: form.employerName.trim() || null,
          inspection_type: form.inspectionType,
          territory: form.territory,
          status: 'Scheduled',
          inspector_name: form.inspectorName.trim() || null,
          scheduled_date: form.scheduledDate,
          scheduled_time: form.scheduledTime || null,
          location_address: form.locationAddress.trim() || null,
          notes: form.purpose.trim() || null,
          created_by: actor,
        } as any)
        .select('id, inspection_number')
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      toast.success('Inspection scheduled', { description: data?.inspection_number });
      queryClient.invalidateQueries({ queryKey: ['ce_inspections_list'] });
      setForm(EMPTY);
      setOpen(false);
    },
    onError: (err: any) => {
      toast.error('Could not schedule inspection', { description: err?.message ?? 'Unexpected error' });
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.employerId.trim() || !form.scheduledDate) {
      toast.error('Employer registration number and scheduled date are required');
      return;
    }
    schedule.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2"><Plus className="h-4 w-4" />Schedule Inspection</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Schedule Inspection</DialogTitle>
          <DialogDescription>Create a scheduled field inspection for an employer.</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="employerId">Employer Reg. No. *</Label>
              <Input id="employerId" value={form.employerId} onChange={e => set('employerId', e.target.value)} placeholder="e.g. 100234" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="employerName">Employer Name</Label>
              <Input id="employerName" value={form.employerName} onChange={e => set('employerName', e.target.value)} placeholder="Employer name" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Inspection Type</Label>
              <Select value={form.inspectionType} onValueChange={v => set('inspectionType', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INSPECTION_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Territory</Label>
              <Select value={form.territory} onValueChange={v => set('territory', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TERRITORIES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="scheduledDate">Scheduled Date *</Label>
              <Input id="scheduledDate" type="date" value={form.scheduledDate} onChange={e => set('scheduledDate', e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="scheduledTime">Time</Label>
              <Input id="scheduledTime" type="time" value={form.scheduledTime} onChange={e => set('scheduledTime', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="inspectorName">Inspector</Label>
              <Input id="inspectorName" value={form.inspectorName} onChange={e => set('inspectorName', e.target.value)} placeholder="Assigned inspector" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="locationAddress">Location</Label>
              <Input id="locationAddress" value={form.locationAddress} onChange={e => set('locationAddress', e.target.value)} placeholder="Site address" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="purpose">Purpose / Notes</Label>
            <Textarea id="purpose" rows={3} value={form.purpose} onChange={e => set('purpose', e.target.value)} placeholder="Reason for the inspection" />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={schedule.isPending}>
              {schedule.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Schedule Inspection
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
