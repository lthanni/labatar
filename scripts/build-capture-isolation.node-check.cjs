const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildHiddenStagePak, pakEntries } = require("./build-capture-isolation.cjs");

function makePak(filePath, files) {
  const contentBytes = files.reduce((total, file) => total + file.bytes.length, 12);
  const pak = Buffer.alloc(contentBytes + files.length * 256);
  pak.write("PACK");
  pak.writeUInt32LE(contentBytes, 4);
  pak.writeUInt32LE(files.length * 256, 8);
  let offset = 12;
  files.forEach((file, index) => {
    file.bytes.copy(pak, offset);
    const directoryAt = contentBytes + index * 256;
    pak.write(file.name, directoryAt);
    pak.writeUInt32LE(offset, directoryAt + 248);
    pak.writeUInt32LE(file.bytes.length, directoryAt + 252);
    offset += file.bytes.length;
  });
  fs.writeFileSync(filePath, pak);
}

void test("Water Tribe blackout keeps patched PAK entries and changes only the level script", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "labatar-stage-blackout-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "watertribe.pak");
  const output = path.join(root, "hidden.pak");
  const levelName = "data/levels/watertribe/watertribe.lvl";
  const level = Buffer.from(
    [
      "Tags: FightStage Shipped katara sokka",
      "# --- Layers and Sprites ---",
      "Layer png/background.png",
      "SpriteScale 0.731934 0.731934",
      "# --- Enviroment ---",
      "FloorShadowColor 46,197,255,192",
      "",
    ].join("\r\n"),
  );
  makePak(source, [
    { name: levelName, bytes: level },
    { name: "new-patch-entry", bytes: Buffer.from("keep this new file") },
  ]);

  const result = buildHiddenStagePak(source, output);
  assert.deepEqual(result, { entries: 2, hiddenCommands: 2, hiddenLayers: 1 });
  assert.equal(fs.statSync(output).size, fs.statSync(source).size);
  const sourceFd = fs.openSync(source, "r");
  const outputFd = fs.openSync(output, "r");
  try {
    const sourceEntries = pakEntries(sourceFd);
    const outputEntries = pakEntries(outputFd);
    assert.deepEqual(outputEntries, sourceEntries);
    const entry = outputEntries.find((item) => item.name === levelName);
    const transformed = Buffer.alloc(entry.bytes);
    fs.readSync(outputFd, transformed, 0, transformed.length, entry.offset);
    const text = transformed.toString("utf8");
    assert.match(text, /Tags: FightStage Shipped katara sokka/);
    assert.match(text, /#ayer png\/background\.png/);
    assert.match(text, /#priteScale 0\.731934 0\.731934/);
    assert.match(text, /FloorShadowColor 46,197,255,000/);
    const original = Buffer.alloc(entry.bytes);
    fs.readSync(sourceFd, original, 0, original.length, entry.offset);
    assert.deepEqual(original, level);
    const added = outputEntries.find((item) => item.name === "new-patch-entry");
    const preserved = Buffer.alloc(added.bytes);
    fs.readSync(outputFd, preserved, 0, preserved.length, added.offset);
    assert.equal(preserved.toString("utf8"), "keep this new file");
  } finally {
    fs.closeSync(sourceFd);
    fs.closeSync(outputFd);
  }
});
