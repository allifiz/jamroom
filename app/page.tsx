"use client";
import Link from "next/link";
import { motion } from "motion/react";
import {
  ArrowUpRight,
  Headphones,
  Radio,
  ListMusic,
  Users,
  Play,
  SkipForward,
  Heart,
  Disc3,
  CornerDownLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
export default function Home() {
  return (
    <main>
      <section className="hero">
        <div>
          <span className="pill bg-mint">
            <span className="online-dot" /> YOUR INTERNET HANGOUT, REMIXED
          </span>
          <h1>
            Your friends.
            <br />
            Your music.
            <br />
            <span className="highlight">Same frequency.</span>
          </h1>
          <p className="hero-copy">
            A little room for your big music taste. Drop a track, grab your
            friends, and make the internet feel a little more together.
          </p>
          <div className="hero-actions">
            <Button asChild>
              <Link href="/create">
                Make a room <ArrowUpRight size={20} />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/dashboard">
                <Headphones size={19} />
                Find your people
              </Link>
            </Button>
          </div>
          <div className="tiny-friends">
            <div className="avatar-stack">
              {["✿", "☺", "★", "♫"].map((x, i) => (
                <span
                  className={`avatar ${["bg-pink", "bg-blue", "bg-mint", "bg-yellow"][i]}`}
                  key={x}
                >
                  {x}
                </span>
              ))}
            </div>
            <span>No downloads. Just good company.</span>
          </div>
        </div>
        <motion.div
          className="hero-scene"
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <span className="sticker top">♪ your vibe lives here</span>
          <span className="star">✦</span>
          <div className="radio-box">
            <div className="radio-top">
              <span>THE GOOD VIBES CLUB</span>
              <span className="pill bg-mint">
                <Radio size={12} /> TOGETHER
              </span>
            </div>
            <div className="radio-display">
              <div className="vinyl">
                <span className="vinyl-center" />
              </div>
              <span className="absolute bottom-3 right-3 text-xs font-bold">
                SIDE A · FRIENDSHIP
              </span>
            </div>
            <div className="radio-bottom">
              <div>
                <strong>Pass the aux.</strong>
                <p className="small mt-1">Everyone gets a turn.</p>
              </div>
              <div className="wave" aria-label="Decorative music animation">
                {Array.from({ length: 8 }, (_, i) => (
                  <i key={i} />
                ))}
              </div>
            </div>
            <div className="flex items-center justify-center gap-5 mt-5">
              <Heart size={20} />
              <SkipForward className="rotate-180" size={20} />
              <Link
                href="/dashboard"
                className="button button-icon bg-paper"
                aria-label="Explore music rooms"
              >
                <Play size={20} />
              </Link>
              <SkipForward size={20} />
              <ListMusic size={20} />
            </div>
          </div>
          <span className="sticker bottom">STAY A WHILE. STAY IN SYNC.</span>
        </motion.div>
      </section>
      <div className="marquee">
        GOOD TRACKS ✳ GREAT FRIENDS ✳ ZERO DISTANCE ✳ YOUR OWN LITTLE MUSIC
        UNIVERSE ✳
      </div>
      <section className="container">
        <div className="section-head">
          <div>
            <p className="eyebrow mb-3">LESS SCROLLING. MORE LISTENING.</p>
            <h2>A hangout with a soundtrack.</h2>
          </div>
          <CornerDownLeft className="hidden sm:block" size={40} />
        </div>
        <div className="feature-grid">
          {[
            {
              icon: Radio,
              title: "Your room. Your rules.",
              text: "Make a permanent space for your people. Public for new friends, private for your inner circle.",
              color: "bg-blue",
            },
            {
              icon: ListMusic,
              title: "One queue. All the taste.",
              text: "Paste a YouTube link and pass the aux. Your playlist stays, even when everyone heads out.",
              color: "bg-pink",
            },
            {
              icon: Users,
              title: "Miles apart. Beats together.",
              text: "Shared playback, live chat, and little reactions. Press join and find your frequency.",
              color: "bg-mint",
            },
          ].map((f, i) => (
            <article className={`panel feature ${f.color}`} key={f.title}>
              <span className="number">0{i + 1} /</span>
              <div className="feature-icon">
                <f.icon />
              </div>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </article>
          ))}
        </div>
        <div className="panel cta-panel">
          <div>
            <p className="eyebrow mb-2">
              <Disc3 size={16} /> THE AUX IS YOURS
            </p>
            <h2>Start something worth listening to.</h2>
          </div>
          <Button asChild variant="outline">
            <Link href="/create">
              Let’s jam <ArrowUpRight size={20} />
            </Link>
          </Button>
        </div>
        <p className="muted text-center mt-6 text-xs">
          Music plays through the official YouTube player. Your room lives on,
          even when you log off.
        </p>
      </section>
    </main>
  );
}
