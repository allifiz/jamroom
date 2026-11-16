export type SourceProvider = "youtube" | "youtube-music" | "spotify" | "soundcloud" | "apple-music" | "deezer" | "bandcamp" | "direct-audio";
export type PlaybackProvider = "youtube" | "soundcloud" | "direct-audio";
export type MusicSource = { provider: SourceProvider; externalId: string; url: string };
export type MusicPlayback = { provider: PlaybackProvider; externalId: string; url: string };
export type ResolvedTrack = {
  source: MusicSource;
  playback: MusicPlayback;
  title: string;
  artist: string | null;
  artwork: string | null;
  durationSeconds: number | null;
};
export interface MusicAdapter {
  provider: SourceProvider;
  resolve(source: MusicSource): Promise<ResolvedTrack | { source: MusicSource; requiresMatch: true }>;
}

// Parse links only. No arbitrary URL fetch, stream extraction, or scraping.
export function parseMusicSource(input: string): MusicSource | null {
  if (input.length > 2048) return null;
  let u: URL;
  try { u = new URL(input.trim()); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);
  const source = (provider: SourceProvider, externalId: string, url: string): MusicSource =>
    ({ provider, externalId, url });
  if (["youtu.be", "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "www.youtube-nocookie.com", "youtube-nocookie.com"].includes(host)) {
    const id = host === "youtu.be" ? parts[0] : parts[0] === "watch" ? u.searchParams.get("v") :
      ["shorts", "live", "embed"].includes(parts[0]) ? parts[1] : null;
    if (!id || !/^[\w-]{11}$/.test(id)) return null;
    const provider = host === "music.youtube.com" ? "youtube-music" : "youtube";
    return source(provider, id, "https://" + (provider === "youtube-music" ? "music.youtube.com" : "www.youtube.com") + "/watch?v=" + id);
  }
  if (host === "open.spotify.com") {
    const p = /^intl-[a-z]{2}$/i.test(parts[0] ?? "") ? parts.slice(1) : parts;
    if (p.length !== 2 || p[0] !== "track" || !/^[A-Za-z0-9]{22}$/.test(p[1])) return null;
    return source("spotify", p[1], "https://open.spotify.com/track/" + p[1]);
  }
  if (host === "soundcloud.com" || host === "www.soundcloud.com") {
    if (parts.length !== 2 || !parts.every(p => /^[\w-]+$/.test(p)) ||
      ["sets", "discover", "charts", "you", "search"].includes(parts[0]) ||
      ["sets", "likes", "tracks", "reposts", "albums", "popular-tracks"].includes(parts[1])) return null;
    const id = parts.join("/");
    return source("soundcloud", id, "https://soundcloud.com/" + id);
  }
  if (host === "music.apple.com") {
    const id = u.searchParams.get("i") ?? (parts.includes("song") ? parts.at(-1) : null);
    if (!id || !/^\d{1,20}$/.test(id)) return null;
    return source("apple-music", id, u.origin + u.pathname + (u.searchParams.has("i") ? "?i=" + id : ""));
  }
  if (host === "www.deezer.com" || host === "deezer.com") {
    const i = parts.indexOf("track");
    const id = i >= 0 ? parts[i + 1] : null;
    if (!id || !/^\d{1,20}$/.test(id) || i !== parts.length - 2) return null;
    return source("deezer", id, "https://www.deezer.com/track/" + id);
  }
  if (/^[a-z0-9-]+\.bandcamp\.com$/.test(host) && parts.length === 2 && parts[0] === "track" && /^[\w-]+$/.test(parts[1])) {
    return source("bandcamp", host + "/" + parts.join("/"), "https://" + host + "/" + parts.join("/"));
  }
  // Direct audio is intentionally disabled pending explicit host/content and licensing policy.
  return null;
}

export function playbackCandidate(source: MusicSource): MusicPlayback | null {
  if (source.provider === "youtube" || source.provider === "youtube-music") {
    return { provider: "youtube", externalId: source.externalId, url: "https://www.youtube.com/watch?v=" + source.externalId };
  }
  if (source.provider === "soundcloud") return { ...source, provider: "soundcloud" };
  // An explicit user-confirmed match is required for reference-only sources.
  return null;
}
