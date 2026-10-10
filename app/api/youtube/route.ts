import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { youtubeId } from "@/lib/domain";
export async function GET(req: NextRequest) {
  const id = youtubeId(req.nextUrl.searchParams.get("url") ?? "");
  if (!id)
    return NextResponse.json(
      {
        error: "Paste a valid YouTube video URL (playlists are not supported).",
      },
      { status: 400 },
    );
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (
    !token ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
    return NextResponse.json(
      { error: "Sign in to add music." },
      { status: 401 },
    );
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user)
    return NextResponse.json(
      { error: "Sign in to add music." },
      { status: 401 },
    );
  try {
    let title = `YouTube · ${id}`;
    let channel_name: string | null = null;
    let duration_seconds: number | null = null;
    const key = process.env.YOUTUBE_DATA_API_KEY;
    if (key) {
      const url = new URL("https://www.googleapis.com/youtube/v3/videos");
      url.search = new URLSearchParams({
        part: "snippet,contentDetails",
        id,
        key,
      }).toString();
      const r = await fetch(url, {
        signal: AbortSignal.timeout(3500),
        next: { revalidate: 3600 },
      });
      if (r.ok) {
        const j = await r.json();
        const v = j.items?.[0];
        if (v) {
          title = v.snippet.title;
          channel_name = v.snippet.channelTitle;
          const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(
            v.contentDetails.duration,
          );
          if (m)
            duration_seconds =
              Number(m[1] ?? 0) * 3600 +
              Number(m[2] ?? 0) * 60 +
              Number(m[3] ?? 0);
        }
      }
    }
    if (title.startsWith("YouTube · ")) {
      const url = new URL("https://www.youtube.com/oembed");
      url.search = new URLSearchParams({
        url: `https://www.youtube.com/watch?v=${id}`,
        format: "json",
      }).toString();
      const r = await fetch(url, {
        signal: AbortSignal.timeout(3500),
        next: { revalidate: 3600 },
      });
      if (r.ok) {
        const j = await r.json();
        title = j.title;
        channel_name = j.author_name;
      }
    }
    return NextResponse.json({
      youtube_video_id: id,
      title: String(title).slice(0, 200),
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      channel_name,
      duration_seconds,
      ...(title.startsWith("YouTube · ")
        ? { warning: "Metadata unavailable. Video playback may still work." }
        : {}),
    });
  } catch {
    return NextResponse.json({
      youtube_video_id: id,
      title: `YouTube · ${id}`,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      channel_name: null,
      duration_seconds: null,
      warning: "Metadata unavailable. Video playback may still work.",
    });
  }
}
