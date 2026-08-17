// Omni-Comms — Print / Correspondence artefact adapter (internal spool).
//
// This adapter is the `print_spool` implementation. Unlike Resend or Twilio it
// contacts NO external service and requires NO credential: acceptance means a
// genuine, immutable correspondence artefact was rendered and archived in the
// shared document store.
//
// Boundaries (permanent):
//   - Acceptance means ARTEFACT PRODUCED. It never means printed, packed,
//     dispatched or delivered. Physical production is a separate governed
//     lifecycle and is not asserted here.
//   - No external network call, no credential, no provider SDK.
//   - Deterministic: the same idempotency key + same content yields the same
//     storage path and the same document checksum.

import type { PrintImageAsset } from "./printImage.ts";
import {
  buildLetterheadPdf,
  letterheadGeometry,
  type PrintLetterheadDesign,
} from "./printLetterheadPdf.ts";

export type { PrintLetterheadDesign };

/** Bucket holding official generated correspondence artefacts. */
export const OMNI_COMMS_PRINT_BUCKET = "core-documents";


/** Official artefact format for Print / Correspondence. */
export const OMNI_COMMS_PRINT_ARTEFACT_FORMAT = "pdf" as const;
export const OMNI_COMMS_PRINT_ARTEFACT_CONTENT_TYPE = "application/pdf" as const;

export interface PrintArtefactStore {
  upload(
    bucket: string,
    path: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<{ ok: true } | { ok: false; errorCode: string; detail: string }>;
}

/**
 * Effective print stationery resolved by the platform inheritance model
 * (organisation default, overridden by the department profile). The adapter
 * NEVER reads configuration itself — it renders exactly what it is given.
 */
export interface PrintStationery {
  /** Letterhead header block, one text line per rendered line. */
  headerLines?: readonly string[] | null;
  /** Letterhead's own footer block (address strip under the header design). */
  letterheadFooterLines?: readonly string[] | null;
  /** Print footer block from the effective print footer. */
  footerLines?: readonly string[] | null;
  /** Page footer template, supports {page} and {pages}. */
  pageFooter?: string | null;
  letterheadName?: string | null;
  letterheadSource?: string | null;
  printFooterName?: string | null;
  printFooterSource?: string | null;
  /** Decoded letterhead logo drawn at the top of every page. */
  logo?: PrintImageAsset | null;
  /** Name of the logo asset, recorded as artefact provenance. */
  logoName?: string | null;
  /**
   * Fully resolved letterhead design (layout variant, margins, office blocks,
   * media assets). When present the letter is rendered with the SAME design the
   * Communication Hub previews, and the flattened header lines are ignored.
   */
  design?: PrintLetterheadDesign | null;
}


export interface ProducePrintArtefactInput {
  /** Stable idempotency key; drives the deterministic storage path. */
  idempotencyKey: string;
  /** Recipient reference used on the letter (never an email address). */
  recipientReference: string;
  /** Issuing authority / return reference, when configured. */
  returnReference?: string | null;
  documentTitle: string;
  bodyText: string;
  store: PrintArtefactStore;
  /** Optional postal destination snapshot rendered onto the letter. */
  postalDestination?: readonly string[] | null;
  /** Optional template family / version recorded as artefact provenance. */
  templateFamily?: string | null;
  templateVersion?: string | null;
  /** Effective letterhead / print footer for this organisation + department. */
  stationery?: PrintStationery | null;
  /**
   * Channel of the template variant the content came from.
   * Print is NEVER derived from an Email (or any other) variant: when a
   * source channel is supplied it MUST be `print`, otherwise production
   * fails closed with `print_variant_required`.
   */
  sourceChannel?: string | null;
}



export interface PrintArtefactOutcome {
  status: "accepted" | "failed" | "outcome_unknown";
  resultCode: string;
  providerMessageId?: string | null;
  providerStatusCode?: number | null;
  providerResponse?: Record<string, unknown>;
  errorCode?: string | null;
  errorDetail?: string | null;
  latencyMs?: number;
}

// ─── Deterministic helpers ────────────────────────────────────────────

/** URL/storage safe slug derived from an arbitrary reference. */
function slug(value: string, max = 96): string {
  const s = value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return (s || "artefact").slice(0, max);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Deterministic letter reference derived from the idempotency key. */
export async function printLetterReference(idempotencyKey: string): Promise<string> {
  const hash = await sha256Hex(new TextEncoder().encode(idempotencyKey));
  return `LTR-${hash.slice(0, 12).toUpperCase()}`;
}

// ─── Minimal deterministic PDF writer ─────────────────────────────────
// A dependency-free PDF 1.4 writer. Only WinAnsi-safe text is emitted, so the
// built-in Helvetica font renders every character we write.

const PAGE_WIDTH = 595.28; // A4 portrait, points
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const FONT_SIZE = 11;
const LINE_HEIGHT = 15;
const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - MARGIN * 2) / LINE_HEIGHT);
const MAX_CHARS_PER_LINE = 92;

function pdfEscape(text: string): string {
  return text.replace(/[\\()]/g, (c) => `\\${c}`);
}

/** Replaces characters the built-in font cannot render. */
function winAnsi(text: string): string {
  // deno-lint-ignore no-control-regex
  return text.replace(/[^\x20-\x7E\u00A0-\u00FF]/g, "?");
}

export function wrapPrintLines(text: string, width = MAX_CHARS_PER_LINE): string[] {
  const out: string[] = [];
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (line.length <= width) {
      out.push(line);
      continue;
    }
    let current = "";
    for (const word of line.split(/\s+/)) {
      if (!current) {
        current = word;
      } else if ((current + " " + word).length <= width) {
        current += " " + word;
      } else {
        out.push(current);
        current = word;
      }
      while (current.length > width) {
        out.push(current.slice(0, width));
        current = current.slice(width);
      }
    }
    if (current) out.push(current);
  }
  return out;
}

/** Normalises a stationery block into safe, wrapped text lines. */
export function stationeryBlock(
  lines: readonly string[] | null | undefined,
): string[] {
  const out: string[] = [];
  for (const raw of lines ?? []) {
    const value = String(raw ?? "").trim();
    if (!value) continue;
    out.push(...wrapPrintLines(value));
  }
  return out;
}

/** Maximum drawn size of the letterhead logo, in points. */
const LOGO_MAX_HEIGHT = 52;
const LOGO_MAX_WIDTH = 170;

/** Drawn geometry for the letterhead logo, when one is supplied. */
function logoGeometry(stationery?: PrintStationery | null) {
  const logo = stationery?.logo;
  if (!logo || !logo.width || !logo.height) return null;
  const scale = Math.min(
    LOGO_MAX_HEIGHT / logo.height,
    LOGO_MAX_WIDTH / logo.width,
  );
  const width = Math.max(1, logo.width * scale);
  const height = Math.max(1, logo.height * scale);
  return { logo, width, height, reservedLines: Math.ceil((height + 8) / LINE_HEIGHT) };
}

/** Lines reserved by the stationery header / footer on every page. */
function stationeryReservation(stationery?: PrintStationery | null) {
  const header = stationeryBlock(stationery?.headerLines);
  const headerFoot = stationeryBlock(stationery?.letterheadFooterLines);
  const footer = stationeryBlock(stationery?.footerLines);
  const pageFooter = (stationery?.pageFooter ?? "").trim();
  const logo = logoGeometry(stationery);
  const headerLines = header.length || headerFoot.length
    ? [...header, ...headerFoot, "".padEnd(MAX_CHARS_PER_LINE, "_"), ""]
    : [];
  const footerLines = footer.length || pageFooter
    ? ["".padEnd(MAX_CHARS_PER_LINE, "_"), ...footer]
    : [];
  return { headerLines, footerLines, pageFooter, logo };
}

export function paginatePrintLines(
  lines: readonly string[],
  stationery?: PrintStationery | null,
): string[][] {
  let perPage: number;
  if (stationery?.design) {
    perPage = letterheadGeometry(stationery.design, {
      footerLines: stationery.footerLines ?? null,
      pageFooter: stationery.pageFooter ?? null,
    }).linesPerPage;
  } else {
    const { headerLines, footerLines, pageFooter, logo } = stationeryReservation(
      stationery,
    );
    const reserved = headerLines.length + footerLines.length +
      (pageFooter ? 1 : 0) + (logo?.reservedLines ?? 0);
    perPage = Math.max(5, LINES_PER_PAGE - reserved);
  }
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += perPage) {
    pages.push(lines.slice(i, i + perPage));
  }
  return pages.length ? pages : [[]];
}

/** Latin-1 encodes PDF syntax so binary streams survive assembly. */
function latin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** Builds a deterministic single- or multi-page PDF document. */
export function buildPrintPdf(
  pages: readonly (readonly string[])[],
  stationery?: PrintStationery | null,
): Uint8Array {
  const objects: (string | Uint8Array[])[] = [];
  const pageCount = pages.length;
  const { headerLines, footerLines, pageFooter, logo } = stationeryReservation(
    stationery,
  );
  // 1 = Catalog, 2 = Pages, 3 = Font, 4/5 = logo image + soft mask (optional),
  // then per page: content + page object.
  const logoId = logo ? 4 : 0;
  const maskId = logo?.logo.alphaDeflate ? 5 : 0;
  const firstPageId = 4 + (logo ? 1 : 0) + (maskId ? 1 : 0);
  const contentIds: number[] = [];
  const pageIds: number[] = [];
  for (let i = 0; i < pageCount; i++) {
    contentIds.push(firstPageId + i * 2);
    pageIds.push(firstPageId + 1 + i * 2);
  }

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${
    pageIds.map((id) => `${id} 0 R`).join(" ")
  }] /Count ${pageCount} >>`;
  objects[3] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";

  if (logo) {
    objects[logoId] = [
      latin1(
        `<< /Type /XObject /Subtype /Image /Width ${logo.logo.width} /Height ${logo.logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${
          maskId ? ` /SMask ${maskId} 0 R` : ""
        } /Length ${logo.logo.rgbDeflate.byteLength} >>\nstream\n`,
      ),
      logo.logo.rgbDeflate,
      latin1("\nendstream"),
    ];
    if (maskId) {
      const alpha = logo.logo.alphaDeflate as Uint8Array;
      objects[maskId] = [
        latin1(
          `<< /Type /XObject /Subtype /Image /Width ${logo.logo.width} /Height ${logo.logo.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${alpha.byteLength} >>\nstream\n`,
        ),
        alpha,
        latin1("\nendstream"),
      ];
    }
  }

  const draw = (lines: readonly string[], startY: number) =>
    lines
      .map((line, i) =>
        i === 0
          ? `1 0 0 1 ${MARGIN} ${startY.toFixed(2)} Tm (${
            pdfEscape(winAnsi(line))
          }) Tj`
          : `0 -${LINE_HEIGHT} Td (${pdfEscape(winAnsi(line))}) Tj`
      )
      .join("\n");

  pages.forEach((lines, index) => {
    const foot = pageFooter
      ? [
        ...footerLines,
        pageFooter
          .replace(/\{page\}/gi, String(index + 1))
          .replace(/\{pages\}/gi, String(pageCount)),
      ]
      : footerLines;
    let topY = PAGE_HEIGHT - MARGIN;
    let imageBlock = "";
    if (logo) {
      const y = topY - logo.height;
      imageBlock = `q\n${logo.width.toFixed(2)} 0 0 ${
        logo.height.toFixed(2)
      } ${MARGIN} ${y.toFixed(2)} cm\n/LOGO Do\nQ\n`;
      topY = y - 10;
    }
    const blocks: string[] = [];
    if (headerLines.length) blocks.push(draw(headerLines, topY));
    const bodyY = topY - headerLines.length * LINE_HEIGHT;
    if (lines.length) blocks.push(draw(lines, bodyY));
    if (foot.length) {
      blocks.push(draw(foot, MARGIN + (foot.length - 1) * LINE_HEIGHT));
    }
    const stream = `${imageBlock}BT\n/F1 ${FONT_SIZE} Tf\n${LINE_HEIGHT} TL\n${
      blocks.join("\n")
    }\nET\n`;
    objects[contentIds[index]] =
      `<< /Length ${stream.length} >>\nstream\n${stream}endstream`;
    objects[pageIds[index]] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${
      PAGE_WIDTH.toFixed(2)
    } ${PAGE_HEIGHT.toFixed(2)}] /Resources << /Font << /F1 3 0 R >>${
      logo ? ` /XObject << /LOGO ${logoId} 0 R >>` : ""
    } >> /Contents ${contentIds[index]} 0 R >>`;
  });

  const chunks: Uint8Array[] = [latin1("%PDF-1.4\n")];
  let length = chunks[0].byteLength;
  const push = (part: Uint8Array) => {
    chunks.push(part);
    length += part.byteLength;
  };
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = length;
    push(latin1(`${id} 0 obj\n`));
    const body = objects[id];
    if (typeof body === "string") push(latin1(body));
    else for (const part of body) push(part);
    push(latin1("\nendobj\n"));
  }
  const xrefOffset = length;
  const total = objects.length; // ids 1..objects.length-1 plus free entry
  let tail = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    tail += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  tail +=
    `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  push(latin1(tail));

  const pdf = new Uint8Array(length);
  let cursor = 0;
  for (const part of chunks) {
    pdf.set(part, cursor);
    cursor += part.byteLength;
  }
  return pdf;
}


/** Composes the correspondence body, including its provenance block. */
export function composePrintDocument(input: {
  letterReference: string;
  documentTitle: string;
  bodyText: string;
  recipientReference: string;
  returnReference?: string | null;
  postalDestination?: readonly string[] | null;
  templateFamily?: string | null;
  templateVersion?: string | null;
}): string[] {
  const head: string[] = [];
  if (input.returnReference) head.push(input.returnReference);
  head.push(`Letter reference: ${input.letterReference}`);
  head.push("");
  head.push("To:");
  head.push(input.recipientReference);
  for (const line of input.postalDestination ?? []) head.push(line);
  head.push("");
  head.push(input.documentTitle);
  head.push("");
  const foot: string[] = [""];
  if (input.templateFamily) {
    foot.push(
      `Template: ${input.templateFamily}${
        input.templateVersion ? ` v${input.templateVersion}` : ""
      }`,
    );
  }
  return [...head, ...wrapPrintLines(input.bodyText), ...foot];
}


/**
 * Renders and archives one correspondence artefact.
 *
 * Acceptance = artefact produced and stored. The returned
 * `providerMessageId` is the immutable storage path of the artefact.
 */
export async function producePrintArtefact(
  input: ProducePrintArtefactInput,
): Promise<PrintArtefactOutcome> {
  const started = Date.now();
  if (
    typeof input.sourceChannel === "string" &&
    input.sourceChannel.trim().toLowerCase() !== "print"
  ) {
    return {
      status: "failed",
      resultCode: "print_variant_required",
      errorCode: "print_variant_required",
      errorDetail:
        "Print artefacts must be produced from a print template variant, never from another channel's rendered content.",
      latencyMs: Date.now() - started,
    };
  }
  try {
    const letterReference = await printLetterReference(input.idempotencyKey);

    const lines = composePrintDocument({
      letterReference,
      documentTitle: input.documentTitle,
      bodyText: input.bodyText,
      recipientReference: input.recipientReference,
      returnReference: input.returnReference ?? null,
      postalDestination: input.postalDestination ?? null,
      templateFamily: input.templateFamily ?? null,
      templateVersion: input.templateVersion ?? null,
    });
    const pages = paginatePrintLines(lines, input.stationery ?? null);
    const bytes = buildPrintPdf(pages, input.stationery ?? null);
    const checksum = await sha256Hex(bytes);
    const path = `omni-comms/print/${slug(input.idempotencyKey)}/${letterReference}.pdf`;

    const stored = await input.store.upload(
      OMNI_COMMS_PRINT_BUCKET,
      path,
      bytes,
      OMNI_COMMS_PRINT_ARTEFACT_CONTENT_TYPE,
    );
    if (!stored.ok) {
      return {
        status: "failed",
        resultCode: "artefact_store_rejected",
        errorCode: stored.errorCode,
        errorDetail: stored.detail,
        latencyMs: Date.now() - started,
      };
    }

    return {
      status: "accepted",
      resultCode: "artefact_produced",
      providerMessageId: path,
      providerStatusCode: 201,
      providerResponse: {
        artefact_format: OMNI_COMMS_PRINT_ARTEFACT_FORMAT,
        artefact_bucket: OMNI_COMMS_PRINT_BUCKET,
        artefact_path: path,
        artefact_bytes: bytes.byteLength,
        document_checksum_sha256: checksum,
        letter_reference: letterReference,
        page_count: pages.length,
        recipient_reference: input.recipientReference,
        postal_destination: input.postalDestination ?? null,
        template_family: input.templateFamily ?? null,
        template_version: input.templateVersion ?? null,
        
        letterhead_name: input.stationery?.letterheadName ?? null,
        letterhead_source: input.stationery?.letterheadSource ?? null,
        print_footer_name: input.stationery?.printFooterName ?? null,
        print_footer_source: input.stationery?.printFooterSource ?? null,
        letterhead_logo_name: input.stationery?.logoName ?? null,
        letterhead_logo_embedded: Boolean(input.stationery?.logo),

        // Truthful physical state: nothing has been printed or dispatched.
        physical_state: "artefact_produced",
      },
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    return {
      status: "failed",
      resultCode: "artefact_render_failed",
      errorCode: "artefact_render_failed",
      errorDetail: error instanceof Error ? error.message : "Artefact render failed.",
      latencyMs: Date.now() - started,
    };
  }
}
