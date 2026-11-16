import { randomUUID } from "node:crypto";
import { roomPermissions } from "./identity";
import { authenticate, ServiceError } from "./identity-service";
import { parseMusicSource, playbackCandidate, type MusicPlayback, type MusicSource } from "./music";
import type { SqlExecutor, SynoraStore } from "./store";

type Room = { id: string; owner_id: string; visibility: "public" | "private"; allow_add: number; allow_manage: number; allow_control: number };
type Member = { role: "ADMIN" | "DJ" | "MEMBER"; can_manage: number; can_control: number };
type Item = {
  id: string; room_id: string; source_provider: string; source_url: string; playback_provider: string;
  playback_external_id: string; playback_url: string; title: string; artist: string | null;
  thumbnail: string | null; duration_seconds: number | null; position: number; added_by: string; added_at: number;
};

export async function roomAccess(tx: SqlExecutor, slug: string, token: unknown, now: number) {
  const user = await authenticate(tx, token, now);
  const [room] = await tx.query<Room>("SELECT id,owner_id,visibility,allow_add,allow_manage,allow_control FROM rooms WHERE slug=?", [slug]);
  if (!room) throw new ServiceError(404, "Room unavailable");
  const [member] = await tx.query<Member>("SELECT role,can_manage,can_control FROM room_members WHERE room_id=? AND user_id=?", [room.id,user.id]);
  const [restriction] = await tx.query<{ expires_at: number | null }>("SELECT expires_at FROM room_restrictions WHERE room_id=? AND user_id=?",[room.id,user.id]);
  const permissions = roomPermissions({ ownerId:room.owner_id, visibility:room.visibility, allowAdd:!!room.allow_add,
    allowManage:!!room.allow_manage, allowControl:!!room.allow_control },user.id,
    member?{role:member.role,canManage:!!member.can_manage,canControl:!!member.can_control}:undefined,
    restriction?{expiresAt:restriction.expires_at}:undefined,now);
  if (!permissions.read) throw new ServiceError(404, "Room unavailable");
  return { user, room, permissions };
}

export async function queueSnapshot(db: SynoraStore, token: unknown, slug: string, now = Date.now()) {
  const { room, permissions } = await roomAccess(db,slug,token,now);
  const items = await db.query<Item>("SELECT id,room_id,source_provider,source_url,playback_provider,playback_external_id,playback_url,title,artist,thumbnail,duration_seconds,position,added_by,added_at FROM playlist_items WHERE room_id=? ORDER BY position",[room.id]);
  const [state] = await db.query("SELECT current_track_id,status,position_seconds,playback_started_at,updated_at,state_version FROM room_playback_states WHERE room_id=?",[room.id]);
  return { items, state, now, canControl: permissions.control, canAdd: permissions.add };
}

export async function requireQueueAdd(db: SynoraStore, token: unknown, slug: string, now = Date.now()) {
  const { permissions } = await roomAccess(db,slug,token,now);
  if (!permissions.add) throw new ServiceError(403,"You cannot add tracks to this room");
}

export async function realtimeAccess(db: SynoraStore, token: unknown, slug: string, now = Date.now()) {
  const { user, room, permissions } = await roomAccess(db,slug,token,now);
  return { clientId:user.id, roomId:room.id, member:permissions.member };
}

export type QueueCandidate = { source: MusicSource; playback: MusicPlayback; title: string; artist: string | null; thumbnail: string | null; durationSeconds: number | null };

export function parseQueueRequest(input: unknown) {
  if (!input || typeof input !== "object") throw new ServiceError(400,"Music URL required");
  const payload = input as Record<string,unknown>;
  const source = typeof payload.url === "string" ? parseMusicSource(payload.url) : null;
  if (!source) throw new ServiceError(400,"Unsupported music URL");
  let playback = playbackCandidate(source);
  if (!playback && typeof payload.matchUrl === "string") {
    const match = parseMusicSource(payload.matchUrl);
    if (match?.provider === "youtube" || match?.provider === "youtube-music") playback = playbackCandidate(match);
  }
  if (!playback) throw new ServiceError(422,"This source needs an explicit playable YouTube match");
  return { source, playback };
}

export async function addQueueItem(db: SynoraStore, token: unknown, slug: string, candidate: QueueCandidate, now = Date.now()) {
  if (!candidate.title.trim() || candidate.title.length > 200) throw new ServiceError(400,"Invalid title");
  return db.write(async tx => {
    const { user, room, permissions } = await roomAccess(tx,slug,token,now);
    if (!permissions.add) throw new ServiceError(403,"You cannot add tracks to this room");
    const id = randomUUID();
    const [max] = await tx.query<{ position: number }>("SELECT COALESCE(MAX(position),-1)+1 AS position FROM playlist_items WHERE room_id=?",[room.id]);
    const [existing] = await tx.query<{id:string}>("SELECT id FROM playlist_items WHERE room_id=? AND playback_provider=? AND playback_external_id=?",[room.id,candidate.playback.provider,candidate.playback.externalId]);
    if (existing) throw new ServiceError(409,"Track is already queued");
    await tx.execute("INSERT INTO playlist_items(id,room_id,source_provider,source_external_id,source_url,playback_provider,playback_external_id,playback_url,title,artist,thumbnail,duration_seconds,position,added_by,added_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [id,room.id,candidate.source.provider,candidate.source.externalId,candidate.source.url,candidate.playback.provider,candidate.playback.externalId,candidate.playback.url,candidate.title,candidate.artist,candidate.thumbnail,candidate.durationSeconds,max.position,user.id,now]);
    await tx.execute("UPDATE room_playback_states SET current_track_id=?,status='paused',position_seconds=0,updated_at=?,updated_by=?,state_version=state_version+1 WHERE room_id=? AND current_track_id IS NULL",[id,now,user.id,room.id]);
    await tx.execute("INSERT INTO realtime_outbox(id,room_id,event,created_at) VALUES(?,?,'refresh',?)",[randomUUID(),room.id,now]);
    const [item] = await tx.query<Item>("SELECT id,room_id,source_provider,source_url,playback_provider,playback_external_id,playback_url,title,artist,thumbnail,duration_seconds,position,added_by,added_at FROM playlist_items WHERE id=?",[id]);
    return item;
  });
}
