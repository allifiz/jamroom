export type Profile = { id: string; display_name: string };
export type Room = { id: string; slug: string; name: string; description: string; visibility: "public" | "private"; cover: string };
export type Rooms = { discover: Room[]; owned: Room[]; recent: Room[] };
export type Track = { id: string; title: string; artist: string | null; source_provider: string; playback_provider: string; playback_external_id: string; position: number };
export type PlaybackState = { current_track_id: string | null; status: "playing" | "paused" | "stopped"; position_seconds: number; playback_started_at: number | null; updated_at: number; state_version: number };
export type Snapshot = { items: Track[]; state: PlaybackState | null; now: number; canControl: boolean; canAdd: boolean };

export async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch("/api/synora" + path, {
    method,
    credentials: "same-origin",
    ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed");
  return data as T;
}

export const roomPath = (slug: string) => "/synora/room/" + encodeURIComponent(slug);
