// Measured from the user's Labatar - Labbing Pressure Framebar OBS scene.
// The reference canvas and game source were 2560 × 1441 on 2026-10-26.
const reference = {
  width: 2560,
  height: 1441,
  cropLeft: 1377,
  cropTop: 1309,
  cropRight: 177,
  cropBottom: 86,
  positionX: 175,
  positionY: 1355,
  scaleX: 1.0007812976837158,
  scaleY: 1.0006943941116333,
};

function pressureFramebarTransform(sourceWidth, sourceHeight) {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth < 8 ||
    sourceHeight < 8
  ) {
    return null;
  }

  const xRatio = sourceWidth / reference.width;
  const yRatio = sourceHeight / reference.height;

  return {
    alignment: 5,
    positionX: Math.round(reference.positionX * xRatio),
    positionY: Math.round(reference.positionY * yRatio),
    rotation: 0,
    scaleX: reference.scaleX,
    scaleY: reference.scaleY,
    cropLeft: Math.round(reference.cropLeft * xRatio),
    cropTop: Math.round(reference.cropTop * yRatio),
    cropRight: Math.round(reference.cropRight * xRatio),
    cropBottom: Math.round(reference.cropBottom * yRatio),
    boundsType: "OBS_BOUNDS_NONE",
    boundsAlignment: 0,
  };
}

function pressureBaseTransform() {
  return {
    alignment: 5,
    positionX: 0,
    positionY: 0,
    rotation: 0,
    scaleX: 0.999218761920929,
    scaleY: 0.9993060231208801,
    cropLeft: 0,
    cropTop: 0,
    cropRight: 0,
    cropBottom: 0,
    boundsType: "OBS_BOUNDS_NONE",
    boundsAlignment: 0,
  };
}

function pressureGameItems(items, gameInputName) {
  // OBS scene-item index 0 is the bottom layer.
  return items
    .filter((item) => item.sourceName === gameInputName)
    .sort((a, b) => a.sceneItemIndex - b.sceneItemIndex);
}

module.exports = { pressureBaseTransform, pressureFramebarTransform, pressureGameItems };
