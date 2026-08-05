/**
 * BN Medical Reviews — explicit confidential-evidence access.
 *
 * Confidential clinical evidence is NEVER prefetched because the caller
 * happens to hold the permission. The section starts collapsed, states that
 * access is audited, and issues the secured RPC only after a deliberate
 * operator action. State is cleared on close, on review change, on route
 * change and on unmount, and is never written to the URL, storage, a shared
 * query cache, analytics or the console.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, Eye, EyeOff, Lock, ShieldAlert } from 'lucide-react';
import { medicalReviewQueryService } from '@/services/bn/medicalReviewQueryService';
import {
  describeMedicalReviewFailure,
  MedicalReviewError,
} from '@/features/bn/medical-reviews/model/errors';
import { ConfidentialWithheldNotice } from './MedicalReviewActionControls';

export const CONFIDENTIAL_AUDIT_NOTICE = 'Access to confidential medical evidence is audited.';
export const CONFIDENTIAL_REVEAL_LABEL = 'View confidential medical evidence';

type Phase = 'collapsed' | 'loading' | 'open' | 'denied' | 'recused' | 'not_released' | 'failed';

interface Props {
  obligationId: string;
  canViewConfidential: boolean;
}

export const ConfidentialEvidenceSection: React.FC<Props> = ({
  obligationId,
  canViewConfidential,
}) => {
  const location = useLocation();
  const [phase, setPhase] = useState<Phase>('collapsed');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useRef(true);

  const clear = useCallback(() => {
    setRows([]);
    setMessage(null);
    setPhase('collapsed');
  }, []);

  // Clear on review change and on route change.
  useEffect(() => {
    clear();
  }, [obligationId, location.pathname, location.search, clear]);

  // Clear on unmount.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      setRows([]);
    };
  }, []);

  const reveal = useCallback(async () => {
    setPhase('loading');
    setMessage(null);
    try {
      const result = await medicalReviewQueryService.confidentialEvidence(obligationId);
      if (!mounted.current) return;
      const list = result.rows as Record<string, unknown>[];
      setRows(list);
      setPhase(list.length === 0 ? 'not_released' : 'open');
    } catch (err) {
      if (!mounted.current) return;
      setRows([]);
      setMessage(describeMedicalReviewFailure(err));
      if (err instanceof MedicalReviewError && err.code === 'E_MEMBER_RECUSED') setPhase('recused');
      else if (
        err instanceof MedicalReviewError &&
        (err.code === 'E_FORBIDDEN' || err.code === 'E_RECORD_FORBIDDEN')
      )
        setPhase('denied');
      else setPhase('failed');
    }
  }, [obligationId]);

  if (!canViewConfidential) {
    return <ConfidentialWithheldNotice />;
  }

  return (
    <section className="rounded-md border p-3" data-testid="mr-confidential-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-start gap-2 text-sm">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          <span data-testid="mr-confidential-audit-notice">{CONFIDENTIAL_AUDIT_NOTICE}</span>
        </div>
        {phase === 'collapsed' || phase === 'failed' ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void reveal()}
            data-testid="mr-confidential-reveal"
          >
            <Eye className="mr-2 h-3.5 w-3.5" /> {CONFIDENTIAL_REVEAL_LABEL}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={clear} data-testid="mr-confidential-hide">
            <EyeOff className="mr-2 h-3.5 w-3.5" /> Hide confidential evidence
          </Button>
        )}
      </div>

      {phase === 'loading' && (
        <div className="mt-3" data-testid="mr-confidential-loading">
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {phase === 'denied' && (
        <Alert className="mt-3" data-testid="mr-confidential-denied">
          <Lock className="h-4 w-4" />
          <AlertTitle>Permission denied</AlertTitle>
          <AlertDescription>{message ?? 'Confidential evidence is not available to you.'}</AlertDescription>
        </Alert>
      )}

      {phase === 'recused' && (
        <Alert className="mt-3" data-testid="mr-confidential-recused">
          <Lock className="h-4 w-4" />
          <AlertTitle>Recused from this case</AlertTitle>
          <AlertDescription>
            {message ?? 'You have been recused and cannot view newly released evidence.'}
          </AlertDescription>
        </Alert>
      )}

      {phase === 'not_released' && (
        <p className="mt-3 text-sm text-muted-foreground" data-testid="mr-confidential-not-released">
          No confidential clinical evidence has been released for this review.
        </p>
      )}

      {phase === 'failed' && (
        <Alert variant="destructive" className="mt-3" data-testid="mr-confidential-failed">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Confidential evidence could not be loaded</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      {phase === 'open' && (
        <div className="mt-3 space-y-2" data-testid="mr-confidential-content">
          {rows.map((row, i) => (
            <div key={i} className="rounded-md border border-amber-300 bg-amber-500/5 p-3 text-sm">
              <div className="font-medium">
                {String(row.evidence_type ?? row.field_code ?? 'Clinical evidence')}
              </div>
              <div className="text-muted-foreground">{String(row.summary ?? row.value ?? '—')}</div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Confidential evidence is excluded from detail exports and print views.
          </p>
        </div>
      )}
    </section>
  );
};

export default ConfidentialEvidenceSection;
