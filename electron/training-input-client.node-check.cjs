const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, mkdir, writeFile, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createTrainingInputClient } = require("./training-input-client.cjs");

void test("training input dry run keeps charged timing and starts jump attacks within 100 ms of Up", async () => {
  const gameRoot = await mkdtemp(path.join(os.tmpdir(), "labatar-input-check-"));
  let client;
  try {
    const dataDir = path.join(gameRoot, "data");
    await mkdir(dataDir);
    await writeFile(
      path.join(dataDir, "button_config.ini"),
      [
        "Player 1",
        "#-------",
        "Device 7 KEY_J -> Atk1",
        "Device 7 KEY_K -> Atk2",
        "Device 7 KEY_L -> Atk3",
        "Device 7 KEY_H -> Atk4",
        "Device 7 KEY_W -> Up",
        "Device 7 KEY_S -> Down",
        "Device 7 KEY_A -> Left",
        "Device 7 KEY_D -> Right",
        "#-------",
        "Player 2",
      ].join("\n"),
    );
    client = await createTrainingInputClient({ gameRoot, dryRun: true });
    const charged = await client.send({
      kind: "move",
      notation: "236[EX]",
      facing: "Right",
      chargeHoldMs: 850,
    });
    assert.equal(charged.steps.at(-2).Ms, 850);
    assert.deepEqual(
      [...charged.steps.at(-2).Keys].sort((left, right) => left.localeCompare(right)),
      ["D", "J", "K"],
    );
    assert.equal(charged.steps.at(-1).Keys.length, 0);
    const normal = await client.send({ kind: "move", notation: "5C" });
    assert.equal(normal.steps.at(-2).Ms, 50);
    const defaultCharge = await client.send({ kind: "move", notation: "5[C]" });
    assert.equal(defaultCharge.steps.at(-2).Ms, 1000);
    const jumpNormal = await client.send({ kind: "move", notation: "j.5A" });
    assert.deepEqual(
      jumpNormal.steps.slice(0, 3).map(({ Keys, Ms }) => [Keys, Ms]),
      [
        [["S"], 40],
        [["W"], 25],
        [["J"], 50],
      ],
    );
    for (const [notation, attackKey] of [
      ["j.A", "J"],
      ["j.B", "K"],
      ["j.C", "L"],
    ]) {
      const bareJumpNormal = await client.send({ kind: "move", notation });
      assert.deepEqual(
        bareJumpNormal.steps.slice(0, 3).map(({ Keys, Ms }) => [Keys, Ms]),
        [
          [["S"], 40],
          [["W"], 25],
          [[attackKey], 50],
        ],
      );
    }
    for (const [notation, facing, expectedMotion] of [
      ["j.236A", "Right", [["S"], ["S", "D"], ["D"], ["D", "J"]]],
      ["j.214B", "Left", [["S"], ["S", "D"], ["D"], ["D", "K"]]],
    ]) {
      const jumpSpecial = await client.send({ kind: "move", notation, facing });
      assert.deepEqual(
        jumpSpecial.steps.slice(0, 2).map(({ Keys }) => Keys),
        [["S"], ["W"]],
      );
      assert.deepEqual(
        jumpSpecial.steps.slice(2, 6).map(({ Keys }) => Keys),
        expectedMotion,
      );
      const millisecondsFromUpToAttack = jumpSpecial.steps
        .slice(1, 5)
        .reduce((sum, step) => sum + step.Ms, 0);
      assert.equal(millisecondsFromUpToAttack, 85);
    }
    const groundedSpecial = await client.send({ kind: "move", notation: "236A" });
    assert.deepEqual(
      groundedSpecial.steps.slice(0, 3).map(({ Ms }) => Ms),
      [50, 50, 50],
    );
    await assert.rejects(
      client.send({ kind: "move", notation: "5[C]", chargeHoldMs: 5100 }),
      /Charge hold must be between/,
    );
  } finally {
    if (client) await client.close();
    await rm(gameRoot, { recursive: true, force: true });
  }
});
