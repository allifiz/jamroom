import { randomUUID } from "node:crypto";
import { z } from "zod";
import { hashSecret, roomPermissions, validSecret } from "./identity";
import { authenticate, ServiceError } from "./identity-service";
import { parseMusicSource, playbackCandidate, type MusicPlayback, type MusicSource } from "./music";
import type { SqlExecutor, SynoraStore } from "./store";

type Room = { id: string; owner_id: string; slug:string; name:string; description:string; cover:string; visibility: "public" | "private"; allow_add: number; allow_manage: number; allow_control: number };
type Member = { role: "ADMIN" | "DJ" | "MEMBER"; can_manage: number; can_control: number };
type AccessRow = {
  user_id:string; display_name:string; avatar_seed:string; avatar_url:string|null;
  room_id:string; owner_id:string; slug:string; name:string; description:string; cover:string; visibility:"public"|"private";
  allow_add:number; allow_manage:number; allow_control:number;
  role:Member["role"]|null; member_can_manage:number|null; member_can_control:number|null;
  restriction_room_id:string|null; expires_at:number|null;
};
type Item = {
  id: string; room_id: string; source_provider: string; source_url: string; playback_provider: string;
  playback_external_id: string; playback_url: string; title: string; artist: string | null;
  thumbnail: string | null; duration_seconds: number | null; position: number; added_by: string; added_at: number;
};

export async function roomAccess(tx: SqlExecutor, slug: string, token: unknown, now: number) {
  if (!validSecret(token)) throw new ServiceError(401,"Session required");
  const [row]=await tx.query<AccessRow>(
    `SELECT p.id AS user_id,p.display_name,p.avatar_seed,p.avatar_url,
      r.id AS room_id,r.owner_id,r.slug,r.name,r.description,r.cover,r.visibility,r.allow_add,r.allow_manage,r.allow_control,
      m.role,m.can_manage AS member_can_manage,m.can_control AS member_can_control,
      b.room_id AS restriction_room_id,b.expires_at
     FROM sessions s JOIN profiles p ON p.id=s.user_id
     CROSS JOIN rooms r
     LEFT JOIN room_members m ON m.room_id=r.id AND m.user_id=p.id
     LEFT JOIN room_restrictions b ON b.room_id=r.id AND b.user_id=p.id
     WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND r.slug=?`,
    [hashSecret(token),now,slug]);
  if (!row) {
    await authenticate(tx,token,now);
    throw new ServiceError(404,"Room unavailable");
  }
  const user={id:row.user_id,display_name:row.display_name,avatar_seed:row.avatar_seed,avatar_url:row.avatar_url};
  const room:Room={id:row.room_id,owner_id:row.owner_id,slug:row.slug,name:row.name,description:row.description,cover:row.cover,visibility:row.visibility,
    allow_add:row.allow_add,allow_manage:row.allow_manage,allow_control:row.allow_control};
  const permissions = roomPermissions({ ownerId:room.owner_id, visibility:room.visibility, allowAdd:!!room.allow_add,
    allowManage:!!room.allow_manage, allowControl:!!room.allow_control },user.id,
    row.role?{role:row.role,canManage:!!row.member_can_manage,canControl:!!row.member_can_control}:undefined,
    row.restriction_room_id?{expiresAt:row.expires_at}:undefined,now);
  if (!permissions.read) throw new ServiceError(404, "Room unavailable");
  return { user, room, permissions };
}

export async function queueSnapshot(db: SynoraStore, token: unknown, slug: string, now = Date.now()) {
  const { room, permissions } = await roomAccess(db,slug,token,now);
  const [items, states] = await Promise.all([
    db.query<Item>("SELECT id,room_id,source_provider,source_url,playback_provider,playback_external_id,playback_url,title,artist,thumbnail,duration_seconds,position,added_by,added_at FROM playlist_items WHERE room_id=? ORDER BY position",[room.id]),
    db.query("SELECT current_track_id,status,position_seconds,playback_started_at,updated_at,state_version,shuffle_enabled,repeat_mode FROM room_playback_states WHERE room_id=?",[room.id]),
  ]);
  const [state] = states;
  return { items, state, now, canControl: permissions.control, canAdd: permissions.add, canManage: permissions.manage };
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

const reorderSchema = z.object({
  orderedIds: z.array(z.string().uuid()).max(200),
  expectedIds: z.array(z.string().uuid()).max(200),
});

export async function reorderQueue(db: SynoraStore, token: unknown, slug: string, raw: unknown, now = Date.now()) {
  const parsed = reorderSchema.safeParse(raw);
  if (!parsed.success) throw new ServiceError(400, "Invalid queue order");
  const { orderedIds, expectedIds } = parsed.data;
  return db.write(async tx => {
    const { room, permissions } = await roomAccess(tx,slug,token,now);
    if (!permissions.manage) throw new ServiceError(403,"You cannot manage this queue");
    const items = await tx.query<Item>("SELECT id,room_id,source_provider,source_url,playback_provider,playback_external_id,playback_url,title,artist,thumbnail,duration_seconds,position,added_by,added_at FROM playlist_items WHERE room_id=? ORDER BY position",[room.id]);
    const ids = items.map(item => item.id);
    if (ids.length !== expectedIds.length || ids.some((id,i) => id !== expectedIds[i])) throw new ServiceError(409,"Queue changed; refresh and try again");
    if (orderedIds.length !== ids.length || new Set(orderedIds).size !== ids.length || orderedIds.some(id => !ids.includes(id))) throw new ServiceError(400,"Invalid queue order");
    if (ids.some((id,i) => id !== orderedIds[i])) {
      // SQLite checks UNIQUE(room_id,position) on each row, so move all old
      // positions into a disjoint negative range before assigning new ones.
      await tx.execute("UPDATE playlist_items SET position=-position-1 WHERE room_id=?",[room.id]);
      await tx.execute(`UPDATE playlist_items SET position=CASE id ${orderedIds.map(() => "WHEN ? THEN ?").join(" ")} END WHERE room_id=?`,
        [...orderedIds.flatMap((id,i) => [id,i]),room.id]);
      await tx.execute("INSERT INTO realtime_outbox(id,room_id,event,created_at) VALUES(?,?,'refresh',?)",[randomUUID(),room.id,now]);
    }
    return { roomId:room.id, items:orderedIds.map((id,position) => ({...items.find(item => item.id===id)!,position})) };
  });
}

export async function removeQueueItem(db: SynoraStore, token: unknown, slug: string, trackId: unknown, now = Date.now()) {
  if (typeof trackId !== "string" || !z.uuid().safeParse(trackId).success) throw new ServiceError(400,"Invalid track");
  return db.write(async tx => {
    const { room, permissions } = await roomAccess(tx,slug,token,now);
    if (!permissions.manage) throw new ServiceError(403,"You cannot manage this queue");
    const items = await tx.query<{id:string}>("SELECT id FROM playlist_items WHERE room_id=? ORDER BY position",[room.id]);
    const index = items.findIndex(item => item.id===trackId);
    if (index<0) throw new ServiceError(404,"Track not in this room");
    const [state] = await tx.query<{current_track_id:string|null;status:string;state_version:number;shuffle_enabled:number;repeat_mode:string}>(
      "SELECT current_track_id,status,state_version,shuffle_enabled,repeat_mode FROM room_playback_states WHERE room_id=?",[room.id]);
    let playback = null;
    if (state.current_track_id===trackId) {
      const next=items[index+1]?.id ?? items[index-1]?.id ?? null;
      const status=next ? (state.status==="playing" ? "playing" : "paused") : "stopped";
      const startedAt=status==="playing" ? now : null;
      await tx.execute("UPDATE room_playback_states SET current_track_id=?,status=?,position_seconds=0,playback_started_at=?,updated_at=?,state_version=state_version+1 WHERE room_id=?",
        [next,status,startedAt,now,room.id]);
      playback={current_track_id:next,status,position_seconds:0,playback_started_at:startedAt,updated_at:now,
        state_version:state.state_version+1,shuffle_enabled:state.shuffle_enabled,repeat_mode:state.repeat_mode};
    }
    await tx.execute("DELETE FROM playlist_items WHERE room_id=? AND id=?",[room.id,trackId]);
    await tx.execute("INSERT INTO realtime_outbox(id,room_id,event,created_at) VALUES(?,?,'refresh',?)",[randomUUID(),room.id,now]);
    return {roomId:room.id,removedId:trackId,state:playback,now};
  });
}
