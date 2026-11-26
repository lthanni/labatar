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
  submitter_email TEXT,
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

CREATE TABLE IF NOT EXISTS catalog_youtube_upload_access (
  email TEXT PRIMARY KEY,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_upload_access_requests (
  email TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  requested_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tech_sections (
  id TEXT PRIMARY KEY,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('character', 'support')),
  subject_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  published INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0, 1)),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tech_sections_subject
  ON tech_sections (scope_kind, subject_id, published, sort_order);

CREATE TABLE IF NOT EXISTS tech_entries (
  id TEXT PRIMARY KEY,
  section_id TEXT NOT NULL REFERENCES tech_sections(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  notation TEXT NOT NULL DEFAULT '',
  videos TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(videos)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  published INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0, 1)),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tech_entries_section
  ON tech_entries (section_id, published, sort_order);

CREATE TABLE IF NOT EXISTS character_notes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('pressure', 'oki', 'guide')),
  character_id TEXT NOT NULL,
  support_id TEXT,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  revision INTEGER NOT NULL DEFAULT 1,
  published INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0, 1)),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS character_notes_selection
  ON character_notes (kind, character_id, support_id, published);

CREATE TABLE IF NOT EXISTS character_note_sections (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('pressure', 'oki', 'guide')),
  character_id TEXT NOT NULL,
  support_id TEXT,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  revision INTEGER NOT NULL DEFAULT 1,
  published INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0, 1)),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS character_note_sections_selection
  ON character_note_sections (kind, character_id, support_id, published);

CREATE TABLE IF NOT EXISTS channel_links (
  id TEXT PRIMARY KEY,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('character', 'support')),
  subject_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  published INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0, 1)),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS channel_links_subject
  ON channel_links (scope_kind, subject_id, published, platform, title);

CREATE TABLE IF NOT EXISTS catalog_players (
  id TEXT PRIMARY KEY,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('character', 'support')),
  subject_id TEXT NOT NULL,
  title TEXT NOT NULL,
  links TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  published INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0, 1)),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS catalog_players_subject
  ON catalog_players (scope_kind, subject_id, published, title);

INSERT OR IGNORE INTO catalog_players
  (id, scope_kind, subject_id, title, links, revision, published, updated_by, updated_at)
SELECT id, scope_kind, subject_id, title, json_array(url), revision, published, updated_by, updated_at
FROM channel_links;

CREATE TABLE IF NOT EXISTS guide_video_uploads (
  id TEXT PRIMARY KEY,
  editor_email TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  object_key TEXT NOT NULL,
  upload_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploading',
  youtube_session TEXT,
  youtube_channel_id TEXT,
  youtube_video_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guide_publications (
  id TEXT PRIMARY KEY,
  editor_email TEXT NOT NULL,
  type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT NOT NULL DEFAULT '',
  lease_until INTEGER NOT NULL DEFAULT 0,
  result TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS guide_publications_pending ON guide_publications (status, lease_until);
CREATE UNIQUE INDEX IF NOT EXISTS guide_publications_one_pending
  ON guide_publications (type, item_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS guide_upload_worker_lock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  lease_until INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO guide_upload_worker_lock (id, lease_until) VALUES (1, 0);
