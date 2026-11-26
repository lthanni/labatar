import { afterEach, describe, expect, it } from "vite-plus/test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const { inspectRecordingDirectory, copyRecordingDirectory } =
  require("../../electron/recording-directory.cjs") as {
    inspectRecordingDirectory: (
      source: string,
      destination: string,
    ) => Promise<{ files: unknown[]; directories: string[]; bytes: number }>;
    copyRecordingDirectory: (
      source: string,
      destination: string,
      inventory: { files: unknown[]; directories: string[]; bytes: number },
    ) => Promise<{ copied: number; total: number }>;
  };

const temporaryRoots: string[] = [];
async function folders() {
  const root = await mkdtemp(path.join(tmpdir(), "labatar-recording-folder-"));
  temporaryRoots.push(root);
  const source = path.join(root, "source");
  const destination = path.join(root, "destination");
  await mkdir(source);
  await mkdir(destination);
  return { source, destination };
}

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    expect(path.dirname(root)).toBe(tmpdir());
    await rm(root, { recursive: true, force: true });
  }
});

describe("recording folder migration", () => {
  it("copies nested videos and sidecars, rebases output paths, and leaves originals intact", async () => {
    const { source, destination } = await folders();
    await mkdir(path.join(source, "clips"));
    const sourceVideo = path.join(source, "clips", "take.mp4");
    await writeFile(sourceVideo, "video bytes");
    const sidecar = `${sourceVideo}.labatar.json`;
    await writeFile(
      sidecar,
      JSON.stringify({ outputPath: sourceVideo, clip: { sourceRecordingId: "full.mp4" } }),
    );
    const inventory = await inspectRecordingDirectory(source, destination);
    expect(inventory.files).toHaveLength(2);
    expect(await copyRecordingDirectory(source, destination, inventory)).toEqual({
      copied: 2,
      total: 2,
    });
    expect(await readFile(path.join(destination, "clips", "take.mp4"), "utf8")).toBe("video bytes");
    const copiedSidecar = JSON.parse(
      await readFile(path.join(destination, "clips", "take.mp4.labatar.json"), "utf8"),
    );
    expect(copiedSidecar.outputPath).toBe(path.join(destination, "clips", "take.mp4"));
    expect(copiedSidecar.clip.sourceRecordingId).toBe("full.mp4");
    expect(JSON.parse(await readFile(sidecar, "utf8")).outputPath).toBe(sourceVideo);
    expect(await copyRecordingDirectory(source, destination, inventory)).toEqual({
      copied: 0,
      total: 2,
    });
  });

  it("rejects name conflicts before copying and never overwrites destination files", async () => {
    const { source, destination } = await folders();
    await writeFile(path.join(source, "a.mp4"), "source A");
    await writeFile(path.join(source, "b.mp4"), "source B");
    await writeFile(path.join(destination, "b.mp4"), "different B");
    const inventory = await inspectRecordingDirectory(source, destination);
    await expect(copyRecordingDirectory(source, destination, inventory)).rejects.toThrow(
      "different file",
    );
    expect(await readdir(destination)).toEqual(["b.mp4"]);
    expect(await readFile(path.join(destination, "b.mp4"), "utf8")).toBe("different B");
  });

  it("rejects a destination nested inside the current recording folder", async () => {
    const { source } = await folders();
    const nested = path.join(source, "next");
    await mkdir(nested);
    await expect(inspectRecordingDirectory(source, nested)).rejects.toThrow("outside");
  });
});
