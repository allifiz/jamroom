"use client";

import { useEffect, useRef, useState } from "react";
import type { PlaybackState } from "../../client-api";
import styles from "../../synora.module.css";

type Player = {
  cueVideoById(id: string): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  destroy(): void;
};
type YouTube = { Player: new (element: HTMLElement, options: {
  videoId: string; playerVars: Record<string, string | number>;
  events: { onReady: () => void; onStateChange: (event: { data: number }) => void; onAutoplayBlocked: () => void };
}) => Player };
type YouTubeWindow = Window & { YT?: YouTube; onYouTubeIframeAPIReady?: () => void };
let apiPromise: Promise<YouTube> | null = null;

function loadYouTube(): Promise<YouTube> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const win = window as YouTubeWindow;
    if (win.YT?.Player) { resolve(win.YT); return; }
    const previous = win.onYouTubeIframeAPIReady;
    win.onYouTubeIframeAPIReady = () => { previous?.(); if (win.YT) resolve(win.YT); };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => { apiPromise = null; reject(new Error("Pemutar YouTube tidak dapat dimuat")); };
    document.head.appendChild(script);
  });
  return apiPromise;
}

export function SyncedPlayer({ videoId, state, serverOffset, onEnded }: {
  videoId: string; state: PlaybackState; serverOffset: number; onEnded: (trackId: string, version: number) => void;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const player = useRef<Player | null>(null);
  const blockedRef = useRef(false);
  const endingVersion = useRef<number | null>(null);
  const current = useRef({ state, offset: serverOffset, onEnded });
  const [blocked, setBlocked] = useState(false);
  const [playerError, setPlayerError] = useState("");
  useEffect(() => { current.current = { state, offset: serverOffset, onEnded }; }, [state, serverOffset, onEnded]);

  useEffect(() => {
    let cancelled = false;
    if (!mount.current) return;
    const container = mount.current;
    const element = document.createElement("div");
    container.appendChild(element);
    const sync = () => {
      const instance = player.current;
      if (!instance) return;
      const { state: active, offset } = current.current;
      const desired = Math.max(0, active.position_seconds + (active.status === "playing" && active.playback_started_at !== null
        ? (Date.now() + offset - active.playback_started_at) / 1000 : 0));
      if (Math.abs(instance.getCurrentTime() - desired) > 2) instance.seekTo(desired, true);
      if (active.status === "playing") {
        if (!blockedRef.current && instance.getPlayerState() !== 1) instance.playVideo();
      } else if (instance.getPlayerState() === 1) instance.pauseVideo();
    };
    let timer: ReturnType<typeof setInterval> | undefined;
    void loadYouTube().then(YT => {
      if (cancelled) return;
      const instance = new YT.Player(element, {
        videoId, playerVars: { controls: 0, playsinline: 1, origin: window.location.origin, rel: 0 },
        events: {
          onReady: () => { if (!cancelled) { sync(); timer = setInterval(sync, 2000); } },
          onStateChange: event => {
            if (event.data === 0) {
              const { state: active, onEnded: ended } = current.current;
              if (active.status === "playing" && active.current_track_id && endingVersion.current !== active.state_version) {
                endingVersion.current = active.state_version;
                ended(active.current_track_id, active.state_version);
              }
            }
          },
          onAutoplayBlocked: () => { blockedRef.current = true; setBlocked(true); },
        },
      });
      player.current = instance;
    }).catch(e => { if (!cancelled) setPlayerError((e as Error).message); });
    return () => { cancelled = true; if (timer) clearInterval(timer); player.current?.destroy(); player.current = null; container.replaceChildren(); };
  }, [videoId]);

  // Apply state changes immediately; the timer above also corrects drift later.
  useEffect(() => {
    const instance = player.current;
    if (!instance) return;
    const desired = Math.max(0, state.position_seconds + (state.status === "playing" && state.playback_started_at !== null
      ? (Date.now() + serverOffset - state.playback_started_at) / 1000 : 0));
    if (Math.abs(instance.getCurrentTime() - desired) > 2) instance.seekTo(desired, true);
    if (state.status === "playing" && !blocked) instance.playVideo();
    else instance.pauseVideo();
  }, [state, serverOffset, blocked]);

  return <div className={styles.playerShell}>
    <div className={styles.player} ref={mount} />
    {blocked && <button type="button" className={styles.audioPrompt} onClick={() => {
      blockedRef.current = false; setBlocked(false); player.current?.playVideo();
    }}>Aktifkan audio di browser ini ▶</button>}
    {playerError && <p role="alert" className={styles.error}>{playerError}</p>}
  </div>;
}
