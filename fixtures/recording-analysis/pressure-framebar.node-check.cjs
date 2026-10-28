const assert = require("node:assert/strict");
const test = require("node:test");
const {
  pressureBaseTransform,
  pressureFramebarTransform,
  pressureGameItems,
} = require("../../electron/pressure-framebar.cjs");

void test("reproduces the pressure scene's measured crop and placement", () => {
  const transform = pressureFramebarTransform(2560, 1441);
  assert.deepEqual(
    {
      x: transform.positionX,
      y: transform.positionY,
      scale: [transform.scaleX, transform.scaleY],
      crop: [transform.cropLeft, transform.cropTop, transform.cropRight, transform.cropBottom],
    },
    {
      x: 175,
      y: 1355,
      scale: [1.0007812976837158, 1.0006943941116333],
      crop: [1377, 1309, 177, 86],
    },
  );
  assert.equal(2560 - transform.cropLeft - transform.cropRight, 1006);
  assert.equal(1441 - transform.cropTop - transform.cropBottom, 46);
  assert.deepEqual(
    [pressureBaseTransform().scaleX, pressureBaseTransform().scaleY],
    [0.999218761920929, 0.9993060231208801],
  );
});

void test("scales the crop with the capture source", () => {
  const transform = pressureFramebarTransform(1920, 1080);
  assert.deepEqual(
    {
      x: transform.positionX,
      y: transform.positionY,
      crop: [transform.cropLeft, transform.cropTop, transform.cropRight, transform.cropBottom],
    },
    { x: 131, y: 1016, crop: [1033, 981, 133, 64] },
  );
});

void test("keeps the full game item below the cropped overlay", () => {
  const items = [
    { sourceName: "game", sceneItemId: 1, sceneItemIndex: 2 },
    { sourceName: "audio", sceneItemId: 2, sceneItemIndex: 0 },
    { sourceName: "game", sceneItemId: 3, sceneItemIndex: 1 },
  ];
  assert.deepEqual(
    pressureGameItems(items, "game").map((item) => item.sceneItemId),
    [3, 1],
  );
});

void test("waits for valid source dimensions", () => {
  assert.equal(pressureFramebarTransform(0, 0), null);
});
