"use client";

import { useCallback, useEffect, useState } from "react";
import type { TokenRequest } from "@ably/pubsub-device";
import styles from "./synora.module.css";

type Profile = { id:string; display_name:string };
type Room = { id:string; slug:string; name:string; description:string; visibility:"public"|"private"; cover:string };
type Rooms = { discover:Room[]; owned:Room[]; recent:Room[] };
type Track = { id:string; title:string; artist:string|null; source_provider:string; playback_provider:string; playback_external_id:string; position:number };
type Snapshot = { items:Track[]; state:{current_track_id:string|null;status:string}|null };

async function api<T>(path:string,method="GET",body?:unknown):Promise<T> {
  const response=await fetch("/api/synora"+path,{method,credentials:"same-origin",
    ...(body!==undefined?{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{})});
  const data=await response.json();
  if(!response.ok) throw new Error(data.error??"Request failed");
  return data as T;
}

export default function SynoraPreview() {
  const [profile,setProfile]=useState<Profile|null>(null);
  const [rooms,setRooms]=useState<Rooms|null>(null);
  const [active,setActive]=useState<Room|null>(null);
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [name,setName]=useState("");
  const [privateRoom,setPrivateRoom]=useState(false);
  const [url,setUrl]=useState("");
  const [matchUrl,setMatchUrl]=useState("");
  const [invite,setInvite]=useState("");
  const [secrets,setSecrets]=useState<{inviteKey:string;recoveryKey:string}|null>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [realtime,setRealtime]=useState("Menghubungkan realtime…");

  const refreshRooms=useCallback(async()=>setRooms(await api<Rooms>("/rooms")),[]);
  const openRoom=useCallback(async(room:Room)=>{
    await api("/rooms/"+encodeURIComponent(room.slug)+"/join","POST",{});
    setActive(room); setSecrets(null); setSnapshot(null);
    setSnapshot(await api<Snapshot>("/rooms/"+encodeURIComponent(room.slug)+"/queue"));
  },[]);
  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      try {
        const session=await api<{profile:Profile}>("/session","POST");
        if(cancelled)return;
        setProfile(session.profile);
        const list=await api<Rooms>("/rooms");
        if(!cancelled)setRooms(list);
      } catch(e) { if(!cancelled)setError((e as Error).message); }
    })();
    return()=>{cancelled=true};
  },[]);

  useEffect(()=>{
    if(!active)return;
    let cancelled=false;
    let close:undefined|(()=>void);
    const slug=encodeURIComponent(active.slug);
    const reload=async()=>{
      try{const next=await api<Snapshot>("/rooms/"+slug+"/queue");if(!cancelled)setSnapshot(next)}
      catch(e){if(!cancelled)setError((e as Error).message)}
    };
    (async()=>{
      try{
        const {createClient}=await import("@ably/pubsub-device");
        if(cancelled)return;
        const client=createClient({authCallback:async(_params,callback)=>{
          try{
            const response=await api<{tokenRequest:TokenRequest}>("/rooms/"+slug+"/realtime","POST");
            callback(null,response.tokenRequest);
          }catch(e){callback((e as Error).message,null)}
        }});
        close=()=>client.close();
        const channel=client.channels.get("synora:room:"+active.id);
        await channel.subscribe(()=>{void reload()});
        if(!cancelled)setRealtime("Realtime terhubung");
        else client.close();
      }catch(e){if(!cancelled)setRealtime("Realtime belum terhubung: "+(e as Error).message)}
    })();
    const onFocus=()=>{void reload()};
    window.addEventListener("focus",onFocus);
    return()=>{cancelled=true;close?.();window.removeEventListener("focus",onFocus)};
  },[active]);

  async function createRoom(event:React.FormEvent) {
    event.preventDefault();setError("");setBusy(true);
    try {
      const created=await api<{room:Room;inviteKey:string;recoveryKey:string}>("/rooms","POST",{name,visibility:privateRoom?"private":"public"});
      await refreshRooms();await openRoom(created.room);
      setSecrets({inviteKey:created.inviteKey,recoveryKey:created.recoveryKey});setName("");
    }catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }

  async function addTrack(event:React.FormEvent) {
    event.preventDefault();if(!active)return;
    setError("");setBusy(true);
    try {
      await api("/rooms/"+encodeURIComponent(active.slug)+"/queue","POST",{url, ...(matchUrl?{matchUrl}:{})});
      setSnapshot(await api<Snapshot>("/rooms/"+encodeURIComponent(active.slug)+"/queue"));
      setUrl("");setMatchUrl("");
    }catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }

  async function join(event:React.FormEvent) {
    event.preventDefault();setError("");setBusy(true);
    try {
      const slug=new URLSearchParams(window.location.search).get("room");
      if(!slug)throw new Error("Open a room invite link first");
      const data=await api<{room:Room}>("/rooms/"+encodeURIComponent(slug)+"/join","POST",{inviteKey:invite||null});
      await refreshRooms();await openRoom(data.room);setInvite("");
    }catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }

  const current=snapshot?.items.find(item=>item.id===snapshot.state?.current_track_id);
  return <main className={styles.main}>
    <div className={styles.hero}><span className={styles.badge}>SYNORA · V2 DEVELOPMENT PREVIEW</span>
      <h1>Music feels better together.</h1><p>Ruang musik tanpa pendaftaran. Masuk, buat ruang, dan kumpulkan lagu bersama.</p>
      {profile&&<span className={styles.identity}>Halo, {profile.display_name}</span>}
    </div>
    {error&&<p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.grid}>
      <section className={styles.panel}><h2>Buat ruang</h2>
        <form onSubmit={createRoom} className={styles.form}>
          <label>Nama ruang<input value={name} onChange={e=>setName(e.target.value)} maxLength={80} required placeholder="Misalnya: Tengah Malam" /></label>
          <label className={styles.checkbox}><input type="checkbox" checked={privateRoom} onChange={e=>setPrivateRoom(e.target.checked)} /> Ruang privat</label>
          <button disabled={busy||!profile}>Buat ruang</button>
        </form>
        <h2>Gabung dari tautan</h2><form onSubmit={join} className={styles.form}>
          <label>Kunci undangan (hanya untuk ruang privat)<input value={invite} onChange={e=>setInvite(e.target.value)} placeholder="Tempel kunci dari pemilik" /></label>
          <button disabled={busy||!profile}>Gabung</button>
        </form>
      </section>
      <section className={styles.panel}><h2>Temukan ruang</h2>
        {!rooms?<p>Memuat ruang…</p>:rooms.discover.length===0?<p>Belum ada ruang publik.</p>:
          <div className={styles.roomList}>{rooms.discover.map(room=><button key={room.id} onClick={()=>openRoom(room).catch(e=>setError(e.message))} className={styles.room}>
            <strong>{room.name}</strong><span>{room.description||"Ruang musik bersama"}</span></button>)}</div>}
        <h2>Ruang milikmu</h2><div className={styles.roomList}>{rooms?.owned.map(room=><button key={room.id} onClick={()=>openRoom(room).catch(e=>setError(e.message))} className={styles.room}><strong>{room.name}</strong><span>{room.visibility}</span></button>)}</div>
      </section>
    </div>
    {active&&<section className={styles.panel}><h2>{active.name}</h2>
      <p>Tautan ruang: <a href={"/synora?room="+encodeURIComponent(active.slug)}>/synora?room={active.slug}</a></p>
      {secrets&&<div className={styles.keys}><strong>Simpan kunci ini sekarang. Kunci pemulihan hanya tampil sekali.</strong>
        <label>Undangan<input readOnly value={secrets.inviteKey} onFocus={e=>e.target.select()} /></label>
        <label>Pemulihan kepemilikan<input readOnly value={secrets.recoveryKey} onFocus={e=>e.target.select()} /></label></div>}
      <form onSubmit={addTrack} className={styles.form}>
        <label>Tautan lagu<input type="url" value={url} onChange={e=>setUrl(e.target.value)} required placeholder="YouTube, Spotify, dan lainnya" /></label>
        <label>Padanan YouTube jika sumbernya bukan YouTube<input type="url" value={matchUrl} onChange={e=>setMatchUrl(e.target.value)} placeholder="Tautan video yang kamu yakin sesuai" /></label>
        <button disabled={busy}>Tambah ke antrean</button>
      </form>
      <div className={styles.roomList}>{snapshot?.items.map(item=><div key={item.id} className={styles.room}><strong>{item.title}</strong><span>{item.artist} · {item.source_provider} → {item.playback_provider}</span></div>)}</div>
      {current?.playback_provider==="youtube"&&<div className={styles.player}><iframe title={current.title} src={"https://www.youtube-nocookie.com/embed/"+current.playback_external_id} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen /></div>}
      <p className={styles.note}>{realtime}. Perubahan antrean akan diperbarui otomatis; kontrol pemutaran bersama masih dalam pengembangan.</p>
    </section>}
  </main>;
}
