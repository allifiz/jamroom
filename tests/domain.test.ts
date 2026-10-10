import { describe, it, expect } from "vitest";
import {
  youtubeId,
  presenceSchema,
  positionAt,
  acceptState,
  permissions,
  roomSchema,
  type Playback,
  type Room,
} from "../lib/domain";
const s: Playback = {
  room_id: "r",
  current_track_id: "t",
  status: "playing",
  position_seconds: 85,
  playback_started_at: "2026-10-10T00:00:00Z",
  updated_at: "2026-10-10T00:00:00Z",
  state_version: 4,
  shuffle_enabled: false,
  repeat_mode: "off",
};
describe("official YouTube URL parsing", () => {
  for (const url of [
    "https://youtube.com/watch?v=dQw4w9WgXcQ&list=abc",
    "https://youtu.be/dQw4w9WgXcQ?t=85",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://m.youtube.com/live/dQw4w9WgXcQ",
    "https://youtube-nocookie.com/embed/dQw4w9WgXcQ",
  ])
    it(url, () => expect(youtubeId(url)).toBe("dQw4w9WgXcQ"));
  for (const url of [
    "javascript:alert(1)",
    "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
    "https://evil.test/dQw4w9WgXcQ",
    "https://youtube.com/watch?v=short",
    "https://youtube.com/playlist?list=abc",
    "not a url",
    "https://youtube.com/watch?v=dQw4w9WgXcQ-extra",
  ])
    it(`reject ${url}`, () => expect(youtubeId(url)).toBeNull());
});
describe("server-clock playback", () => {
  it("joins at saved position plus elapsed time", () =>
    expect(positionAt(s, Date.parse("2026-10-10T00:00:05Z"))).toBe(90));
  it("paused does not accumulate offline time", () =>
    expect(
      positionAt(
        { ...s, status: "paused" },
        Date.parse("2026-10-13T00:00:00Z"),
      ),
    ).toBe(85));
  it("clock skew never subtracts position", () =>
    expect(positionAt(s, Date.parse("2026-10-09T00:00:00Z"))).toBe(85));
  it("ignores out-of-order realtime state", () =>
    expect(acceptState(s, { ...s, state_version: 3 })).toBe(false));
  it("accepts a current snapshot", () =>
    expect(acceptState(s, { ...s, state_version: 5 })).toBe(true));
});
const room = {
  owner_id: "owner",
  allow_add: true,
  allow_manage: false,
  allow_control: true,
} as Room;
describe("permissions", () => {
  it("owner always controls the room", () =>
    expect(permissions(room, "owner")).toEqual({
      owner: true,
      add: true,
      manage: true,
      control: true,
    }));
  it("membership required for participant controls", () =>
    expect(permissions(room, "stranger").control).toBe(false));
  it("participant can play without owner", () =>
    expect(
      permissions(room, "friend", { can_control: false, can_manage: false }),
    ).toEqual({ owner: false, add: true, manage: false, control: true }));
  it("explicit grants enable queue management", () =>
    expect(
      permissions(room, "friend", { can_control: false, can_manage: true })
        .manage,
    ).toBe(true));
  it("no participant can claim ownership", () =>
    expect(
      permissions(room, "friend", { can_control: true, can_manage: true })
        .owner,
    ).toBe(false));
});
describe("room validation", () => {
  it("accepts complete creation request", () =>
    expect(
      roomSchema.parse({
        name: "Radio club",
        description: "Hi",
        visibility: "private",
        cover: "pink",
      }).name,
    ).toBe("Radio club"));
  it("rejects blank room name", () =>
    expect(
      roomSchema.safeParse({
        name: " ",
        description: "",
        visibility: "public",
        cover: "pink",
      }).success,
    ).toBe(false));
});

describe("realtime payload validation", () => {
  it("ignores malformed participant announcements", () =>
    expect(
      presenceSchema.safeParse({ user_id: "bad", name: 99, avatar: null })
        .success,
    ).toBe(false));
  it("accepts legitimate presence data", () =>
    expect(
      presenceSchema.safeParse({
        user_id: "00000000-0000-4000-8000-000000000001",
        name: "Friend",
        avatar: null,
      }).success,
    ).toBe(true));
});
