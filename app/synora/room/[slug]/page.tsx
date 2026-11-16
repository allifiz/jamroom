"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Headphones, MessageCircle, Music2, Pause, Play, Plus, Send, SkipForward, Users, X } from "lucide-react";
import type { TokenRequest } from "@ably/pubsub-device";
import { api, roomPath, type Listener, type PlaybackState, type Profile, type Room, type RoomMessage, type Snapshot } from "../../client-api";
import { SyncedPlayer } from "./synced-player";
import styles from "../../synora.module.css";

type TimedSnapshot = Snapshot & { receivedAt: number };
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export default function RoomPage() {
  const { slug } = useParams<{ slug: string }>();
  const encoded = encodeURIComponent(slug);
  const [room, setRoom] = useState<Room | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [snapshot, setSnapshot] = useState<TimedSnapshot | null>(null);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [listeners, setListeners] = useState<Listener[]>([]);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const chatScroll = useRef<HTMLDivElement>(null);
  const addDialog = useRef<HTMLDialogElement>(null);
  const [invite, setInvite] = useState("");
  const [needsInvite, setNeedsInvite] = useState(false);
  const [url, setUrl] = useState("");
  const [matchUrl, setMatchUrl] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addError, setAddError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [realtime, setRealtime] = useState("Menghubungkan realtime…");
  const [tick, setTick] = useState(0);

  const reload = useCallback(async () => {
    const result = await api<Snapshot>("/rooms/" + encoded + "/queue");
    setSnapshot({ ...result, receivedAt: Date.now() });
  }, [encoded]);
  const reloadSocial = useCallback(async () => {
    const [chat, presence] = await Promise.all([
      api<{messages:RoomMessage[]}>("/rooms/" + encoded + "/messages"),
      api<{listeners:Listener[]}>("/rooms/" + encoded + "/presence"),
    ]);
    setMessages(chat.messages);
    setListeners(presence.listeners);
  }, [encoded]);

  const join = useCallback(async (inviteKey?: string) => {
    setError(""); setBusy(true);
    try {
      const session = await api<{profile:Profile}>("/session", "POST");
      setProfile(session.profile);
      const data = await api<{ room: Room }>("/rooms/" + encoded + "/join", "POST", { inviteKey: inviteKey || null });
      setRoom(data.room); setNeedsInvite(false);
      await Promise.all([reload(),reloadSocial()]);
    } catch (e) {
      setError((e as Error).message);
      if (!inviteKey) setNeedsInvite(true);
    } finally { setBusy(false); }
  }, [encoded, reload, reloadSocial]);

  useEffect(() => { void join(); }, [join]);
  useEffect(() => { const timer = setInterval(() => setTick(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (chatScroll.current) chatScroll.current.scrollTop = chatScroll.current.scrollHeight; }, [messages]);
  useEffect(() => {
    const dialog = addDialog.current;
    if (!dialog) return;
    if (addOpen && !dialog.open) dialog.showModal();
    if (!addOpen && dialog.open) dialog.close();
  }, [addOpen]);

  useEffect(() => {
    if (!room) return;
    const tabId = crypto.randomUUID();
    const heartbeat = async () => {
      try {
        await api("/rooms/" + encoded + "/presence", "POST", {tabId});
        const result = await api<{listeners:Listener[]}>("/rooms/" + encoded + "/presence");
        setListeners(result.listeners);
      } catch (e) { setError((e as Error).message); }
    };
    void heartbeat();
    const interval = setInterval(() => { void heartbeat(); }, 20_000);
    return () => {
      clearInterval(interval);
      void fetch("/api/synora/rooms/" + encoded + "/presence", {
        method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({tabId,action:"leave"}),keepalive:true,
      }).catch(() => {});
    };
  }, [room,encoded]);

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
        await channel.subscribe(() => {
          void reload().catch(e => setError((e as Error).message));
          void reloadSocial().catch(e => setError((e as Error).message));
        });
        if (!cancelled) setRealtime("Realtime terhubung");
        else client.close();
      } catch (e) { if (!cancelled) setRealtime("Realtime belum terhubung: " + (e as Error).message); }
    })();
    const onFocus = () => { void reload().catch(e => setError((e as Error).message)); void reloadSocial().catch(() => {}); };
    const fallback = setInterval(() => { void reload().catch(() => {}); void reloadSocial().catch(() => {}); }, 10000);
    window.addEventListener("focus", onFocus);
    return () => { cancelled = true; close?.(); clearInterval(fallback); window.removeEventListener("focus", onFocus); };
  }, [room, encoded, reload, reloadSocial]);

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!message.trim() || sending) return;
    setSending(true); setError("");
    try {
      await api("/rooms/" + encoded + "/messages", "POST", {body:message});
      setMessage(""); await reloadSocial();
    } catch(e) { setError((e as Error).message); }
    finally { setSending(false); }
  }

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
    event.preventDefault(); setAddError(""); setBusy(true);
    try {
      await api("/rooms/" + encoded + "/queue", "POST", { url, ...(matchUrl ? { matchUrl } : {}) });
      await reload(); setUrl(""); setMatchUrl(""); setAddOpen(false);
    } catch (e) { setAddError((e as Error).message); } finally { setBusy(false); }
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
        <div><span className={styles.eyebrow}>SYNORA / {room.visibility === "private" ? "PRIVATE ROOM" : "PUBLIC ROOM"}</span>
          <h1>{room.name} <span>✳</span></h1><p>Tempat lagu enak dan cerita kecil bertemu.</p></div>
        <div className={styles.headerActions}>
          <span className={styles.listeningBadge}><Headphones size={15} /> Sedang mendengarkan bersama</span>
          <button className={styles.share} onClick={() => { void navigator.clipboard.writeText(window.location.origin + roomPath(room.slug)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => setError("Gagal menyalin tautan")); }}><Copy size={15} /> {copied ? "Tersalin" : "Bagikan room"}</button>
        </div>
      </header>
      <div className={styles.studioGrid}>
        <section className={styles.studioCenter} aria-label="Pemutar bersama">
          {current?.playback_provider === "youtube" && state && snapshot ?
            <SyncedPlayer key={current.id} videoId={current.playback_external_id} state={state}
              serverOffset={snapshot.now - snapshot.receivedAt}
              onEnded={(trackId, version) => { if (snapshot.canControl) void command("ended", { trackId }, version); }} />
            : <div className={styles.emptyPlayer}><div className={styles.record}>✳</div><span>Belum ada lagu. Tambahkan lagu untuk mulai mendengarkan.</span></div>}
          <div className={styles.songTitle}><span>NOW PLAYING <i>{state?.status === "playing" ? "● LIVE" : "○ JEDA"}</i></span>
            <h2>{current?.title ?? "Belum ada lagu"}</h2><p>{current?.artist ?? "Tambahkan lagu untuk memulai sesi"}</p></div>
          <div className={styles.transport}>
            <button className={styles.playControl} disabled={!snapshot?.items.length || !snapshot?.canControl || busy} onClick={() => void command(state?.status === "playing" ? "pause" : "play")} aria-label={state?.status === "playing" ? "Jeda" : "Putar"}>{state?.status === "playing" ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</button>
            <button disabled={!next || !snapshot?.canControl || busy} onClick={() => void command("next")} aria-label="Lagu berikutnya"><SkipForward size={19} fill="currentColor" /></button>
            <span>{clock(position)}</span><div className={styles.progress}><i style={{width:current?.duration_seconds ? `${Math.min(100,position / current.duration_seconds * 100)}%` : "0%"}} /></div>
            <button disabled={!state?.current_track_id || !snapshot?.canControl || busy} onClick={() => void command("seek", { positionSeconds: Math.max(0, position - 10) })} aria-label="Mundur 10 detik">−10</button>
            <button disabled={!state?.current_track_id || !snapshot?.canControl || busy} onClick={() => void command("seek", { positionSeconds: Math.min(43200, position + 10) })} aria-label="Maju 10 detik">+10</button>
          </div>
          <div className={styles.roster}>
            <div className={styles.sectionHeading}><h3><Users size={17} /> Di ruang ini</h3><span>{listeners.length} online</span></div>
            {listeners.length ? <div className={styles.people}>{listeners.map(person => <div className={styles.person} key={person.id}><span className={styles.avatar}>{person.display_name.slice(0,2).toUpperCase()}</span><span>{person.display_name}{person.is_owner ? " · Host" : ""}</span><i /></div>)}</div>
              : <p className={styles.note}>Menunggu kehadiran anggota…</p>}
          </div>
          <p className={styles.note}>{realtime}. Pemutaran mengikuti waktu room; browser mungkin meminta satu klik untuk mengaktifkan audio.</p>
        </section>
        <aside className={styles.studioSide}>
          <section className={styles.queuePanel} aria-label="Antrean lagu">
            <div className={styles.sectionHeading}><h3><Music2 size={17} /> Antrean lagu</h3><span>{snapshot?.items.length ?? 0} lagu</span></div>
            <button className={styles.queueAddButton} disabled={!snapshot?.canAdd} onClick={() => { setAddError(""); setAddOpen(true); }}><Plus size={16} /> Tambah lagu</button>
            {!snapshot?.items.length && <p className={styles.note}>Belum ada lagu di antrean.</p>}
            <div className={styles.queueItems}>{snapshot?.items.map((item, index) =>
              <button key={item.id} disabled={!snapshot.canControl || busy} onClick={() => void command("select", { trackId: item.id })}
                className={item.id === current?.id ? styles.queueActive : styles.queueItem}>
                <span className={styles.queueNumber}>{item.id === current?.id ? "♫" : index + 1}</span>
                <span><strong>{item.title}</strong><small>{item.artist ?? item.source_provider}</small></span>
              </button>)}</div>
          </section>
          <section className={styles.chatPanel} aria-label="Obrolan room">
            <div className={styles.sectionHeading}><h3><MessageCircle size={17} /> Obrolan</h3><span>Room chat</span></div>
            <div className={styles.messages} ref={chatScroll} role="log" aria-live="polite">
              {!messages.length && <p className={styles.note}>Belum ada pesan. Sapa temanmu duluan!</p>}
              {messages.map(item => <div className={styles.message} key={item.id}>
                <span className={styles.avatar}>{item.display_name.slice(0,2).toUpperCase()}</span>
                <div><div className={styles.messageMeta}><strong>{item.user_id === profile?.id ? "Kamu" : item.display_name}</strong><time>{new Intl.DateTimeFormat("id-ID",{hour:"2-digit",minute:"2-digit",timeZone:"Asia/Jakarta"}).format(item.created_at)}</time></div><p>{item.body}</p></div>
              </div>)}
            </div>
            <form className={styles.chatForm} onSubmit={sendMessage}><input aria-label="Tulis pesan" value={message} onChange={e => setMessage(e.target.value)} maxLength={500} placeholder="Tulis pesan untuk room…" required /><button disabled={sending || !message.trim()} aria-label="Kirim pesan"><Send size={17} /></button></form>
          </section>
        </aside>
      </div>
      <dialog ref={addDialog} className={styles.addDialog} aria-labelledby="add-song-title" onClose={() => setAddOpen(false)} onClick={event => { if (event.target === event.currentTarget) setAddOpen(false); }}>
        <div className={styles.dialogContent}>
          <div className={styles.dialogHeader}><div><span className={styles.eyebrow}>SYNORA / ANTREAN</span><h2 id="add-song-title">Tambah lagu</h2></div><button type="button" className={styles.dialogClose} aria-label="Tutup popup" onClick={() => setAddOpen(false)}><X size={20} /></button></div>
          <p className={styles.dialogDescription}>Tempel tautan lagu yang ingin didengarkan bersama.</p>
          {addError && <p role="alert" className={styles.error}>{addError}</p>}
          <form onSubmit={addTrack} className={styles.addSongForm}>
            <label>Tautan lagu<input type="url" autoFocus value={url} onChange={e => setUrl(e.target.value)} required placeholder="https://www.youtube.com/watch?v=…" /></label>
            <label><span>Padanan YouTube <span className={styles.optional}>(jika sumbernya bukan YouTube)</span></span><input type="url" value={matchUrl} onChange={e => setMatchUrl(e.target.value)} placeholder="Tautan video YouTube yang sesuai" /></label>
            <p className={styles.note}>Lagu dari Spotify dan sumber lain membutuhkan padanan YouTube yang kamu pilih.</p>
            <div className={styles.dialogActions}><button type="button" className={styles.cancelButton} onClick={() => setAddOpen(false)}>Batal</button><button type="submit" className={styles.submitButton} disabled={busy || !snapshot?.canAdd}><Plus size={16} /> {busy ? "Menambahkan…" : "Tambah ke antrean"}</button></div>
          </form>
        </div>
      </dialog>
    </>}
  </main>;
}
