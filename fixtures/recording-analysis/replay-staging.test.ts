import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const require = createRequire(import.meta.url);
const {
  createReplayStagingStore,
  logicalReplayId,
  orderReplayFilesForScan,
} = require("../../electron/replay-staging.cjs");

async function fixture() {
  const folder = await mkdtemp(path.join(tmpdir(), "labatar-replay-staging-"));
  const gameFolder = path.join(folder, "game");
  const replayFolder = path.join(gameFolder, "replays");
  const userDataFolder = path.join(folder, "user-data");
  await mkdir(path.join(gameFolder, "data_packages"), { recursive: true });
  await mkdir(path.join(replayFolder, "Imported", "Opponent"), { recursive: true });
  await writeFile(path.join(replayFolder, "first.dlr"), "first replay");
  await writeFile(path.join(replayFolder, "second.dlr"), "second replay");
  await writeFile(path.join(replayFolder, "Imported", "Opponent", "old.dlr"), "imported replay");
  return {
    folder,
    gameFolder,
    replayFolder,
    store: createReplayStagingStore(userDataFolder),
  };
}

describe("in-game replay staging", () => {
  it("keeps archived replay IDs stable and gives same-name new files distinct IDs", async () => {
    const files = await fixture();
    try {
      await files.store.stage(files.gameFolder, ["replays/first.dlr"]);
      await writeFile(path.join(files.replayFolder, "second.dlr"), "new second replay");
      const state = files.store.readState();
      const archived = path.join(files.gameFolder, ".labatar-original-replays", "second.dlr");
      const live = path.join(files.replayFolder, "second.dlr");
      expect(orderReplayFilesForScan(files.gameFolder, [live, archived], state)).toEqual([
        archived,
        live,
      ]);
      const seenIds = new Set<string>();
      expect(logicalReplayId(files.gameFolder, archived, seenIds, state)).toBe(
        "replays/second.dlr",
      );
      seenIds.add("replays/second.dlr");
      expect(logicalReplayId(files.gameFolder, live, seenIds, state)).toBe(
        "replays/.labatar-live/second.dlr",
      );
      expect(
        await files.store.resolveSource(files.gameFolder, "replays/.labatar-live/second.dlr"),
      ).toBe(live);
    } finally {
      await rm(files.folder, { recursive: true, force: true });
    }
  });

  it("keeps organized imports intact and resolves their original IDs while staged", async () => {
    const files = await fixture();
    try {
      const preview = await files.store.preview(files.gameFolder, ["replays/first.dlr"]);
      expect(preview).toMatchObject({ selectedCount: 1, archivedCount: 3, switching: false });
      const status = await files.store.stage(files.gameFolder, ["replays/first.dlr"]);
      expect(status).toMatchObject({ active: true, selectedCount: 1, newReplayCount: 0 });
      expect(await readdir(files.replayFolder)).toEqual(["first.dlr"]);
      expect(
        await readFile(
          path.join(
            files.gameFolder,
            ".labatar-original-replays",
            "Imported",
            "Opponent",
            "old.dlr",
          ),
          "utf8",
        ),
      ).toBe("imported replay");
      expect(
        await files.store.resolveSource(files.gameFolder, "replays/Imported/Opponent/old.dlr"),
      ).toContain(".labatar-original-replays");
      await files.store.restore();
      expect(await readFile(path.join(files.replayFolder, "first.dlr"), "utf8")).toBe(
        "first replay",
      );
      expect(
        await readFile(path.join(files.replayFolder, "Imported", "Opponent", "old.dlr"), "utf8"),
      ).toBe("imported replay");
      expect(await files.store.status(files.gameFolder)).toMatchObject({
        active: false,
        issue: null,
      });
    } finally {
      await rm(files.folder, { recursive: true, force: true });
    }
  });

  it("preserves a newly saved replay when switching selections and restoring", async () => {
    const files = await fixture();
    try {
      await files.store.stage(files.gameFolder, ["replays/first.dlr"]);
      await writeFile(path.join(files.replayFolder, "new.dlr"), "new replay");
      expect(await files.store.status(files.gameFolder)).toMatchObject({ newReplayCount: 1 });
      await files.store.stage(files.gameFolder, ["replays/second.dlr"]);
      expect(await readdir(files.replayFolder)).toEqual(["second.dlr"]);
      expect(
        await readFile(path.join(files.gameFolder, ".labatar-original-replays", "new.dlr"), "utf8"),
      ).toBe("new replay");
      await files.store.restore();
      expect(await readFile(path.join(files.replayFolder, "new.dlr"), "utf8")).toBe("new replay");
      expect(await readFile(path.join(files.replayFolder, "first.dlr"), "utf8")).toBe(
        "first replay",
      );
    } finally {
      await rm(files.folder, { recursive: true, force: true });
    }
  });

  it("can prepare a game that was saved while another replay was staged", async () => {
    const files = await fixture();
    try {
      await files.store.stage(files.gameFolder, ["replays/first.dlr"]);
      await writeFile(path.join(files.replayFolder, "new.dlr"), "new replay");
      await files.store.stage(files.gameFolder, ["replays/new.dlr"]);
      expect(await readdir(files.replayFolder)).toEqual(["new.dlr"]);
      expect(await readFile(path.join(files.replayFolder, "new.dlr"), "utf8")).toBe("new replay");
      await files.store.restore();
      expect(await readFile(path.join(files.replayFolder, "new.dlr"), "utf8")).toBe("new replay");
    } finally {
      await rm(files.folder, { recursive: true, force: true });
    }
  });

  it("preserves a game-created file even if it replaces a staged copy", async () => {
    const files = await fixture();
    try {
      await files.store.stage(files.gameFolder, ["replays/first.dlr"]);
      await writeFile(path.join(files.replayFolder, "first.dlr"), "new replay with same name");
      const result = await files.store.restore();
      expect(result).toMatchObject({ newReplayCount: 1, recoveredCount: 1 });
      expect(await readFile(path.join(files.replayFolder, "first.dlr"), "utf8")).toBe(
        "first replay",
      );
      const recoveredRoot = path.join(files.replayFolder, "Recovered while staged");
      const [recoveryFolder] = await readdir(recoveredRoot);
      expect(await readFile(path.join(recoveredRoot, recoveryFolder, "first.dlr"), "utf8")).toBe(
        "new replay with same name",
      );
    } finally {
      await rm(files.folder, { recursive: true, force: true });
    }
  });

  it("keeps both files when a new replay uses an archived filename", async () => {
    const files = await fixture();
    try {
      await files.store.stage(files.gameFolder, ["replays/first.dlr"]);
      await writeFile(path.join(files.replayFolder, "second.dlr"), "new second replay");
      const restored = await files.store.restore();
      expect(restored).toMatchObject({ newReplayCount: 1, recoveredCount: 1 });
      expect(await readFile(path.join(files.replayFolder, "second.dlr"), "utf8")).toBe(
        "second replay",
      );
      const recoveredRoot = path.join(files.replayFolder, "Recovered while staged");
      const [recoveryFolder] = await readdir(recoveredRoot);
      expect(await readFile(path.join(recoveredRoot, recoveryFolder, "second.dlr"), "utf8")).toBe(
        "new second replay",
      );
    } finally {
      await rm(files.folder, { recursive: true, force: true });
    }
  });

  it("rejects selected filenames that would collide without moving anything", async () => {
    const files = await fixture();
    try {
      await writeFile(path.join(files.replayFolder, "Imported", "Opponent", "first.dlr"), "other");
      await expect(
        files.store.stage(files.gameFolder, [
          "replays/first.dlr",
          "replays/Imported/Opponent/first.dlr",
        ]),
      ).rejects.toThrow(/share the filename/);
      expect(await readdir(files.replayFolder)).toContain("first.dlr");
      expect(await files.store.status(files.gameFolder)).toMatchObject({ active: false });
    } finally {
      await rm(files.folder, { recursive: true, force: true });
    }
  });

  it("finishes a restore interrupted after the original directory was renamed back", async () => {
    const files = await fixture();
    try {
      await files.store.stage(files.gameFolder, ["replays/first.dlr"]);
      const state = files.store.readState();
      await writeFile(
        path.join(files.folder, "user-data", "replay-staging.json"),
        JSON.stringify({ ...state, phase: "restoring" }),
      );
      await rm(files.replayFolder, { recursive: true });
      await rename(path.join(files.gameFolder, ".labatar-original-replays"), files.replayFolder);
      expect(await files.store.restore()).toMatchObject({ active: false, issue: null });
      expect(await readdir(files.replayFolder)).not.toContain(
        ".labatar-replay-staging-marker.json",
      );
      expect(await readFile(path.join(files.replayFolder, "second.dlr"), "utf8")).toBe(
        "second replay",
      );
    } finally {
      await rm(files.folder, { recursive: true, force: true });
    }
  });
});
