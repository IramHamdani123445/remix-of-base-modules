/**
 * FormulaVersionEditor — dialog to edit a single bn_formula_version row.
 * Lets the user pick expression_type and edit expression/steps_json via the
 * visual FormulaStepsBuilder. Only DRAFT versions are editable; others are read-only.
 */
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { requireUserCode } from '@/lib/bn/requireUserCode';
import { FormulaStepsBuilder, type ExpressionType, type StepsJson } from '@/components/bn/config/FormulaStepsBuilder';
import { useBnFormulaVariableRegistry } from '@/hooks/bn/useBnFormulaVariableRegistry';

const db = supabase as any;

const EXPRESSION_TYPES: ExpressionType[] = [
  'SIMPLE_EXPRESSION', 'RATE_TABLE_LOOKUP', 'MATRIX_LOOKUP',
  'MEDICAL_TARIFF_LOOKUP', 'MULTI_STEP', 'CONDITIONAL',
];

interface Props {
  open: boolean;
  versionId: string | null;
  onClose: () => void;
  onSaved?: () => void;
}

export function FormulaVersionEditor({ open, versionId, onClose, onSaved }: Props) {
  const { profile } = useSupabaseAuth();
  const { data: registry = [] } = useBnFormulaVariableRegistry();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expressionType, setExpressionType] = useState<ExpressionType>('SIMPLE_EXPRESSION');
  const [steps, setSteps] = useState<StepsJson>({});
  const [governanceStatus, setGovernanceStatus] = useState<string>('DRAFT');
  const [versionNo, setVersionNo] = useState<number>(1);

  useEffect(() => {
    if (!open || !versionId) return;
    let alive = true;
    (async () => {
      setLoading(true);
      const { data, error } = await db.from('bn_formula_version').select('*').eq('id', versionId).single();
      if (!alive) return;
      if (error) { toast.error(error.message); setLoading(false); return; }
      setExpressionType((data.expression_type as ExpressionType) ?? 'SIMPLE_EXPRESSION');
      const sj = (data.steps_json ?? {}) as StepsJson;
      // back-compat: if steps_json empty but expression present, prefill SIMPLE_EXPRESSION
      if (!Object.keys(sj).length && data.expression) sj.expression = data.expression;
      setSteps(sj);
      setGovernanceStatus(data.governance_status ?? 'DRAFT');
      setVersionNo(data.version_no ?? 1);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [open, versionId]);

  const readOnly = governanceStatus !== 'DRAFT';

  const save = async () => {
    if (!versionId) return;
    let userCode: string;
    try { userCode = requireUserCode(profile?.user_code, 'save formula version'); }
    catch (e: any) { toast.error(e.message); return; }
    setSaving(true);
    try {
      // Governed path only — direct table writes are refused by the
      // calculation immutability guard.
      await saveFormulaVersion({
        versionId,
        expressionType,
        stepsJson: steps as Record<string, unknown>,
        expression: expressionType === 'SIMPLE_EXPRESSION' ? (steps.expression ?? '') : null,
        userCode,
      });
      toast.success('Version saved');
      onSaved?.();
      onClose();
    } catch (e: any) {
      toast.error(e.message ?? 'Save failed');
    } finally { setSaving(false); }
  };


  const variables = registry.map((r: any) => r.variable_code);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Edit Formula Version v{versionNo}
            <Badge variant={governanceStatus === 'DRAFT' ? 'default' : 'secondary'}>{governanceStatus}</Badge>
            {readOnly && <Badge variant="outline" className="text-yellow-700">Read-only</Badge>}
          </DialogTitle>
        </DialogHeader>
        {loading ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div> : (
          <div className="space-y-4">
            <div>
              <Label>Expression type</Label>
              <Select value={expressionType} onValueChange={(v) => setExpressionType(v as ExpressionType)} disabled={readOnly}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{EXPRESSION_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <fieldset disabled={readOnly} className={readOnly ? 'opacity-60 pointer-events-none' : ''}>
              <FormulaStepsBuilder
                expressionType={expressionType}
                value={steps}
                onChange={setSteps}
                variables={variables}
              />
            </fieldset>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {!readOnly && (
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
