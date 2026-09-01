/**
 * CountryProfileEditor — edits the Country Pack main-record fields stored
 * directly on `bn_country` (formats, office contact, letterhead logo).
 * Rendered as a dialog from the Country Pack dashboard.
 */
import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { getCountryProfile, updateCountryProfile, type CountryProfileFields } from '@/services/bn/countryProfileService';
import { BnBusyButton } from '@/components/bn/shared';

interface Props {
  countryCode: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CountryProfileEditor: React.FC<Props> = ({ countryCode, open, onOpenChange }) => {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['bn', 'country-profile', countryCode],
    queryFn: () => getCountryProfile(countryCode),
    enabled: open && !!countryCode,
  });
  const [form, setForm] = useState<CountryProfileFields>({ country_code: countryCode });

  useEffect(() => {
    if (data) setForm(data);
    else setForm({ country_code: countryCode });
  }, [data, countryCode]);

  const save = useMutation({
    mutationFn: () => updateCountryProfile({ ...form, country_code: countryCode }),
    onSuccess: () => {
      toast.success('Country profile updated');
      qc.invalidateQueries({ queryKey: ['bn', 'country-profile', countryCode] });
      qc.invalidateQueries({ queryKey: ['bn', 'country-pack', countryCode] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message ?? 'Failed to save'),
  });

  const setField = <K extends keyof CountryProfileFields>(k: K, v: CountryProfileFields[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Country Profile · {countryCode}</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="py-10 text-center text-muted-foreground">Loading…</div>
        ) : (
          <div className="space-y-5 py-2">
            <section className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <h4 className="text-sm font-semibold mb-2">Display & Formats</h4>
              </div>
              <div><Label>Default Language</Label><Input value={form.default_language ?? ''} onChange={(e) => setField('default_language', e.target.value)} placeholder="en" /></div>
              <div><Label>Timezone</Label><Input value={form.timezone ?? ''} onChange={(e) => setField('timezone', e.target.value)} placeholder="America/St_Kitts" /></div>
              <div><Label>Date Format</Label><Input value={form.date_format ?? ''} onChange={(e) => setField('date_format', e.target.value)} placeholder="dd/MM/yyyy" /></div>
              <div><Label>Number Format</Label><Input value={form.number_format ?? ''} onChange={(e) => setField('number_format', e.target.value)} placeholder="#,##0.00" /></div>
              <div className="col-span-2"><Label>Phone Format</Label><Input value={form.phone_format ?? ''} onChange={(e) => setField('phone_format', e.target.value)} placeholder="(+{dialCode}) XXX-XXXX" /></div>
            </section>

            <section className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><h4 className="text-sm font-semibold mb-2">Social Security Office</h4></div>
              <div className="col-span-2"><Label>Office Name</Label><Input value={form.office_name ?? ''} onChange={(e) => setField('office_name', e.target.value)} placeholder="Social Security Board" /></div>
              <div className="col-span-2"><Label>Office Address</Label><Textarea rows={2} value={form.office_address ?? ''} onChange={(e) => setField('office_address', e.target.value)} placeholder="Bay Road, Basseterre, St. Kitts" /></div>
              <div><Label>Phone</Label><Input value={form.office_phone ?? ''} onChange={(e) => setField('office_phone', e.target.value)} placeholder="+1 869 465 2535" /></div>
              <div><Label>Email</Label><Input value={form.office_email ?? ''} onChange={(e) => setField('office_email', e.target.value)} placeholder="info@socialsecurity.kn" /></div>
              <div className="col-span-2"><Label>Website</Label><Input value={form.office_website ?? ''} onChange={(e) => setField('office_website', e.target.value)} placeholder="https://socialsecurity.kn" /></div>
            </section>

            <section className="grid grid-cols-1 gap-3">
              <h4 className="text-sm font-semibold">Letterhead</h4>
              <div><Label>Letterhead Logo URL</Label><Input value={form.letterhead_logo_url ?? ''} onChange={(e) => setField('letterhead_logo_url', e.target.value)} placeholder="https://…/logo.png" /></div>
            </section>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <BnBusyButton loading={save.isPending} onClick={() => save.mutate()} disabled={save.isPending || isLoading}>>Save</BnBusyButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CountryProfileEditor;
