import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { ServiceError } from "./identity-service";
import { positionAt, type PlaybackState } from "./playback";
import { roomAccess } from "./queue-service";
import type { SynoraStore } from "./store";

const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("play"), expectedVersion: z.number().int().min(0) }),
  z.object({ action: z.literal("pause"), expectedVersion: z.number().int().min(0) }),
  z.object({ action: z.literal("next"), expectedVersion: z.number().int().min(0) }),
  z.object({ action: z.literal("previous"), expectedVersion: z.number().int().min(0) }),
  z.object({ action: z.literal("ended"), expectedVersion: z.number().int().min(0), trackId: z.string().uuid() }),
  z.object({ action: z.literal("select"), expectedVersion: z.number().int().min(0), trackId: z.string().uuid() }),
  z.object({ action: z.literal("seek"), expectedVersion: z.number().int().min(0), positionSeconds: z.number().finite().min(0).max(43200) }),
  z.object({ action: z.literal("setRepeat"), expectedVersion: z.number().int().min(0), repeatMode: z.enum(["off","song","playlist"]) }),
  z.object({ action: z.literal("setShuffle"), expectedVersion: z.number().int().min(0), enabled: z.boolean() }),
]);

type PlaybackRow = {
  current_track_id: string | null; status: "playing" | "paused" | "stopped";
  position_seconds: number; playback_started_at: number | null; updated_at: number; state_version: number;
  shuffle_enabled: number; repeat_mode: "off" | "song" | "playlist";
};

// UUIDs make the order room-specific and unpredictable; the stable permutation
// visits every queued song once before repeat-playlist wraps around.
export function playOrder<T extends {id:string}>(items:T[],roomId:string,shuffle:boolean):T[] {
  if (!shuffle) return items;
  return items.map(item=>({item,key:createHash("sha256").update(roomId+":"+item.id).digest("hex")}))
    .sort((a,b)=>a.key.localeCompare(b.key)).map(entry=>entry.item);
}

export async function controlPlayback(db: SynoraStore, token: unknown, slug: string, raw: unknown, now = Date.now()) {
  const parsed = commandSchema.safeParse(raw);
  if (!parsed.success) throw new ServiceError(400, "Invalid playback command");
  const command = parsed.data;
  return db.write(async tx => {
    const { user, room, permissions } = await roomAccess(tx, slug, token, now);
    if (!permissions.control) throw new ServiceError(403, "You cannot control playback in this room");
    const [previous] = await tx.query<PlaybackRow>(
      "SELECT current_track_id,status,position_seconds,playback_started_at,updated_at,state_version,shuffle_enabled,repeat_mode FROM room_playback_states WHERE room_id=?", [room.id]);
    if (!previous) throw new ServiceError(404, "Playback state unavailable");
    if (previous.state_version !== command.expectedVersion) throw new ServiceError(409, "Playback changed; refresh and try again");
    const state: PlaybackState = { currentTrackId: previous.current_track_id, status: previous.status,
      positionSeconds: previous.position_seconds, startedAt: previous.playback_started_at,
      updatedAt: previous.updated_at, version: previous.state_version };
    const items = await tx.query<{ id: string; position: number }>(
      "SELECT id,position FROM playlist_items WHERE room_id=? ORDER BY position", [room.id]);
    const order=playOrder(items,room.id,!!previous.shuffle_enabled);
    let current = state.currentTrackId;
    let position = positionAt(state, now);
    let status = state.status;
    let startedAt: number | null = state.startedAt;
    let shuffleEnabled=previous.shuffle_enabled;
    let repeatMode=previous.repeat_mode;

    if (command.action === "select") {
      if (!items.some(item => item.id === command.trackId)) throw new ServiceError(404, "Track not in this room");
      current = command.trackId; position = 0;
      status = state.status === "playing" ? "playing" : "paused";
      startedAt = status === "playing" ? now : null;
    } else if (command.action === "next" || command.action === "ended") {
      if (command.action === "ended" && (state.currentTrackId !== command.trackId || state.status !== "playing")) {
        throw new ServiceError(409, "Track already changed");
      }
      const index=order.findIndex(item=>item.id===current);
      current=command.action==="ended" && repeatMode==="song" ? current
        : (order[index+1] ?? (repeatMode==="playlist" ? order[0] : undefined))?.id ?? null;
      position = 0;
      status = current ? (state.status === "playing" ? "playing" : "paused") : "stopped";
      startedAt = status === "playing" ? now : null;
    } else if (command.action === "previous") {
      if (!current) throw new ServiceError(409,"No track is selected");
      const index=order.findIndex(item=>item.id===current);
      current=(position>3 ? order[index] : order[index-1] ?? (repeatMode==="playlist" ? order.at(-1) : order[index]))?.id ?? null;
      position=0;
      status=state.status==="playing" ? "playing" : "paused";
      startedAt=status==="playing" ? now : null;
    } else if (command.action === "play") {
      current ??= order[0]?.id ?? null;
      if (!current) throw new ServiceError(409, "Add a track before playing");
      if (state.status === "stopped") position = 0;
      status = "playing"; startedAt = now;
    } else if (command.action === "pause") {
      if (!current) throw new ServiceError(409, "No track is playing");
      status = "paused"; startedAt = null;
    } else if (command.action === "seek") {
      if (!current) throw new ServiceError(409, "Select a track before seeking");
      position = command.positionSeconds;
      startedAt = status === "playing" ? now : null;
    } else if (command.action === "setRepeat") {
      repeatMode=command.repeatMode;
      startedAt=status==="playing" ? now : null;
    } else if (command.action === "setShuffle") {
      shuffleEnabled=command.enabled ? 1 : 0;
      startedAt=status==="playing" ? now : null;
    }

    await tx.execute(
      "UPDATE room_playback_states SET current_track_id=?,status=?,position_seconds=?,playback_started_at=?,shuffle_enabled=?,repeat_mode=?,updated_at=?,updated_by=?,state_version=state_version+1 WHERE room_id=?",
      [current,status,position,startedAt,shuffleEnabled,repeatMode,now,user.id,room.id]);
    await tx.execute("INSERT INTO realtime_outbox(id,room_id,event,created_at) VALUES(?,?,'refresh',?)",
      [randomUUID(),room.id,now]);
    return { roomId:room.id, state:{ current_track_id:current, status, position_seconds:position,
      playback_started_at:startedAt,shuffle_enabled:shuffleEnabled,repeat_mode:repeatMode,
      updated_at:now, state_version:state.version + 1 }, now };
  });
}
