import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { extractWebArtwork } from "./artwork";
import { decodePortraitMunged } from "../../electron/artwork-extractor";

function makePortraitPak() {
  const embeddedName = "src/sprites/aang/hud/art/portraitart.png";
  const name = new TextEncoder().encode(embeddedName);
  const dimensionsAt = 0x20 + name.length + 8;
  const packed = new Uint8Array(34 * 34 * 4);
  packed.set([10, 20, 30, 255], (34 + 1) * 4);
  const remaining = packed.length - 15;
  const extras = [...Array(Math.floor(remaining / 255)).fill(255), remaining % 255];
  const block = Uint8Array.of(0xf0, ...extras, ...packed);
  const blockAt = dimensionsAt + 48;
  const raw = new Uint8Array(blockAt + block.length);
  raw[0x1a] = 6;
  raw[0x1b] = name.length + 1;
  raw.set(name, 0x20);
  const rawView = new DataView(raw.buffer);
  rawView.setUint32(dimensionsAt, 1, true);
  rawView.setUint32(dimensionsAt + 4, 1, true);
  rawView.setUint32(dimensionsAt + 16, 34, true);
  rawView.setUint32(dimensionsAt + 20, 34, true);
  rawView.setUint32(dimensionsAt + 28, 1, true);
  rawView.setUint32(dimensionsAt + 32, 1, true);
  rawView.setUint32(blockAt - 8, packed.length, true);
  rawView.setUint32(blockAt - 4, block.length, true);
  raw.set(block, blockAt);

  const directoryOffset = 12 + raw.length;
  const directory = new Uint8Array(256);
  directory.set(
    new TextEncoder().encode("srcdata/munged/frames/sprites~aang~hud~art~portraitart.munged"),
  );
  const directoryView = new DataView(directory.buffer);
  directoryView.setUint32(248, 12, true);
  directoryView.setUint32(252, raw.length, true);
  const bytes = new Uint8Array(directoryOffset + directory.length);
  bytes.set(new TextEncoder().encode("PACK"));
  const headerView = new DataView(bytes.buffer);
  headerView.setUint32(4, directoryOffset, true);
  headerView.setUint32(8, directory.length, true);
  bytes.set(raw, 12);
  bytes.set(directory, directoryOffset);
  return bytes;
}

afterEach(() => vi.unstubAllGlobals());

describe("browser artwork extraction", () => {
  it("reads only the PAK header, directory, and selected portrait bytes, then revokes URLs", async () => {
    const bytes = makePortraitPak();
    const directoryOffset = new DataView(bytes.buffer).getUint32(4, true);
    const entrySize = new DataView(bytes.buffer).getUint32(directoryOffset + 252, true);
    expect(decodePortraitMunged(bytes.subarray(12, 12 + entrySize)).sourcePath).toContain(
      "portraitart.png",
    );
    const readRanges: [number, number][] = [];
    const blob = new Blob([bytes]);
    const file = Object.assign(blob, {
      slice(start?: number, end?: number) {
        readRanges.push([start ?? 0, end ?? bytes.length]);
        return Blob.prototype.slice.call(blob, start, end);
      },
    });
    const revoke = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:portrait"),
      revokeObjectURL: revoke,
    });
    vi.stubGlobal("document", {
      createElement: () => ({
        set width(_value: number) {},
        set height(_value: number) {},
        getContext: () => ({
          createImageData: (width: number, height: number) => ({
            data: new Uint8ClampedArray(width * height * 4),
          }),
          putImageData: vi.fn(),
        }),
        toBlob: (callback: (value: Blob) => void) => callback(new Blob(["png"])),
      }),
    });

    const library = await extractWebArtwork([
      { relativePath: "Game/data_packages/characters.pak", file },
      { relativePath: "Game/other.pak", file },
    ]);
    expect(library.portraitArtwork("Aang", "None")).toEqual({
      portraitUrl: "blob:portrait",
      supportUrl: null,
    });
    expect(library.decodedCount).toBe(1);
    expect(readRanges).toHaveLength(3);
    expect(readRanges[0]).toEqual([0, 12]);
    expect(readRanges[1][0]).toBe(bytes.length - 256);
    expect(readRanges[2]).toEqual([12, readRanges[1][0]]);
    library.dispose();
    expect(revoke).toHaveBeenCalledWith("blob:portrait");
    expect(library.portraitArtwork("Aang", "None").portraitUrl).toBeNull();
  });

  it("honors cancellation before reading PAK files", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      extractWebArtwork([{ relativePath: "data_packages/a.pak", file: new Blob() }], {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
