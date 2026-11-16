"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Copy, Headphones, Heart, MessageCircle, Music2, Pause, Play, Plus, Send, SkipForward, Users, Volume2 } from "lucide-react";
import styles from "./room-mockups.module.css";

type Option = "studio" | "lounge" | "radio";
type Message = { name: string; body: string; time: string; tone: string };
const people = [
  { name: "MellowPotato", initials: "MP", tone: "pink", role: "Host" },
  { name: "CosmicMoon", initials: "CM", tone: "blue", role: "Mendengarkan" },
  { name: "VelvetRaptor", initials: "VR", tone: "yellow", role: "Mendengarkan" },
  { name: "NeonNoodle", initials: "NN", tone: "mint", role: "Mendengarkan" },
];
const songs = [
  { title: "Secukupnya", artist: "Hindia", color: "pink", time: "3:39" },
  { title: "Bertaut", artist: "Nadin Amizah", color: "violet", time: "5:09" },
  { title: "Untuk Perempuan yang Sedang Dalam Pelukan", artist: "Payung Teduh", color: "yellow", time: "5:13" },
  { title: "Runtuh", artist: "Feby Putri, Fiersa Besari", color: "mint", time: "3:44" },
];
const initialMessages: Message[] = [
  { name: "CosmicMoon", body: "Lagu ini pas banget buat malam ini ✨", time: "21:42", tone: "blue" },
  { name: "VelvetRaptor", body: "Setelah ini putar Bertaut yaa", time: "21:43", tone: "yellow" },
  { name: "MellowPotato", body: "Sudah masuk antrean. Enjoy! 🎧", time: "21:43", tone: "pink" },
];
const options: { id: Option; label: string; mood: string; description: string }[] = [
  { id: "studio", label: "A · Studio", mood: "Pemutar jadi pusat", description: "Layar musik besar, chat dan antrean di sisi kanan. Cocok untuk sesi nonton dan dengar bersama." },
  { id: "lounge", label: "B · Lounge", mood: "Ruang ngobrol hangat", description: "Chat lebih terasa hidup, orang yang hadir jelas, dan visual tetap dekat dengan Jamroom sekarang." },
  { id: "radio", label: "C · Night Radio", mood: "Kompak dan atmosferik", description: "Pemutar ringkas di atas, percakapan dan antrean berimbang. Enak dipakai sambil membuka tab lain." },
];

function Avatar({ initials, tone }: { initials: string; tone: string }) {
  return <span className={`${styles.avatar} ${styles[tone]}`}>{initials}</span>;
}

function Roster({ compact = false }: { compact?: boolean }) {
  return <section className={styles.roster} aria-label="Orang di room">
    <div className={styles.sectionHeading}><h3><Users size={17} /> Di ruang ini</h3><span className={styles.onlineCount}>● 4 online</span></div>
    {compact ? <div className={styles.rosterCompact}>{people.map(person => <span key={person.name} title={person.name}><Avatar initials={person.initials} tone={person.tone} /><span>{person.name}</span></span>)}</div>
      : <div className={styles.people}>{people.map(person => <div className={styles.person} key={person.name}>
        <Avatar initials={person.initials} tone={person.tone} /><span><strong>{person.name}</strong><small>{person.role}</small></span><i aria-label="online" />
      </div>)}</div>}
  </section>;
}

function Chat({ messages, draft, setDraft, send }: { messages: Message[]; draft: string; setDraft: (value: string) => void; send: () => void }) {
  return <section className={styles.chat} aria-label="Contoh chat">
    <div className={styles.sectionHeading}><h3><MessageCircle size={17} /> Obrolan</h3><span>Room chat</span></div>
    <div className={styles.messages}>{messages.map((message, index) => <div className={styles.message} key={`${message.time}-${index}`}>
      <Avatar initials={message.name.slice(0, 2).toUpperCase()} tone={message.tone} />
      <div><div className={styles.messageMeta}><strong>{message.name}</strong><time>{message.time}</time></div><p>{message.body}</p></div>
    </div>)}</div>
    <form className={styles.messageForm} onSubmit={event => { event.preventDefault(); send(); }}>
      <input aria-label="Tulis pesan mockup" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Tulis pesan untuk room…" maxLength={100} />
      <button aria-label="Kirim pesan mockup" type="submit"><Send size={16} /></button>
    </form>
  </section>;
}

function Queue({ active, setActive }: { active: number; setActive: (index: number) => void }) {
  return <section className={styles.queue} aria-label="Antrean lagu">
    <div className={styles.sectionHeading}><h3><Music2 size={17} /> Antrean lagu</h3><span>{songs.length} lagu</span></div>
    <div className={styles.tracks}>{songs.map((song, index) => <button key={song.title} className={`${styles.track} ${active === index ? styles.activeTrack : ""}`} onClick={() => setActive(index)}>
      <span className={`${styles.artMini} ${styles[song.color]}`}><Music2 size={16} /></span>
      <span className={styles.trackInfo}><strong>{song.title}</strong><small>{song.artist}</small></span>
      <span className={styles.trackTime}>{active === index ? "♫" : song.time}</span>
    </button>)}</div>
    <button className={styles.addSong}><Plus size={16} /> Tambah lagu ke antrean</button>
  </section>;
}

function Controls({ playing, setPlaying, next }: { playing: boolean; setPlaying: (value: boolean) => void; next: () => void }) {
  return <div className={styles.controls}>
    <button className={styles.playControl} onClick={() => setPlaying(!playing)} aria-label={playing ? "Jeda" : "Putar"}>{playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button>
    <button onClick={next} aria-label="Lagu berikutnya"><SkipForward size={19} fill="currentColor" /></button>
    <div className={styles.timeline}><span>1:24</span><div className={styles.timelineBar}><i /></div><span>{songs[0].time}</span></div>
    <Volume2 className={styles.volume} size={18} />
  </div>;
}

function MusicVisual({ compact = false }: { compact?: boolean }) {
  return <div className={`${styles.musicVisual} ${compact ? styles.compactVisual : ""}`}>
    <div className={styles.visualGlow} /><div className={styles.record}><div className={styles.recordCenter} /></div>
    <span className={styles.visualLabel}>SYNORA SESSIONS <span>✳</span></span>
    <div className={styles.visualCaption}>good music<br />better company.</div>
  </div>;
}

function RoomTop({ option, copied, copy }: { option: Option; copied: boolean; copy: () => void }) {
  return <div className={styles.roomTop}>
    <div><span className={styles.eyebrow}>SYNORA / ROOM 048</span><h2>Ruang Tengah Malam <span>✳</span></h2><p>Tempat lagu enak dan cerita kecil bertemu.</p></div>
    <div className={styles.roomTopActions}><span className={styles.roomBadge}><Headphones size={15} /> Sedang mendengarkan bersama</span><button onClick={copy}><Copy size={15} /> {copied ? "Tersalin" : "Bagikan room"}</button></div>
    <span className={styles.visuallyHidden}>{option}</span>
  </div>;
}

export default function RoomMockups() {
  const [option, setOption] = useState<Option>("studio");
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const next = () => setActive(index => (index + 1) % songs.length);
  const send = () => {
    if (!draft.trim()) return;
    setMessages(items => [...items, { name: "Kamu", body: draft.trim(), time: "21:44", tone: "mint" }]);
    setDraft("");
  };
  const copy = () => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); };
  const song = songs[active];

  return <main className={styles.page}>
    <div className={styles.intro}><a href="/synora" className={styles.back}><ArrowLeft size={16} /> Kembali ke Synora</a>
      <span className={styles.introTag}>EKSPLORASI DESAIN · ROOM V2</span><h1>Pilih rasa untuk room-mu.</h1>
      <p>Tiga arah visual untuk fitur yang sama. Ini mockup interaktif dengan data contoh; halaman room yang sedang dipakai tetap seperti sekarang.</p>
    </div>
    <div className={styles.choices} role="tablist" aria-label="Pilih mockup room">
      {options.map(item => <button key={item.id} role="tab" aria-selected={option === item.id} onClick={() => setOption(item.id)} className={`${styles.choice} ${styles[item.id + "Choice"]} ${option === item.id ? styles.chosen : ""}`}>
        <span className={styles.choiceTop}><strong>{item.label}</strong>{option === item.id && <Check size={17} />}</span>
        <span className={styles.choiceMood}>{item.mood}</span><span className={styles.choiceDescription}>{item.description}</span>
        <span className={styles.choiceSwatches}><i /><i /><i /></span>
      </button>)}
    </div>

    <div className={`${styles.canvas} ${styles[option]}`} role="tabpanel">
      <div className={styles.previewRibbon}><span>MOCKUP {option === "studio" ? "A" : option === "lounge" ? "B" : "C"}</span><span>DATA CONTOH · KLIK KONTROL UNTUK MENCOBA</span></div>
      <RoomTop option={option} copied={copied} copy={copy} />

      {option === "studio" && <div className={styles.studioGrid}>
        <div className={styles.studioCenter}><div className={styles.studioVisual}><MusicVisual /><button className={styles.visualPlay} onClick={() => setPlaying(!playing)} aria-label={playing ? "Jeda" : "Putar"}>{playing ? <Pause size={27} fill="currentColor" /> : <Play size={27} fill="currentColor" />}</button></div>
          <div className={styles.songTitle}><span>NOW PLAYING <i>● LIVE</i></span><h3>{song.title}</h3><p>{song.artist}</p></div><Controls playing={playing} setPlaying={setPlaying} next={next} />
          <div className={styles.studioPeople}><Roster compact /></div>
        </div>
        <div className={styles.studioSide}><Queue active={active} setActive={setActive} /><Chat messages={messages} draft={draft} setDraft={setDraft} send={send} /></div>
      </div>}

      {option === "lounge" && <div className={styles.loungeGrid}>
        <div className={styles.loungeMain}><div className={styles.loungePlayer}><MusicVisual compact /><div className={styles.loungePlayerText}><span>SEDANG DIPUTAR</span><h3>{song.title}</h3><p>{song.artist}</p><button><Heart size={16} /> Suka lagu ini</button></div></div>
          <Controls playing={playing} setPlaying={setPlaying} next={next} /><Queue active={active} setActive={setActive} />
        </div>
        <div className={styles.loungeSide}><Roster /><Chat messages={messages} draft={draft} setDraft={setDraft} send={send} /></div>
      </div>}

      {option === "radio" && <><div className={styles.radioHero}><MusicVisual compact /><div className={styles.radioNow}><span className={styles.eyebrow}>ON AIR · SEDANG DIPUTAR</span><h3>{song.title}</h3><p>{song.artist} <span>· disetel MellowPotato</span></p><Controls playing={playing} setPlaying={setPlaying} next={next} /></div><div className={styles.radioWave} aria-hidden="true">▂▅▃▇▄▆▂▅▇▃▆▂▇▄▅▃▆▂▇▄</div></div>
        <div className={styles.radioPeople}><Roster compact /></div><div className={styles.radioGrid}><Chat messages={messages} draft={draft} setDraft={setDraft} send={send} /><Queue active={active} setActive={setActive} /></div>
      </>}
    </div>
    <div className={styles.footnote}><span>Mana yang paling terasa seperti Synora?</span><strong>Pilih A, B, atau C — detailnya bisa kita gabungkan setelah itu.</strong><ArrowRight size={20} /></div>
  </main>;
}
