/**
 * Wave 4 — Business producer: Finance document communications.
 *
 * EVIDENCE, not invention. The application already emails business documents
 * today from the Cashier screens:
 *
 *   - Create Invoice      → invoice email (DB template `INVOICE_EMAIL`)
 *   - Payment Data Entry  → receipt email (DB template `RECEIPT_EMAIL`)
 *
 * Both previously called the platform notification function directly,
 * bypassing every Omni-Comms control. This producer replaces that call with
 * the single governed façade.
 *
 * Deliberately module-specific: an invoice and a receipt are different
 * business facts with different traceability, so they are NOT collapsed into a
 * generic `DOCUMENT.SEND` event.
 *
 * Delivery authority is NOT widened. The producer bindings authorise `shadow`
 * only, so the runtime resolves, evaluates and records the emission but
 * persists no dispatch job. The module stays fail-closed until certification.
 */

import { emitBusinessCommunication } from './emitBusinessCommunication';
import { resolveBusinessCommunicationScope } from './businessScopeResolver';
import type {
  BusinessProducerMode,
  BusinessProducerResult,
  OmniCommsRecipientType,
} from './businessProducerTypes';

/** Registered caller module code (omni_comms_caller_module_registry). */
export const FINANCE_MODULE_CODE = 'FINANCE';

export const FINANCE_INVOICE_ISSUED_EVENT_CODE = 'FINANCE.INVOICE.ISSUED';
export const FINANCE_RECEIPT_ISSUED_EVENT_CODE = 'FINANCE.PAYMENT.RECEIPT_ISSUED';

/** Payer is outside the organisation; business meaning travels in the reference. */
export const FINANCE_DOCUMENT_RECIPIENT_TYPE: OmniCommsRecipientType = 'external';

/**
 * Evaluate-only until the Finance module is certified for live delivery.
 * Matches `allowed_modes = {shadow}` on both producer bindings.
 */
export const FINANCE_DOCUMENT_MODE: BusinessProducerMode = 'shadow';

export const FINANCE_DOCUMENT_ENTITY_TYPES = {
  invoice: 'finance_invoice',
  receipt: 'finance_receipt',
} as const;

export type FinanceDocumentType = keyof typeof FINANCE_DOCUMENT_ENTITY_TYPES;

/** Canonical payload vocabulary shared by templates, tests and the contract. */
export interface FinanceDocumentPayload {
  documentType: FinanceDocumentType;
  documentNumber: string;
  payerName: string;
  payerId: string;
  totalAmount: string;
  currencyCode: string;
  documentDate: string;
}

export interface FinanceDocumentEmissionInput {
  documentType: FinanceDocumentType;
  /** Business identifier of the document (invoice/receipt number). */
  documentNumber: string;
  /** Authoritative payer email, resolved server-side by `resolve_payer_email`. */
  recipientEmail?: string | null;
  payerId?: string | null;
  payerName?: string | null;
  totalAmount?: string | null;
  currencyCode?: string | null;
  documentDate?: string | null;
  organizationId?: string | null;
  departmentId?: string | null;
  correlationId?: string | null;
}

export function buildFinanceDocumentPayload(
  input: FinanceDocumentEmissionInput,
): FinanceDocumentPayload {
  return {
    documentType: input.documentType,
    documentNumber: String(input.documentNumber ?? '').trim(),
    payerName: input.payerName?.trim() || input.payerId?.trim() || 'Valued Payer',
    payerId: input.payerId?.trim() || '',
    totalAmount: input.totalAmount?.trim() || '0.00',
    currencyCode: input.currencyCode?.trim() || 'XCD',
    documentDate: input.documentDate?.trim() || new Date().toISOString().slice(0, 10),
  };
}

export function buildFinanceDocumentCorrelationId(
  documentType: FinanceDocumentType,
  documentNumber: string,
): string {
  return `finance-document-${documentType}:${String(documentNumber ?? '').trim()}`;
}

/**
 * Raise the governed Finance document communication.
 *
 * Total by construction: never throws, so a cashier transaction can never be
 * broken by a communication concern.
 */
export async function emitFinanceDocumentCommunication(
  input: FinanceDocumentEmissionInput,
): Promise<BusinessProducerResult> {
  const scope = await resolveBusinessCommunicationScope({
    moduleCode: FINANCE_MODULE_CODE,
    organizationId: input.organizationId ?? null,
    departmentId: input.departmentId ?? null,
  });

  const payload = buildFinanceDocumentPayload(input);

  return emitBusinessCommunication({
    moduleCode: FINANCE_MODULE_CODE,
    eventCode:
      input.documentType === 'invoice'
        ? FINANCE_INVOICE_ISSUED_EVENT_CODE
        : FINANCE_RECEIPT_ISSUED_EVENT_CODE,
    organizationId: scope.organizationId ?? '',
    departmentId: scope.departmentId,
    entityType: FINANCE_DOCUMENT_ENTITY_TYPES[input.documentType],
    entityId: payload.documentNumber,
    // A document is issued once; re-issuing the same document number is the
    // SAME logical communication and must replay, not duplicate.
    entityVersion: `${input.documentType}-issued-v1`,
    mode: FINANCE_DOCUMENT_MODE,
    correlationId:
      input.correlationId?.trim() ||
      buildFinanceDocumentCorrelationId(input.documentType, payload.documentNumber),
    recipients: [
      {
        recipientType: FINANCE_DOCUMENT_RECIPIENT_TYPE,
        recipientRole: 'payer',
        recipientReference: payload.payerId || payload.documentNumber,
        displayName: payload.payerName,
        email: input.recipientEmail ?? null,
      },
    ],
    payload: payload as unknown as Record<string, unknown>,
  });
}

/** Convenience wrappers so call sites read as business language. */
export const emitFinanceInvoiceIssued = (
  input: Omit<FinanceDocumentEmissionInput, 'documentType'>,
) => emitFinanceDocumentCommunication({ ...input, documentType: 'invoice' });

export const emitFinanceReceiptIssued = (
  input: Omit<FinanceDocumentEmissionInput, 'documentType'>,
) => emitFinanceDocumentCommunication({ ...input, documentType: 'receipt' });
