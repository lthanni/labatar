const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { discordReplayAttachment, importDiscordReplayUrl } = require("./discord-replay-import.cjs");

void test("accepts only Discord replay attachment URLs", () => {
  const url = "https://cdn.discordapp.com/attachments/123/456/match.zip?ex=123&is=456&hm=abc";
  assert.equal(discordReplayAttachment(url).name, "match.zip");
  assert.throws(
    () => discordReplayAttachment("https://discord.com/channels/1/2/3"),
    /Discord attachment/,
  );
  assert.throws(
    () => discordReplayAttachment("https://cdn.discordapp.com.evil.test/attachments/1/2/a.zip"),
    /Only Discord/,
  );
  assert.throws(
    () => discordReplayAttachment("http://cdn.discordapp.com/attachments/1/2/a.zip"),
    /Only Discord/,
  );
  assert.throws(
    () => discordReplayAttachment("https://cdn.discordapp.com/attachments/1/2/a.exe"),
    /must be a .dlr/,
  );
});

void test("downloads a bounded replay and feeds it into the existing importer", async () => {
  const source =
    "https://cdn.discordapp.com/attachments/123/456/2026-10-20%2012-00-00.dlr?ex=123&hm=abc";
  let seenName = "";
  let seenBytes = "";
  const fetchFile = async (url, options) => {
    assert.equal(url.href, source);
    assert.equal(options.redirect, "manual");
    return new Response("replay bytes", { status: 200 });
  };
  const importFiles = async (paths, gameFolder) => {
    assert.equal(gameFolder, "C:\\game");
    seenName = paths[0];
    seenBytes = await fs.promises.readFile(paths[0], "utf8");
    return { importedCount: 1 };
  };
  assert.deepEqual(await importDiscordReplayUrl(source, "C:\\game", fetchFile, importFiles), {
    importedCount: 1,
  });
  assert.match(seenName, /2026-10-20 12-00-00-.*\.dlr$/);
  assert.equal(seenBytes, "replay bytes");
  await assert.rejects(() => fs.promises.access(seenName));
});

void test("rejects a redirect before it can fetch another host", async () => {
  const url = "https://cdn.discordapp.com/attachments/123/456/replays.zip";
  await assert.rejects(
    () =>
      importDiscordReplayUrl(
        url,
        "C:\\game",
        async () =>
          new Response(null, { status: 302, headers: { Location: "https://example.com/private" } }),
      ),
    /Discord could not provide/,
  );
});
