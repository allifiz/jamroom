import { describe, expect, it } from "vitest";
import { hashSecret, issueSecret, newIdentity, roomPermissions, sessionCookie, validSecret } from "../synora/core/identity";
import { parseMusicSource, playbackCandidate } from "../synora/core/music";
import { freezeAbandoned, pauseAt, positionAt, type PlaybackState } from "../synora/core/playback";

describe("SYNORA identity", () => {
  it("creates unique anonymous identities and only persists the token hash", () => {
    const a = newIdentity(1000), b = newIdentity(1000);
    expect(a.profile.id).not.toBe(b.profile.id);
    expect(a.profile.display_name).toMatch(/^[A-Za-z]+$/);
    expect(a.session.token_hash).toBe(hashSecret(a.cookie));
    expect(JSON.stringify(a.session)).not.toContain(a.cookie);
    expect(a.session.expires_at).toBeGreaterThan(1000);
    expect(validSecret(issueSecret().token)).toBe(true);
    expect(validSecret("not-a-token")).toBe(false);
    expect(sessionCookie(a.cookie, true)).toMatchObject({ name: "__Host-synora", httpOnly: true, secure: true, sameSite: "lax", path: "/" });
  });
  it("isolates ownership, membership, and moderation", () => {
    const room = { ownerId: "a", visibility: "private" as const, allowAdd: true, allowManage: false, allowControl: false };
    expect(roomPermissions(room, "a")).toMatchObject({ owner: true, delete: true, control: true });
    expect(roomPermissions(room, "b")).toMatchObject({ read: false, add: false, owner: false });
    expect(roomPermissions(room, "b", { role: "ADMIN" })).toMatchObject({ moderate: true, assignAdmin: false, delete: false });
    expect(roomPermissions(room, "b", { role: "DJ" })).toMatchObject({ manage: true, control: true, moderate: false });
    expect(roomPermissions(room, "b", { role: "MEMBER" }, { expiresAt: null })).toMatchObject({ read: false, chat: false });
    expect(roomPermissions({ ...room, visibility: "public" }, "b")).toMatchObject({ read: true, joinPublic: true, chat: false });
  });
});
describe("SYNORA music sources", () => {
  it("normalizes supported music URLs", () => {
    const yt = parseMusicSource("https://music.youtube.com/watch?v=dQw4w9WgXcQ&si=x");
    expect(yt?.provider).toBe("youtube-music");
    expect(yt && playbackCandidate(yt)?.provider).toBe("youtube");
    const spotify = parseMusicSource("https://open.spotify.com/intl-id/track/4cOdK2wGLETKBW3PvgPWqT?si=x");
    expect(spotify?.provider).toBe("spotify");
    expect(spotify && playbackCandidate(spotify)).toBeNull();
    expect(parseMusicSource("https://soundcloud.com/artist/track")?.provider).toBe("soundcloud");
    expect(parseMusicSource("https://music.apple.com/us/album/example/123?i=456")?.externalId).toBe("456");
    expect(parseMusicSource("https://www.deezer.com/en/track/123")?.provider).toBe("deezer");
    expect(parseMusicSource("https://artist.bandcamp.com/track/example")?.provider).toBe("bandcamp");
  });
  it("rejects deceptive hosts, credentials, playlists, and non-HTTPS links", () => {
    for (const url of ["https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ", "https://foo@youtube.com/watch?v=dQw4w9WgXcQ", "http://youtu.be/dQw4w9WgXcQ", "https://open.spotify.com/playlist/4cOdK2wGLETKBW3PvgPWqT", "https://soundcloud.com/artist/sets", "https://localhost/a.mp3"]) {
      expect(parseMusicSource(url)).toBeNull();
    }
  });
});
describe("SYNORA playback", () => {
  const state: PlaybackState = { currentTrackId: "t", status: "playing", positionSeconds: 10, startedAt: 1000, updatedAt: 1000, version: 3 };
  it("uses elapsed server time and freezes at the last heartbeat", () => {
    expect(positionAt(state, 6000)).toBe(15);
    expect(freezeAbandoned(state, 6000, 10000)).toBe(state);
    expect(freezeAbandoned(state, 6000, 100000)).toMatchObject({ status: "paused", positionSeconds: 15, startedAt: null, version: 4 });
    expect(freezeAbandoned(state, null, 100000).positionSeconds).toBe(10);
    expect(pauseAt(state, 12000).positionSeconds).toBe(21);
  });
});
