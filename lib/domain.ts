import { z } from "zod";
export const roomSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500),
  visibility: z.enum(["public", "private"]),
  cover: z.enum(["pink", "yellow", "blue", "mint", "lavender"]),
});
export function youtubeId(input: string): string | null {
  try {
    const u = new URL(input);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const host = u.hostname
      .toLowerCase()
      .replace(/^www\./, "")
      .replace(/^m\./, "");
    let id: string | null = null;
    if (host === "youtu.be") id = u.pathname.split("/")[1];
    else if (["youtube.com", "youtube-nocookie.com"].includes(host)) {
      const p = u.pathname.split("/");
      id =
        u.pathname === "/watch"
          ? u.searchParams.get("v")
          : ["shorts", "live", "embed"].includes(p[1])
            ? p[2]
            : null;
    }
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
export type Room = {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  slug: string;
  cover: string;
  visibility: string;
  invite_code: string;
  allow_add: boolean;
  allow_manage: boolean;
  allow_control: boolean;
  enhancements_enabled?: boolean;
};
export type Track = {
  id: string;
  room_id: string;
  youtube_video_id: string;
  title: string;
  thumbnail: string;
  duration_seconds: number | null;
  channel_name: string | null;
  position: number;
};
export type Playback = {
  room_id: string;
  current_track_id: string | null;
  status: "playing" | "paused" | "stopped";
  position_seconds: number;
  playback_started_at: string | null;
  updated_at: string;
  state_version: number;
  shuffle_enabled: boolean;
  repeat_mode: "off" | "song" | "playlist";
};
export type Member = {
  user_id: string;
  can_manage: boolean;
  can_control: boolean;
  profiles: { display_name: string; avatar_url: string | null } | null;
};
export type Message = {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
  profiles: { display_name: string } | null;
};
export function positionAt(s: Playback, serverNow: number) {
  return Math.max(
    0,
    s.position_seconds +
      (s.status === "playing" && s.playback_started_at
        ? Math.max(0, (serverNow - Date.parse(s.playback_started_at)) / 1000)
        : 0),
  );
}
export function acceptState(current: Playback | null, incoming: Playback) {
  return !current || incoming.state_version >= current.state_version;
}
export function permissions(
  room: Room,
  userId: string,
  member?: Pick<Member, "can_manage" | "can_control">,
) {
  const owner = room.owner_id === userId;
  return {
    owner,
    add: owner || (!!member && room.allow_add),
    manage: owner || (!!member && (room.allow_manage || member.can_manage)),
    control: owner || (!!member && (room.allow_control || member.can_control)),
  };
}
export function time(seconds: number) {
  const n = Math.max(0, Math.floor(seconds));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}

export const presenceSchema = z.object({
  user_id: z.uuid(),
  name: z.string().min(1).max(40),
  avatar: z.string().max(2048).nullable(),
});
