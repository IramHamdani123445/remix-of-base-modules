import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ChevronDown, ShieldCheck, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useRuleGovernance } from '@/hooks/bn/useRuleGovernance';
import {
  executeTransition,
  type GovernanceAction,
  type GovernanceStatus,
  type GovernanceTransition,
  type ValidationIssue,
} from '@/services/bn/governance/ruleGovernanceService';
import { getCurrentUserCode } from '@/services/bn/audit/getCurrentUserCode';
import CountryFieldSelector from '@/components/bn/selectors/CountryFieldSelector';
import LegalReferenceSelector from '@/components/bn/selectors/LegalReferenceSelector';
import { BnBusyButton } from '@/components/bn/shared';

interface Props {
  ruleId: string;
  ruleCode: string;
  status: GovernanceStatus;
  /** Existing legal fields, used to prefill the Approve Legal dialog */
  defaults?: {
    legal_reference?: string | null;
    legal_notes?: string | null;
    jurisdiction_country?: string | null;
    effective_date?: string | null;
  };
  onChanged?: () => void;
}

export function GovernanceActionsMenu({ ruleId, ruleCode, status, defaults, onChanged }: Props) {
  const gov = useRuleGovernance();
  const actions = gov.getActions(status);
  const [pending, setPending] = useState<GovernanceTransition | null>(null);
  const [comment, setComment] = useState('');
  const [legalRef, setLegalRef] = useState(defaults?.legal_reference ?? '');
  const [legalNotes, setLegalNotes] = useState(defaults?.legal_notes ?? '');
  const [jurisdiction, setJurisdiction] = useState(defaults?.jurisdiction_country ?? '');
  const [effectiveDate, setEffectiveDate] = useState(defaults?.effective_date ?? '');
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [busy, setBusy] = useState(false);

  if (actions.length === 0) {
    return (
      <span className="text-xs text-muted-foreground italic">No actions available for your role</span>
    );
  }

  const open = (t: GovernanceTransition) => {
    setComment('');
    setIssues([]);
    setPending(t);
  };

  const close = () => {
    setPending(null);
    setComment('');
    setIssues([]);
  };

  const run = async () => {
    if (!pending) return;
    const userCode = await getCurrentUserCode();
    if (!userCode) { toast.error('Authenticated user_code required'); return; }
    setBusy(true);
    try {
      const res = await executeTransition(ruleId, pending.action as GovernanceAction, {
        userCode,
        userRoles: gov.userRoles,
        isAdmin: gov.isAdmin,
        comment: comment || undefined,
        legalReference: legalRef || undefined,
        legalNotes: legalNotes || undefined,
        jurisdictionCountry: jurisdiction || undefined,
        effectiveDate: effectiveDate || undefined,
      });
      if (!res.ok) {
        if (res.issues?.length) {
          setIssues(res.issues);
          toast.error('Validation failed', {
            description: `${res.issues.filter(i => i.severity === 'error').length} blocking issue(s)`,
          });
        } else {
          toast.error(res.error ?? 'Action failed');
        }
        return;
      }
      toast.success(`${pending.label} — ${ruleCode}`);
      close();
      onChanged?.();
    } catch (e: any) {
      toast.error('Action failed', { description: e?.message });
    } finally {
      setBusy(false);
    }
  };

  const isLegalApproval = pending?.action === 'APPROVE_LEGAL';
  const errorIssues = issues.filter(i => i.severity === 'error');
  const warnIssues  = issues.filter(i => i.severity === 'warning');

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="gap-1">
            <ShieldCheck className="h-3.5 w-3.5" /> Governance
            <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Available actions
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {actions.map(t => (
            <DropdownMenuItem key={t.action}
              className={t.destructive ? 'text-destructive focus:text-destructive' : ''}
              onSelect={() => open(t)}>
              {t.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={!!pending} onOpenChange={v => !v && close()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{pending?.label}</DialogTitle>
            <DialogDescription>
              Rule <span className="font-mono">{ruleCode}</span>: {status} → {pending?.to}
            </DialogDescription>
          </DialogHeader>

          {isLegalApproval && (
            <div className="space-y-3">
              <div>
                <Label htmlFor="jurisdiction">Jurisdiction / Country *</Label>
                <CountryFieldSelector
                  value={jurisdiction || null}
                  onChange={(code) => setJurisdiction(code ?? '')}
                  placeholder="Select country…"
                  required
                />
              </div>
              <div>
                <Label htmlFor="legalRef">Legal reference *</Label>
                <LegalReferenceSelector
                  value={null}
                  countryCode={jurisdiction || null}
                  onChange={(_id, row) => setLegalRef(row ? (row.full_reference_text || row.short_title) : '')}
                  required
                />
                {legalRef && <p className="text-[11px] text-muted-foreground mt-1 truncate">Cited as: {legalRef}</p>}
              </div>
              <div>
                <Label htmlFor="effectiveDate">Effective date *</Label>
                <Input id="effectiveDate" type="date" value={effectiveDate}
                  onChange={e => setEffectiveDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="legalNotes">Legal notes *</Label>
                <Textarea id="legalNotes" value={legalNotes}
                  onChange={e => setLegalNotes(e.target.value)} rows={3} />
              </div>
            </div>
          )}

          {(pending?.requiresComment || isLegalApproval) && (
            <div>
              <Label htmlFor="comment">{isLegalApproval ? 'Approver comment *' : 'Comment *'}</Label>
              <Textarea id="comment" value={comment} onChange={e => setComment(e.target.value)}
                rows={3} placeholder="Briefly describe the reason for this action" />
            </div>
          )}

          {errorIssues.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <div className="font-semibold mb-1">Cannot proceed — fix these first:</div>
                <ul className="list-disc pl-4 text-xs space-y-0.5">
                  {errorIssues.map(i => <li key={i.code}>{i.message}</li>)}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          {warnIssues.length > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <div className="font-semibold mb-1">Warnings:</div>
                <ul className="list-disc pl-4 text-xs space-y-0.5">
                  {warnIssues.map(i => <li key={i.code}>{i.message}</li>)}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={busy}>Cancel</Button>
            <BnBusyButton loading={busy} onClick={run} disabled={busy}
              variant={pending?.destructive ? 'destructive' : 'default'}>
              {busy ? 'Working…' : pending?.label}
            </BnBusyButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
