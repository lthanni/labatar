/** A narrow reader for the PAK and type-6 munged assets used by the portrait importer. */

export type PakEntry = { name: string; offset: number; size: number };
export type DecodedPortrait = {
  sourcePath: string;
  width: number;
  height: number;
  pixels: Uint8Array;
};

const archiveEntryBytes = 256;
const maxDirectoryBytes = archiveEntryBytes * 100_000;
const maxImageBytes = 64 * 1024 * 1024;
const textDecoder = new TextDecoder("utf-8");
const portraitEntryPattern =
  /^srcdata\/munged\/frames\/sprites~[a-z0-9_]+~hud~art~(?:portraitart|support[1-3](?:-[a-z0-9_-]+)?)\.munged$/i;

export function portraitPakRelativePath(
  archiveName: string,
  filters: readonly string[],
): string | null {
  const relativePath = archiveName.replace(/\\/g, "/");
  if (!portraitEntryPattern.test(relativePath)) return null;
  const lowerPath = relativePath.toLowerCase();
  return filters.some((filter) => lowerPath.includes(filter.toLowerCase())) ? relativePath : null;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readU32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) throw new Error("Truncated artwork data.");
  return view(bytes).getUint32(offset, true);
}

export function parsePakHeader(
  header: Uint8Array,
  archiveBytes: number,
): {
  directoryOffset: number;
  directoryBytes: number;
} {
  if (header.length < 12 || textDecoder.decode(header.subarray(0, 4)) !== "PACK") {
    throw new Error("Not an Avatar Legends PAK archive.");
  }
  const directoryOffset = readU32(header, 4);
  const directoryBytes = readU32(header, 8);
  if (
    directoryBytes === 0 ||
    directoryBytes > maxDirectoryBytes ||
    directoryBytes % archiveEntryBytes !== 0 ||
    directoryOffset < 12 ||
    directoryOffset + directoryBytes > archiveBytes
  ) {
    throw new Error("Invalid PAK directory.");
  }
  return { directoryOffset, directoryBytes };
}

export function parsePakDirectory(directory: Uint8Array, archiveBytes: number): PakEntry[] {
  if (directory.length % archiveEntryBytes !== 0 || directory.length > maxDirectoryBytes) {
    throw new Error("Invalid PAK directory size.");
  }
  const entries: PakEntry[] = [];
  for (let at = 0; at < directory.length; at += archiveEntryBytes) {
    const nameBytes = directory.subarray(at, at + 248);
    const terminator = nameBytes.indexOf(0);
    const name = textDecoder.decode(nameBytes.subarray(0, terminator < 0 ? 248 : terminator));
    const offset = readU32(directory, at + 248);
    const size = readU32(directory, at + 252);
    if (!name || offset + size > archiveBytes) throw new Error("Invalid PAK file entry.");
    entries.push({ name, offset, size });
  }
  return entries;
}

export function decodeLz4Block(source: Uint8Array, expectedBytes: number): Uint8Array {
  if (expectedBytes < 0 || expectedBytes > maxImageBytes) throw new Error("Image is too large.");
  const output = new Uint8Array(expectedBytes);
  let inputAt = 0;
  let outputAt = 0;
  while (inputAt < source.length) {
    const token = source[inputAt++];
    let literalBytes = token >> 4;
    if (literalBytes === 15) {
      let extra: number;
      do {
        if (inputAt >= source.length) throw new Error("Truncated LZ4 literal length.");
        extra = source[inputAt++];
        literalBytes += extra;
      } while (extra === 255);
    }
    if (inputAt + literalBytes > source.length || outputAt + literalBytes > output.length) {
      throw new Error("Invalid LZ4 literal run.");
    }
    output.set(source.subarray(inputAt, inputAt + literalBytes), outputAt);
    inputAt += literalBytes;
    outputAt += literalBytes;
    if (inputAt === source.length) break;
    if (inputAt + 2 > source.length) throw new Error("Truncated LZ4 match offset.");
    const back = source[inputAt] | (source[inputAt + 1] << 8);
    inputAt += 2;
    let matchBytes = (token & 15) + 4;
    if ((token & 15) === 15) {
      let extra: number;
      do {
        if (inputAt >= source.length) throw new Error("Truncated LZ4 match length.");
        extra = source[inputAt++];
        matchBytes += extra;
      } while (extra === 255);
    }
    if (back < 1 || back > outputAt || outputAt + matchBytes > output.length) {
      throw new Error("Invalid LZ4 match.");
    }
    for (let i = 0; i < matchBytes; i++) output[outputAt + i] = output[outputAt + i - back];
    outputAt += matchBytes;
  }
  if (outputAt !== expectedBytes) throw new Error("Incomplete LZ4 image block.");
  return output;
}

export function decodePortraitMunged(raw: Uint8Array): DecodedPortrait {
  if (raw.length < 96 || raw[0x1a] !== 6) {
    throw new Error("Only type-6 munged portrait images are supported.");
  }
  const nameLength = raw[0x1b] - 1;
  if (nameLength < 1 || nameLength > 240 || 0x20 + nameLength + 44 > raw.length) {
    throw new Error("Invalid munged image header.");
  }
  const sourcePath = textDecoder.decode(raw.subarray(0x20, 0x20 + nameLength));
  if (!sourcePath.toLowerCase().endsWith(".png")) throw new Error("Not a PNG artwork frame.");
  const dimensionsAt = 0x20 + nameLength + 8;
  const width = readU32(raw, dimensionsAt);
  const height = readU32(raw, dimensionsAt + 4);
  const packedWidth = readU32(raw, dimensionsAt + 16);
  const packedHeight = readU32(raw, dimensionsAt + 20);
  const tileColumns = readU32(raw, dimensionsAt + 28);
  const tileRows = readU32(raw, dimensionsAt + 32);
  if (
    width < 1 ||
    height < 1 ||
    width > 4096 ||
    height > 4096 ||
    tileColumns !== Math.ceil(width / 32) ||
    tileRows !== Math.ceil(height / 32)
  ) {
    throw new Error("Invalid portrait dimensions or tile layout.");
  }
  const tileCount = tileColumns * tileRows;
  const packedColumns = Math.min(tileCount, 30);
  const expectedWidth = packedColumns * 34;
  const expectedHeight = Math.ceil(tileCount / packedColumns) * 34;
  const unpackedBytes = expectedWidth * expectedHeight * 4;
  if (
    packedWidth !== expectedWidth ||
    packedHeight !== expectedHeight ||
    unpackedBytes > maxImageBytes
  ) {
    throw new Error("Unsupported portrait tile packing.");
  }
  let blockAt = -1;
  for (let at = dimensionsAt + 36; at + 8 <= Math.min(raw.length, dimensionsAt + 512); at++) {
    if (readU32(raw, at) === unpackedBytes && readU32(raw, at + 4) === raw.length - at - 8) {
      blockAt = at + 8;
      break;
    }
  }
  if (blockAt < 0) throw new Error("Missing compressed portrait block.");
  const packed = decodeLz4Block(raw.subarray(blockAt), unpackedBytes);
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tileIndex = Math.floor(y / 32) * tileColumns + Math.floor(x / 32);
      const packedX = (tileIndex % packedColumns) * 34 + (x % 32) + 1;
      const packedY = Math.floor(tileIndex / packedColumns) * 34 + (y % 32) + 1;
      const sourceAt = (packedY * packedWidth + packedX) * 4;
      pixels.set(packed.subarray(sourceAt, sourceAt + 4), (y * width + x) * 4);
    }
  }
  return { sourcePath, width, height, pixels };
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) * 0xedb88320);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(data.length + 12);
  const metadata = view(chunk);
  metadata.setUint32(0, data.length);
  chunk.set(new TextEncoder().encode(type), 4);
  chunk.set(data, 8);
  metadata.setUint32(chunk.length - 4, crc32(chunk.subarray(4, chunk.length - 4)));
  return chunk;
}

export function encodePngRgba(
  width: number,
  height: number,
  pixels: Uint8Array,
  deflate: (scanlines: Uint8Array) => Uint8Array,
): Uint8Array {
  if (width < 1 || height < 1 || pixels.length !== width * height * 4) {
    throw new Error("Invalid PNG pixel data.");
  }
  const ihdr = new Uint8Array(13);
  view(ihdr).setUint32(0, width);
  view(ihdr).setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const scanlines = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    scanlines.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const idat = deflate(scanlines);
  const chunks = [
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", new Uint8Array()),
  ];
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    result.set(chunk, at);
    at += chunk.length;
  }
  return result;
}
