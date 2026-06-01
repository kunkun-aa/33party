PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS bars (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY,
  bar_id TEXT NOT NULL REFERENCES bars(id),
  openid TEXT UNIQUE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  wechat_id TEXT NOT NULL,
  wechat_qr_url TEXT,
  is_default INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

CREATE TABLE IF NOT EXISTS parties (
  id TEXT PRIMARY KEY,
  bar_id TEXT NOT NULL REFERENCES bars(id),
  admin_id TEXT NOT NULL REFERENCES admins(id),
  title TEXT NOT NULL,
  scene_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'open',
  starts_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

CREATE TABLE IF NOT EXISTS party_tables (
  id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL REFERENCES parties(id),
  table_no TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 8,
  status TEXT NOT NULL DEFAULT 'open',
  share_scene TEXT NOT NULL UNIQUE,
  head_member_id TEXT REFERENCES party_members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  UNIQUE(party_id, table_no)
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  openid TEXT UNIQUE,
  nickname TEXT NOT NULL,
  avatar_url TEXT,
  gender TEXT NOT NULL DEFAULT 'unknown',
  phone TEXT,
  wechat_id TEXT,
  profile_complete INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

CREATE TABLE IF NOT EXISTS party_members (
  id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL REFERENCES parties(id),
  table_id TEXT NOT NULL REFERENCES party_tables(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'guest',
  seat_status TEXT NOT NULL DEFAULT 'ghost',
  joined_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  UNIQUE(party_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL REFERENCES parties(id),
  table_id TEXT NOT NULL REFERENCES party_tables(id),
  sender_type TEXT NOT NULL CHECK(sender_type IN ('user', 'admin')),
  sender_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('text', 'voice', 'photo', 'video', 'system', 'photo_burst')),
  text TEXT,
  media_url TEXT,
  duration_seconds INTEGER,
  quote_message_id TEXT,
  quote_sender TEXT,
  quote_kind TEXT,
  quote_text TEXT,
  quote_media_url TEXT,
  quote_duration_seconds INTEGER,
  like_count INTEGER NOT NULL DEFAULT 0,
  is_flash INTEGER NOT NULL DEFAULT 0,
  flash_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

CREATE TABLE IF NOT EXISTS contact_requests (
  id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL REFERENCES parties(id),
  requester_type TEXT NOT NULL CHECK(requester_type IN ('user', 'admin')),
  requester_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK(target_type IN ('user', 'admin')),
  target_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'allowed',
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admins(id),
  openid TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

CREATE INDEX IF NOT EXISTS idx_party_tables_party ON party_tables(party_id);
CREATE INDEX IF NOT EXISTS idx_party_members_party ON party_members(party_id);
CREATE INDEX IF NOT EXISTS idx_party_members_table ON party_members(table_id);
CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(party_id, table_id, id);
CREATE INDEX IF NOT EXISTS idx_contact_requests_party ON contact_requests(party_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON admin_sessions(admin_id);
