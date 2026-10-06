import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vite-plus/test";

const require = createRequire(import.meta.url);
const { createUnnamedRecordChapter } = require("../../electron/record-chapter.cjs");

describe("native OBS recording chapters", () => {
  it("asks OBS for an unnamed chapter only while recording", async () => {
    const client = {
      call: vi
        .fn()
        .mockResolvedValueOnce({ outputActive: true, outputPaused: false })
        .mockResolvedValueOnce(undefined),
    };
    await createUnnamedRecordChapter(client);
    expect(client.call.mock.calls).toEqual([["GetRecordStatus"], ["CreateRecordChapter"]]);
  });

  it("does not add a chapter when recording is stopped or paused", async () => {
    for (const status of [
      { outputActive: false, outputPaused: false },
      { outputActive: true, outputPaused: true },
    ]) {
      const client = { call: vi.fn().mockResolvedValue(status) };
      await expect(createUnnamedRecordChapter(client)).rejects.toThrow();
      expect(client.call.mock.calls).toEqual([["GetRecordStatus"]]);
    }
  });

  it("passes through a chapter request failure, such as an unsupported output format", async () => {
    const client = {
      call: vi
        .fn()
        .mockResolvedValueOnce({ outputActive: true, outputPaused: false })
        .mockRejectedValueOnce(new Error("unsupported")),
    };
    await expect(createUnnamedRecordChapter(client)).rejects.toThrow("unsupported");
  });
});
