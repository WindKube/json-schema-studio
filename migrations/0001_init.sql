CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  github_id INTEGER NOT NULL UNIQUE,
  login TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX users_login ON users (lower(login));

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE schemas (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users (id),
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('json', 'yaml')),
  schema_uri TEXT,
  public_versions INTEGER NOT NULL DEFAULT 0,
  source_url TEXT,
  source_version TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (owner_id, slug)
);

CREATE TABLE drafts (
  schema_id INTEGER PRIMARY KEY REFERENCES schemas (id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  base_version_id INTEGER,
  failing_examples INTEGER NOT NULL DEFAULT 0,
  updated_by INTEGER REFERENCES users (id),
  updated_at INTEGER NOT NULL
);

CREATE TABLE versions (
  id INTEGER PRIMARY KEY,
  schema_id INTEGER NOT NULL REFERENCES schemas (id) ON DELETE CASCADE,
  semver TEXT NOT NULL,
  text TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  example_results TEXT NOT NULL DEFAULT '[]',
  published_by INTEGER NOT NULL REFERENCES users (id),
  published_at INTEGER NOT NULL,
  UNIQUE (schema_id, semver)
);

CREATE TABLE members (
  schema_id INTEGER NOT NULL REFERENCES schemas (id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'commenter', 'editor', 'owner')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (schema_id, user_id)
);
CREATE INDEX members_user ON members (user_id);

CREATE TABLE invites (
  id INTEGER PRIMARY KEY,
  schema_id INTEGER NOT NULL REFERENCES schemas (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'commenter', 'editor', 'owner')),
  github_id INTEGER,
  github_login TEXT,
  avatar_url TEXT,
  token_hash TEXT UNIQUE,
  created_by INTEGER NOT NULL REFERENCES users (id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  used_at INTEGER
);
CREATE INDEX invites_login ON invites (lower(github_login));

CREATE TABLE examples (
  id INTEGER PRIMARY KEY,
  schema_id INTEGER NOT NULL REFERENCES schemas (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('json', 'yaml')),
  text TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  expect TEXT NOT NULL CHECK (expect IN ('valid', 'invalid')),
  updated_at INTEGER NOT NULL
);
CREATE INDEX examples_schema ON examples (schema_id);

CREATE TABLE suggestions (
  id INTEGER PRIMARY KEY,
  schema_id INTEGER NOT NULL REFERENCES schemas (id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  author_id INTEGER NOT NULL REFERENCES users (id),
  base_revision INTEGER NOT NULL,
  patch TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'approved', 'changes_requested', 'rejected')),
  decided_by INTEGER REFERENCES users (id),
  decision_note TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (schema_id, number)
);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY,
  schema_id INTEGER NOT NULL REFERENCES schemas (id) ON DELETE CASCADE,
  suggestion_id INTEGER REFERENCES suggestions (id) ON DELETE CASCADE,
  pointer TEXT NOT NULL DEFAULT '#',
  parent_id INTEGER REFERENCES comments (id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users (id),
  body TEXT NOT NULL,
  resolved_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX comments_schema ON comments (schema_id);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  read_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX notifications_user ON notifications (user_id, read_at);

CREATE TABLE catalog_sources (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('catalog', 'schema')),
  created_at INTEGER NOT NULL
);
