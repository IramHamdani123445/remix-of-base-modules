import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import {
  recordReceipt, verifyCertificate, rejectCertificate, requestResubmission,
  waiveObligation, deferObligation, escalateToSuspension, proposeReinstatement,
  LifeCertificateCommandError, type LifeCertificateChannel,
} from '@/services/bn/lifeCertificateCommandService';

export type LifeCertificateAction =
  | 'receive' | 'verify' | 'reject' | 'resubmission'
  | 'waive' | 'defer' | 'escalate' | 'reinstate';

interface Props {
  action: LifeCertificateAction | null;
  lifeCertificateId: string | null;
  awardId: string | null;
  rowVersion: number;
  onCancel: () => void;
  onDone: () => void;
}

const TITLES: Record<LifeCertificateAction, { title: string; description: string }> = {
  receive: { title: 'Record certificate receipt', description: 'Receipt is not verification — the certificate still requires review by a different officer.' },
  verify: { title: 'Verify certificate', description: 'Maker-checker applies: the verifier must differ from the officer who recorded receipt.' },
  reject: { title: 'Reject certificate', description: 'A reason code and narrative are mandatory and are audited.' },
  resubmission: { title: 'Request resubmission', description: 'The claimant will be asked to resubmit before the deadline you set.' },
  waive: { title: 'Waive obligation', description: 'Requires the specific waive permission and a policy authority.' },
  defer: { title: 'Defer obligation', description: 'Requires the specific defer permission and a new date.' },
  escalate: { title: 'Escalate for suspension', description: 'Creates an Award Suspension PROPOSAL only. The award is not suspended here and approval remains with Award Suspension.' },
  reinstate: { title: 'Propose reinstatement', description: 'Creates a reinstatement PROPOSAL through Award Suspension. Hold release and arrears remain owned by that boundary.' },
};

const CHANNELS: { value: LifeCertificateChannel; label: string }[] = [
  { value: 'IN_PERSON', label: 'In person' },
  { value: 'PORTAL', label: 'Self-service portal' },
  { value: 'EMAIL_INTAKE', label: 'Email intake' },
  { value: 'EMBASSY', label: 'Embassy' },
  { value: 'AUTHORISED_AUTHORITY', label: 'Authorised authority' },
  { value: 'INTERNAL_UPLOAD', label: 'Internal upload' },
  { value: 'POST', label: 'Post' },
];

const today = () => new Date().toISOString().slice(0, 10);

const LifeCertificateActionDialogs: React.FC<Props> = ({
  action, lifeCertificateId, awardId, rowVersion, onCancel, onDone,
}) => {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [receivedDate, setReceivedDate] = useState(today());
  const [certificateDate, setCertificateDate] = useState(today());
  const [documentId, setDocumentId] = useState('');
  const [evidenceType, setEvidenceType] = useState('LIFE_CERTIFICATE');
  const [issuingAuthority, setIssuingAuthority] = useState('');
  const [channel, setChannel] = useState<LifeCertificateChannel>('IN_PERSON');
  const [narrative, setNarrative] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [deadline, setDeadline] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [expiresOn, setExpiresOn] = useState('');
  const [checklist, setChecklist] = useState<Record<string, boolean>>({
    identity_matches: false, evidence_legible: false, authority_acceptable: false, within_validity: false,
  });
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());
  const [correlationId, setCorrelationId] = useState<string>(() => crypto.randomUUID());

  useEffect(() => {
    if (!action) return;
    setError(null);
    setIdempotencyKey(crypto.randomUUID());
    setCorrelationId(crypto.randomUUID());
  }, [action, lifeCertificateId]);

  /** Permission-filtered document picker — no free-text UUIDs. */
  const [documents, setDocuments] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    if (action !== 'receive' || !awardId) return;
    let cancelled = false;
    void (async () => {
      const client = supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (c: string, v: string) => {
              maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
              order: (c: string, o: { ascending: boolean }) => {
                limit: (n: number) => Promise<{ data: Record<string, unknown>[] | null }>;
              };
            };
          };
        };
      };
      const { data } = await client.from('bn_award').select('bn_claim_id').eq('id', awardId).maybeSingle();
      const claimId = data?.bn_claim_id as string | undefined;
      if (!claimId) { if (!cancelled) setDocuments([]); return; }
      const { data: docs } = await client
        .from('bn_claim_document')
        .select('id,document_name,document_type_code,uploaded_at')
        .eq('claim_id', claimId)
        .order('uploaded_at', { ascending: false })
        .limit(50);
      if (cancelled) return;
      setDocuments((docs ?? []).map((d) => ({
        value: String(d.id),
        label: `${(d.document_name as string) ?? 'Document'} · ${(d.document_type_code as string) ?? 'UNSPECIFIED'}`,
      })));
    })();
    return () => { cancelled = true; };
  }, [action, awardId]);

  const reasonOptions = useMemo(() => {
    if (action === 'reject') {
      return ['LIFE_CERT_ILLEGIBLE', 'LIFE_CERT_WRONG_PERSON', 'LIFE_CERT_EXPIRED', 'LIFE_CERT_AUTHORITY'];
    }
    if (action === 'waive') return ['LIFE_CERT_INSTITUTION', 'LIFE_CERT_MEDICAL', 'LIFE_CERT_POLICY_EXEMPT'];
    if (action === 'defer') return ['LIFE_CERT_TRAVEL', 'LIFE_CERT_ADMIN_DELAY'];
    return [];
  }, [action]);

  const canSubmit = (() => {
    switch (action) {
      case 'receive': return !!documentId && !!receivedDate && !!certificateDate;
      case 'verify': return Object.values(checklist).every(Boolean);
      case 'reject': return !!reasonCode && narrative.trim().length > 0;
      case 'resubmission': return narrative.trim().length > 0 && !!deadline;
      case 'waive': return !!reasonCode && narrative.trim().length > 0 && !!effectiveFrom && !!expiresOn;
      case 'defer': return !!reasonCode && narrative.trim().length > 0 && !!deadline;
      case 'escalate':
      case 'reinstate': return narrative.trim().length > 0;
      default: return false;
    }
  })();

  const submit = async () => {
    if (!action || !lifeCertificateId) return;
    setSubmitting(true);
    setError(null);
    const base = { lifeCertificateId, expectedRowVersion: rowVersion, idempotencyKey, correlationId };
    try {
      switch (action) {
        case 'receive':
          await recordReceipt({ ...base, receivedDate, documentId, evidenceType,
            issuingAuthority: issuingAuthority || null, certificateDate, channel, narrative: narrative || null });
          break;
        case 'verify':
          await verifyCertificate({ ...base, narrative: narrative || null, checklist });
          break;
        case 'reject':
          await rejectCertificate({ ...base, reasonCode, narrative, resubmissionDueDate: deadline || null });
          break;
        case 'resubmission':
          await requestResubmission({ ...base, narrative, resubmissionDueDate: deadline });
          break;
        case 'waive':
          await waiveObligation({ ...base, reasonCode, narrative, effectiveFrom, expiresOn });
          break;
        case 'defer':
          await deferObligation({ ...base, reasonCode, narrative, deferredTo: deadline });
          break;
        case 'escalate':
          await escalateToSuspension({ ...base, narrative });
          break;
        case 'reinstate':
          await proposeReinstatement({ ...base, narrative, effectiveFrom });
          break;
      }
      onDone();
    } catch (e) {
      setError((e as LifeCertificateCommandError).message ?? 'The command could not be completed.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!action) return null;
  const meta = TITLES[action];

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !submitting) onCancel(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{meta.title}</DialogTitle>
          <DialogDescription>{meta.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {action === 'receive' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Received date</Label>
                  <Input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Certificate date</Label>
                  <Input type="date" value={certificateDate} onChange={(e) => setCertificateDate(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Evidence document</Label>
                <SearchableSelect
                  options={documents}
                  value={documentId}
                  onValueChange={setDocumentId}
                  placeholder={documents.length ? 'Select a claim document…' : 'No documents available for this claim'}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Evidence type</Label>
                  <Input value={evidenceType} onChange={(e) => setEvidenceType(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Submission channel</Label>
                  <Select value={channel} onValueChange={(v) => setChannel(v as LifeCertificateChannel)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CHANNELS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label>Issuing authority</Label>
                <Input value={issuingAuthority} onChange={(e) => setIssuingAuthority(e.target.value)} />
              </div>
            </>
          )}

          {action === 'verify' && (
            <div className="space-y-2">
              <Label>Verification checklist</Label>
              {Object.entries(checklist).map(([key, value]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={value} onCheckedChange={(c) => setChecklist((p) => ({ ...p, [key]: c === true }))} />
                  {key.replace(/_/g, ' ')}
                </label>
              ))}
            </div>
          )}

          {reasonOptions.length > 0 && (
            <div className="space-y-1">
              <Label>Reason code</Label>
              <Select value={reasonCode} onValueChange={setReasonCode}>
                <SelectTrigger><SelectValue placeholder="Select a reason" /></SelectTrigger>
                <SelectContent>
                  {reasonOptions.map((r) => <SelectItem key={r} value={r}>{r.replace(/_/g, ' ')}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {(action === 'reject' || action === 'resubmission' || action === 'defer') && (
            <div className="space-y-1">
              <Label>{action === 'defer' ? 'Deferred to' : 'Resubmission deadline'}</Label>
              <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </div>
          )}

          {action === 'waive' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Effective from</Label>
                <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Expires on</Label>
                <Input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
              </div>
            </div>
          )}

          {action === 'reinstate' && (
            <div className="space-y-1">
              <Label>Reinstatement effective from</Label>
              <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
            </div>
          )}

          <div className="space-y-1">
            <Label>Narrative</Label>
            <Textarea rows={3} value={narrative} onChange={(e) => setNarrative(e.target.value)}
                      placeholder="Recorded in the audit trail" />
          </div>

          {(action === 'escalate' || action === 'reinstate') && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Proposal only</AlertTitle>
              <AlertDescription>
                This creates a maker-checker proposal in Award Suspension. No award status change, payment hold
                release or arrears calculation happens from Life Certificates.
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={!canSubmit || submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default LifeCertificateActionDialogs;
