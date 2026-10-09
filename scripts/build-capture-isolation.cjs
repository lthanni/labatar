const fs = require("node:fs");
const path = require("node:path");

const PAK_ENTRY_BYTES = 256;
const PAK_NAME_BYTES = 248;
const PAK_ALIGNMENT = 4096;
const TRANSPARENT_TYPE_3 = Buffer.from([0, 255, 0, 0]);
const TRANSPARENT_TYPE_6 = Buffer.alloc(4);

function readAt(fd, bytes, offset) {
  const buffer = Buffer.alloc(bytes);
  let read = 0;
  while (read < bytes) {
    const count = fs.readSync(fd, buffer, read, bytes - read, offset + read);
    if (!count) throw new Error("Unexpected end of PAK data.");
    read += count;
  }
  return buffer;
}

function writeAt(fd, buffer, offset) {
  let written = 0;
  while (written < buffer.length) {
    const count = fs.writeSync(fd, buffer, written, buffer.length - written, offset + written);
    if (!count) throw new Error("Could not finish writing the PAK.");
    written += count;
  }
}

function pakEntries(fd) {
  const size = fs.fstatSync(fd).size;
  const header = readAt(fd, 12, 0);
  if (header.toString("ascii", 0, 4) !== "PACK") throw new Error("Invalid PAK signature.");
  const directoryOffset = header.readUInt32LE(4);
  const directoryBytes = header.readUInt32LE(8);
  if (
    directoryBytes === 0 ||
    directoryBytes % PAK_ENTRY_BYTES !== 0 ||
    directoryOffset < 12 ||
    directoryOffset + directoryBytes !== size
  ) {
    throw new Error("Invalid PAK directory.");
  }
  const directory = readAt(fd, directoryBytes, directoryOffset);
  const entries = [];
  const names = new Set();
  for (let at = 0; at < directory.length; at += PAK_ENTRY_BYTES) {
    const rawName = directory.subarray(at, at + PAK_NAME_BYTES);
    const terminator = rawName.indexOf(0);
    const name = rawName.subarray(0, terminator < 0 ? PAK_NAME_BYTES : terminator).toString("utf8");
    const offset = directory.readUInt32LE(at + PAK_NAME_BYTES);
    const bytes = directory.readUInt32LE(at + PAK_NAME_BYTES + 4);
    if (!name || names.has(name.toLowerCase()) || offset < 12 || offset + bytes > directoryOffset) {
      throw new Error(`Invalid PAK entry: ${name}`);
    }
    names.add(name.toLowerCase());
    entries.push({ name, offset, bytes });
  }
  return entries;
}

function lengthBytes(length) {
  const bytes = [];
  do {
    const part = Math.min(length, 255);
    bytes.push(part);
    length -= part;
  } while (bytes.at(-1) === 255);
  return Buffer.from(bytes);
}

function solidLz4(rawBytes, pixel) {
  if (rawBytes % 4 !== 0) throw new Error("Pixel chunk is not RGBA aligned.");
  if (rawBytes < 16) {
    const raw = Buffer.alloc(rawBytes);
    for (let at = 0; at < rawBytes; at += 4) pixel.copy(raw, at);
    return Buffer.concat([Buffer.from([rawBytes << 4]), raw]);
  }

  // Four literal bytes seed the repeated pixel. Eight final literals satisfy
  // LZ4's end-of-block rule, so the replacement stays small even for big atlases.
  const matchExtra = rawBytes - 12 - 4;
  const token = (4 << 4) | Math.min(matchExtra, 15);
  const extension = matchExtra >= 15 ? lengthBytes(matchExtra - 15) : Buffer.alloc(0);
  return Buffer.concat([
    Buffer.from([token]),
    pixel,
    Buffer.from([4, 0]),
    extension,
    Buffer.from([8 << 4]),
    pixel,
    pixel,
  ]);
}

function transparentMunged(raw) {
  if (raw.length < 91 || raw.readUInt32LE(0) !== 24) throw new Error("Invalid munged image.");
  const imageType = raw[26];
  if (imageType !== 3 && imageType !== 6) throw new Error(`Unsupported munged type ${imageType}.`);
  const nameEnd = 31 + raw.readUInt32LE(27);
  if (nameEnd + 60 > raw.length) throw new Error("Truncated munged geometry.");
  const atlasWidth = raw.readUInt32LE(nameEnd + 6 * 4);
  const atlasHeight = raw.readUInt32LE(nameEnd + 7 * 4);
  const tileCount = raw.readUInt32LE(nameEnd + 14 * 4);
  const chunkCountAt = nameEnd + 60 + Math.ceil(tileCount / 8);
  if (chunkCountAt + 4 > raw.length) throw new Error("Truncated munged occupancy.");
  const chunkCount = raw.readUInt32LE(chunkCountAt);
  if (chunkCount < 1 || chunkCount > 4096) throw new Error("Invalid munged chunk count.");
  const prefix = raw.subarray(0, chunkCountAt + 4);
  const parts = [prefix];
  const pixel = imageType === 3 ? TRANSPARENT_TYPE_3 : TRANSPARENT_TYPE_6;
  let at = chunkCountAt + 4;
  let totalRawBytes = 0;
  for (let chunk = 0; chunk < chunkCount; chunk++) {
    if (at + 12 > raw.length) throw new Error("Truncated munged chunk header.");
    const sectionBytes = raw.readUInt32LE(at);
    const rawBytes = raw.readUInt32LE(at + 4);
    const streamBytes = raw.readUInt32LE(at + 8);
    at += 12;
    if (sectionBytes !== streamBytes + 8 || at + streamBytes > raw.length) {
      throw new Error("Invalid munged chunk bounds.");
    }
    const stream = solidLz4(rawBytes, pixel);
    const header = Buffer.alloc(12);
    header.writeUInt32LE(stream.length + 8, 0);
    header.writeUInt32LE(rawBytes, 4);
    header.writeUInt32LE(stream.length, 8);
    parts.push(header, stream);
    at += streamBytes;
    totalRawBytes += rawBytes;
  }
  if (at !== raw.length || totalRawBytes !== atlasWidth * atlasHeight * 4) {
    throw new Error("Munged image has unexpected trailing data or atlas size.");
  }
  return Buffer.concat(parts);
}

function buildHiddenImagesPak(source, destination) {
  const packageName = path.basename(source).toLowerCase();
  if (packageName !== "korra.pak" && packageName !== "hud.pak") {
    throw new Error("This builder only accepts the Korra or fight HUD package.");
  }
  if (path.resolve(source).toLowerCase() === path.resolve(destination).toLowerCase()) {
    throw new Error("Source and destination must differ.");
  }
  const sourceFd = fs.openSync(source, "r");
  let destinationFd;
  let created = false;
  try {
    const entries = pakEntries(sourceFd);
    destinationFd = fs.openSync(destination, "wx");
    created = true;
    const leading = Buffer.alloc(PAK_ALIGNMENT);
    leading.write("PACK", 0, "ascii");
    writeAt(destinationFd, leading, 0);
    const outputEntries = [];
    let nextOffset = PAK_ALIGNMENT;
    let changed = 0;
    const imageTypes = { 3: 0, 6: 0 };
    for (const entry of entries) {
      const sourceBytes = readAt(sourceFd, entry.bytes, entry.offset);
      const replace = entry.name.endsWith(".munged");
      const bytes = replace ? transparentMunged(sourceBytes) : sourceBytes;
      if (replace) {
        changed++;
        imageTypes[sourceBytes[26]]++;
      }
      writeAt(destinationFd, bytes, nextOffset);
      outputEntries.push({ name: entry.name, offset: nextOffset, bytes: bytes.length });
      nextOffset += bytes.length;
      const padding = (PAK_ALIGNMENT - (nextOffset % PAK_ALIGNMENT)) % PAK_ALIGNMENT;
      if (padding) writeAt(destinationFd, Buffer.alloc(padding), nextOffset);
      nextOffset += padding;
    }
    if (changed === 0) throw new Error("No image entries were replaced.");
    const last = outputEntries.at(-1);
    const directoryOffset = last.offset + last.bytes;
    const directory = Buffer.alloc(outputEntries.length * PAK_ENTRY_BYTES);
    for (let index = 0; index < outputEntries.length; index++) {
      const entry = outputEntries[index];
      const nameBytes = Buffer.from(entry.name, "utf8");
      if (nameBytes.length >= PAK_NAME_BYTES) throw new Error(`PAK path too long: ${entry.name}`);
      nameBytes.copy(directory, index * PAK_ENTRY_BYTES);
      directory.writeUInt32LE(entry.offset, index * PAK_ENTRY_BYTES + PAK_NAME_BYTES);
      directory.writeUInt32LE(entry.bytes, index * PAK_ENTRY_BYTES + PAK_NAME_BYTES + 4);
    }
    writeAt(destinationFd, directory, directoryOffset);
    const header = Buffer.alloc(8);
    header.writeUInt32LE(directoryOffset, 0);
    header.writeUInt32LE(directory.length, 4);
    writeAt(destinationFd, header, 4);
    fs.ftruncateSync(destinationFd, directoryOffset + directory.length);
    return { packageName, entries: entries.length, replacedImages: changed, imageTypes };
  } catch (error) {
    if (destinationFd != null) fs.closeSync(destinationFd);
    destinationFd = undefined;
    if (created) fs.rmSync(destination);
    throw error;
  } finally {
    fs.closeSync(sourceFd);
    if (destinationFd != null) fs.closeSync(destinationFd);
  }
}

if (require.main === module) {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination) {
    process.stderr.write(
      "Usage: node scripts/build-capture-isolation.cjs <korra.pak|hud.pak> <output.pak>\n",
    );
    process.exitCode = 2;
  } else {
    try {
      process.stdout.write(`${JSON.stringify(buildHiddenImagesPak(source, destination))}\n`);
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}

module.exports = { buildHiddenImagesPak, pakEntries, solidLz4, transparentMunged };
