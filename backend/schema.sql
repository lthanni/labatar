CREATE TABLE IF NOT EXISTS catalog_versions (
  kind TEXT NOT NULL CHECK (kind IN ('move', 'combo')),
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  character_id TEXT NOT NULL,
  support_id TEXT,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  published INTEGER NOT NULL CHECK (published IN (0, 1)),
  editor_email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (kind, id, revision)
);

CREATE INDEX IF NOT EXISTS catalog_versions_lookup
  ON catalog_versions (kind, character_id, support_id, id, revision DESC);

CREATE TABLE IF NOT EXISTS combo_candidates (
  id TEXT PRIMARY KEY,
  combo_payload TEXT NOT NULL CHECK (json_valid(combo_payload)),
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size > 0),
  object_key TEXT NOT NULL UNIQUE,
  upload_id TEXT NOT NULL,
  upload_token_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('uploading', 'pending', 'rejected', 'uploaded')),
  rejection_reason TEXT NOT NULL DEFAULT '',
  youtube_video_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS combo_candidates_review
  ON combo_candidates (status, created_at DESC);

CREATE TABLE IF NOT EXISTS catalog_access_roles (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_upload_access_requests (
  email TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  requested_at TEXT NOT NULL
);
