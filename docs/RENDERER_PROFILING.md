# Renderer memory profiling

Labatar writes lightweight memory samples every 10 seconds during development
to `.dev/electron-user-data/renderer-profile.jsonl`. Packaged builds can opt in
with `LABATAR_RENDERER_PROFILE=1`; development builds can opt out with
`LABATAR_RENDERER_PROFILE=0`. A full log rotates to a timestamped file at 8 MiB.
Each line is JSON and includes a UTC timestamp.

The main process records working-set and private memory for each Electron
process, plus whether OBS recording and automation are active. The preload
reports renderer V8 heap and Blink allocation, the active tab, and a bounded
summary of video elements (visible, playing, loaded, and dimensions). It does
not record video paths, recording names, replay names, or player identities.
Memory values ending in `KiB` are kibibytes, and `snapshotAgeMs` shows how
old the renderer-side report is. If the renderer hangs or crashes, main-process
sampling continues and a `renderer-process-gone` line includes the last sample.

Compare `renderer.heapUsedKiB`, `renderer.blinkAllocatedKiB`, and the process
entry whose `pid` equals `rendererPid`:

- Growing heap suggests retained JavaScript objects.
- Growing Blink allocation suggests DOM or rendering objects.
- Growing renderer private memory with stable heap/Blink figures suggests
  native allocations such as media decoding, but is not proof of their source.
- GPU process growth can point to video or graphics resources.

Sampling does not take heap snapshots, alter OBS, or prevent an out-of-memory
crash. A heap snapshot can itself consume substantial memory, so take one
manually in DevTools before the renderer nears its limit if these samples
indicate a JavaScript leak.
