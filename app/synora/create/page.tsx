"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, roomPath, type Profile, type Room } from "../client-api";
import styles from "../synora.module.css";

export default function CreateRoom() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState("");
  const [privateRoom, setPrivateRoom] = useState(false);
  const [created, setCreated] = useState<{ room: Room; inviteKey: string; recoveryKey: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<{ profile: Profile }>("/session", "POST")
      .then(data => { if (!cancelled) setProfile(data.profile); })
      .catch(e => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      setCreated(await api("/rooms", "POST", { name, visibility: privateRoom ? "private" : "public" }));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return <main className={styles.main}>
    <Link className={styles.back} href="/synora">← Semua ruang</Link>
    <section className={styles.panel}><h1>Buat ruang</h1>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {!created ? <form onSubmit={submit} className={styles.form}>
        <label>Nama ruang<input value={name} onChange={e => setName(e.target.value)} maxLength={80} required placeholder="Misalnya: Tengah Malam" /></label>
        <label className={styles.checkbox}><input type="checkbox" checked={privateRoom} onChange={e => setPrivateRoom(e.target.checked)} /> Ruang privat</label>
        <button disabled={busy || !profile}>{busy ? "Membuat…" : "Buat ruang"}</button>
      </form> : <>
        <p>Ruang <strong>{created.room.name}</strong> berhasil dibuat.</p>
        <div className={styles.keys}><strong>Simpan kunci pemulihan sekarang. Kunci ini hanya ditampilkan sekali.</strong>
          <label>Tautan ruang<input readOnly value={typeof window !== "undefined" ? window.location.origin + roomPath(created.room.slug) : roomPath(created.room.slug)} onFocus={e => e.target.select()} /></label>
          <label>Kunci undangan<input readOnly value={created.inviteKey} onFocus={e => e.target.select()} /></label>
          <label>Kunci pemulihan kepemilikan<input readOnly value={created.recoveryKey} onFocus={e => e.target.select()} /></label>
        </div>
        <Link className={styles.action} href={roomPath(created.room.slug)}>Masuk ke ruang →</Link>
      </>}
    </section>
  </main>;
}
