"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Disc3, Share2, Send, Users, Radio } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "./providers";
import { db, configured } from "@/lib/supabase";
import { useRoom } from "@/lib/use-room";
import { permissions } from "@/lib/domain";
import { Button } from "./ui/button";
import { SetupNotice } from "./shell";
import { YoutubePlayer } from "./youtube-player";
import { Queue } from "./queue";
import { RoomSettings } from "./room-settings";
export function RoomClient({ slug }: { slug: string }) {
  const { user, guest, loading } = useAuth();
  const params = useSearchParams();
  const invite = params.get("invite");
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [confetti, setConfetti] = useState(false);
  const r = useRoom(slug, user?.id ?? null, invite);
  useEffect(() => {
    if (params.get("created")) {
      setConfetti(true);
      const t = setTimeout(() => setConfetti(false), 2000);
      return () => clearTimeout(t);
    }
  }, [params]);
  if (!configured) return <SetupNotice />;
  if (loading)
    return (
      <main className="container">
        <div className="skeleton" />
      </main>
    );
  if (!user)
    return (
      <main className="container">
        <form
          className="panel join-gate bg-blue"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await guest(nickname);
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <span className="eyebrow">THE DOOR IS OPEN</span>
          <h1 className="text-3xl">What should we call you?</h1>
          <p>
            Grab a nickname and join the room. Guest accounts can listen;
            permanent accounts own rooms.
          </p>
          <label>
            Nickname
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              required
              maxLength={40}
            />
          </label>
          <Button disabled={busy}>Join as guest ↗</Button>
          <Link href="/auth" className="underline small">
            Already have an account? Sign in
          </Link>
        </form>
      </main>
    );
  if (r.error)
    return (
      <main className="container">
        <div className="panel empty">
          <h1>This door needs a key.</h1>
          <p role="alert">{r.error}</p>
          <p className="muted">
            For a private room, ask a member for the full invitation link.
          </p>
          <Button asChild>
            <Link href="/dashboard">Back to the rooms</Link>
          </Button>
        </div>
      </main>
    );
  if (!r.room)
    return (
      <main className="container">
        <div className="skeleton" />
      </main>
    );
  const room = r.room;
  const member = r.members.find((m) => m.user_id === user.id);
  const can = permissions(room, user.id, member);
  const current = r.tracks.find((t) => t.id === r.state?.current_track_id);
  async function share() {
    const url = `${location.origin}/room/${room.slug}${room.visibility === "private" ? `?invite=${room.invite_code}` : ""}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Invite copied. Send it to your people.");
    } catch {
      prompt("Copy this room invitation", url);
    }
  }
  return (
    <main className="room-layout">
      {confetti && (
        <div className="confetti" aria-hidden="true">
          {Array.from({ length: 24 }, (_, i) => (
            <i
              key={i}
              style={{
                background: ["#ff90e8", "#ffe66d", "#75c7ff"][i % 3],
                animationDelay: `${(i % 5) * 0.1}s`,
              }}
            />
          ))}
        </div>
      )}
      <aside className="room-sidebar">
        <div>
          <Link href="/dashboard" className="eyebrow mb-5">
            <ArrowLeft size={14} />
            ALL ROOMS
          </Link>
          <div
            className="panel room-side-art mb-5"
            style={{
              background: (
                {
                  pink: "#ff90e8",
                  blue: "#75c7ff",
                  yellow: "#ffe66d",
                  mint: "#a7f3d0",
                  lavender: "#c4b5fd",
                } as Record<string, string>
              )[room.cover],
            }}
          >
            <Disc3 size={57} />
          </div>
          <span className="pill bg-mint mb-3">
            {room.visibility === "public" ? "OPEN DOOR" : "INVITE ONLY"}
          </span>
          <h1>{room.name}</h1>
          <p className="muted small mt-3">
            {room.description || "Your corner of the music universe."}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-4"
            onClick={() => void share()}
          >
            <Share2 size={15} />
            Share room
          </Button>
        </div>
        <section>
          <h2 className="eyebrow mb-3">
            <Users size={15} />
            {r.people.length} {r.people.length === 1 ? "FRIEND" : "FRIENDS"}{" "}
            JAMMING
          </h2>
          {r.people.map((p) => (
            <div className="participant" key={p.user_id}>
              {p.avatar && p.avatar.startsWith("https://") ? (
                <img
                  className="avatar"
                  src={p.avatar}
                  alt=""
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="avatar bg-pink">
                  {p.name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span>
                {p.name}
                {p.user_id === user.id ? " (you)" : ""}
                {p.user_id === room.owner_id ? " ♛" : ""}
              </span>
              <span className="online-dot ml-auto" />
            </div>
          ))}
          <p className="small muted mt-3">
            {r.connection === "online"
              ? "● Room is vibing"
              : `○ ${r.connection}…`}
          </p>
        </section>
        <div className="notice">
          {can.control
            ? "You are the DJ! Take the queue for a spin."
            : "You’re here for the good vibes. A DJ handles the controls."}
        </div>
        {can.owner && (
          <RoomSettings room={room} members={r.members} notify={r.notify} />
        )}
      </aside>
      <div className="room-main">
        <YoutubePlayer
          track={current}
          state={r.state}
          listening={r.listening}
          control={can.control}
          onJoin={r.startListening}
          onLeave={() => r.setListening(false)}
          onCommand={r.command}
          serverNow={r.serverNow}
        />
        {!current && r.tracks.length > 0 && can.control && (
          <Button
            onClick={async () => {
              await r.startListening();
              await r.command("play");
            }}
          >
            Start the room’s soundtrack ♫
          </Button>
        )}
        <section className="panel bg-yellow">
          <div className="reaction-row">
            <span className="small font-bold mr-auto">FEELING THIS ONE?</span>
            {["🔥", "💖", "✨", "🙌", "🎶"].map((e) => (
              <button
                key={e}
                className="reaction"
                aria-label={`React ${e}`}
                onClick={() => r.react(e)}
              >
                {e}
              </button>
            ))}
          </div>
          {r.reaction && (
            <p className="text-center text-5xl mt-4" aria-live="polite">
              {r.reaction}
            </p>
          )}
        </section>
        <section className="panel history">
          <h2 className="eyebrow mb-3">
            <Radio size={16} />
            RECENTLY ON THE AUX
          </h2>
          {r.history.length ? (
            r.history.map((h) => (
              <p className="recent-item" key={h.id}>
                ♫ {h.title}
              </p>
            ))
          ) : (
            <p className="muted small">The soundtrack is yet to be written.</p>
          )}
        </section>
      </div>
      <div className="room-right">
        <Queue
          roomId={room.id}
          tracks={r.tracks}
          currentId={r.state?.current_track_id ?? null}
          add={can.add}
          manage={can.manage}
          control={can.control}
          notify={r.notify}
          command={r.command}
        />
        <section className="panel bg-blue">
          <div className="queue-heading">
            <h2 className="text-xl">The hangout</h2>
            <span className="pill bg-paper">ROOM CHAT</span>
          </div>
          <div className="chat-list" role="log" aria-label="Room chat">
            {r.messages.map((m) => (
              <div className="chat-message" key={m.id}>
                <strong>
                  {m.profiles?.display_name ?? "Music friend"}{" "}
                  <span className="font-normal opacity-60">
                    {new Date(m.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </strong>
                <span>{m.body}</span>
              </div>
            ))}
            {!r.messages.length && (
              <p className="muted small">Say hey. Ask who added that banger.</p>
            )}
          </div>
          <form
            className="chat-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!text.trim() || busy) return;
              setBusy(true);
              const { error } = await db().rpc("send_message", {
                p_room: room.id,
                p_body: text.trim(),
              });
              setBusy(false);
              if (error) toast.error(error.message);
              else {
                setText("");
                await r.notify();
              }
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={500}
              placeholder="Say something nice…"
              aria-label="Chat message"
              required
            />
            <Button size="icon" aria-label="Send message" disabled={busy}>
              <Send size={17} />
            </Button>
          </form>
        </section>
      </div>
    </main>
  );
}
