/**
 * BN Medical Reviews — command submission and idempotency controller.
 *
 * One key per *intent*, not per attempt:
 *
 *  - a key is minted when the operator starts a submission
 *  - the SAME key is reused for every retry of the SAME payload, including
 *    transport timeouts, lost responses, explicit "Retry" and rerenders
 *  - a NEW key is minted only when the prior command succeeded / reached a
 *    confirmed terminal outcome, when the payload changes, or when the
 *    operator cancels and starts again
 *
 * Version conflicts are a first-class phase: the entered payload and the
 * attempted key are preserved, the canonical record is reloaded, and the
 * operator must explicitly confirm the refreshed state before resubmitting.
 */
import { useCallback, useRef, useState } from 'react';
import {
  newIdempotencyKey,
  type CommandResult,
} from '@/services/bn/medicalReviewCommandService';
import {
  MedicalReviewError,
  mapMedicalReviewError,
} from '@/features/bn/medical-reviews/model/errors';

export type SubmissionPhase = 'idle' | 'pending' | 'success' | 'error' | 'conflict';

export interface VersionConflictState {
  /** Row version the operator submitted against. */
  previousRowVersion: number | null;
  /** Row version now held by the canonical record. */
  currentRowVersion: number | null;
  /** True once the operator has reviewed the refreshed record. */
  acknowledged: boolean;
  reloadFailed: boolean;
}

export interface MedicalReviewSubmissionState {
  phase: SubmissionPhase;
  isPending: boolean;
  /** The key currently bound to the in-flight / last intent. */
  idempotencyKey: string | null;
  result: CommandResult | null;
  error: MedicalReviewError | null;
  conflict: VersionConflictState | null;
  /** Human outcome label: `Applied`, `Replayed`, `No change`. */
  outcomeLabel: string | null;
}

export interface UseMedicalReviewSubmissionOptions {
  /**
   * Reload the canonical record after a version conflict and return its
   * refreshed row version (or `null` when unknown).
   */
  reloadRecord?: () => Promise<number | null>;
  /** Refresh only the affected sections after a successful command. */
  onSettled?: (result: CommandResult) => void | Promise<void>;
}

function fingerprint(payload: unknown): string {
  try {
    return JSON.stringify(payload ?? null);
  } catch {
    return String(payload);
  }
}

function labelFor(result: CommandResult): string {
  if (result.replayed) return 'Replayed — this command had already been processed.';
  if (result.noOp) return 'No change — the record was already in the requested state.';
  return 'Applied.';
}

export interface MedicalReviewSubmissionController extends MedicalReviewSubmissionState {
  /**
   * Runs `execute` with the idempotency key bound to `payload`.
   * Double submission while pending is ignored and resolves to `null`.
   */
  submit: <T extends Record<string, unknown>>(
    payload: T,
    execute: (payload: T, idempotencyKey: string) => Promise<CommandResult>,
  ) => Promise<CommandResult | null>;
  /** Operator confirmed they reviewed the refreshed record after a conflict. */
  acknowledgeConflict: () => void;
  /** Abandon the intent: the next submission mints a new key. */
  reset: () => void;
}

export function useMedicalReviewSubmission(
  options: UseMedicalReviewSubmissionOptions = {},
): MedicalReviewSubmissionController {
  const { reloadRecord, onSettled } = options;

  const [phase, setPhase] = useState<SubmissionPhase>('idle');
  const [result, setResult] = useState<CommandResult | null>(null);
  const [error, setError] = useState<MedicalReviewError | null>(null);
  const [conflict, setConflict] = useState<VersionConflictState | null>(null);
  const [key, setKey] = useState<string | null>(null);

  const keyRef = useRef<string | null>(null);
  const fpRef = useRef<string | null>(null);
  const inFlight = useRef(false);
  /** Set after a terminal outcome so the next submission mints a fresh key. */
  const consumed = useRef(false);

  const keyFor = useCallback((payload: unknown): string => {
    const fp = fingerprint(payload);
    const mustRotate = keyRef.current === null || consumed.current || fpRef.current !== fp;
    if (mustRotate) {
      keyRef.current = newIdempotencyKey();
      fpRef.current = fp;
      consumed.current = false;
    }
    return keyRef.current;
  }, []);

  const reset = useCallback(() => {
    keyRef.current = null;
    fpRef.current = null;
    consumed.current = false;
    inFlight.current = false;
    setKey(null);
    setPhase('idle');
    setResult(null);
    setError(null);
    setConflict(null);
  }, []);

  const acknowledgeConflict = useCallback(() => {
    setConflict((c) => (c ? { ...c, acknowledged: true } : c));
  }, []);

  const submit = useCallback(
    async <T extends Record<string, unknown>>(
      payload: T,
      execute: (payload: T, idempotencyKey: string) => Promise<CommandResult>,
    ): Promise<CommandResult | null> => {
      if (inFlight.current) return null; // double-submit prevention

      const submissionKey = keyFor(payload);
      const previousRowVersion =
        typeof (payload as Record<string, unknown>).expectedRowVersion === 'number'
          ? ((payload as Record<string, unknown>).expectedRowVersion as number)
          : null;

      inFlight.current = true;
      setKey(submissionKey);
      setPhase('pending');
      setError(null);

      try {
        const commandResult = await execute(payload, submissionKey);
        // Terminal outcome — the next distinct submission mints a new key.
        consumed.current = true;
        setResult(commandResult);
        setConflict(null);
        setPhase('success');
        await onSettled?.(commandResult);
        return commandResult;
      } catch (raw) {
        const mapped =
          raw instanceof MedicalReviewError
            ? raw
            : mapMedicalReviewError(raw instanceof Error ? raw.message : 'E_TRANSPORT');

        if (mapped.code === 'E_VERSION_CONFLICT') {
          // Keep the key and the entered payload; refresh the canonical record.
          let currentRowVersion: number | null = null;
          let reloadFailed = false;
          if (reloadRecord) {
            try {
              currentRowVersion = await reloadRecord();
            } catch {
              reloadFailed = true;
            }
          }
          setConflict({
            previousRowVersion,
            currentRowVersion,
            acknowledged: false,
            reloadFailed,
          });
          setError(mapped);
          setPhase('conflict');
          return null;
        }

        // Transport / recoverable failures keep the SAME key so a retry is
        // replay-safe rather than creating a duplicate command.
        setError(mapped);
        setPhase('error');
        return null;
      } finally {
        inFlight.current = false;
      }
    },
    [keyFor, onSettled, reloadRecord],
  );

  return {
    phase,
    isPending: phase === 'pending',
    idempotencyKey: key,
    result,
    error,
    conflict,
    outcomeLabel: result ? labelFor(result) : null,
    submit,
    acknowledgeConflict,
    reset,
  };
}
