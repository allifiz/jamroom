"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { TokenRequest } from "@ably/pubsub-device";
import { api, roomPath, type Room, type Snapshot } from "../../client-api";
import styles from "../../synora.module.css";

export default function RoomPage() {
  const { slug } = useParams<{ slug: string }>();
  const [room, setRoom] = useState<Room | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [invite, setInvite] = useState("");
  const [needsInvite, setNeedsInvite] = useState(false);
  const [url, setUrl] = useState("");
  const [matchUrl, setMatchUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [realtime, setRealtime] = useState("Menghubungkan realtime…");
  const encoded = encodeURIComponent(slug);

  const reload = useCallback(async () => {
    setSnapshot(await api<Snapshot>("/rooms/" + encoded + "/queue"));
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
    window.addEventListener("focus", onFocus);
    return () => { cancelled = true; close?.(); window.removeEventListener("focus", onFocus); };
  }, [room, encoded, reload]);

  async function addTrack(event: React.FormEvent) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      await api("/rooms/" + encoded + "/queue", "POST", { url, ...(matchUrl ? { matchUrl } : {}) });
      await reload(); setUrl(""); setMatchUrl("");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const current = snapshot?.items.find(item => item.id === snapshot.state?.current_track_id);
  return <main className={styles.main}>
    <Link className={styles.back} href="/synora">← Semua ruang</Link>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {!room ? <section className={styles.panel}>
      <h1>{needsInvite ? "Gabung ke ruang" : "Membuka ruang…"}</h1>
      {needsInvite && <form className={styles.form} onSubmit={event => { event.preventDefault(); void join(invite); }}>
        <label>Kunci undangan untuk ruang privat<input value={invite} onChange={e => setInvite(e.target.value)} placeholder="Tempel kunci dari pemilik" required /></label>
        <button disabled={busy}>Gabung</button>
      </form>}
    </section> : <section className={styles.panel}>
      <h1>{room.name}</h1>
      <p>Tautan ruang: <a href={roomPath(room.slug)}>{typeof window !== "undefined" ? window.location.origin + roomPath(room.slug) : roomPath(room.slug)}</a></p>
      <form onSubmit={addTrack} className={styles.form}>
        <label>Tautan lagu<input type="url" value={url} onChange={e => setUrl(e.target.value)} required placeholder="YouTube, Spotify, dan lainnya" /></label>
        <label>Padanan YouTube jika sumbernya bukan YouTube<input type="url" value={matchUrl} onChange={e => setMatchUrl(e.target.value)} placeholder="Tautan video yang kamu yakin sesuai" /></label>
        <button disabled={busy}>Tambah ke antrean</button>
      </form>
      <div className={styles.roomList}>{snapshot?.items.map(item => <div key={item.id} className={styles.room}>
        <strong>{item.title}</strong><span>{item.artist} · {item.source_provider} → {item.playback_provider}</span>
      </div>)}</div>
      {current?.playback_provider === "youtube" && <div className={styles.player}><iframe title={current.title} src={"https://www.youtube-nocookie.com/embed/" + current.playback_external_id} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen /></div>}
      <p className={styles.note}>{realtime}. Perubahan antrean akan diperbarui otomatis; kontrol pemutaran bersama masih dalam pengembangan.</p>
    </section>}
  </main>;
}
