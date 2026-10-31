const { spawn } = require("node:child_process");

function buildFastTrimStartProbeArgs(sourcePath, startTime) {
  return [
    "-nostdin",
    "-hide_banner",
    "-noaccurate_seek",
    "-ss",
    startTime.toFixed(3),
    "-i",
    sourcePath,
    "-map",
    "0:v:0",
    "-frames:v",
    "1",
    "-vf",
    "select=eq(n\\,0),showinfo",
    "-an",
    "-f",
    "null",
    "-",
  ];
}

function parseFastTrimStart(output, requestedStart) {
  const firstFrame = output.match(
    /showinfo[^\n]*\bn:\s*0\b[^\n]*\bpts_time:\s*(-?\d+(?:\.\d+)?)[^\n]*\biskey:\s*1\b/,
  );
  if (!firstFrame) throw new Error("Could not find a safe keyframe for fast copying.");
  const actualStart = Math.round((requestedStart + Number(firstFrame[1])) * 1000) / 1000;
  if (!Number.isFinite(actualStart) || actualStart < -0.05 || actualStart > requestedStart + 0.05) {
    throw new Error("The fast copy keyframe is outside the requested range.");
  }
  return Math.max(0, actualStart);
}

function probeFastTrimStart(executable, sourcePath, requestedStart) {
  if (requestedStart < 0.05) return Promise.resolve(0);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, buildFastTrimStartProbeArgs(sourcePath, requestedStart), {
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) return reject(new Error(stderr.trim() || `FFmpeg exited with code ${code}`));
      try {
        resolve(parseFastTrimStart(stderr, requestedStart));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function buildFastTrimFfmpegArgs({
  sourcePath,
  requestedStart,
  requestedEnd,
  creationTime,
  outputPath,
}) {
  const args = ["-nostdin", "-hide_banner", "-loglevel", "error", "-y"];
  if (requestedStart >= 0.05) args.push("-noaccurate_seek", "-ss", requestedStart.toFixed(3));
  args.push(
    "-i",
    sourcePath,
    "-t",
    (requestedEnd - requestedStart).toFixed(3),
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-map_metadata",
    "0",
    "-map_chapters",
    "-1",
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    "-avoid_negative_ts",
    "make_zero",
  );
  if (creationTime) args.push("-metadata", `creation_time=${creationTime}`);
  args.push(outputPath);
  return args;
}

module.exports = { buildFastTrimFfmpegArgs, parseFastTrimStart, probeFastTrimStart };
