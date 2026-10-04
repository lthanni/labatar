# Development Electron state

`vp run electron:dev` stores Electron state inside the repository at
`.dev/electron-user-data`. This includes Chromium renderer `localStorage`,
session data, caches, crash dumps, plain settings, logs, and the persistent
processing configuration. The directory is ignored by Git but is inside the
workspace, so local diagnostic tools and coding agents can read it.

On the first launch after this change, Labatar migrates existing useful state
from the normal Electron user-data directory: settings, the processing
configuration and history, Chromium preferences, renderer local storage, and
session storage. It writes `development-user-data-migration.json` describing
what was copied. Subsequent launches treat the repository copy as authoritative
and never overwrite it from AppData.

`obs-password.enc` is copied once to a separate, OS app-data-only development
credential path. It is an encrypted credential rather than diagnostic state,
and is deliberately excluded from repository-local state and agent inspection.
That keeps dev and packaged credential changes independent without requiring a
fresh OBS login.

The packaged application keeps using normal OS app data; this routing only
applies while `app.isPackaged` is false.
