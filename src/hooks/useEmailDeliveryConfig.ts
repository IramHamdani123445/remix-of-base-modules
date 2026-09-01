import { usePaymentConfig } from '@/hooks/usePaymentModuleConfig';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { emitFinanceDocumentCommunication } from '@/platform/omni-comms/integrations/business/financeDocumentProducer';

type DeliveryMode = 'always' | 'ask' | 'never';

export function useEmailDeliveryConfig() {
  const { data: invoiceConfig, isLoading: l1 } = usePaymentConfig('invoice_email_delivery');
  const { data: receiptConfig, isLoading: l2 } = usePaymentConfig('receipt_email_delivery');

  const invoiceMode: DeliveryMode = (invoiceConfig?.config_value as DeliveryMode) || 'never';
  const receiptMode: DeliveryMode = (receiptConfig?.config_value as DeliveryMode) || 'never';

  return {
    invoiceEmailMode: invoiceMode,
    receiptEmailMode: receiptMode,
    isLoading: l1 || l2,
  };
}

/** Basic email format validation */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Resolve payer email via centralized RPC */
export async function resolvePayerEmail(payerType: string, payerId: string): Promise<string> {
  try {
    const { data, error } = await supabase.rpc('resolve_payer_email', {
      p_payer_type: payerType,
      p_payer_id: payerId.trim(),
    });
    if (error) {
      console.error('[EmailDelivery] resolve_payer_email RPC error:', error);
      return '';
    }
    return (data as string) || '';
  } catch (err) {
    console.error('[EmailDelivery] Failed to resolve payer email:', err);
    return '';
  }
}

export interface SendDocumentEmailResult {
  success: boolean;
  status: 'sent' | 'queued' | 'failed' | 'skipped';
  error?: string;
}

/**
 * Raise the governed business communication for an issued invoice or receipt.
 *
 * The Hub owns template selection, versioning, branding, letterhead,
 * signature, sender identity, approval, queueing, dispatch, retry and
 * logging. The screen therefore supplies business facts only — no subject,
 * no HTML body, no attachment, no provider call.
 */
export async function sendDocumentEmail(params: {
  documentType: 'invoice' | 'receipt';
  documentId: string | number;
  documentNumber: string;
  recipientEmail: string;
  userCode: string;
  payerType?: string;
  payerId?: string;
  payerName?: string;
  totalAmount?: string;
  currencyCode?: string;
  documentDate?: string;
}): Promise<SendDocumentEmailResult> {
  const {
    documentType, documentNumber, recipientEmail,
    payerId, payerName, totalAmount, currencyCode, documentDate,
  } = params;

  const label = documentType === 'invoice' ? 'Invoice' : 'Receipt';

  // Guard the authoritative address resolved server-side by the payer lookup.
  if (!recipientEmail || !isValidEmail(recipientEmail)) {
    const msg = !recipientEmail
      ? 'No email address on file for this payer'
      : `Invalid email address: ${recipientEmail}`;
    toast.warning(`${label} email not sent`, { description: msg });
    return { success: false, status: 'skipped', error: msg };
  }

  // ── Omni-Comms convergence (Wave 4) ───────────────────────────────
  // This document email is a governed business communication. It is raised
  // through the single Omni-Comms facade; the provider is never contacted
  // from the browser. Finance is bound in evaluate-only mode until it is
  // certified for live delivery, so the emission is resolved, evaluated and
  // recorded but nothing is dispatched — fail-closed by design.
  try {
    const outcome = await emitFinanceDocumentCommunication({
      documentType,
      documentNumber,
      recipientEmail,
      payerId: payerId ?? null,
      payerName: payerName ?? null,
      totalAmount: totalAmount ?? null,
      currencyCode: currencyCode ?? null,
      documentDate: documentDate ?? null,
    });

    if (outcome.outcome === 'accepted' || outcome.outcome === 'replayed') {
      toast.info(`${label} email registered for delivery`, {
        description: `Recorded for ${recipientEmail}. Delivery starts once Finance communications are authorised.`,
      });
      return { success: true, status: 'queued' };
    }

    toast.warning(`${label} email not sent`, {
      description:
        outcome.blockers?.join(', ') ||
        'Finance communications are not yet authorised for delivery.',
    });
    return {
      success: false,
      status: 'failed',
      error: outcome.blockers?.join(', ') || outcome.outcome,
    };
  } catch (err: any) {
    // Total by construction: a communication concern must never break the
    // cashier transaction that raised it.
    console.error('[EmailDelivery] Governed emission failed:', err);
    toast.error(`Failed to register ${label.toLowerCase()} email`, {
      description: err?.message || 'Communication service error',
    });
    return { success: false, status: 'failed', error: err.message };
  }
}
