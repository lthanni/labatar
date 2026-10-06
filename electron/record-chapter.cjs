async function createUnnamedRecordChapter(client) {
  const status = await client.call("GetRecordStatus");
  if (!status.outputActive) throw new Error("OBS is not recording.");
  if (status.outputPaused) throw new Error("Resume the OBS recording before adding a chapter.");
  // Omitting chapterName lets OBS assign its native "Unnamed N" chapter title.
  await client.call("CreateRecordChapter");
}

module.exports = { createUnnamedRecordChapter };
