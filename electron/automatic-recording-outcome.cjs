function noGameStartedRecordingBaseName(recording) {
  if (recording?.source !== "automatic" || (recording.games?.length ?? 0) > 0) return null;
  const startedAt = new Date(recording.startedAt);
  if (!Number.isFinite(startedAt.getTime())) return "No game started";
  const timestamp = startedAt.toISOString().slice(0, 19).replace("T", " ").replaceAll(":", "-");
  return `No game started - ${timestamp} UTC`;
}

module.exports = { noGameStartedRecordingBaseName };
