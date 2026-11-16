export const LISTENER_LEASE_MS = 45_000;
export const HEARTBEAT_MS = 20_000;
export type PlaybackState = {
  currentTrackId: string | null;
  status: "playing" | "paused" | "stopped";
  positionSeconds: number;
  startedAt: number | null;
  updatedAt: number;
  version: number;
};
export function positionAt(state: PlaybackState, now: number) {
  return Math.max(0, state.positionSeconds + (state.status === "playing" && state.startedAt !== null
    ? Math.max(0, now - state.startedAt) / 1000 : 0));
}
// Freeze before renewing the first lease after an idle period, inside a write transaction.
export function freezeAbandoned(state: PlaybackState, lastSeen: number | null, now: number): PlaybackState {
  if (state.status !== "playing" || (lastSeen !== null && now - lastSeen < LISTENER_LEASE_MS)) return state;
  const stopAt = Math.min(now, Math.max(state.startedAt ?? now, lastSeen ?? state.startedAt ?? now));
  return { ...state, status: "paused", positionSeconds: positionAt(state, stopAt), startedAt: null, updatedAt: now, version: state.version + 1 };
}
// Use when the last active tab leaves cleanly.
export function pauseAt(state: PlaybackState, now: number): PlaybackState {
  if (state.status !== "playing") return state;
  return { ...state, status: "paused", positionSeconds: positionAt(state, now), startedAt: null, updatedAt: now, version: state.version + 1 };
}
