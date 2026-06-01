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
  agreement_accepted_at TEXT,
  age_confirmed_at TEXT,
  banned_at TEXT,
  ban_reason TEXT,
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
  deleted_at TEXT,
  deleted_by TEXT,
  delete_reason TEXT,
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

CREATE TABLE IF NOT EXISTS message_subscriptions (
  id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL REFERENCES parties(id),
  table_id TEXT NOT NULL REFERENCES party_tables(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  template_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'accepted' CHECK(status IN ('accepted', 'rejected')),
  enabled INTEGER NOT NULL DEFAULT 1,
  last_notified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  UNIQUE(party_id, table_id, user_id, template_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL REFERENCES parties(id),
  table_id TEXT NOT NULL REFERENCES party_tables(id),
  reporter_type TEXT NOT NULL CHECK(reporter_type IN ('user', 'admin')),
  reporter_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK(target_type IN ('message', 'user')),
  target_id TEXT NOT NULL,
  target_user_id TEXT,
  reason TEXT NOT NULL,
  detail TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'resolved', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  handled_at TEXT,
  handled_by TEXT
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
CREATE INDEX IF NOT EXISTS idx_message_subscriptions_room ON message_subscriptions(party_id, table_id);
CREATE INDEX IF NOT EXISTS idx_message_subscriptions_user ON message_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_reports_party ON reports(party_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON admin_sessions(admin_id);
