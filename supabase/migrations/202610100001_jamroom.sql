-- Database is authoritative. Presence is presentation; leases determine empty rooms.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.profiles
  (id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT 'Music friend' check(length(display_name) BETWEEN 1 AND 40),
  avatar_url text, updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.rooms (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.profiles,
  name text NOT NULL check(length(name) BETWEEN 1 AND 80),
  description text NOT NULL DEFAULT '' check(length(description)<=500),
  slug text NOT NULL UNIQUE,
  cover text NOT NULL DEFAULT 'pink' check(cover IN ('pink', 'yellow', 'blue', 'mint', 'lavender')),
  visibility text NOT NULL DEFAULT 'public' check(visibility IN ('public', 'private')),
  invite_code UUID NOT NULL DEFAULT gen_random_uuid(),
  allow_add boolean NOT NULL DEFAULT TRUE,
  allow_manage boolean NOT NULL DEFAULT FALSE,
  allow_control boolean NOT NULL DEFAULT TRUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.room_members
  (room_id UUID REFERENCES public.rooms ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles ON DELETE CASCADE,
  can_manage boolean NOT NULL DEFAULT FALSE,
  can_control boolean NOT NULL DEFAULT FALSE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(room_id,
  user_id));

CREATE TABLE public.playlist_items
  (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms ON DELETE CASCADE,
  youtube_video_id text NOT NULL check(youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'),
  title text NOT NULL check(length(title) BETWEEN 1 AND 200),
  thumbnail text NOT NULL,
  duration_seconds integer check(duration_seconds>=0),
  channel_name text, POSITION integer NOT NULL,
  added_by UUID NOT NULL REFERENCES public.profiles,
  added_at timestamptz NOT NULL DEFAULT now(),
  unique(room_id, youtube_video_id),
  unique(room_id, POSITION) DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE public.room_playback_states
  (room_id UUID PRIMARY KEY REFERENCES public.rooms ON DELETE CASCADE,
  current_track_id UUID REFERENCES public.playlist_items ON DELETE
   SET NULL,
       status text NOT NULL DEFAULT 'stopped' check(status IN ('playing', 'paused', 'stopped')),
  position_seconds double precision NOT NULL DEFAULT 0 check(position_seconds>=0),
  playback_started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES public.profiles,
  state_version bigint NOT NULL DEFAULT 0,
  shuffle_enabled boolean NOT NULL DEFAULT FALSE,
  repeat_mode text NOT NULL DEFAULT 'off' check(repeat_mode IN ('off', 'song', 'playlist')));

CREATE TABLE public.room_messages
  (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles,
  BODY text NOT NULL check(length(BODY) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.playback_history
  (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms ON DELETE CASCADE,
  youtube_video_id text NOT NULL,
  title text NOT NULL,
  played_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.room_listener_leases
  (room_id UUID REFERENCES public.rooms ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles ON DELETE CASCADE,
  tab_id UUID NOT NULL,
  last_seen timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(room_id,
  user_id,
  tab_id));

CREATE INDEX playlist_room ON public.playlist_items(room_id, POSITION);

CREATE INDEX messages_room ON public.room_messages(room_id, created_at DESC);

CREATE INDEX history_room ON public.playback_history(room_id, played_at DESC);

CREATE INDEX members_user ON public.room_members(user_id);

CREATE INDEX leases_room ON public.room_listener_leases(room_id, last_seen);

CREATE FUNCTION public.bootstrap_profile() RETURNS TRIGGER LANGUAGE PLPGSQL SECURITY DEFINER
SET search_path=PUBLIC AS $$
BEGIN
INSERT INTO profiles(id, display_name)
VALUES(new.id,
       left(coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), 'Music friend'), 40)); RETURN NEW; END
$$;

CREATE TRIGGER on_auth_user_created AFTER
INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.bootstrap_profile();

INSERT INTO public.profiles(id, display_name)
SELECT id,
       left(coalesce(nullif(raw_user_meta_data->>'display_name', ''), 'Music friend'), 40)
FROM auth.users ON conflict(id) DO NOTHING;

CREATE FUNCTION public.can_read_room(rid UUID) RETURNS boolean LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path=PUBLIC AS $$
SELECT exists
  (SELECT 1
   FROM rooms r
   WHERE r.id=rid
     AND (r.visibility='public'
          OR r.owner_id=auth.uid()
          OR exists
            (SELECT 1
             FROM room_members m
             WHERE m.room_id=rid
               AND m.user_id=auth.uid())))
$$;

CREATE FUNCTION public.room_permission(rid UUID, action text) RETURNS boolean LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path=PUBLIC AS $$
SELECT auth.uid() IS NOT NULL
AND exists
  (SELECT 1
   FROM rooms r
   WHERE r.id=rid
     AND public.can_read_room(rid)
     AND (r.owner_id=auth.uid()
          OR (exists
                (SELECT 1
                 FROM room_members m
                 WHERE m.room_id=rid
                   AND m.user_id=auth.uid())
              AND CASE action
  WHEN 'add' THEN r.allow_add
  WHEN 'manage' THEN r.allow_manage
  OR exists
  (SELECT 1
  FROM room_members m
  WHERE m.room_id=rid
  AND m.user_id=auth.uid()
  AND m.can_manage)
  WHEN 'control' THEN r.allow_control
  OR exists
  (SELECT 1
  FROM room_members m
  WHERE m.room_id=rid
  AND m.user_id=auth.uid()
  AND m.can_control)
  ELSE FALSE
                  END)))
$$;

CREATE FUNCTION public.create_room(p_name text,p_description text,p_visibility text,p_cover text) RETURNS JSONB LANGUAGE PLPGSQL SECURITY DEFINER
SET search_path=PUBLIC AS $$
DECLARE r rooms;

BEGIN IF auth.uid() IS NULL
OR coalesce((auth.jwt()->>'is_anonymous')::boolean, FALSE) THEN RAISE
EXCEPTION 'Sign in with a permanent account to create rooms'; END IF;
INSERT INTO rooms(owner_id, name, description, visibility, cover, slug)
VALUES(auth.uid(),
       p_name,
       p_description,
       p_visibility,
       p_cover,
       trim(BOTH '-'
            FROM regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'))||'-'||substr(gen_random_uuid()::text, 1, 8)) RETURNING * INTO r;
INSERT INTO room_members(room_id, user_id, can_manage, can_control)
VALUES(r.id,
       auth.uid(),
       TRUE,
       TRUE);
INSERT INTO room_playback_states(room_id)
VALUES(r.id); RETURN to_jsonb(r); END
$$;

CREATE FUNCTION public.join_room(p_slug text,p_invite UUID DEFAULT NULL) RETURNS JSONB LANGUAGE PLPGSQL SECURITY DEFINER
SET search_path=PUBLIC AS $$
DECLARE r rooms;

BEGIN IF auth.uid() IS NULL THEN RAISE
EXCEPTION 'Authentication required'; END IF;
SELECT * INTO r
FROM rooms
WHERE slug=p_slug; IF r.id IS NULL
  OR (NOT can_read_room(r.id)
      AND (p_invite IS NULL
           OR p_invite<>r.invite_code)) THEN RAISE
  EXCEPTION 'Room unavailable or invitation required'; END IF;
  INSERT INTO room_members(room_id, user_id)
VALUES(r.id,
       auth.uid()) ON CONFLICT DO NOTHING; RETURN to_jsonb(r); END
$$;

CREATE FUNCTION public.playlist_mutation(p_room UUID, p_action text,p_item UUID DEFAULT NULL, p_video text DEFAULT NULL, p_title text DEFAULT NULL, p_thumbnail text DEFAULT NULL, p_channel text DEFAULT NULL, p_duration integer DEFAULT NULL, p_order UUID[] DEFAULT NULL) RETURNS void LANGUAGE PLPGSQL SECURITY DEFINER
SET search_path=PUBLIC AS $$
DECLARE n integer;

BEGIN
PERFORM 1
FROM rooms
WHERE id=p_room
  FOR
  UPDATE; IF NOT room_permission(p_room, CASE
  WHEN p_action='add' THEN 'add'
  ELSE 'manage'
  END) THEN RAISE
  EXCEPTION 'Permission denied'; END IF; IF p_action='add' THEN
  SELECT coalesce(max(POSITION), -1)+1 INTO n
  FROM playlist_items
  WHERE room_id=p_room;
    INSERT INTO playlist_items(room_id, youtube_video_id, title, thumbnail, channel_name, duration_seconds, POSITION, added_by)
  VALUES(p_room,
         p_video,
         p_title,
         p_thumbnail,
         p_channel,
         p_duration,
         n,
         auth.uid()); ELSIF p_action='remove' THEN IF EXISTS
    (SELECT 1
     FROM room_playback_states
     WHERE room_id=p_room
       AND current_track_id=p_item) THEN
  UPDATE room_playback_states
  SET current_track_id=NULL,
      status='stopped',
      position_seconds=0,
      playback_started_at=NULL,
      state_version=state_version+1,
      updated_at=clock_timestamp(),
      updated_by=auth.uid()
  WHERE room_id=p_room; END IF;
  DELETE
  FROM playlist_items WHERE id=p_item
  AND room_id=p_room; ELSIF p_action='reorder' THEN IF cardinality(p_order)<>
    (SELECT count(*)
     FROM playlist_items
     WHERE room_id=p_room)
  OR
    (SELECT count(DISTINCT x)
     FROM unnest(p_order) x)<>cardinality(p_order)
  OR exists
    (SELECT 1
     FROM unnest(p_order) x
     WHERE NOT exists
         (SELECT 1
          FROM playlist_items
          WHERE id=x
            AND room_id=p_room)) THEN RAISE
  EXCEPTION 'Queue changed; refresh before reorder'; END IF;
  UPDATE playlist_items p
  SET POSITION=o.n-1
  FROM unnest(p_order) WITH
  ORDINALITY o(id, n) WHERE p.id=o.id
  AND p.room_id=p_room; ELSE RAISE
  EXCEPTION 'Unknown action'; END IF;
  UPDATE rooms
  SET updated_at=now() WHERE id=p_room; END
$$;

-- Join/heartbeat freezes abandoned playback before refreshing a lease. No writes per second.

CREATE FUNCTION public.listener_heartbeat(p_room UUID, p_tab UUID, p_leave boolean DEFAULT FALSE) RETURNS JSONB LANGUAGE PLPGSQL SECURITY DEFINER
SET search_path=PUBLIC AS $$
DECLARE s room_playback_states;

last_active timestamptz;

t timestamptz:=clock_timestamp();

BEGIN IF NOT can_read_room(p_room)
OR auth.uid() IS NULL THEN RAISE
EXCEPTION 'Permission denied'; END IF;
PERFORM 1
FROM rooms
WHERE id=p_room
  FOR
  UPDATE;
  SELECT * INTO s
FROM room_playback_states
WHERE room_id=p_room
  FOR
  UPDATE;
  SELECT max(last_seen) INTO last_active
FROM room_listener_leases
WHERE room_id=p_room; IF s.status='playing'
  AND (last_active IS NULL
       OR last_active<t-interval '45 seconds') THEN
  UPDATE room_playback_states
  SET status='paused',
      position_seconds=s.position_seconds+greatest(0, extract(epoch
  FROM (coalesce(last_active, s.playback_started_at)-s.playback_started_at))),
      playback_started_at=NULL,
      state_version=state_version+1,
      updated_at=t
  WHERE room_id=p_room; END IF; IF p_leave THEN
  DELETE
  FROM room_listener_leases
  WHERE room_id=p_room
    AND user_id=auth.uid()
    AND tab_id=p_tab; IF NOT EXISTS
      (SELECT 1
       FROM room_listener_leases
       WHERE room_id=p_room
         AND last_seen>t-interval '45 seconds') THEN
    UPDATE room_playback_states
    SET position_seconds=position_seconds+CASE
  WHEN status='playing' THEN greatest(0, extract(epoch
  FROM (t-playback_started_at)))
  ELSE 0
  END,
  status=CASE
  WHEN status='playing' THEN 'paused'
  ELSE status
  END,
  playback_started_at=NULL,
  state_version=state_version+1,
  updated_at=t WHERE room_id=p_room; END IF; ELSE
  INSERT INTO room_listener_leases(room_id, user_id, tab_id, last_seen)
VALUES(p_room,
       auth.uid(),
       p_tab,
       t) ON conflict(room_id, user_id, tab_id) DO
UPDATE
SET last_seen=t; END IF;
DELETE
FROM room_listener_leases
WHERE room_id=p_room
  AND last_seen<t-interval '1 day';
  SELECT * INTO s
FROM room_playback_states
WHERE room_id=p_room; RETURN jsonb_build_object('state', to_jsonb(s), 'server_time', clock_timestamp()); END
$$;

CREATE FUNCTION public.playback_command(p_room UUID, p_version bigint,p_action text,p_track UUID DEFAULT NULL, p_position double precision DEFAULT NULL, p_shuffle boolean DEFAULT NULL, p_repeat text DEFAULT NULL) RETURNS JSONB LANGUAGE PLPGSQL SECURITY DEFINER
SET search_path=PUBLIC AS $$
DECLARE s room_playback_states;

target playlist_items;

t timestamptz:=clock_timestamp();

pos double precision;

BEGIN
PERFORM 1
FROM rooms
WHERE id=p_room
  FOR
  UPDATE; IF NOT room_permission(p_room, 'control') THEN RAISE
  EXCEPTION 'Permission denied'; END IF;
  SELECT * INTO s
FROM room_playback_states
WHERE room_id=p_room
  FOR
  UPDATE; IF s.state_version<>p_version THEN RETURN jsonb_build_object('conflict', TRUE, 'state', to_jsonb(s), 'server_time', t); END IF; pos:=s.position_seconds+CASE
  WHEN s.status='playing' THEN greatest(0, extract(epoch
  FROM(t-s.playback_started_at)))
  ELSE 0
  END; IF p_action IN ('select',
  'next',
  'previous',
  'ended') THEN IF p_action='ended'
  AND s.status<>'playing' THEN RETURN jsonb_build_object('conflict', TRUE, 'state', to_jsonb(s), 'server_time', t); END IF; IF p_action='select' THEN
  SELECT * INTO target
  FROM playlist_items
  WHERE room_id=p_room
    AND id=p_track; IF target.id IS NULL THEN RAISE
    EXCEPTION 'Track unavailable'; END IF; ELSIF p_action='ended'
    AND s.repeat_mode='song' THEN
    SELECT * INTO target
  FROM playlist_items
  WHERE room_id=p_room
    AND id=s.current_track_id; ELSIF s.shuffle_enabled THEN
    SELECT * INTO target
  FROM playlist_items
  WHERE room_id=p_room
    AND id IS DISTINCT
    FROM s.current_track_id
  ORDER BY random()
  LIMIT 1; ELSE IF p_action='previous' THEN
  SELECT * INTO target
  FROM playlist_items
  WHERE room_id=p_room
    AND POSITION<coalesce(
  (SELECT POSITION
  FROM playlist_items
  WHERE id=s.current_track_id),2147483647)
  ORDER BY POSITION DESC
  LIMIT 1; ELSE
  SELECT * INTO target
  FROM playlist_items
  WHERE room_id=p_room
    AND POSITION>coalesce(
  (SELECT POSITION
  FROM playlist_items
  WHERE id=s.current_track_id),-1)
  ORDER BY POSITION
  LIMIT 1; END IF; END IF; IF target.id IS NULL
  AND (s.repeat_mode='playlist'
       OR p_action IN ('next',
  'previous')) THEN
  SELECT * INTO target
  FROM playlist_items
  WHERE room_id=p_room
  ORDER BY CASE
               WHEN p_action='previous' THEN -POSITION
               ELSE POSITION
           END
  LIMIT 1; END IF; s.current_track_id:=target.id; s.status:=CASE
  WHEN target.id IS NULL THEN 'stopped'
  ELSE 'playing'
  END; pos:=0; IF target.id IS NOT NULL THEN
  INSERT INTO playback_history(room_id, youtube_video_id, title)
  VALUES(p_room,
         target.youtube_video_id,
         target.title);
  DELETE
  FROM playback_history
  WHERE room_id=p_room
    AND id NOT IN
      (SELECT id
       FROM playback_history
       WHERE room_id=p_room
       ORDER BY played_at DESC
       LIMIT 50); END IF; ELSIF p_action='play' THEN IF s.current_track_id IS NULL THEN
  SELECT * INTO target
  FROM playlist_items
  WHERE room_id=p_room
  ORDER BY POSITION
  LIMIT 1; s.current_track_id:=target.id; pos:=0; IF target.id IS NOT NULL THEN
  INSERT INTO playback_history(room_id, youtube_video_id, title)
  VALUES(p_room,
         target.youtube_video_id,
         target.title); END IF; END IF; IF s.current_track_id IS NULL THEN RAISE
  EXCEPTION 'Add a song first'; END IF; s.status:='playing'; ELSIF p_action='pause' THEN s.status:='paused'; ELSIF p_action='seek' THEN IF p_position IS NULL
  OR p_position<0
  OR p_position>86400 THEN RAISE
  EXCEPTION 'Invalid position'; END IF; pos:=p_position; ELSIF p_action='options' THEN IF p_repeat IS NOT NULL
  AND p_repeat NOT IN ('off',
  'song',
  'playlist') THEN RAISE
  EXCEPTION 'Invalid repeat'; END IF; s.shuffle_enabled:=coalesce(p_shuffle, s.shuffle_enabled); s.repeat_mode:=coalesce(p_repeat, s.repeat_mode); ELSE RAISE
  EXCEPTION 'Unknown command'; END IF;
  UPDATE room_playback_states
  SET current_track_id=s.current_track_id,
      status=s.status,
      position_seconds=pos,
      playback_started_at=CASE
  WHEN s.status='playing' THEN t
  ELSE NULL
  END,
  shuffle_enabled=s.shuffle_enabled,
  repeat_mode=s.repeat_mode,
  state_version=state_version+1,
  updated_at=t,
  updated_by=auth.uid() WHERE room_id=p_room RETURNING * INTO s; RETURN jsonb_build_object('conflict', FALSE, 'state', to_jsonb(s), 'server_time', clock_timestamp()); END
$$;

CREATE FUNCTION public.send_message(p_room UUID, p_body text) RETURNS void LANGUAGE PLPGSQL SECURITY DEFINER
SET search_path=PUBLIC AS $$
BEGIN
PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 1)); IF NOT can_read_room(p_room)
OR NOT exists
  (SELECT 1
   FROM room_members
   WHERE room_id=p_room
     AND user_id=auth.uid()) THEN RAISE
EXCEPTION 'Permission denied'; END IF; IF EXISTS
  (SELECT 1
   FROM room_messages
   WHERE user_id=auth.uid()
     AND created_at>now()-interval '1 second') THEN RAISE
EXCEPTION 'Slow down a little'; END IF;
INSERT INTO room_messages(room_id, user_id, BODY)
VALUES(p_room,
       auth.uid(),
       p_body);
DELETE
FROM room_messages
WHERE room_id=p_room
  AND id NOT IN
    (SELECT id
     FROM room_messages
     WHERE room_id=p_room
     ORDER BY created_at DESC
     LIMIT 100); END
$$;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

ALTER TABLE room_members ENABLE ROW LEVEL SECURITY;

ALTER TABLE playlist_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE room_playback_states ENABLE ROW LEVEL SECURITY;

ALTER TABLE room_messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE playback_history ENABLE ROW LEVEL SECURITY;

ALTER TABLE room_listener_leases ENABLE ROW LEVEL SECURITY;

CREATE policy profile_read ON profiles
FOR
SELECT TO authenticated USING(TRUE);

CREATE policy profile_update ON profiles
FOR
UPDATE TO authenticated USING(id=auth.uid()) WITH check(id=auth.uid());

CREATE policy room_read ON rooms
FOR
SELECT TO authenticated USING(can_read_room(id));

CREATE policy room_update ON rooms
FOR
UPDATE TO authenticated USING(owner_id=auth.uid()) WITH check(owner_id=auth.uid());

CREATE policy room_delete ON rooms
FOR
DELETE TO authenticated USING(owner_id=auth.uid());

CREATE policy member_read ON room_members
FOR
SELECT TO authenticated USING(can_read_room(room_id));

CREATE policy member_update ON room_members
FOR
UPDATE TO authenticated USING(exists
  (SELECT 1
  FROM rooms
  WHERE id=room_id
  AND owner_id=auth.uid())) WITH check(exists
  (SELECT 1
  FROM rooms
  WHERE id=room_id
  AND owner_id=auth.uid()));

CREATE policy playlist_read ON playlist_items
FOR
SELECT TO authenticated USING(can_read_room(room_id));

CREATE policy state_read ON room_playback_states
FOR
SELECT TO authenticated USING(can_read_room(room_id));

CREATE policy message_read ON room_messages
FOR
SELECT TO authenticated USING(can_read_room(room_id));

CREATE policy history_read ON playback_history
FOR
SELECT TO authenticated USING(can_read_room(room_id));

REVOKE ALL ON profiles,
              rooms,
              room_members,
              playlist_items,
              room_playback_states,
              room_messages,
              playback_history,
              room_listener_leases
FROM anon,
     authenticated;

GRANT
SELECT ON profiles,
          rooms,
          room_members,
          playlist_items,
          room_playback_states,
          room_messages,
          playback_history TO authenticated;

GRANT update(display_name, avatar_url, updated_at) ON profiles TO authenticated;

GRANT update(name, description, cover, visibility, allow_add, allow_manage, allow_control, updated_at) ON rooms TO authenticated;

GRANT
DELETE ON rooms TO authenticated;

GRANT update(can_manage, can_control) ON room_members TO authenticated;

REVOKE EXECUTE ON FUNCTION bootstrap_profile()
FROM PUBLIC,
     anon,
     authenticated;

REVOKE EXECUTE ON FUNCTION can_read_room(UUID),
  room_permission(UUID,text),
  create_room(text,text,text,text),
  join_room(text,UUID),
  playlist_mutation(UUID,text,UUID,text,text,text,text,integer,UUID[]),
  listener_heartbeat(UUID, UUID,boolean),
  playback_command(UUID,bigint,text,UUID,double precision,boolean,text),
  send_message(UUID,text)
FROM PUBLIC,
     anon;

GRANT EXECUTE ON FUNCTION can_read_room(UUID),
  room_permission(UUID,text),
  create_room(text,text,text,text),
  join_room(text,UUID),
  playlist_mutation(UUID,text,UUID,text,text,text,text,integer,UUID[]),
  listener_heartbeat(UUID, UUID,boolean),
  playback_command(UUID,bigint,text,UUID,double precision,boolean,text),
  send_message(UUID,text) TO authenticated;

-- Authenticated private Realtime channels; database events remain protected by RLS.

CREATE policy room_realtime_read ON realtime.messages
FOR
SELECT TO authenticated USING(public.can_read_room(CASE
  WHEN realtime.topic() ~ '^room:[0-9a-f-]{36}$' THEN split_part(realtime.topic(), ':', 2)::UUID
  ELSE NULL
  END));

CREATE policy room_realtime_write ON realtime.messages
FOR
INSERT TO authenticated WITH check(public.can_read_room(CASE
  WHEN realtime.topic() ~ '^room:[0-9a-f-]{36}$' THEN split_part(realtime.topic(), ':', 2)::UUID
  ELSE NULL
  END));

ALTER publication supabase_realtime ADD TABLE rooms,
  playlist_items,
  room_playback_states,
  room_messages,
  room_members,
  playback_history;

CREATE FUNCTION public.playback_snapshot(p_room UUID) RETURNS JSONB LANGUAGE PLPGSQL SECURITY DEFINER
SET search_path=PUBLIC AS $$
BEGIN IF NOT can_read_room(p_room)
OR auth.uid() IS NULL THEN RAISE
EXCEPTION 'Permission denied'; END IF; RETURN jsonb_build_object('state',
  (SELECT to_jsonb(s)
  FROM room_playback_states s
  WHERE room_id=p_room),'server_time', clock_timestamp()); END
$$;

REVOKE EXECUTE ON FUNCTION playback_snapshot(UUID)
FROM PUBLIC,
     anon;

GRANT EXECUTE ON FUNCTION playback_snapshot(UUID) TO authenticated;
