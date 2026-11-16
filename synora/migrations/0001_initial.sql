-- SYNORA v2 schema. Apply to a fresh Turso database only.
PRAGMA foreign_keys = ON;

CREATE TABLE profiles (
  id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 40),
  avatar_seed TEXT NOT NULL,
  avatar_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY NOT NULL CHECK(length(token_hash)=64),
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at > created_at),
  revoked_at INTEGER
);
CREATE INDEX sessions_user ON sessions(user_id, expires_at);
CREATE TABLE rooms (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES profiles(id),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=500),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','private')),
  cover TEXT NOT NULL DEFAULT 'pink' CHECK(cover IN ('pink','yellow','blue','mint','lavender')),
  invite_hash TEXT NOT NULL UNIQUE CHECK(length(invite_hash)=64),
  recovery_hash TEXT NOT NULL UNIQUE CHECK(length(recovery_hash)=64),
  allow_add INTEGER NOT NULL DEFAULT 1 CHECK(allow_add IN (0,1)),
  allow_manage INTEGER NOT NULL DEFAULT 0 CHECK(allow_manage IN (0,1)),
  allow_control INTEGER NOT NULL DEFAULT 1 CHECK(allow_control IN (0,1)),
  enhancements_enabled INTEGER NOT NULL DEFAULT 0 CHECK(enhancements_enabled IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX rooms_directory ON rooms(visibility, updated_at DESC);
CREATE INDEX rooms_owner ON rooms(owner_id);
CREATE TABLE room_members (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'MEMBER' CHECK(role IN ('ADMIN','DJ','MEMBER')),
  can_manage INTEGER NOT NULL DEFAULT 0 CHECK(can_manage IN (0,1)),
  can_control INTEGER NOT NULL DEFAULT 0 CHECK(can_control IN (0,1)),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY(room_id,user_id)
);
CREATE INDEX members_user ON room_members(user_id, joined_at DESC);
CREATE TABLE playlist_items (
  id TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  source_provider TEXT NOT NULL CHECK(source_provider IN ('youtube','youtube-music','spotify','soundcloud','apple-music','deezer','bandcamp','direct-audio')),
  source_external_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  playback_provider TEXT NOT NULL CHECK(playback_provider IN ('youtube','soundcloud','direct-audio')),
  playback_external_id TEXT NOT NULL,
  playback_url TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
  artist TEXT,
  thumbnail TEXT,
  duration_seconds INTEGER CHECK(duration_seconds>=0),
  position INTEGER NOT NULL,
  added_by TEXT NOT NULL REFERENCES profiles(id),
  added_at INTEGER NOT NULL,
  UNIQUE(room_id,id),
  UNIQUE(room_id,playback_provider,playback_external_id),
  UNIQUE(room_id,position)
);
CREATE TABLE room_playback_states (
  room_id TEXT PRIMARY KEY NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  current_track_id TEXT,
  status TEXT NOT NULL DEFAULT 'stopped' CHECK(status IN ('playing','paused','stopped')),
  position_seconds REAL NOT NULL DEFAULT 0 CHECK(position_seconds>=0),
  playback_started_at INTEGER,
  updated_at INTEGER NOT NULL,
  updated_by TEXT REFERENCES profiles(id),
  state_version INTEGER NOT NULL DEFAULT 0 CHECK(state_version>=0),
  shuffle_enabled INTEGER NOT NULL DEFAULT 0 CHECK(shuffle_enabled IN (0,1)),
  repeat_mode TEXT NOT NULL DEFAULT 'off' CHECK(repeat_mode IN ('off','song','playlist')),
  FOREIGN KEY(room_id,current_track_id) REFERENCES playlist_items(room_id,id),
  CHECK((status='playing' AND current_track_id IS NOT NULL AND playback_started_at IS NOT NULL)
    OR (status!='playing' AND playback_started_at IS NULL)),
  CHECK(status='stopped' OR current_track_id IS NOT NULL)
);
-- Service must clear active playback before removing the selected item.
CREATE TABLE room_messages (
  id TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES profiles(id),
  body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 500),
  created_at INTEGER NOT NULL
);
CREATE INDEX messages_room ON room_messages(room_id,created_at DESC);
CREATE TABLE playback_history (
  id TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  playback_provider TEXT NOT NULL,
  playback_external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  played_at INTEGER NOT NULL
);
CREATE INDEX history_room ON playback_history(room_id,played_at DESC);
CREATE TABLE room_listener_leases (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tab_id TEXT NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY(room_id,user_id,tab_id)
);
CREATE INDEX leases_room ON room_listener_leases(room_id,last_seen);
CREATE TABLE room_restrictions (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN ('kick','ban')),
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(room_id,user_id)
);
CREATE TABLE room_skip_votes (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  state_version INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(room_id,state_version,user_id)
);
CREATE TABLE extension_pairings (
  code_hash TEXT PRIMARY KEY NOT NULL CHECK(length(code_hash)=64),
  user_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
  verifier_hash TEXT NOT NULL CHECK(length(verifier_hash)=64),
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE TABLE extension_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL CHECK(length(token_hash)=64),
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX extension_sessions_user ON extension_sessions(user_id);
-- Retryable invalidation events; payloads contain no invite/session/recovery secrets.
CREATE TABLE realtime_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  event TEXT NOT NULL CHECK(event IN ('refresh','access_changed')),
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);
CREATE INDEX outbox_pending ON realtime_outbox(sent_at,created_at);
CREATE TABLE rate_limits (
  bucket TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL CHECK(count>=0),
  expires_at INTEGER NOT NULL
);
