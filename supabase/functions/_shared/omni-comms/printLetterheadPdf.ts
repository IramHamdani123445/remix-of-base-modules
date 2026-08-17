// Omni-Comms — designed letterhead PDF renderer.
//
// Renders the SAME letterhead the Communication Hub previews: the layout comes
// from `comm_letterhead.design_config`, the content from the organisation,
// Locations/Branches and Text Blocks, and the imagery from the Media Library.
// The resolver `omni_comms_priv_print_letterhead_effective` produces the input;
// this module only draws it. No configuration is read here.

import type { PrintImageAsset } from "./printImage.ts";

const MM = 2.834645669; // points per millimetre

const PAGE_MM: Record<string, [number, number]> = {
  A4: [210, 297],
  A5: [148, 210],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6],
};

export interface PrintLetterheadAssets {
  logo?: PrintImageAsset | null;
  watermark?: PrintImageAsset | null;
  seal?: PrintImageAsset | null;
  headerBand?: PrintImageAsset | null;
  footerBand?: PrintImageAsset | null;
}

export interface PrintOfficeBlock {
  label?: string | null;
  lines?: readonly string[] | null;
}

export interface PrintLetterheadDesign {
  letterheadId?: string | null;
  letterheadCode?: string | null;
  letterheadName?: string | null;
  letterheadSource?: string | null;
  layoutVariant?: string | null;
  pageSize?: string | null;
  orientation?: string | null;
  margins?: { top?: number; bottom?: number; left?: number; right?: number } | null;
  dividerColor?: string | null;
  officeBlockLayout?: string | null;
  organizationName?: string | null;
  tagline?: string | null;
  headOffice?: PrintOfficeBlock | null;
  branchOffice?: PrintOfficeBlock | null;
  footerNote?: string | null;
  footerNoteSource?: string | null;
  assets?: PrintLetterheadAssets | null;
}

/** Extra print-footer content rendered under the letterhead footer note. */
export interface PrintLetterheadFooter {
  footerLines?: readonly string[] | null;
  pageFooter?: string | null;
}

const BODY_FONT = 11;
const BODY_LEADING = 15;
const HEAD_FONT = 7.2;
const HEAD_LEADING = 9;
const ORG_FONT = 12;
const FOOT_FONT = 7.4;
const FOOT_LEADING = 9.4;

const LOGO_BOX = 62;
const BAND_MAX_HEIGHT_RATIO = 0.16;

function esc(text: string): string {
  return text.replace(/[\\()]/g, (c) => `\\${c}`);
}

function winAnsi(text: string): string {
  // deno-lint-ignore no-control-regex
  return text.replace(/[^\x20-\x7E\u00A0-\u00FF]/g, "?");
}

/** Approximate Helvetica advance width — good enough for centring. */
function textWidth(text: string, size: number, bold = false): number {
  return text.length * size * (bold ? 0.55 : 0.5);
}

function hexToRgb(hex: string | null | undefined): [number, number, number] {
  const value = (hex ?? "").trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return [0.18, 0.49, 0.2];
  return [
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255,
  ];
}

function clean(lines: readonly string[] | null | undefined): string[] {
  return (lines ?? []).map((l) => String(l ?? "").trim()).filter(Boolean);
}

/** Fits an image inside a box while preserving its aspect ratio. */
function fit(asset: PrintImageAsset, maxW: number, maxH: number) {
  const scale = Math.min(maxW / asset.width, maxH / asset.height, 1);
  return { width: asset.width * scale, height: asset.height * scale };
}

export interface LetterheadGeometry {
  pageWidth: number;
  pageHeight: number;
  marginLeft: number;
  marginRight: number;
  bodyTop: number;
  bodyBottom: number;
  bodyWidth: number;
  maxChars: number;
  linesPerPage: number;
  headerHeight: number;
  footerHeight: number;
}

/** Page + chrome geometry for one letterhead design. */
export function letterheadGeometry(
  design: PrintLetterheadDesign,
  footer?: PrintLetterheadFooter | null,
): LetterheadGeometry {
  const size = PAGE_MM[String(design.pageSize ?? "A4")] ?? PAGE_MM.A4;
  const [wmm, hmm] = String(design.orientation ?? "portrait") === "landscape"
    ? [size[1], size[0]]
    : size;
  const pageWidth = wmm * MM;
  const pageHeight = hmm * MM;

  const m = design.margins ?? {};
  const marginLeft = Math.max(18, (m.left ?? 20) * MM);
  const marginRight = Math.max(18, (m.right ?? 20) * MM);
  const marginTop = Math.max(14, (m.top ?? 20) * MM);
  const marginBottom = Math.max(14, (m.bottom ?? 20) * MM);

  const variant = String(design.layoutVariant ?? "ssb_standard");
  const assets = design.assets ?? {};

  // ── header height ──
  let headerHeight = 0;
  if (variant === "image_bands") {
    headerHeight = assets.headerBand
      ? fit(assets.headerBand, pageWidth, pageHeight * BAND_MAX_HEIGHT_RATIO).height + 10
      : 0;
  } else {
    const head = clean(design.headOffice?.lines);
    const branch = clean(design.branchOffice?.lines);
    const stacked = String(design.officeBlockLayout ?? "left_right") === "stacked";
    const blockLines = stacked
      ? (head.length ? head.length + 1 : 0) + (branch.length ? branch.length + 1 : 0)
      : Math.max(head.length ? head.length + 1 : 0, branch.length ? branch.length + 1 : 0);
    const textHeight = (design.organizationName ? ORG_FONT + 6 : 0) +
      blockLines * HEAD_LEADING;
    const logoHeight = assets.logo
      ? fit(assets.logo, LOGO_BOX, LOGO_BOX).height + (design.tagline ? 12 : 0)
      : 0;
    headerHeight = Math.max(textHeight, logoHeight);
    if (headerHeight > 0) headerHeight += 14; // divider + gap
  }

  // ── footer height ──
  const footerNote = clean(design.footerNote ? design.footerNote.split("\n") : []);
  const printFooter = clean(footer?.footerLines);
  const pageFooter = (footer?.pageFooter ?? "").trim();
  let footerHeight = 0;
  if (variant === "image_bands" && assets.footerBand) {
    footerHeight = fit(assets.footerBand, pageWidth, pageHeight * 0.12).height + 6;
  }
  const footerTextLines = footerNote.length + printFooter.length + (pageFooter ? 1 : 0);
  if (footerTextLines) footerHeight += footerTextLines * FOOT_LEADING + 10;

  const bodyTop = pageHeight - marginTop - headerHeight;
  const bodyBottom = marginBottom + footerHeight;
  const bodyWidth = pageWidth - marginLeft - marginRight;
  const maxChars = Math.max(24, Math.floor(bodyWidth / (BODY_FONT * 0.5)));
  const linesPerPage = Math.max(6, Math.floor((bodyTop - bodyBottom) / BODY_LEADING));

  return {
    pageWidth,
    pageHeight,
    marginLeft,
    marginRight,
    bodyTop,
    bodyBottom,
    bodyWidth,
    maxChars,
    linesPerPage,
    headerHeight,
    footerHeight,
  };
}

function latin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

interface RegisteredImage {
  name: string;
  asset: PrintImageAsset;
  id: number;
  maskId: number;
}

/**
 * Builds the full PDF for a designed letterhead.
 * `pages` holds the already-paginated body lines.
 */
export function buildLetterheadPdf(
  pages: readonly (readonly string[])[],
  design: PrintLetterheadDesign,
  footer?: PrintLetterheadFooter | null,
): Uint8Array {
  const g = letterheadGeometry(design, footer);
  const variant = String(design.layoutVariant ?? "ssb_standard");
  const assets = design.assets ?? {};
  const pageCount = Math.max(1, pages.length);

  // ── object ids ──
  // 1 catalog, 2 pages, 3 regular font, 4 bold font, 5 ExtGState
  const objects: (string | Uint8Array[])[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objects[5] = "<< /Type /ExtGState /ca 0.07 /CA 0.07 >>";

  let nextId = 6;
  const images: RegisteredImage[] = [];
  const register = (name: string, asset?: PrintImageAsset | null) => {
    if (!asset) return null;
    const id = nextId++;
    const maskId = asset.alphaDeflate ? nextId++ : 0;
    const entry: RegisteredImage = { name, asset, id, maskId };
    images.push(entry);
    objects[id] = [
      latin1(
        `<< /Type /XObject /Subtype /Image /Width ${asset.width} /Height ${asset.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${
          maskId ? ` /SMask ${maskId} 0 R` : ""
        } /Length ${asset.rgbDeflate.byteLength} >>\nstream\n`,
      ),
      asset.rgbDeflate,
      latin1("\nendstream"),
    ];
    if (maskId) {
      const alpha = asset.alphaDeflate as Uint8Array;
      objects[maskId] = [
        latin1(
          `<< /Type /XObject /Subtype /Image /Width ${asset.width} /Height ${asset.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${alpha.byteLength} >>\nstream\n`,
        ),
        alpha,
        latin1("\nendstream"),
      ];
    }
    return entry;
  };

  const watermark = register("WMK", assets.watermark);
  const logo = variant === "image_bands"
    ? register("LOGO", assets.logo)
    : register("LOGO", assets.logo);
  const seal = variant === "image_bands" ? register("SEAL", assets.seal) : null;
  const headerBand = variant === "image_bands"
    ? register("HDRB", assets.headerBand)
    : null;
  const footerBand = variant === "image_bands"
    ? register("FTRB", assets.footerBand)
    : null;

  const contentIds: number[] = [];
  const pageIds: number[] = [];
  for (let i = 0; i < pageCount; i++) {
    contentIds.push(nextId++);
    pageIds.push(nextId++);
  }
  objects[2] = `<< /Type /Pages /Kids [${
    pageIds.map((id) => `${id} 0 R`).join(" ")
  }] /Count ${pageCount} >>`;

  // ── drawing helpers ──
  const text = (
    value: string,
    x: number,
    y: number,
    size: number,
    bold = false,
  ) =>
    `BT\n/${bold ? "F2" : "F1"} ${size} Tf\n1 0 0 1 ${x.toFixed(2)} ${
      y.toFixed(2)
    } Tm (${esc(winAnsi(value))}) Tj\nET\n`;

  const block = (
    lines: readonly string[],
    x: number,
    y: number,
    size: number,
    leading: number,
    bold = false,
  ) => {
    if (!lines.length) return "";
    const body = lines
      .map((line, i) =>
        i === 0
          ? `1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${
            esc(winAnsi(line))
          }) Tj`
          : `0 -${leading} Td (${esc(winAnsi(line))}) Tj`
      )
      .join("\n");
    return `BT\n/${bold ? "F2" : "F1"} ${size} Tf\n${leading} TL\n${body}\nET\n`;
  };

  const centred = (
    value: string,
    y: number,
    size: number,
    bold = false,
  ) =>
    text(
      value,
      (g.pageWidth - textWidth(value, size, bold)) / 2,
      y,
      size,
      bold,
    );

  const image = (entry: RegisteredImage | null, x: number, y: number, w: number, h: number, alpha = false) =>
    entry
      ? `q\n${alpha ? "/GS0 gs\n" : ""}${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${
        x.toFixed(2)
      } ${y.toFixed(2)} cm\n/${entry.name} Do\nQ\n`
      : "";

  const [dr, dg, db] = hexToRgb(design.dividerColor);
  const rule = (y: number, thickness = 1.1) =>
    `q\n${dr.toFixed(3)} ${dg.toFixed(3)} ${db.toFixed(3)} rg\n${
      g.marginLeft.toFixed(2)
    } ${y.toFixed(2)} ${(g.pageWidth - g.marginLeft - g.marginRight).toFixed(2)} ${thickness} re f\nQ\n`;

  // ── header chrome (identical on every page) ──
  let header = "";
  if (variant === "image_bands") {
    if (headerBand) {
      const dims = fit(headerBand.asset, g.pageWidth, g.pageHeight * BAND_MAX_HEIGHT_RATIO);
      header += image(headerBand, 0, g.pageHeight - dims.height, dims.width, dims.height);
    }
    const marks: RegisteredImage[] = [logo, seal].filter(Boolean) as RegisteredImage[];
    let x = g.pageWidth - g.marginRight;
    for (const mark of marks) {
      const dims = fit(mark.asset, 54, 40);
      x -= dims.width + 6;
      header += image(mark, x, g.pageHeight - g.marginTopSafe(0) || 0, dims.width, dims.height);
    }
  } else {
    const top = g.pageHeight - (design.margins?.top ?? 20) * MM;
    let textX = g.marginLeft;
    if (logo) {
      const dims = fit(logo.asset, LOGO_BOX, LOGO_BOX);
      header += image(logo, g.marginLeft, top - dims.height, dims.width, dims.height);
      if (design.tagline) {
        const tag = design.tagline;
        const size = 6;
        header += text(
          tag,
          g.marginLeft + Math.max(0, (dims.width - textWidth(tag, size)) / 2),
          top - dims.height - 8,
          size,
        );
      }
      textX = g.marginLeft + Math.max(dims.width, LOGO_BOX) + 12;
    }

    let cursor = top - ORG_FONT;
    if (design.organizationName) {
      header += text(design.organizationName, textX, cursor, ORG_FONT, true);
      cursor -= ORG_FONT + 4;
    }

    const head = clean(design.headOffice?.lines);
    const branch = clean(design.branchOffice?.lines);
    const stacked = String(design.officeBlockLayout ?? "left_right") === "stacked";
    const rightX = stacked ? textX : g.pageWidth / 2 + 12;
    let headBottom = cursor;
    if (head.length) {
      const label = (design.headOffice?.label ?? "Head Office:").trim();
      header += block([label, ...head], textX, cursor, HEAD_FONT, HEAD_LEADING, false);
      headBottom = cursor - (head.length + 1) * HEAD_LEADING;
    }
    if (branch.length) {
      const label = (design.branchOffice?.label ?? "Branch Office:").trim();
      const startY = stacked ? headBottom - 4 : cursor;
      header += block([label, ...branch], rightX, startY, HEAD_FONT, HEAD_LEADING, false);
      const bottom = startY - (branch.length + 1) * HEAD_LEADING;
      headBottom = Math.min(headBottom, bottom);
    }
    const ruleY = Math.min(headBottom, g.bodyTop + 8) - 2;
    if (design.organizationName || head.length || branch.length || logo) {
      header += rule(Math.max(ruleY, g.bodyTop + 4));
    }
  }

  // ── footer chrome ──
  const footerNote = clean(design.footerNote ? design.footerNote.split("\n") : []);
  const printFooter = clean(footer?.footerLines);
  const pageFooterTemplate = (footer?.pageFooter ?? "").trim();

  const footerFor = (index: number) => {
    let out = "";
    const marginBottom = Math.max(14, (design.margins?.bottom ?? 20) * MM);
    let y = marginBottom;
    if (variant === "image_bands" && footerBand) {
      const dims = fit(footerBand.asset, g.pageWidth, g.pageHeight * 0.12);
      out += image(footerBand, 0, 0, dims.width, dims.height);
      y = dims.height + 6;
    }
    if (pageFooterTemplate) {
      const value = pageFooterTemplate
        .replace(/\{page\}/gi, String(index + 1))
        .replace(/\{pages\}/gi, String(pageCount));
      out += centred(value, y, FOOT_FONT);
      y += FOOT_LEADING;
    }
    for (const line of [...printFooter].reverse()) {
      out += centred(line, y, FOOT_FONT);
      y += FOOT_LEADING;
    }
    for (const line of [...footerNote].reverse()) {
      out += centred(line, y, FOOT_FONT);
      y += FOOT_LEADING;
    }
    if (footerNote.length || printFooter.length || pageFooterTemplate) {
      out += rule(y + 2, 0.6);
    }
    return out;
  };

  let watermarkOps = "";
  if (watermark) {
    const dims = fit(watermark.asset, g.pageWidth * 0.6, g.pageHeight * 0.6);
    watermarkOps = image(
      watermark,
      (g.pageWidth - dims.width) / 2,
      (g.pageHeight - dims.height) / 2,
      dims.width,
      dims.height,
      true,
    );
  }

  const resourceImages = images.length
    ? ` /XObject << ${images.map((i) => `/${i.name} ${i.id} 0 R`).join(" ")} >>`
    : "";

  (pages.length ? pages : [[]]).forEach((lines, index) => {
    const body = block(lines, g.marginLeft, g.bodyTop - BODY_FONT, BODY_FONT, BODY_LEADING);
    const stream = `${watermarkOps}${header}${body}${footerFor(index)}`;
    objects[contentIds[index]] =
      `<< /Length ${stream.length} >>\nstream\n${stream}endstream`;
    objects[pageIds[index]] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${g.pageWidth.toFixed(2)} ${
        g.pageHeight.toFixed(2)
      }] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /ExtGState << /GS0 5 0 R >>${resourceImages} >> /Contents ${
        contentIds[index]
      } 0 R >>`;
  });

  // ── assemble ──
  const chunks: Uint8Array[] = [latin1("%PDF-1.4\n")];
  let length = chunks[0].byteLength;
  const push = (part: Uint8Array) => {
    chunks.push(part);
    length += part.byteLength;
  };
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    const body = objects[id];
    if (body === undefined) continue;
    offsets[id] = length;
    push(latin1(`${id} 0 obj\n`));
    if (typeof body === "string") push(latin1(body));
    else for (const part of body) push(part);
    push(latin1("\nendobj\n"));
  }
  const xrefOffset = length;
  const total = objects.length;
  let tail = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    tail += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 ${
      offsets[id] === undefined ? "f" : "n"
    } \n`;
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
