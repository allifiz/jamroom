"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Headphones, MessageCircle, Music2, Pause, Play, Plus, Repeat, Repeat1, Send, Settings2, Shuffle, SkipBack, SkipForward, Trash2, Users, X } from "lucide-react";
import type { TokenRequest } from "@ably/pubsub-device";
import { api, roomPath, type Listener, type PlaybackState, type Profile, type Room, type RoomMembers, type RoomMessage, type RoomView, type Snapshot, type Track } from "../../client-api";
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
  const queueRequest = useRef(0);
  const addDialog = useRef<HTMLDialogElement>(null);
  const settingsDialog = useRef<HTMLDialogElement>(null);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [settingsError,setSettingsError]=useState("");
  const [settingsBusy,setSettingsBusy]=useState(false);
  const [members,setMembers]=useState<RoomMembers|null>(null);
  const [settings,setSettings]=useState({name:"",description:"",visibility:"public" as "public"|"private",allow_add:true,allow_manage:false,allow_control:true});
  const [canConfigure,setCanConfigure]=useState(false);
  const [inviteLink,setInviteLink]=useState("");
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
    const requestId = ++queueRequest.current;
    const result = await api<Snapshot>("/rooms/" + encoded + "/queue");
    if (requestId === queueRequest.current) setSnapshot({ ...result, receivedAt: Date.now() });
  }, [encoded]);
  const reloadView = useCallback(async () => {
    const requestId=++queueRequest.current;
    let view:RoomView;
    try { view=await api<RoomView>("/rooms/"+encoded+"/view"); }
    catch(e) { if(requestId===queueRequest.current && [403,404].includes((e as Error & {status?:number}).status??0)) { setRoom(null);setSnapshot(null);setNeedsInvite(true);setSettingsOpen(false);setError((e as Error).message); } else throw e; return; }
    if(requestId!==queueRequest.current)return;
    setRoom(view.room);setCanConfigure(view.canConfigure);
    setSnapshot({...view,receivedAt:Date.now()});
    setMessages(view.messages);
    setListeners(view.listeners);
  }, [encoded]);

  const join = useCallback(async (inviteKey?: string) => {
    setError(""); setBusy(true);
    try {
      const session = await api<{profile:Profile}>("/session", "POST");
      setProfile(session.profile);
      const data = await api<{ room: Room; view: RoomView }>("/rooms/" + encoded + "/join", "POST", { inviteKey: inviteKey || null });
      queueRequest.current++;
      setRoom(data.room); setCanConfigure(data.view.canConfigure); setNeedsInvite(false);
      if (window.location.hash.startsWith("#invite=")) window.history.replaceState(null,"",window.location.pathname+window.location.search);
      setSnapshot({...data.view,receivedAt:Date.now()});
      setMessages(data.view.messages);setListeners(data.view.listeners);
    } catch (e) {
      setError((e as Error).message);
      if (!inviteKey) setNeedsInvite(true);
    } finally { setBusy(false); }
  }, [encoded]);

  useEffect(() => { const key=window.location.hash.startsWith("#invite=") ? decodeURIComponent(window.location.hash.slice(8)) : undefined; void join(key); }, [join]);
  useEffect(() => { const timer = setInterval(() => setTick(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (chatScroll.current) chatScroll.current.scrollTop = chatScroll.current.scrollHeight; }, [messages]);
  useEffect(() => {
    const dialog = addDialog.current;
    if (!dialog) return;
    if (addOpen && !dialog.open) dialog.showModal();
    if (!addOpen && dialog.open) dialog.close();
  }, [addOpen]);
  useEffect(() => {
    const dialog=settingsDialog.current;
    if(!dialog)return;
    if(settingsOpen&&!dialog.open)dialog.showModal();
    if(!settingsOpen&&dialog.open)dialog.close();
  },[settingsOpen]);

  async function openSettings() {
    if(!room)return;
    setSettings({name:room.name,description:room.description,visibility:room.visibility,allow_add:!!room.allow_add,allow_manage:!!room.allow_manage,allow_control:!!room.allow_control});
    setSettingsError("");setInviteLink("");setSettingsOpen(true);
    try { setMembers(await api<RoomMembers>("/rooms/"+encoded+"/members")); }
    catch(e) { setSettingsError((e as Error).message); }
  }
  async function saveSettings(event:React.FormEvent) {
    event.preventDefault();setSettingsBusy(true);setSettingsError("");
    try { await api("/rooms/"+encoded+"/settings","PATCH",settings); await reloadView(); }
    catch(e) { setSettingsError((e as Error).message); }
    finally { setSettingsBusy(false); }
  }
  async function memberAction(userId:string,action:"kick"|"ban"|"unban"|"role",role?:"ADMIN"|"DJ"|"MEMBER") {
    setSettingsBusy(true);setSettingsError("");
    try {
      await api("/rooms/"+encoded+"/members",action==="role"?"PATCH":"POST",action==="role"?{userId,role}:{userId,action});
      setMembers(await api<RoomMembers>("/rooms/"+encoded+"/members"));
      await reloadView();
    } catch(e) { setSettingsError((e as Error).message); }
    finally { setSettingsBusy(false); }
  }
  async function createInvite() {
    setSettingsBusy(true);setSettingsError("");
    try {
      const {inviteKey}=await api<{inviteKey:string}>("/rooms/"+encoded+"/invite","POST");
      const link=window.location.origin+roomPath(slug)+"#invite="+encodeURIComponent(inviteKey);
      setInviteLink(link);
      await navigator.clipboard.writeText(link);
    } catch(e) { setSettingsError((e as Error).message); }
    finally { setSettingsBusy(false); }
  }

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
          void reloadView().catch(e => setError((e as Error).message));
        });
        if (!cancelled) setRealtime("Realtime terhubung");
        else client.close();
      } catch (e) { if (!cancelled) setRealtime("Realtime belum terhubung: " + (e as Error).message); }
    })();
    const onFocus = () => { void reloadView().catch(e => setError((e as Error).message)); };
    const fallback = setInterval(() => { void reloadView().catch(() => {}); }, 30000);
    window.addEventListener("focus", onFocus);
    return () => { cancelled = true; close?.(); clearInterval(fallback); window.removeEventListener("focus", onFocus); };
  }, [room, encoded, reloadView]);

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!message.trim() || sending) return;
    setSending(true); setError("");
    try {
      const result=await api<{message:RoomMessage}>("/rooms/" + encoded + "/messages", "POST", {body:message});
      setMessage(""); setMessages(previous => previous.some(item=>item.id===result.message.id) ? previous : [...previous,result.message].slice(-50));
    } catch(e) { setError((e as Error).message); }
    finally { setSending(false); }
  }

  async function command(action: "play" | "pause" | "next" | "previous" | "seek" | "select" | "ended" | "setRepeat" | "setShuffle", extra: Record<string, unknown> = {}, version?: number) {
    const expectedVersion = version ?? snapshot?.state?.state_version;
    if (expectedVersion === undefined) return;
    setError(""); setBusy(true);
    try {
      const result = await api<{ state: PlaybackState; now: number }>("/rooms/" + encoded + "/playback", "POST", { action, expectedVersion, ...extra });
      queueRequest.current++;
      setSnapshot(previous => previous ? { ...previous, state: result.state, now: result.now, receivedAt: Date.now() } : previous);
    } catch (e) { setError((e as Error).message); await reload().catch(() => {}); }
    finally { setBusy(false); }
  }

  async function addTrack(event: React.FormEvent) {
    event.preventDefault(); setAddError(""); setBusy(true);
    try {
      const result=await api<{item:Track}>("/rooms/" + encoded + "/queue", "POST", { url, ...(matchUrl ? { matchUrl } : {}) });
      queueRequest.current++;
      setSnapshot(previous => previous ? {
        ...previous,
        items:previous.items.some(item=>item.id===result.item.id) ? previous.items : [...previous.items,result.item],
        state:previous.state?.current_track_id ? previous.state : previous.state ? {
          ...previous.state,current_track_id:result.item.id,status:"paused",position_seconds:0,
          playback_started_at:null,state_version:previous.state.state_version+1,updated_at:Date.now(),
        } : null,
      } : previous);
      setUrl(""); setMatchUrl(""); setAddOpen(false);
    } catch (e) { setAddError((e as Error).message); } finally { setBusy(false); }
  }

  async function reorder(trackId:string, direction:-1|1) {
    if (!snapshot || busy) return;
    const expectedIds=snapshot.items.map(item=>item.id);
    const from=expectedIds.indexOf(trackId),to=from+direction;
    if (from<0 || to<0 || to>=expectedIds.length) return;
    const orderedIds=[...expectedIds];
    [orderedIds[from],orderedIds[to]]=[orderedIds[to],orderedIds[from]];
    setBusy(true);setError("");
    try {
      const result=await api<{items:Track[]}>("/rooms/"+encoded+"/queue","PATCH",{orderedIds,expectedIds});
      queueRequest.current++;
      setSnapshot(previous=>previous?{...previous,items:result.items}:previous);
    } catch(e) { setError((e as Error).message);await reload().catch(()=>{}); }
    finally { setBusy(false); }
  }

  async function remove(trackId:string) {
    if (!snapshot || busy) return;
    setBusy(true);setError("");
    try {
      const result=await api<{removedId:string;state:PlaybackState|null;now:number}>("/rooms/"+encoded+"/queue","DELETE",{trackId});
      queueRequest.current++;
      setSnapshot(previous=>previous?{...previous,items:previous.items.filter(item=>item.id!==result.removedId),
        state:result.state??previous.state,now:result.now,receivedAt:Date.now()}:previous);
    } catch(e) { setError((e as Error).message);await reload().catch(()=>{}); }
    finally { setBusy(false); }
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
          {canConfigure && <button className={styles.share} onClick={() => void openSettings()}><Settings2 size={15}/> Pengaturan</button>}
          {(room.visibility==="public" || canConfigure) && <button className={styles.share} onClick={() => { if(room.visibility==="private") { void openSettings(); return; } void navigator.clipboard.writeText(window.location.origin + roomPath(room.slug)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => setError("Gagal menyalin tautan")); }}><Copy size={15} /> {copied ? "Tersalin" : "Bagikan room"}</button>}
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
            <button disabled={!state?.current_track_id || !snapshot?.canControl || busy} onClick={() => void command("previous")} aria-label="Lagu sebelumnya"><SkipBack size={19} fill="currentColor" /></button>
            <button className={styles.playControl} disabled={!snapshot?.items.length || !snapshot?.canControl || busy} onClick={() => void command(state?.status === "playing" ? "pause" : "play")} aria-label={state?.status === "playing" ? "Jeda" : "Putar"}>{state?.status === "playing" ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</button>
            <button disabled={!state?.current_track_id || (!next && (snapshot?.items.length ?? 0)<2 && state.repeat_mode!=="playlist") || !snapshot?.canControl || busy} onClick={() => void command("next")} aria-label="Lagu berikutnya"><SkipForward size={19} fill="currentColor" /></button>
            <span>{clock(position)}</span><div className={styles.progress}><i style={{width:current?.duration_seconds ? `${Math.min(100,position / current.duration_seconds * 100)}%` : "0%"}} /></div>
            <button disabled={!state?.current_track_id || !snapshot?.canControl || busy} onClick={() => void command("seek", { positionSeconds: Math.max(0, position - 10) })} aria-label="Mundur 10 detik">−10</button>
            <button disabled={!state?.current_track_id || !snapshot?.canControl || busy} onClick={() => void command("seek", { positionSeconds: Math.min(43200, position + 10) })} aria-label="Maju 10 detik">+10</button>
          </div>
          <div className={styles.modeControls} aria-label="Mode pemutaran">
            <button type="button" aria-pressed={!!state?.shuffle_enabled} disabled={!snapshot?.canControl || busy} onClick={() => void command("setShuffle",{enabled:!state?.shuffle_enabled})}>
              <Shuffle size={16}/> Acak {state?.shuffle_enabled ? "aktif" : "nonaktif"}
            </button>
            <button type="button" aria-pressed={!!state && state.repeat_mode!=="off"} disabled={!snapshot?.canControl || busy}
              onClick={() => void command("setRepeat",{repeatMode:state?.repeat_mode==="off" ? "playlist" : state?.repeat_mode==="playlist" ? "song" : "off"})}>
              {state?.repeat_mode==="song" ? <Repeat1 size={16}/> : <Repeat size={16}/>}
              {state?.repeat_mode==="song" ? "Ulang lagu" : state?.repeat_mode==="playlist" ? "Ulang antrean" : "Ulang nonaktif"}
            </button>
          </div>
          <div className={styles.roster}>
            <div className={styles.sectionHeading}><h3><Users size={17} /> Di ruang ini</h3><span>{listeners.length} online</span></div>
            {listeners.length ? <div className={styles.people}>{listeners.map(person => <div className={styles.person} key={person.id}><span className={styles.avatar}>{person.display_name.slice(0,2).toUpperCase()}</span><span>{person.display_name}{person.is_owner ? " · Host" : ""}</span><i /></div>)}</div>
              : <p className={styles.note}>Menunggu kehadiran anggota…</p>}
          </div>
          <p className={styles.note}>{realtime}. Pemutaran mengikuti waktu room; browser mungkin meminta satu klik untuk mengaktifkan audio.</p>
        </section>
        <section className={styles.queuePanel} aria-label="Antrean lagu">
          <div className={styles.sectionHeading}><h3><Music2 size={17} /> Antrean lagu</h3><span>{snapshot?.items.length ?? 0} lagu</span></div>
          <button className={styles.queueAddButton} disabled={!snapshot?.canAdd} onClick={() => { setAddError(""); setAddOpen(true); }}><Plus size={16} /> Tambah lagu</button>
          {!snapshot?.items.length && <p className={styles.note}>Belum ada lagu di antrean.</p>}
          <div className={styles.queueItems}>{snapshot?.items.map((item, index) =>
            <div className={styles.queueRow} key={item.id}>
              <button disabled={!snapshot.canControl || busy} onClick={() => void command("select", { trackId: item.id })}
                className={item.id === current?.id ? styles.queueActive : styles.queueItem}
                aria-label={`Putar ${item.title}`}>
                <span className={styles.queueNumber}>{item.id === current?.id ? "♫" : index + 1}</span>
                <span><strong>{item.title}</strong><small>{item.artist ?? item.source_provider}</small></span>
              </button>
              {snapshot.canManage && <div className={styles.queueActions}>
                <button type="button" disabled={busy || index===0} onClick={() => void reorder(item.id,-1)} aria-label={`Naikkan ${item.title}`} title="Naikkan"><ArrowUp size={14}/></button>
                <button type="button" disabled={busy || index===snapshot.items.length-1} onClick={() => void reorder(item.id,1)} aria-label={`Turunkan ${item.title}`} title="Turunkan"><ArrowDown size={14}/></button>
                <button type="button" disabled={busy} onClick={() => void remove(item.id)} aria-label={`Hapus ${item.title}`} title="Hapus lagu"><Trash2 size={14}/></button>
              </div>}
            </div>)}</div>
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
      <dialog ref={settingsDialog} className={`${styles.addDialog} ${styles.settingsDialog}`} aria-labelledby="room-settings-title" onClose={() => setSettingsOpen(false)} onClick={event => { if(event.target===event.currentTarget)setSettingsOpen(false); }}>
        <div className={styles.dialogContent}>
          <div className={styles.dialogHeader}><div><span className={styles.eyebrow}>SYNORA / ROOM</span><h2 id="room-settings-title">Pengaturan room</h2></div><button type="button" className={styles.dialogClose} aria-label="Tutup pengaturan" onClick={() => setSettingsOpen(false)}><X size={20}/></button></div>
          {settingsError && <p role="alert" className={styles.error}>{settingsError}</p>}
          <form className={styles.settingsForm} onSubmit={saveSettings}>
            <label>Nama room<input value={settings.name} maxLength={80} required onChange={e=>setSettings({...settings,name:e.target.value})}/></label>
            <label>Deskripsi<textarea value={settings.description} maxLength={500} onChange={e=>setSettings({...settings,description:e.target.value})}/></label>
            <label>Visibilitas<select value={settings.visibility} onChange={e=>setSettings({...settings,visibility:e.target.value as "public"|"private"})}><option value="public">Publik</option><option value="private">Privat</option></select></label>
            <fieldset className={styles.permissionFields}><legend>Izin anggota</legend>
              <label><input type="checkbox" checked={settings.allow_add} onChange={e=>setSettings({...settings,allow_add:e.target.checked})}/> Tambah lagu</label>
              <label><input type="checkbox" checked={settings.allow_manage} onChange={e=>setSettings({...settings,allow_manage:e.target.checked})}/> Atur antrean</label>
              <label><input type="checkbox" checked={settings.allow_control} onChange={e=>setSettings({...settings,allow_control:e.target.checked})}/> Kontrol pemutaran</label>
            </fieldset>
            <button className={styles.submitButton} disabled={settingsBusy}>Simpan pengaturan</button>
          </form>
          <section className={styles.settingsSection}><h3>Undangan privat</h3><p className={styles.note}>Buat tautan baru untuk mengundang teman. Tautan lama akan berhenti berlaku untuk tamu baru.</p>
            <button className={styles.cancelButton} type="button" disabled={settingsBusy} onClick={() => void createInvite()}><Copy size={15}/> Buat dan salin tautan</button>
            {inviteLink && <div className={styles.inviteBox}><input aria-label="Tautan undangan" readOnly value={inviteLink} onFocus={e=>e.target.select()}/><button type="button" onClick={() => void navigator.clipboard.writeText(inviteLink)}>Salin</button></div>}
          </section>
          <section className={styles.settingsSection}><h3>Anggota</h3>{!members && <p className={styles.note}>Memuat anggota…</p>}
            {members?.members.map(person=><div className={styles.memberRow} key={person.user_id}><div><strong>{person.display_name}</strong><small>{person.user_id===members.ownerId?"Host":person.role}</small></div>
              {person.user_id!==members.ownerId && person.user_id!==profile?.id && <div className={styles.memberActions}>
                <select aria-label={`Peran ${person.display_name}`} disabled={settingsBusy || (!room || room.owner_id!==profile?.id) && person.role==="ADMIN"} value={person.role} onChange={e=>void memberAction(person.user_id,"role",e.target.value as "ADMIN"|"DJ"|"MEMBER")}>
                  <option value="MEMBER">Anggota</option><option value="DJ">DJ</option>{room.owner_id===profile?.id && <option value="ADMIN">Admin</option>}
                </select>
                <button type="button" disabled={settingsBusy || (person.role==="ADMIN" && room.owner_id!==profile?.id)} onClick={()=>void memberAction(person.user_id,"kick")}>Keluarkan</button>
                <button type="button" disabled={settingsBusy || (person.role==="ADMIN" && room.owner_id!==profile?.id)} onClick={()=>void memberAction(person.user_id,"ban")}>Blokir</button>
              </div>}</div>)}
            {!!members?.restrictions.length && <><h4>Dibatasi</h4>{members.restrictions.map(person=><div className={styles.memberRow} key={person.user_id}><div><strong>{person.display_name}</strong><small>{person.action==="ban"?"Diblokir":"Dikeluarkan sementara"}</small></div><button type="button" disabled={settingsBusy} onClick={()=>void memberAction(person.user_id,"unban")}>Pulihkan akses</button></div>)}</>}
          </section>
        </div>
      </dialog>
    </>}
  </main>;
}
