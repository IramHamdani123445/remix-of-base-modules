// Omni-Comms — shared, server-only Print / Correspondence adapter.
//
// Print is an INTERNAL production channel: the "provider" is the platform's own
// document store. This adapter is the ONLY place where a print artefact is
// produced, and it mirrors the Resend/Twilio adapters exactly:
//
//   * no external credential is used or modelled — production is internal;
//   * a deterministic artefact path derived from the delivery idempotency key
//     means a safe retry of the SAME logical production cannot duplicate an
//     artefact;
//   * a storage transport failure is reported as `outcome_unknown`, never as a
//     definite failure;
//   * only bounded, non-sensitive fields are retained as evidence — the
//     recipient reference is never echoed back in the provider response.

/** Existing shared bucket for archived print artefacts. */
export const OMNI_COMMS_PRINT_BUCKET = "core-documents";

/** Bounded artefact folder inside the shared bucket. */
export const OMNI_COMMS_PRINT_PREFIX = "omni-comms/print";

export type PrintOutcomeStatus = "accepted" | "failed" | "outcome_unknown";

export interface PrintArtefactOutcome {
  status: PrintOutcomeStatus;
  resultCode: string;
  providerMessageId?: string | null;
  providerStatusCode?: number | null;
  providerResponse?: Record<string, unknown>;
  errorCode?: string | null;
  errorDetail?: string | null;
  latencyMs?: number;
}

/** Minimal storage surface — keeps the adapter transport-neutral and testable. */
export interface PrintArtefactStore {
  upload: (
    bucket: string,
    path: string,
    body: Uint8Array,
    contentType: string,
  ) => Promise<{ ok: boolean; errorCode?: string; detail?: string }>;
}

export interface PrintArtefactRequest {
  /** Deterministic reference used as the artefact file name. */
  idempotencyKey: string;
  /** Bounded recipient reference (never a full postal address block). */
  recipientReference: string;
  /** Return/sender reference printed on the artefact. */
  returnReference?: string | null;
  documentTitle: string;
  bodyText: string;
  store: PrintArtefactStore;
}

/** Deterministic, filesystem-safe artefact object path. */
export function printArtefactPath(idempotencyKey: string): string {
  const safe = String(idempotencyKey ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._/-]/g, "-")
    .replace(/^\/+|\/+$/g, "")
    .slice(0, 160);
  return `${OMNI_COMMS_PRINT_PREFIX}/${safe || "artefact"}.txt`;
}

/** Renders the plain-text correspondence artefact. */
export function renderPrintArtefact(req: {
  documentTitle: string;
  bodyText: string;
  recipientReference: string;
  returnReference?: string | null;
}): string {
  const lines = [
    `TITLE: ${req.documentTitle}`,
    `RECIPIENT REFERENCE: ${req.recipientReference}`,
  ];
  if (req.returnReference) lines.push(`RETURN REFERENCE: ${req.returnReference}`);
  lines.push("", req.bodyText, "");
  return lines.join("\n");
}

/**
 * Produces a print/correspondence artefact into the shared document store.
 *
 * `accepted` means the artefact exists and is retrievable — that IS the
 * delivery evidence for this channel, because there is no external carrier
 * callback.
 */
export async function producePrintArtefact(
  req: PrintArtefactRequest,
): Promise<PrintArtefactOutcome> {
  const title = String(req.documentTitle ?? "").trim();
  const recipient = String(req.recipientReference ?? "").trim();
  if (title === "" || recipient === "") {
    return {
      status: "failed",
      resultCode: "configuration_invalid",
      errorCode: "print_artefact_incomplete",
      errorDetail: "A document title and recipient reference are required.",
    };
  }

  const path = printArtefactPath(req.idempotencyKey);
  const content = renderPrintArtefact({
    documentTitle: title,
    bodyText: String(req.bodyText ?? ""),
    recipientReference: recipient,
    returnReference: req.returnReference ?? null,
  });
  const bytes = new TextEncoder().encode(content);
  const startedAt = Date.now();

  let result: { ok: boolean; errorCode?: string; detail?: string };
  try {
    result = await req.store.upload(
      OMNI_COMMS_PRINT_BUCKET,
      path,
      bytes,
      "text/plain; charset=utf-8",
    );
  } catch (_err) {
    // The write may have landed — uncertainty is never reported as failure.
    return {
      status: "outcome_unknown",
      resultCode: "provider_outcome_unknown",
      errorCode: "print_store_unreachable",
      errorDetail: "The document store did not confirm the artefact write.",
      latencyMs: Date.now() - startedAt,
    };
  }

  if (!result.ok) {
    return {
      status: "failed",
      resultCode: "provider_rejected",
      providerStatusCode: 502,
      errorCode: result.errorCode ?? "print_store_rejected",
      errorDetail: result.detail ?? "The document store rejected the artefact.",
      latencyMs: Date.now() - startedAt,
    };
  }

  return {
    status: "accepted",
    resultCode: "provider_accepted",
    providerMessageId: path,
    providerStatusCode: 200,
    providerResponse: {
      artefact_bucket: OMNI_COMMS_PRINT_BUCKET,
      artefact_path: path,
      byte_count: bytes.byteLength,
    },
    latencyMs: Date.now() - startedAt,
  };
}
