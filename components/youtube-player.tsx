"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Volume2,
  Headphones,
  VolumeX,
} from "lucide-react";
import { Button } from "./ui/button";
import { positionAt, time, type Playback, type Track } from "@/lib/domain";
type YTPlayer = {
  loadVideoById: (v: { videoId: string; startSeconds: number }) => void;
  cueVideoById: (v: { videoId: string; startSeconds: number }) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (n: number, allow: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  getVideoData: () => { video_id?: string };
  setVolume: (n: number) => void;
  destroy: () => void;
};
declare global {
  interface Window {
    YT?: {
      Player: new (el: HTMLElement, args: Record<string, unknown>) => YTPlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}
let loader: Promise<void> | null = null;
function loadAPI() {
  if (window.YT?.Player) return Promise.resolve();
  return (loader ??= new Promise((resolve, reject) => {
    const old = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      old?.();
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => {
      loader = null;
      reject(
        new Error(
          "YouTube could not load. Check your network, then refresh to retry.",
        ),
      );
    };
    document.head.appendChild(script);
  }));
}
export function YoutubePlayer({
  track,
  state,
  listening,
  control,
  onJoin,
  onLeave,
  onCommand,
  serverNow,
}: {
  track: Track | undefined;
  state: Playback | null;
  listening: boolean;
  control: boolean;
  onJoin: () => Promise<void>;
  onLeave: () => void;
  onCommand: (
    action: string,
    extra?: Record<string, unknown>,
    version?: number,
  ) => Promise<void>;
  serverNow: () => number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const latest = useRef({ track, state, listening, onCommand, serverNow });
  const loaded = useRef("");
  const ready = useRef(false);
  const [isReady, setReady] = useState(false);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [volume, setVolume] = useState(65);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seek, setSeek] = useState<number | null>(null);
  const [actualTime, setActualTime] = useState(0);
  const [actualStatus, setActualStatus] = useState(-1);
  useEffect(() => {
    latest.current = { track, state, listening, onCommand, serverNow };
  }, [track, state, listening, onCommand, serverNow]);
  const sync = useCallback(() => {
    const p = player.current;
    const { state: s, track: t, listening: l, serverNow: now } = latest.current;
    if (!p || !ready.current) return;
    if (!s || !t) {
      p.pauseVideo();
      return;
    }
    const pos = positionAt(s, now());
    const video = { videoId: t.youtube_video_id, startSeconds: pos };
    if (loaded.current !== t.youtube_video_id) {
      loaded.current = t.youtube_video_id;
      if (l && s.status === "playing") p.loadVideoById(video);
      else p.cueVideoById(video);
    } else {
      if (Math.abs(p.getCurrentTime() - pos) > 1.8) p.seekTo(pos, true);
      if (l && s.status === "playing") p.playVideo();
      else p.pauseVideo();
    }
  }, []);
  useEffect(() => {
    let alive = true;
    let p: YTPlayer | null = null;
    const initialVolume = Number(localStorage.getItem("jamroom-volume") ?? 65);
    setVolume(
      Number.isFinite(initialVolume)
        ? Math.max(0, Math.min(100, initialVolume))
        : 65,
    );
    loadAPI()
      .then(() => {
        if (!alive || !host.current || !window.YT) return;
        const el = document.createElement("div");
        host.current.replaceChildren(el);
        p = new window.YT.Player(el, {
          width: "100%",
          height: "100%",
          playerVars: { playsinline: 1, origin: location.origin },
          events: {
            onReady: () => {
              if (!alive || !p) return;
              player.current = p;
              ready.current = true;
              p.setVolume(initialVolume);
              setReady(true);
              sync();
            },
            onStateChange: (e: { data: number }) => {
              if (!alive) return;
              if (e.data === 1) setBlocked(false);
              if (e.data === 0) {
                const v = latest.current;
                if (
                  v.listening &&
                  v.state?.status === "playing" &&
                  v.track?.youtube_video_id === p?.getVideoData().video_id
                )
                  void v.onCommand("ended", {}, v.state.state_version);
              }
            },
            onAutoplayBlocked: () => {
              if (alive) setBlocked(true);
            },
            onError: (e: { data: number }) => {
              if (alive)
                setError(
                  (
                    {
                      2: "This video URL is invalid.",
                      5: "The YouTube player could not play this video.",
                      100: "This video is private, deleted, or unavailable.",
                      101: "This creator does not allow embedding.",
                      150: "This creator does not allow embedding.",
                      153: "YouTube could not verify this embed. Check your browser referrer settings.",
                    } as Record<number, string>
                  )[e.data] ??
                    "This video cannot be played in your region or browser.",
                );
            },
          },
        });
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
      ready.current = false;
      p?.destroy();
      player.current = null;
    };
  }, [sync]);
  useEffect(() => {
    if (ready.current) setError("");
  }, [track?.youtube_video_id]);
  useEffect(() => {
    sync();
  }, [state, track?.youtube_video_id, listening, isReady, sync]);
  useEffect(() => {
    const timer = setInterval(() => {
      const v = latest.current;
      if (player.current && ready.current) {
        setActualTime(player.current.getCurrentTime());
        setActualStatus(player.current.getPlayerState());
      }
      if (
        v.listening &&
        v.state?.status === "playing" &&
        player.current &&
        ready.current &&
        player.current.getPlayerState() !== 1 &&
        player.current.getPlayerState() !== 3 &&
        !error
      )
        setBlocked(true);
      if (v.state) {
        const pos = positionAt(v.state, v.serverNow());
        setPosition(pos);
        setDuration(
          player.current?.getDuration() || v.track?.duration_seconds || 0,
        );
      }
      if (
        v.listening &&
        v.state?.status === "playing" &&
        player.current &&
        ready.current &&
        !error &&
        !blocked &&
        Math.abs(
          player.current.getCurrentTime() - positionAt(v.state, v.serverNow()),
        ) > 2.5
      )
        sync();
    }, 1000);
    return () => clearInterval(timer);
  }, [sync, error, blocked]);
  return (
    <section
      className="panel now-playing"
      data-testid="youtube-player"
      data-player-time={actualTime}
      data-player-status={actualStatus}
      data-shared-status={state?.status}
      data-current-track={track?.youtube_video_id ?? ""}
    >
      <div className="player-heading">
        <span className="eyebrow">
          <span className="online-dot" /> NOW PLAYING
        </span>
        <span className="pill bg-paper">
          {error
            ? "PLAYER UNAVAILABLE"
            : blocked
              ? "TAP TO LISTEN"
              : listening
                ? "SYNC MODE"
                : "PREVIEW MODE"}
        </span>
      </div>
      <div className="player-frame" ref={host} />
      <h2>{track?.title ?? "Waiting for your first song."}</h2>
      <p className="small">
        {track?.channel_name ??
          "Drop a YouTube link in the queue to set the mood."}
      </p>
      {error && (
        <div className="notice mt-4" role="alert">
          {error}{" "}
          {control && (
            <Button size="sm" onClick={() => void onCommand("next")}>
              Skip track
            </Button>
          )}
        </div>
      )}
      {!listening ? (
        <Button
          className="w-full mt-5 bg-mint"
          disabled={!isReady}
          onClick={() => {
            player.current?.playVideo();
            void onJoin();
          }}
        >
          <Headphones size={18} />
          Join & Listen
        </Button>
      ) : (
        <>
          {blocked && (
            <Button
              className="w-full mt-4 bg-mint"
              onClick={() => {
                player.current?.playVideo();
                setBlocked(false);
              }}
            >
              Enable audio · Start listening
            </Button>
          )}
          <div className="controls">
            <Button
              size="icon"
              variant="outline"
              className={state?.shuffle_enabled ? "control-active" : ""}
              disabled={!control}
              aria-label="Shuffle"
              aria-pressed={state?.shuffle_enabled ?? false}
              onClick={() =>
                void onCommand("options", {
                  p_shuffle: !state?.shuffle_enabled,
                })
              }
            >
              <Shuffle size={18} />
            </Button>
            <Button
              size="icon"
              variant="outline"
              disabled={!control}
              aria-label="Previous track"
              onClick={() => void onCommand("previous")}
            >
              <SkipBack size={20} />
            </Button>
            <Button
              size="icon"
              disabled={!control || !track}
              aria-label={state?.status === "playing" ? "Pause" : "Play"}
              onClick={() => {
                player.current?.playVideo();
                void onCommand(state?.status === "playing" ? "pause" : "play");
              }}
            >
              {state?.status === "playing" ? (
                <Pause size={21} />
              ) : (
                <Play size={21} />
              )}
            </Button>
            <Button
              size="icon"
              variant="outline"
              disabled={!control}
              aria-label="Next track"
              onClick={() => void onCommand("next")}
            >
              <SkipForward size={20} />
            </Button>
            <Button
              size="icon"
              variant="outline"
              disabled={!control}
              className={state?.repeat_mode !== "off" ? "control-active" : ""}
              aria-label={`Repeat: ${state?.repeat_mode ?? "off"}`}
              onClick={() =>
                void onCommand("options", {
                  p_repeat:
                    state?.repeat_mode === "off"
                      ? "playlist"
                      : state?.repeat_mode === "playlist"
                        ? "song"
                        : "off",
                })
              }
            >
              {state?.repeat_mode === "song" ? (
                <span className="font-bold">1</span>
              ) : (
                <Repeat size={18} />
              )}
            </Button>
          </div>
          <div className="seek-row">
            <span>{time(seek ?? position)}</span>
            <input
              type="range"
              aria-label="Seek playback"
              min={0}
              max={Math.max(duration, position, 1)}
              step={1}
              value={
                seek ?? Math.min(position, Math.max(duration, position, 1))
              }
              disabled={!control || !track}
              onChange={(e) => setSeek(Number(e.target.value))}
              onPointerUp={(e) => {
                void onCommand("seek", {
                  p_position: Number(e.currentTarget.value),
                });
                setSeek(null);
              }}
              onKeyUp={(e) => {
                void onCommand("seek", {
                  p_position: Number(e.currentTarget.value),
                });
                setSeek(null);
              }}
            />
            <span>{time(duration)}</span>
          </div>
          <div className="volume">
            <button
              className="icon-plain"
              aria-label={volume ? "Mute" : "Unmute"}
              onClick={() => {
                const n = volume ? 0 : 65;
                setVolume(n);
                player.current?.setVolume(n);
                localStorage.setItem("jamroom-volume", String(n));
              }}
            >
              {volume ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
            <input
              aria-label="Local volume"
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => {
                const n = Number(e.target.value);
                setVolume(n);
                player.current?.setVolume(n);
                localStorage.setItem("jamroom-volume", String(n));
              }}
            />
          </div>
          <button
            className="icon-plain small mx-auto mt-3"
            onClick={() => {
              player.current?.pauseVideo();
              onLeave();
            }}
          >
            Leave listening · stay in the room
          </button>
        </>
      )}
      <p className="small text-center mt-4">
        Official YouTube player · keep this tab open to listen.
      </p>
    </section>
  );
}
