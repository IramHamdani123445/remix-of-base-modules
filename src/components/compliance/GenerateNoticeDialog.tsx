/**
 * Dialog to generate a notice from a template with merge-field resolution.
 * Reuses ce_notice_templates + ce_notices via noticeWorkflowService.
 * Permission-gated: manage_compliance / create.
 */
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { fetchNoticeTemplates } from '@/services/noticeTemplateService';
import { generateNotice, resolveTemplate } from '@/services/noticeWorkflowService';
import { useUserCode } from '@/hooks/useUserCode';
import { supabase } from '@/integrations/supabase/client';
import { isComplianceFeatureEnabled } from '@/lib/compliance/featureToggles';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  source?: {
    caseId?: string | null;
    violationId?: string | null;
    employerId?: string;
    employerName?: string;
    mergeVars?: Record<string, any>;
  };
}

export const GenerateNoticeDialog = ({ open, onOpenChange, source }: Props) => {
  const qc = useQueryClient();
  const { userCode } = useUserCode();
  const [templateId, setTemplateId] = useState('');
  const [employerId, setEmployerId] = useState(source?.employerId || '');
  const [employerName, setEmployerName] = useState(source?.employerName || '');
  const [noticeType, setNoticeType] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState('EMAIL');
  const [dueDate, setDueDate] = useState('');
  const [requireApproval, setRequireApproval] = useState(true);
  const [extraVars, setExtraVars] = useState('');

  const { data: templates = [] } = useQuery({
    queryKey: ['ce_notice_templates_active'],
    queryFn: async () => (await fetchNoticeTemplates()).filter(t => t.is_active),
  });

  // Notice types come from the canonical ce_notice_ref configuration, never
  // from hardcoded frontend values.
  const { data: noticeTypes = [] } = useQuery({
    queryKey: ['ce_notice_ref', 'TYPE'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('ce_notice_ref')
        .select('code,label,display_order')
        .eq('domain', 'TYPE').eq('is_active', true)
        .order('display_order');
      if (error) throw error;
      return (data || []) as { code: string; label: string }[];
    },
  });

  const tpl = templates.find(t => t.id === templateId);
  const mergeVars = useMemo(() => {
    const base: Record<string, any> = {
      employer_id: employerId, employer_name: employerName,
      due_date: dueDate, officer: userCode || '',
      ...(source?.mergeVars || {}),
    };
    try {
      const parsed = extraVars ? JSON.parse(extraVars) : {};
      return { ...base, ...parsed };
    } catch { return base; }
  }, [employerId, employerName, dueDate, userCode, source, extraVars]);

  const previewSubject = tpl ? resolveTemplate(tpl.subject || '', mergeVars) : '';
  const previewBody = tpl ? resolveTemplate(tpl.body || '', mergeVars) : '';

  const mut = useMutation({
    mutationFn: () => {
      if (!userCode) {
        throw new Error('Your user profile could not be resolved — sign in again before generating notices.');
      }
      return generateNotice({
      templateId, employerId, employerName,
      caseId: source?.caseId || null, violationId: source?.violationId || null,
      noticeType, deliveryMethod,
      dueResponseDate: dueDate || null,
      mergeVars,
      requiresApproval: requireApproval && isComplianceFeatureEnabled('notices.pendingApproval'),
      userCode,
      });
    },
    onSuccess: () => {
      toast.success('Notice generated');
      qc.invalidateQueries({ queryKey: ['ce_notices'] });
      qc.invalidateQueries({ queryKey: ['ce_notices_pending'] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message || 'Failed to generate notice'),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Generate Notice</DialogTitle>
          <DialogDescription>
            Uses configured templates from Administration › Notice Templates.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Label>Template *</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger><SelectValue placeholder="Select template" /></SelectTrigger>
              <SelectContent>
                {templates.map(t => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.template_code} — {t.template_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Employer ID *</Label>
            <Input value={employerId} onChange={e => setEmployerId(e.target.value)} />
          </div>
          <div>
            <Label>Employer Name</Label>
            <Input value={employerName} onChange={e => setEmployerName(e.target.value)} />
          </div>
          <div>
            <Label>Notice Type</Label>
            <Select value={noticeType} onValueChange={setNoticeType}>
              <SelectTrigger><SelectValue placeholder="Select notice type" /></SelectTrigger>
              <SelectContent>
                {noticeTypes.map(t => (
                  <SelectItem key={t.code} value={t.code}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Delivery Method</Label>
            <Select value={deliveryMethod} onValueChange={setDeliveryMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="EMAIL">Email</SelectItem>
                <SelectItem value="POST">Post</SelectItem>
                <SelectItem value="PORTAL">Portal</SelectItem>
                <SelectItem value="SMS">SMS</SelectItem>
                <SelectItem value="HAND">Hand Delivery</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Due Response Date</Label>
            <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
          <div className="col-span-2 flex items-center gap-3">
            <Switch checked={requireApproval} onCheckedChange={setRequireApproval}
              disabled={!isComplianceFeatureEnabled('notices.pendingApproval')} />
            <Label className="cursor-pointer">Send for approval before dispatch</Label>
          </div>
          <div className="col-span-2">
            <Label>Extra merge variables (JSON, optional)</Label>
            <Textarea rows={2} placeholder='{"amount":"1500","period":"2026-03","fund":"SS"}'
              value={extraVars} onChange={e => setExtraVars(e.target.value)} />
            {tpl && (
              <p className="text-xs text-muted-foreground mt-1">
                Template variables: {(tpl.variables || []).join(', ') || '—'}
              </p>
            )}
          </div>
          {tpl && (
            <div className="col-span-2 rounded-md border bg-muted/30 p-3">
              <p className="text-xs font-semibold mb-1">Preview</p>
              <p className="text-sm font-medium">{previewSubject}</p>
              <pre className="text-xs whitespace-pre-wrap mt-2">{previewBody}</pre>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mut.mutate()} disabled={!templateId || !employerId || !noticeType || mut.isPending}>
            {mut.isPending ? 'Generating…' : 'Generate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
