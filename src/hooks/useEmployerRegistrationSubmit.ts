import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { triggerEmployerRegistrationWorkflow } from '@/services/employerWorkflowTriggerService';
import { resolveOrganizationContext } from '@/lib/org/organizationContextResolver';
import {
  emitEmployerRegistrationApplicationSubmitted,
  EMPLOYER_REGISTRATION_MODULE_CODE,
} from '@/platform/omni-comms/integrations/business/employerRegistrationProducer';
import type { BusinessProducerResult } from '@/platform/omni-comms/integrations/business/businessProducerTypes';

/** Observable, non-fatal outcome of the pilot acknowledgement emission. */
export interface CommunicationOutcome {
  outcome: BusinessProducerResult['outcome'] | 'skipped';
  eventCode: string | null;
  requestId: string | null;
  blockers: string[];
  /** Short, user-safe sentence describing what happened. */
  summary: string;
}

const COMMUNICATION_SUMMARY: Record<string, string> = {
  accepted: 'Acknowledgement prepared (test mode — nothing was sent).',
  replayed: 'Acknowledgement already prepared for this application.',
  blocked: 'Acknowledgement not prepared.',
  unavailable: 'Acknowledgement could not be prepared right now.',
  skipped: 'Acknowledgement not applicable for this organisation.',
};

/**
 * Build 4A pilot — raise the employer-registration APPLICATION SUBMITTED
 * acknowledgement through the single Omni-Comms facade in SHADOW mode.
 * Provider-free and fail-closed: the runtime records evidence only. This
 * never blocks or fails the business submission, never contacts a provider
 * and never writes to a comms table. The outcome is returned so the caller
 * can surface it — it is observed, not fire-and-forget.
 */
const emitOmniCommsRegistrationEvent = async (
  regno: string,
  employerName: string,
  contact: { email?: string | null; phone?: string | null },
): Promise<CommunicationOutcome> => {
  const skipped: CommunicationOutcome = {
    outcome: 'skipped',
    eventCode: null,
    requestId: null,
    blockers: [],
    summary: COMMUNICATION_SUMMARY.skipped,
  };

  try {
    const ctx = await resolveOrganizationContext({
      moduleCode: EMPLOYER_REGISTRATION_MODULE_CODE,
    });
    const organizationId: string | undefined = ctx?.organization?.id;
    if (!organizationId) return skipped;

    const res = await emitEmployerRegistrationApplicationSubmitted({
      organizationId,
      departmentId: ctx?.department?.department_id ?? null,
      reference: regno,
      subjectName: employerName,
      contactEmail: contact.email ?? null,
      contactPhone: contact.phone ?? null,
      submittedAt: new Date().toISOString(),
    });

    return {
      outcome: res.outcome,
      eventCode: res.eventCode || null,
      requestId: res.requestId,
      blockers: res.blockers ?? [],
      summary: COMMUNICATION_SUMMARY[res.outcome] ?? COMMUNICATION_SUMMARY.unavailable,
    };
  } catch {
    // Communication evidence is best-effort and never affects submission.
    return {
      outcome: 'unavailable',
      eventCode: null,
      requestId: null,
      blockers: ['runtime_unavailable'],
      summary: COMMUNICATION_SUMMARY.unavailable,
    };
  }
};


const formatDbError = (err: unknown): string => {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;

  const anyErr = err as any;
  const message = anyErr?.message || anyErr?.error_description || anyErr?.msg;
  const details = anyErr?.details;
  const hint = anyErr?.hint;
  const code = anyErr?.code;

  return [
    message,
    details ? `Details: ${details}` : null,
    hint ? `Hint: ${hint}` : null,
    code ? `Code: ${code}` : null,
  ]
    .filter(Boolean)
    .join(' | ');
};

export interface ERSubmitData {
  regno: string;
  name?: string | null;
  trade_name?: string | null;
  email?: string | null;
  phone?: string | null;
  status?: string;
}

export interface ValidationErrors {
  [key: string]: string;
}

export interface SubmitResult {
  success: boolean;
  regno?: string;
  errors?: ValidationErrors;
  message?: string;
  workflowInstanceId?: string;
  /** Observed, non-fatal outcome of the acknowledgement emission. */
  communication?: CommunicationOutcome;
}


/**
 * Validates required fields for ER submission.
 */
export const validateERRegistrationForSubmit = (data: ERSubmitData): ValidationErrors => {
  const errors: ValidationErrors = {};

  if (!data.name?.trim()) errors.name = 'Employer name is required';
  if (!data.email?.trim()) errors.email = 'Email is required';
  if (!data.phone?.trim()) errors.phone = 'Phone is required';

  return errors;
};

// Employer Registration module ID — kept for reference
const ER_MODULE_ID = '683ed102-9a5a-41d7-91d3-1e00c2e15a15';

/**
 * Hook providing unified ER Registration submission functionality.
 */
export function useEmployerRegistrationSubmit() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionInProgressRef = useRef(false);

  /**
   * Fetches the complete record data from er_master for validation.
   */
  const fetchRecordData = async (regno: string): Promise<ERSubmitData | null> => {
    const { data, error } = await supabase
      .from('er_master')
      .select('regno, name, trade_name, email, phone, status')
      .eq('regno', regno)
      .single();

    if (error) {
      console.error('Error fetching record:', error);
      throw new Error(formatDbError(error));
    }

    return data as ERSubmitData;
  };

  /**
   * Triggers workflow for the submitted ER registration.
   * Delegates to the shared employer workflow trigger service.
   */
  const triggerWorkflow = async (
    regno: string,
    recordName: string,
    userId?: string
  ): Promise<string | null> => {
    return triggerEmployerRegistrationWorkflow(regno, recordName, userId);
  };

  /**
   * Main submit function for ER Registration submission.
   * Uses the database RPC function to atomically:
   * 1. Generate a permanent registration number
   * 2. Update the record from temp regno to permanent
   * 3. Update status to Pending
   * 4. Update all related tables with the new regno
   */
  const submitERRegistration = useCallback(async (
    tempRegno: string,
    userId?: string
  ): Promise<SubmitResult> => {
    // Prevent duplicate submissions
    if (submissionInProgressRef.current) {
      return { success: false, message: 'Submission already in progress' };
    }

    submissionInProgressRef.current = true;
    setIsSubmitting(true);

    try {
      // Fetch the complete record for validation
      const recordData = await fetchRecordData(tempRegno);
      if (!recordData) {
        throw new Error('Record not found');
      }

      // Verify record is in draft status
      if (recordData.status !== 'Z') {
        throw new Error('Only draft records can be submitted');
      }

      // Validate all required fields
      const validationErrors = validateERRegistrationForSubmit(recordData);
      if (Object.keys(validationErrors).length > 0) {
        const firstError = Object.values(validationErrors)[0];
        return {
          success: false,
          errors: validationErrors,
          message: firstError,
        };
      }

      // Call the RPC function to atomically submit and generate permanent regno
      const { data: rpcResult, error: rpcError } = await supabase.rpc('submit_er_registration', {
        p_temp_regno: tempRegno,
        p_user_id: userId || null,
      });

      if (rpcError) {
        throw new Error(formatDbError(rpcError));
      }

      const result = rpcResult as { success: boolean; old_regno: string; new_regno: string; status: string };
      
      if (!result.success) {
        throw new Error('Submission failed');
      }

      const newRegno = result.new_regno;
      const recordName = recordData.name || newRegno;
      
      // Trigger workflow with the new permanent regno (if configured)
      const workflowInstanceId = await triggerWorkflow(newRegno, recordName, userId);

      // Build 4A pilot — Omni-Comms shadow emission. Awaited so the outcome
      // is observable, but total: it can never fail the submission.
      const communication = await emitOmniCommsRegistrationEvent(
        newRegno,
        recordName,
        { email: recordData.email, phone: recordData.phone },
      );

      return {
        success: true,
        regno: newRegno,
        workflowInstanceId: workflowInstanceId || undefined,
        message: `Registration submitted successfully. New Registration No: ${newRegno}`,
        communication,
      };

    } catch (error) {
      console.error('Submit error:', error);
      return {
        success: false,
        message: formatDbError(error),
      };
    } finally {
      setIsSubmitting(false);
      submissionInProgressRef.current = false;
    }
  }, []);

  return {
    submitERRegistration,
    isSubmitting,
    validateERRegistrationForSubmit,
  };
}
