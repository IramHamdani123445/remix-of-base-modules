/**
 * Omni-Comms Print — secure archived-PDF access.
 *
 * The operator never sees a bucket, a storage path or a permanent URL. The
 * edge function authorises server-side (tenant + Omni-Comms capability +
 * release control + physical state) and returns a short-lived signed URL for
 * the exact immutable artefact recorded on the Print Item.
 */

export type PrintDocumentMode = 'preview' | 'print';

export interface PrintDocumentInvoker {
  invoke: (
    fn: string,
    options: { body: Record<string, unknown> },
  ) => Promise<{ data: unknown; error: unknown }>;
}

export interface PrintDocumentAccess {
  ok: true;
  mode: PrintDocumentMode;
  url: string;
  expiresInSeconds: number;
  printItem: {
    id: string;
    letterReference: string | null;
    checksumSha256: string;
    byteSize: number | null;
    pageCount: number | null;
    physicalStatus: string;
    version: number;
    attemptId: string | null;
    attemptCount: number;
  };
}

export class PrintDocumentError extends Error {
  readonly errorCode: string;
  constructor(errorCode: string, message?: string) {
    super(message ?? errorCode);
    this.name = 'PrintDocumentError';
    this.errorCode = errorCode;
  }
}

const FUNCTION_NAME = 'omni-comms-print-document';

/** Normalises the function response into an access grant or a coded error. */
export function interpretPrintDocumentResponse(
  data: unknown,
  error: unknown,
): PrintDocumentAccess {
  const payload = data as
    | (Partial<PrintDocumentAccess> & { errorCode?: string; detail?: string })
    | null;

  if (payload && payload.ok === true && payload.url) {
    return payload as PrintDocumentAccess;
  }
  if (payload?.errorCode) {
    throw new PrintDocumentError(payload.errorCode, payload.detail);
  }
  if (error) {
    const message =
      error instanceof Error ? error.message : 'Print document access failed.';
    throw new PrintDocumentError('print_access_failed', message);
  }
  throw new PrintDocumentError('print_access_failed');
}

export async function requestPrintDocument(
  invoker: PrintDocumentInvoker,
  input: {
    printItemId: string;
    mode: PrintDocumentMode;
    expectedVersion?: number | null;
  },
): Promise<PrintDocumentAccess> {
  const { data, error } = await invoker.invoke(FUNCTION_NAME, {
    body: {
      printItemId: input.printItemId,
      mode: input.mode,
      expectedVersion: input.expectedVersion ?? null,
    },
  });
  const resolved = data ?? (await readErrorBody(error));
  return interpretPrintDocumentResponse(resolved, error);
}

/**
 * supabase-js surfaces non-2xx function responses as an error carrying the
 * raw Response. The coded Print payload lives in that body, so read it rather
 * than collapsing every failure into a generic message.
 */
async function readErrorBody(error: unknown): Promise<unknown> {
  const context = (error as { context?: unknown } | null)?.context as
    | { json?: () => Promise<unknown> }
    | undefined;
  if (!context || typeof context.json !== 'function') return null;
  try {
    return await context.json();
  } catch {
    return null;
  }
}
