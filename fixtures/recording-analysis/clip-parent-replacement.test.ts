import { createRequire } from "node:module";
import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";

const require = createRequire(import.meta.url);
const {
  applyClipParentReplacement,
  validateClipParentSelections,
} = require("../../electron/clip-parent-replacement.cjs");
const mutableFs = require("node:fs/promises") as typeof fs;

async function withRecordings(
  run: (files: Awaited<ReturnType<typeof makeRecordings>>) => Promise<void>,
) {
  const root = await fs.realpath(tmpdir());
  const folder = await mkdtemp(path.join(root, "labatar-replace-test-"));
  try {
    await run(await makeRecordings(folder));
  } finally {
    if (
      path.dirname(folder) === root &&
      path.basename(folder).startsWith("labatar-replace-test-")
    ) {
      await rm(folder, { recursive: true, force: true });
    }
  }
}

async function makeRecordings(folder: string) {
  const parent = path.join(folder, "parent.mp4");
  const clip = path.join(folder, "clip.mp4");
  const manifestPath = `${clip}.labatar.json`;
  const originalContent = JSON.stringify({ clip: { sourceRecordingId: "parent.mp4" } });
  await writeFile(parent, "full recording");
  await writeFile(clip, "clip footage");
  await writeFile(manifestPath, originalContent);
  return {
    folder,
    parent,
    clip,
    manifestPath,
    originalContent,
    removals: [{ filePath: parent, stat: await lstat(parent) }],
    changes: [{ manifestPath, originalContent, manifest: { clip: null } }],
  };
}

describe("replacing a parent recording with a clip", () => {
  it("rejects ambiguous batches before removing any parents", () => {
    const first = { clipId: "first", parentId: "parent" };
    expect(() =>
      validateClipParentSelections([first, { clipId: "second", parentId: "parent" }]),
    ).toThrow(/one clip per parent/);
    expect(() =>
      validateClipParentSelections([first, { clipId: "second", parentId: "first" }]),
    ).toThrow(/both a clip to keep and a parent to remove/);
  });

  it("keeps the promoted clip and leaves a recovery folder if trash is unavailable", async () => {
    await withRecordings(async (files) => {
      const backup = await applyClipParentReplacement({
        ...files,
        trashItem: async () => {
          throw new Error("Recycle Bin unavailable");
        },
      });
      expect(await readFile(files.clip, "utf8")).toBe("clip footage");
      expect(JSON.parse(await readFile(files.manifestPath, "utf8"))).toEqual({ clip: null });
      await expect(lstat(files.parent)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(path.join(backup, "original recordings", "parent.mp4"), "utf8")).toBe(
        "full recording",
      );
    });
  });

  it("rolls the parent and original clip link back when installing the new sidecar fails", async () => {
    await withRecordings(async (files) => {
      const rename = mutableFs.rename;
      const spy = vi.spyOn(mutableFs, "rename").mockImplementation(async (from, to) => {
        if (to === files.manifestPath && String(from).endsWith(".tmp")) {
          throw new Error("Could not install sidecar");
        }
        await rename(from, to);
      });
      try {
        await expect(applyClipParentReplacement({ ...files, trashItem: vi.fn() })).rejects.toThrow(
          /Could not install sidecar/,
        );
      } finally {
        spy.mockRestore();
      }
      expect(await readFile(files.parent, "utf8")).toBe("full recording");
      expect(await readFile(files.manifestPath, "utf8")).toBe(files.originalContent);
      expect(await readdir(files.folder)).toHaveLength(3);
    });
  });
});
