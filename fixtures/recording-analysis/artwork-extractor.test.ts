import { deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vite-plus/test";
import {
  decodeLz4Block,
  decodePortraitMunged,
  encodePngRgba,
  parsePakDirectory,
  parsePakHeader,
  portraitPakRelativePath,
} from "../../electron/artwork-extractor";

describe("local artwork formats", () => {
  it("selects only requested character and support portrait paths", () => {
    const filters = ["~hud~art~portraitart", "~hud~art~support"];
    expect(
      portraitPakRelativePath(
        "srcdata/munged/frames/sprites~aang~hud~art~support2.munged",
        filters,
      ),
    ).toBe("srcdata/munged/frames/sprites~aang~hud~art~support2.munged");
    expect(
      portraitPakRelativePath("srcdata/../other/sprites~aang~hud~art~support2.munged", filters),
    ).toBeNull();
    expect(
      portraitPakRelativePath(
        "srcdata/munged/frames/sprites~aang~hud~art~supportart.munged",
        filters,
      ),
    ).toBeNull();
  });

  it("reads the game's 256-byte PAK directory entries", () => {
    const header = new Uint8Array(12);
    header.set(new TextEncoder().encode("PACK"));
    const headerView = new DataView(header.buffer);
    headerView.setUint32(4, 32, true);
    headerView.setUint32(8, 256, true);
    const directory = new Uint8Array(256);
    directory.set(new TextEncoder().encode("srcdata/munged/frames/test.munged"));
    const view = new DataView(directory.buffer);
    view.setUint32(248, 12, true);
    view.setUint32(252, 20, true);
    expect(parsePakHeader(header, 288)).toEqual({ directoryOffset: 32, directoryBytes: 256 });
    expect(parsePakDirectory(directory, 288)).toEqual([
      { name: "srcdata/munged/frames/test.munged", offset: 12, size: 20 },
    ]);
    expect(() => parsePakHeader(header, 287)).toThrow("Invalid PAK directory");
  });

  it("decodes literal and overlapping LZ4 match runs", () => {
    expect([...decodeLz4Block(Uint8Array.of(0x40, 1, 2, 3, 4), 4)]).toEqual([1, 2, 3, 4]);
    expect([...decodeLz4Block(Uint8Array.of(0x1f, 7, 1, 0, 10), 30)]).toEqual(Array(30).fill(7));
    expect(() => decodeLz4Block(Uint8Array.of(0x00, 0, 0), 4)).toThrow("Invalid LZ4 match");
  });

  it("untangles type-6 portrait tiles and writes a valid PNG", () => {
    const embeddedName = "src/sprites/test/hud/art/portraitart.png";
    const name = new TextEncoder().encode(embeddedName);
    const dimensionsAt = 0x20 + name.length + 8;
    const packed = new Uint8Array(34 * 34 * 4);
    const expected = Uint8Array.of(1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255);
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        packed.set(
          expected.subarray((y * 2 + x) * 4, (y * 2 + x + 1) * 4),
          ((y + 1) * 34 + x + 1) * 4,
        );
      }
    }
    const remaining = packed.length - 15;
    const extras = [...Array(Math.floor(remaining / 255)).fill(255), remaining % 255];
    const block = Uint8Array.of(0xf0, ...extras, ...packed);
    const blockAt = dimensionsAt + 48;
    const raw = new Uint8Array(blockAt + block.length);
    raw[0x1a] = 6;
    raw[0x1b] = name.length + 1;
    raw.set(name, 0x20);
    const view = new DataView(raw.buffer);
    view.setUint32(dimensionsAt, 2, true);
    view.setUint32(dimensionsAt + 4, 2, true);
    view.setUint32(dimensionsAt + 16, 34, true);
    view.setUint32(dimensionsAt + 20, 34, true);
    view.setUint32(dimensionsAt + 28, 1, true);
    view.setUint32(dimensionsAt + 32, 1, true);
    view.setUint32(blockAt - 8, packed.length, true);
    view.setUint32(blockAt - 4, block.length, true);
    raw.set(block, blockAt);

    const decoded = decodePortraitMunged(raw);
    expect(decoded.sourcePath).toBe(embeddedName);
    expect([decoded.width, decoded.height]).toEqual([2, 2]);
    expect(decoded.pixels).toEqual(expected);
    const png = encodePngRgba(2, 2, decoded.pixels, deflateSync);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const pngView = new DataView(png.buffer);
    expect(pngView.getUint32(16)).toBe(2);
    expect(pngView.getUint32(20)).toBe(2);
    const scanlines = inflateSync(png.subarray(41, png.length - 16));
    expect([...scanlines]).toEqual([0, ...expected.subarray(0, 8), 0, ...expected.subarray(8)]);
  });
});
