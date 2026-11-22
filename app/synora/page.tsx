"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, roomPath, type Profile, type Room, type Rooms } from "./client-api";
import styles from "./synora.module.css";

function RoomList({ rooms }: { rooms: Room[] }) {
  return <div className={styles.roomList}>{rooms.map(room =>
    <Link className={styles.room} href={roomPath(room.slug)} key={room.id}>
      <strong>{room.name}</strong><span>{room.description || (room.visibility === "private" ? "Ruang privat" : "Ruang musik bersama")}</span>
    </Link>)}</div>;
}

export default function SynoraHome() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [rooms, setRooms] = useState<Rooms | null>(null);
  const [error, setError] = useState("");
  const [slug, setSlug] = useState("");

  useEffect(() => {
    const legacy = new URLSearchParams(window.location.search).get("room");
    if (legacy) { router.replace(roomPath(legacy)); return; }
    let cancelled = false;
    (async () => {
      try {
        const session = await api<{ profile: Profile; rooms: Rooms }>("/session?rooms=1", "POST");
        if (cancelled) return;
        setProfile(session.profile);
        setRooms(session.rooms);
      } catch (e) { if (!cancelled) setError((e as Error).message); }
    })();
    return () => { cancelled = true; };
  }, [router]);

  function openLink(event: React.FormEvent) {
    event.preventDefault();
    const value = slug.trim();
    if (!value) return;
    try {
      const parsed = new URL(value, window.location.origin);
      const path = parsed.pathname;
      const target = path.startsWith("/synora/room/") ? decodeURIComponent(path.slice("/synora/room/".length))
        : parsed.searchParams.get("room") || (path === "/synora" ? "" : value);
      if (!target) throw new Error("Tautan ruang tidak valid");
      router.push(roomPath(target));
    } catch { setError("Tautan ruang tidak valid"); }
  }

  return <main className={styles.main}>
    <div className={styles.hero}><span className={styles.badge}>SYNORA · RUANG MUSIK BERSAMA</span>
      <h1>Music feels better together.</h1><p>Ruang musik tanpa pendaftaran. Masuk, buat ruang, dan kumpulkan lagu bersama.</p>
      {profile && <span className={styles.identity}>Halo, {profile.display_name}</span>}
    </div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.grid}>
      <section className={styles.panel}><h2>Mulai dengarkan bersama</h2>
        <p>Buat ruang baru dan bagikan tautannya kepada temanmu.</p>
        <Link className={styles.action} href="/synora/create">Buat ruang ↗</Link>
        <h2>Gabung dari tautan</h2>
        <form className={styles.form} onSubmit={openLink}>
          <label>Tautan ruang<input value={slug} onChange={e => setSlug(e.target.value)} placeholder="Tempel tautan ruang" required /></label>
          <button type="submit">Buka ruang</button>
        </form>
      </section>
      <section className={styles.panel}><h2>Temukan ruang</h2>
        {!rooms ? <p>Memuat ruang…</p> : rooms.discover.length ? <RoomList rooms={rooms.discover} /> : <p>Belum ada ruang publik.</p>}
        <h2>Ruang milikmu</h2>
        {rooms?.owned.length ? <RoomList rooms={rooms.owned} /> : <p>Belum ada ruang milikmu.</p>}
        {!!rooms?.recent.length && <><h2>Baru dikunjungi</h2><RoomList rooms={rooms.recent.filter(room => !rooms.owned.some(owned => owned.id === room.id))} /></>}
      </section>
    </div>
  </main>;
}
