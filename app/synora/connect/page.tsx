"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api, type Profile } from "../client-api";
import styles from "../synora.module.css";

function ConnectExtension() {
  const search=useSearchParams();
  const code=search.get("code")??"";
  const [profile,setProfile]=useState<Profile|null>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [approved,setApproved]=useState(false);
  useEffect(()=>{ api<{profile:Profile}>("/session","POST").then(r=>setProfile(r.profile)).catch(e=>setError((e as Error).message)); },[]);
  async function approve() {
    setBusy(true);setError("");
    try { await api("/extension/approve","POST",{code});setApproved(true);window.history.replaceState(null,"","/synora/connect"); }
    catch(e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <main className={styles.main}><Link className={styles.back} href="/synora">← Semua ruang</Link><section className={styles.panel}>
    <span className={styles.eyebrow}>SYNORA / EXTENSION</span><h1>Hubungkan extension</h1>
    {error&&<p role="alert" className={styles.error}>{error}</p>}
    {approved ? <><p>Extension terhubung ke profilmu. Buka lagi popup extension untuk memilih room dan mengirim lagu.</p><Link className={styles.action} href="/synora">Kembali ke Synora</Link></>
      : code ? <><p>Pastikan kode di bawah sama dengan yang terlihat di popup extension. Koneksi ini dapat mengirim lagu ke room yang kamu ikuti.</p>
        <p className={styles.pairCode}>{code}</p><p>Profil: <strong>{profile?.display_name??"Memuat profil…"}</strong></p>
        <button className={styles.action} disabled={!profile||busy} onClick={()=>void approve()}>{busy?"Menghubungkan…":"Ya, hubungkan extension"}</button></>
      : <p>Buka extension Synora dan pilih Hubungkan untuk mendapatkan kode sekali pakai.</p>}
  </section></main>;
}
export default function ConnectPage() { return <Suspense><ConnectExtension/></Suspense>; }
