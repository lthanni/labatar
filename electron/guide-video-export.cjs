const fs = require("node:fs/promises");
const { constants } = require("node:fs");
const path = require("node:path");
const { assTime } = require("./combo-input-overlay.cjs");
const { probeMedia } = require("./game-chapters.cjs");

const maxVideoHeight = 552;
const footerHeight = 168;

function guideLayout(media, captioned = true) {
  const narrowest = Math.min(...media.map((info) => info.displayAspectRatio));
  // All segments need identical dimensions. Fit the narrowest clip into the
  // canvas and scale wider clips to the same width without cutting off footage.
  const width = Math.max(2, Math.min(1280, 2 * Math.floor((maxVideoHeight * narrowest) / 2)));
  const videoHeight = Math.max(2, Math.min(maxVideoHeight, 2 * Math.round(width / narrowest / 2)));
  return { width, videoHeight, height: videoHeight + (captioned ? footerHeight : 0) };
}

const hasClipText = (clip) => Boolean(clip.title?.trim() || clip.caption?.trim());

function wrapGuideText(text) {
  if (!text?.trim()) return [];
  return text
    .trim()
    .split(/\r?\n/)
    .flatMap((paragraph) => {
      const wrapped = [];
      let rest = Array.from(paragraph.replace(/\p{Cc}/gu, " ").trim());
      while (rest.length > 50) {
        const space = rest.slice(0, 51).lastIndexOf(" ");
        const end = space >= 25 ? space : 50;
        wrapped.push(rest.slice(0, end).join(""));
        rest = Array.from(rest.slice(end).join("").trimStart());
      }
      wrapped.push(rest.join(""));
      return wrapped;
    });
}

function guideCaptionAss(clip, durationMs, layout) {
  const heading = wrapGuideText(clip.title);
  const caption = wrapGuideText(clip.caption);
  const lines = [...heading, ...caption];
  // Insert an invisible separator after literal backslashes so they cannot become ASS escapes.
  const escape = (line) => line.replace(/\\/g, "\\\u200b").replace(/[{}]/g, "\\$&");
  const text = [
    ...(heading.length ? [`{\\b1}${heading.map(escape).join("\\N")}{\\b0}`] : []),
    ...caption.map(escape),
  ].join("\\N");
  const fontSize = Math.min(
    32,
    Math.floor(138 / lines.length),
    Math.max(
      1,
      Math.floor(
        (layout.width * 0.89) / Math.max(1, ...lines.map((line) => Array.from(line).length)),
      ),
    ),
  );
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${layout.width}`,
    `PlayResY: ${layout.height}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Caption,Arial,${fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,64,64,0,1`,
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    `Dialogue: 0,0:00:00.00,${assTime(Math.ceil(durationMs / 10))},Caption,,0,0,0,,{\\an5\\pos(${layout.width / 2},${layout.videoHeight + footerHeight / 2})}${text}`,
    "",
  ].join("\n");
}

function buildRecordingCaption(caption, durationMs, displayAspectRatio, subtitleFile) {
  if (!Number.isFinite(displayAspectRatio) || displayAspectRatio <= 0) {
    throw new Error("The recording video dimensions could not be read.");
  }
  const layout = guideLayout([{ displayAspectRatio }]);
  return {
    subtitle: guideCaptionAss({ caption }, durationMs, layout),
    videoFilter: [
      "scale=w='2*ceil(iw*sar/2)':h='2*ceil(ih/2)'",
      "setsar=1",
      `pad=iw:2*ceil(ih*${layout.height}/${layout.videoHeight}/2):0:0:color=black`,
      "format=yuv420p",
      `ass=filename=${subtitleFile}`,
    ].join(","),
  };
}

function segmentArgs(clip, info, layout, subtitle, output) {
  return [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    clip.filePath,
    ...(!info.hasAudio ? ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"] : []),
    "-map",
    "0:V:0",
    "-map",
    info.hasAudio ? "0:a:0" : "1:a:0",
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
    "-shortest",
    "-vf",
    [
      `scale=w=${layout.width}:h='max(2,min(${layout.videoHeight},2*round(${layout.width}/dar/2)))'`,
      `pad=${layout.width}:${layout.height}:0:${layout.videoHeight}-ih:color=black`,
      "setsar=1",
      "fps=60",
      "format=yuv420p",
      ...(subtitle ? [`ass=filename=${subtitle}`] : []),
    ].join(","),
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "18",
    "-af",
    "aresample=48000:async=1:first_pts=0,apad",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-c:a",
    "pcm_s16le",
    output,
  ];
}

async function exportGuideVideo({ executable, runFfmpeg, clips, outputPath, onProgress }) {
  const parent = await fs.realpath(path.dirname(outputPath));
  const folder = await fs.mkdtemp(path.join(parent, ".labatar-guide-"));
  try {
    const media = [];
    onProgress("Checking clip dimensions");
    for (const [index, clip] of clips.entries()) {
      try {
        const info = await probeMedia(executable, clip.filePath);
        if (!info.durationMs || !info.displayAspectRatio)
          throw new Error("The MP4 has no playable video.");
        media.push(info);
      } catch (error) {
        throw new Error(
          `Could not read clip ${index + 1} (${path.basename(clip.filePath)}). ${error.message}`,
        );
      }
    }
    const layout = guideLayout(media, clips.some(hasClipText));
    const segments = [];
    for (const [index, clip] of clips.entries()) {
      onProgress(`Rendering clip ${index + 1} of ${clips.length}`);
      const subtitle = hasClipText(clip) ? `caption-${index}.ass` : null;
      const segment = `clip-${index}.mkv`;
      try {
        const info = media[index];
        if (subtitle)
          await fs.writeFile(
            path.join(folder, subtitle),
            guideCaptionAss(clip, info.durationMs, layout),
          );
        await runFfmpeg(segmentArgs(clip, info, layout, subtitle, segment), { cwd: folder });
      } catch (error) {
        throw new Error(
          `Could not render clip ${index + 1} (${path.basename(clip.filePath)}). ${error.message}`,
        );
      }
      segments.push(segment);
    }
    onProgress("Joining clips and saving MP4");
    await fs.writeFile(
      path.join(folder, "clips.ffconcat"),
      segments.map((name) => `file '${name}'`).join("\n") + "\n",
    );
    const rendered = path.join(folder, "guide.mp4");
    await runFfmpeg(
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "1",
        "-i",
        "clips.ffconcat",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        rendered,
      ],
      { cwd: folder },
    );
    await fs.copyFile(rendered, outputPath, constants.COPYFILE_EXCL);
  } finally {
    if (path.dirname(folder) === parent && path.basename(folder).startsWith(".labatar-guide-")) {
      await fs.rm(folder, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

module.exports = { buildRecordingCaption, exportGuideVideo };
