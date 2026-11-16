import { randomUUID } from "node:crypto";
import { ServiceError } from "./identity-service";
import { roomAccess } from "./queue-service";
import type { SqlExecutor, SynoraStore } from "./store";

const PRESENCE_TTL_MS = 45_000;
type MessageRow = { id: string; user_id: string; display_name: string; body: string; created_at: number };
type Listener = { id: string; display_name: string; is_owner: number; last_seen: number };

// One authorization check and one parallel read batch for the whole room.
// This backs initial entry and realtime refresh instead of three API calls.
export async function roomView(db: SynoraStore, token: unknown, slug: string, now = Date.now()) {
  const {room,permissions}=await roomAccess(db,slug,token,now);
  const [items,states,chat,listeners]=await Promise.all([
    db.query("SELECT id,room_id,source_provider,source_url,playback_provider,playback_external_id,playback_url,title,artist,thumbnail,duration_seconds,position,added_by,added_at FROM playlist_items WHERE room_id=? ORDER BY position",[room.id]),
    db.query("SELECT current_track_id,status,position_seconds,playback_started_at,updated_at,state_version,shuffle_enabled,repeat_mode FROM room_playback_states WHERE room_id=?",[room.id]),
    db.query<MessageRow>("SELECT m.id,m.user_id,p.display_name,m.body,m.created_at FROM room_messages m JOIN profiles p ON p.id=m.user_id WHERE m.room_id=? ORDER BY m.created_at DESC,m.id DESC LIMIT 50",[room.id]),
    db.query<Listener>("SELECT p.id,p.display_name,CASE WHEN p.id=? THEN 1 ELSE 0 END AS is_owner,MAX(l.last_seen) AS last_seen FROM room_listener_leases l JOIN profiles p ON p.id=l.user_id WHERE l.room_id=? AND l.last_seen>=? GROUP BY p.id,p.display_name ORDER BY is_owner DESC,last_seen DESC LIMIT 100",[room.owner_id,room.id,now-PRESENCE_TTL_MS]),
  ]);
  return {items,state:states[0]??null,messages:chat.reverse(),listeners,now,
    canControl:permissions.control,canAdd:permissions.add,canManage:permissions.manage};
}

async function notify(tx: SqlExecutor, roomId: string, now: number) {
  await tx.execute("INSERT INTO realtime_outbox(id,room_id,event,created_at) VALUES(?,?,'refresh',?)", [randomUUID(),roomId,now]);
}

export async function listRoomMessages(db: SynoraStore, token: unknown, slug: string, now = Date.now()) {
  const { room } = await roomAccess(db,slug,token,now);
  const rows = await db.query<MessageRow>(
    "SELECT m.id,m.user_id,p.display_name,m.body,m.created_at FROM room_messages m JOIN profiles p ON p.id=m.user_id WHERE m.room_id=? ORDER BY m.created_at DESC,m.id DESC LIMIT 50", [room.id]);
  return { messages:rows.reverse() };
}

export async function sendRoomMessage(db: SynoraStore, token: unknown, slug: string, raw: unknown, now = Date.now()) {
  if (typeof raw !== "string" || !raw.trim() || raw.trim().length > 500 || /[\p{Cc}]/u.test(raw)) {
    throw new ServiceError(400,"Message must be 1–500 characters");
  }
  const body = raw.trim();
  return db.write(async tx => {
    const { room, user, permissions } = await roomAccess(tx,slug,token,now);
    if (!permissions.chat) throw new ServiceError(403,"Join this room before chatting");
    const bucket = `room-chat:${room.id}:${user.id}`;
    await tx.execute("INSERT INTO rate_limits(bucket,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END",
      [bucket,now+30_000,now,now]);
    const [attempt] = await tx.query<{count:number}>("SELECT count FROM rate_limits WHERE bucket=?",[bucket]);
    if (attempt.count > 12) throw new ServiceError(429,"Too many messages; wait a moment");
    const id = randomUUID();
    await tx.execute("INSERT INTO room_messages(id,room_id,user_id,body,created_at) VALUES(?,?,?,?,?)",[id,room.id,user.id,body,now]);
    await notify(tx,room.id,now);
    return {roomId:room.id,message:{id,user_id:user.id,display_name:user.display_name,body,created_at:now}};
  });
}

export async function roomListeners(db: SynoraStore, token: unknown, slug: string, now = Date.now()) {
  const {room} = await roomAccess(db,slug,token,now);
  const listeners = await db.query<Listener>(
    "SELECT p.id,p.display_name,CASE WHEN p.id=? THEN 1 ELSE 0 END AS is_owner,MAX(l.last_seen) AS last_seen FROM room_listener_leases l JOIN profiles p ON p.id=l.user_id WHERE l.room_id=? AND l.last_seen>=? GROUP BY p.id,p.display_name ORDER BY is_owner DESC,last_seen DESC LIMIT 100",
    [room.owner_id,room.id,now-PRESENCE_TTL_MS]);
  return { listeners, now };
}

export async function updateRoomPresence(db: SynoraStore, token: unknown, slug: string, tabId: unknown, leaving = false, now = Date.now()) {
  if (typeof tabId !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(tabId)) throw new ServiceError(400,"Invalid tab identity");
  return db.write(async tx => {
    const {room,user,permissions} = await roomAccess(tx,slug,token,now);
    if (!permissions.member) throw new ServiceError(403,"Join this room first");
    await tx.execute("DELETE FROM room_listener_leases WHERE room_id=? AND last_seen<?",[room.id,now-PRESENCE_TTL_MS]);
    const [before] = await tx.query<{n:number}>("SELECT COUNT(*) AS n FROM room_listener_leases WHERE room_id=? AND user_id=? AND last_seen>=?",[room.id,user.id,now-PRESENCE_TTL_MS]);
    if (leaving) {
      await tx.execute("DELETE FROM room_listener_leases WHERE room_id=? AND user_id=? AND tab_id=?",[room.id,user.id,tabId]);
    } else {
      await tx.execute("INSERT INTO room_listener_leases(room_id,user_id,tab_id,last_seen) VALUES(?,?,?,?) ON CONFLICT(room_id,user_id,tab_id) DO UPDATE SET last_seen=excluded.last_seen",[room.id,user.id,tabId,now]);
    }
    const [after] = await tx.query<{n:number}>("SELECT COUNT(*) AS n FROM room_listener_leases WHERE room_id=? AND user_id=? AND last_seen>=?",[room.id,user.id,now-PRESENCE_TTL_MS]);
    if (!!before.n !== !!after.n) await notify(tx,room.id,now);
    return {roomId:room.id};
  });
}
