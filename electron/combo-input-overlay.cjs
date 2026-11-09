const { spawn } = require("node:child_process");

const MAX_LINE_LENGTH = 48;
const CROP_TOP_FRACTION = 0.025;
const CROP_BOTTOM_FRACTION = 0.07;
const FOOTER_FRACTION = 0.2;

function evenFloor(value) {
  return Math.floor(value / 2) * 2;
}

function comboInputVideoLayout(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 64) {
    throw new Error("The video dimensions are unavailable for the input overlay.");
  }
  const outputWidth = evenFloor(width);
  const outputHeight = evenFloor(height);
  const cropTop = evenFloor(height * CROP_TOP_FRACTION);
  const cropBottom = evenFloor(height * CROP_BOTTOM_FRACTION);
  const cropHeight = outputHeight - cropTop - cropBottom;
  const videoAreaHeight = evenFloor(outputHeight * (1 - FOOTER_FRACTION));
  const scale = Math.min(1, videoAreaHeight / cropHeight);
  const videoWidth = evenFloor(outputWidth * scale);
  const videoHeight = evenFloor(cropHeight * scale);
  const left = evenFloor((outputWidth - videoWidth) / 2);
  const top = evenFloor((videoAreaHeight - videoHeight) / 2);
  return {
    outputWidth,
    outputHeight,
    cropTop,
    cropHeight,
    videoWidth,
    videoHeight,
    left,
    top,
    footerTop: videoAreaHeight,
  };
}

function buildComboInputVideoFilter(width, height, subtitleFile) {
  if (!/^[A-Za-z0-9_.-]+\.ass$/.test(subtitleFile)) {
    throw new Error("Invalid input overlay subtitle file.");
  }
  const layout = comboInputVideoLayout(width, height);
  return [
    `crop=${layout.outputWidth}:${layout.cropHeight}:0:${layout.cropTop}`,
    `scale=${layout.videoWidth}:${layout.videoHeight}:flags=lanczos`,
    `pad=${layout.outputWidth}:${layout.outputHeight}:${layout.left}:${layout.top}:color=black`,
    "setsar=1",
    `ass=filename=${subtitleFile}`,
  ].join(",");
}

function probeVideoDimensions(executable, videoPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["-nostdin", "-hide_banner", "-i", videoPath], {
      windowsHide: true,
    });
    let details = "";
    child.stderr.on("data", (chunk) => {
      if (details.length < 65536) details += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", () => {
      const line = details.split(/\r?\n/).find((value) => value.includes("Video:"));
      const match = line?.match(/\b(\d{2,5})x(\d{2,5})(?=\s|,|\[)/);
      if (!match) {
        reject(new Error("The recording video dimensions could not be read."));
        return;
      }
      resolve({ width: Number(match[1]), height: Number(match[2]) });
    });
  });
}

function assTime(centiseconds) {
  const hours = Math.floor(centiseconds / 360000);
  const minutes = Math.floor((centiseconds % 360000) / 6000);
  const seconds = Math.floor((centiseconds % 6000) / 100);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds % 100).padStart(2, "0")}`;
}

function assText(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/[{}]/g, "").replace(/\r?\n/g, " ");
}

function buildComboInputOverlayAss(processed, capture, durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("The video duration is unavailable for the input overlay.");
  }
  if (!Array.isArray(processed?.presses) || processed.presses.length === 0) {
    throw new Error("This recording has no processed button presses to render.");
  }
  if (capture?.schemaVersion !== 1 || !Array.isArray(capture.states)) {
    throw new Error("This recording has no raw button hold timeline to render.");
  }
  const durationCs = Math.ceil(durationMs / 10);
  const presses = processed.presses
    .filter(
      (press) => Number.isFinite(press.timeMs) && press.timeMs >= 0 && press.timeMs < durationMs,
    )
    .map((press, index) => {
      const state = capture.states[press.sourceStateIndex];
      if (
        !Number.isInteger(press.sourceStateIndex) ||
        state?.timeMs !== press.timeMs ||
        !state.buttons?.includes(press.physicalButton)
      ) {
        throw new Error(
          "The processed inputs no longer match the raw capture. Reprocess them first.",
        );
      }
      const release = capture.states
        .slice(press.sourceStateIndex + 1)
        .find((next) => !next.buttons?.includes(press.physicalButton));
      const lastCapturedMs = capture.states.at(-1)?.timeMs ?? press.timeMs;
      const endMs =
        release?.timeMs ?? (capture.status === "interrupted" ? lastCapturedMs : capture.durationMs);
      const start = Math.min(durationCs - 1, Math.round(press.timeMs / 10));
      return {
        start,
        end: Math.min(durationCs, Math.max(start + 1, Math.round(endMs / 10))),
        label: assText(
          press.interpretations?.right?.notation || `Controller ${press.physicalButton}`,
        ),
        separator: index === 0 ? "" : press.manualEdit?.separator === "~" ? "~" : " ",
      };
    });
  if (!presses.length) throw new Error("No button presses fall within this video.");

  const boundaries = [
    ...new Set([0, durationCs, ...presses.flatMap(({ start, end }) => [start, end])]),
  ].sort((left, right) => left - right);
  const events = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (start === end) continue;
    let text = "";
    let lineLength = 0;
    for (const press of presses) {
      const tokenLength = press.separator.length + press.label.length;
      const separator =
        lineLength && lineLength + tokenLength > MAX_LINE_LENGTH ? "\\N" : press.separator;
      lineLength = separator === "\\N" ? press.label.length : lineLength + tokenLength;
      const color = press.start <= start && start < press.end ? "0000FF" : "FFFFFF";
      text += `${separator}{\\c&H${color}&}${press.label}`;
    }
    events.push(
      `Dialogue: 0,${assTime(start)},${assTime(end)},Inputs,,0,0,0,,{\\an5\\pos(960,972)}${text}`,
    );
  }
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1920",
    "PlayResY: 1080",
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Inputs,Consolas,44,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,3,1,5,60,60,0,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}

module.exports = {
  buildComboInputOverlayAss,
  buildComboInputVideoFilter,
  comboInputVideoLayout,
  probeVideoDimensions,
};
