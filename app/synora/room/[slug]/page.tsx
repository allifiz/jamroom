"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { TokenRequest } from "@ably/pubsub-device";
import { api, roomPath, type PlaybackState, type Room, type Snapshot } from "../../client-api";
import { SyncedPlayer } from "./synced-player";
import styles from "../../synora.module.css";

type TimedSnapshot = Snapshot & { receivedAt: number };
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export default function RoomPage() {
  const { slug } = useParams<{ slug: string }>();
  const encoded = encodeURIComponent(slug);
  const [room, setRoom] = useState<Room | null>(null);
  const [snapshot, setSnapshot] = useState<TimedSnapshot | null>(null);
  const [invite, setInvite] = useState("");
  const [needsInvite, setNeedsInvite] = useState(false);
  const [url, setUrl] = useState("");
  const [matchUrl, setMatchUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [realtime, setRealtime] = useState("Menghubungkan realtime…");
  const [tick, setTick] = useState(0);

  const reload = useCallback(async () => {
    const result = await api<Snapshot>("/rooms/" + encoded + "/queue");
    setSnapshot({ ...result, receivedAt: Date.now() });
  }, [encoded]);

  const join = useCallback(async (inviteKey?: string) => {
    setError(""); setBusy(true);
    try {
      await api("/session", "POST");
      const data = await api<{ room: Room }>("/rooms/" + encoded + "/join", "POST", { inviteKey: inviteKey || null });
      setRoom(data.room); setNeedsInvite(false);
      await reload();
    } catch (e) {
      setError((e as Error).message);
      if (!inviteKey) setNeedsInvite(true);
    } finally { setBusy(false); }
  }, [encoded, reload]);

  useEffect(() => { void join(); }, [join]);
  useEffect(() => { const timer = setInterval(() => setTick(Date.now()), 1000); return () => clearInterval(timer); }, []);

  useEffect(() => {
    if (!room) return;
    let cancelled = false;
    let close: undefined | (() => void);
    (async () => {
      try {
        const { createClient } = await import("@ably/pubsub-device");
        if (cancelled) return;
        const client = createClient({ authCallback: async (_params, callback) => {
          try {
            const response = await api<{ tokenRequest: TokenRequest }>("/rooms/" + encoded + "/realtime", "POST");
            callback(null, response.tokenRequest);
          } catch (e) { callback((e as Error).message, null); }
        } });
        close = () => client.close();
        const channel = client.channels.get("synora:room:" + room.id);
        await channel.subscribe(() => { void reload().catch(e => setError((e as Error).message)); });
        if (!cancelled) setRealtime("Realtime terhubung");
        else client.close();
      } catch (e) { if (!cancelled) setRealtime("Realtime belum terhubung: " + (e as Error).message); }
    })();
    const onFocus = () => { void reload().catch(e => setError((e as Error).message)); };
    const fallback = setInterval(() => { void reload().catch(() => {}); }, 10000);
    window.addEventListener("focus", onFocus);
    return () => { cancelled = true; close?.(); clearInterval(fallback); window.removeEventListener("focus", onFocus); };
  }, [room, encoded, reload]);

  async function command(action: "play" | "pause" | "next" | "seek" | "select" | "ended", extra: Record<string, unknown> = {}, version?: number) {
    const expectedVersion = version ?? snapshot?.state?.state_version;
    if (expectedVersion === undefined) return;
    setError(""); setBusy(true);
    try {
      const result = await api<{ state: PlaybackState; now: number }>("/rooms/" + encoded + "/playback", "POST", { action, expectedVersion, ...extra });
      setSnapshot(previous => previous ? { ...previous, state: result.state, now: result.now, receivedAt: Date.now() } : previous);
    } catch (e) { setError((e as Error).message); await reload().catch(() => {}); }
    finally { setBusy(false); }
  }

  async function addTrack(event: React.FormEvent) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      await api("/rooms/" + encoded + "/queue", "POST", { url, ...(matchUrl ? { matchUrl } : {}) });
      await reload(); setUrl(""); setMatchUrl("");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const state = snapshot?.state;
  const current = snapshot?.items.find(item => item.id === state?.current_track_id);
  const position = state ? Math.max(0, state.position_seconds + (state.status === "playing" && state.playback_started_at !== null
    ? (snapshot!.now + Math.max(snapshot!.receivedAt, tick) - snapshot!.receivedAt - state.playback_started_at) / 1000 : 0)) : 0;
  const next = snapshot?.items.find(item => item.position > (current?.position ?? -1));

  return <main className={styles.main}>
    <Link className={styles.back} href="/synora">← Semua ruang</Link>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {!room ? <section className={styles.panel}>
      <h1>{needsInvite ? "Gabung ke ruang" : "Membuka ruang…"}</h1>
      {needsInvite && <form className={styles.form} onSubmit={event => { event.preventDefault(); void join(invite); }}>
        <label>Kunci undangan untuk ruang privat<input value={invite} onChange={e => setInvite(e.target.value)} placeholder="Tempel kunci dari pemilik" required /></label>
        <button disabled={busy}>Gabung</button>
      </form>}
    </section> : <>
      <header className={styles.roomHeader}>
        <div><span className={styles.badge}>RUANG {room.visibility.toUpperCase()}</span><h1>{room.name}</h1>
          <p>Putar lagu dan dengarkan bersama dari perangkat mana pun.</p></div>
        <button className={styles.share} onClick={() => navigator.clipboard.writeText(window.location.origin + roomPath(room.slug))}>Salin tautan ruang ↗</button>
      </header>
      <div className={styles.roomGrid}>
        <section className={styles.stage} aria-label="Pemutar bersama">
          <div className={styles.nowPlaying}><span>SEDANG DIPUTAR</span><h2>{current?.title ?? "Belum ada lagu"}</h2>
            <p>{current?.artist ?? "Tambahkan lagu untuk memulai sesi"}</p></div>
          {current?.playback_provider === "youtube" && state && snapshot &&
            <SyncedPlayer key={current.id} videoId={current.playback_external_id} state={state}
              serverOffset={snapshot.now - snapshot.receivedAt}
              onEnded={(trackId, version) => { if (snapshot.canControl) void command("ended", { trackId }, version); }} />}
          <div className={styles.transport}>
            <span>{clock(position)}</span>
            <div className={styles.transportButtons}>
              <button disabled={!state?.current_track_id || !snapshot?.canControl || busy} onClick={() => void command("seek", { positionSeconds: Math.max(0, position - 10) })} aria-label="Mundur 10 detik">−10</button>
              <button className={styles.playButton} disabled={!snapshot?.items.length || !snapshot?.canControl || busy} onClick={() => void command(state?.status === "playing" ? "pause" : "play")}>{state?.status === "playing" ? "Jeda ❚❚" : "Putar ▶"}</button>
              <button disabled={!state?.current_track_id || !snapshot?.canControl || busy} onClick={() => void command("seek", { positionSeconds: Math.min(43200, position + 10) })} aria-label="Maju 10 detik">+10</button>
              <button disabled={!next || !snapshot?.canControl || busy} onClick={() => void command("next")} aria-label="Lagu berikutnya">Berikutnya →</button>
            </div>
            <span className={styles.liveStatus}>{state?.status === "playing" ? "● LIVE" : "JEDA"}</span>
          </div>
          <p className={styles.note}>{realtime}. Perubahan pemutaran dan antrean diselaraskan otomatis. Browser mungkin meminta satu klik untuk mengaktifkan audio.</p>
        </section>
        <aside className={styles.queuePanel}>
          <div className={styles.queueHeading}><h2>Antrean</h2><span>{snapshot?.items.length ?? 0} lagu</span></div>
          {!snapshot?.items.length && <p className={styles.note}>Antrean masih kosong. Tambahkan lagu pertamamu.</p>}
          <div className={styles.queueItems}>{snapshot?.items.map((item, index) =>
            <button key={item.id} disabled={!snapshot.canControl || busy} onClick={() => void command("select", { trackId: item.id })}
              className={item.id === current?.id ? styles.queueActive : styles.queueItem}>
              <span className={styles.queueNumber}>{item.id === current?.id ? "♫" : index + 1}</span>
              <span><strong>{item.title}</strong><small>{item.artist ?? item.source_provider}</small></span>
            </button>)}</div>
          <form onSubmit={addTrack} className={styles.form}>
            <h3>Tambah lagu</h3>
            <label>Tautan lagu<input type="url" value={url} onChange={e => setUrl(e.target.value)} required placeholder="YouTube, Spotify, dan lainnya" /></label>
            <label>Padanan YouTube jika bukan YouTube<input type="url" value={matchUrl} onChange={e => setMatchUrl(e.target.value)} placeholder="Tautan video yang sesuai" /></label>
            <button disabled={busy || !snapshot?.canAdd}>Tambah ke antrean</button>
          </form>
        </aside>
      </div>
    </>}
  </main>;
}
