// Omni-Comms — Print stationery image support.
//
// Dependency-free PNG decoding for letterhead logos and seals so official
// printed correspondence carries the same branding operators see in the
// Communication & Documents template preview.
//
// Only what a PDF needs is produced: a zlib (FlateDecode) compressed RGB
// stream plus an optional zlib compressed 8-bit soft mask for transparency.

export interface PrintImageAsset {
  /** Pixel width of the decoded image. */
  width: number;
  /** Pixel height of the decoded image. */
  height: number;
  /** zlib-compressed 8-bit RGB samples (DeviceRGB, 3 components). */
  rgbDeflate: Uint8Array;
  /** zlib-compressed 8-bit alpha samples used as the PDF /SMask. */
  alphaDeflate?: Uint8Array | null;
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(
    new DecompressionStream("deflate"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(
    new CompressionStream("deflate"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Decodes a non-interlaced 8-bit PNG (grey, RGB, grey+alpha or RGBA) into
 * PDF-ready compressed streams. Returns `null` when the PNG uses a feature
 * outside that envelope — the caller then renders text-only stationery
 * instead of failing the letter.
 */
export async function decodePngForPdf(
  bytes: Uint8Array,
): Promise<PrintImageAsset | null> {
  if (bytes.length < 24) return null;
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  const idat: Uint8Array[] = [];

  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    const dataStart = offset + 8;
    if (dataStart + length > bytes.length) break;
    if (type === "IHDR") {
      width = view.getUint32(dataStart);
      height = view.getUint32(dataStart + 4);
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      interlace = bytes[dataStart + 12];
    } else if (type === "IDAT") {
      idat.push(bytes.subarray(dataStart, dataStart + length));
    } else if (type === "IEND") {
      break;
    }
    offset = dataStart + length + 4;
  }

  if (!width || !height || bitDepth !== 8 || interlace !== 0) return null;
  if (![0, 2, 4, 6].includes(colorType)) return null;
  if (!idat.length) return null;

  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : 4;
  const total = idat.reduce((sum, part) => sum + part.length, 0);
  const compressed = new Uint8Array(total);
  let cursor = 0;
  for (const part of idat) {
    compressed.set(part, cursor);
    cursor += part.length;
  }

  let raw: Uint8Array;
  try {
    raw = await inflate(compressed);
  } catch {
    return null;
  }

  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return null;

  const pixels = new Uint8Array(stride * height);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const out = pixels.subarray(y * stride, y * stride + stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? out[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) value += paeth(left, up, upLeft);
      out[x] = value & 0xff;
    }
    previous = out;
  }

  const rgb = new Uint8Array(width * height * 3);
  const hasAlpha = colorType === 4 || colorType === 6;
  const alpha = hasAlpha ? new Uint8Array(width * height) : null;
  for (let i = 0; i < width * height; i++) {
    const src = i * channels;
    if (colorType === 0 || colorType === 4) {
      const grey = pixels[src];
      rgb[i * 3] = grey;
      rgb[i * 3 + 1] = grey;
      rgb[i * 3 + 2] = grey;
      if (alpha) alpha[i] = colorType === 4 ? pixels[src + 1] : 255;
    } else {
      rgb[i * 3] = pixels[src];
      rgb[i * 3 + 1] = pixels[src + 1];
      rgb[i * 3 + 2] = pixels[src + 2];
      if (alpha) alpha[i] = colorType === 6 ? pixels[src + 3] : 255;
    }
  }

  return {
    width,
    height,
    rgbDeflate: await deflate(rgb),
    alphaDeflate: alpha ? await deflate(alpha) : null,
  };
}
