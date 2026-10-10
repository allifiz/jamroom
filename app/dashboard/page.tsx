"use client";
import Link from "next/link";
import { LiveCount } from "@/components/live-count";
import { useEffect, useState } from "react";
import { Disc3, ArrowUpRight, Plus, Headphones } from "lucide-react";
import { db, configured } from "@/lib/supabase";
import type { Room } from "@/lib/domain";
import { useAuth } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { SetupNotice } from "@/components/shell";
import { toast } from "sonner";
function Cards({ rooms }: { rooms: Room[] }) {
  return (
    <div className="room-grid">
      {rooms.map((r) => (
        <Link href={`/room/${r.slug}`} className="panel room-card" key={r.id}>
          <div
            className={`room-art bg-${r.cover}`}
            style={{
              background: (
                {
                  pink: "#ff90e8",
                  blue: "#75c7ff",
                  mint: "#a7f3d0",
                  yellow: "#ffe66d",
                  lavender: "#c4b5fd",
                } as Record<string, string>
              )[r.cover],
            }}
          >
            <span className="pill">
              {r.visibility === "private" ? "INVITE ONLY" : "OPEN DOOR"}
            </span>
            <Disc3 />
          </div>
          <div className="room-card-copy">
            <h3>{r.name}</h3>
            <p className="muted">
              {r.description || "Good tracks. Better company."}
            </p>
            <span className="flex justify-between text-xs font-bold">
              <LiveCount roomId={r.id} />
              <ArrowUpRight size={17} />
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
export default function Dashboard() {
  const { user, guest, loading } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [visited, setVisited] = useState<Room[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!configured || loading) return;
    let alive = true;
    (async () => {
      try {
        const u = user ?? (await guest("Music friend"));
        const { data, error } = await db()
          .from("rooms")
          .select("*")
          .order("updated_at", { ascending: false })
          .limit(100);
        if (error) throw error;
        const { data: membership, error: me } = await db()
          .from("room_members")
          .select("room_id")
          .eq("user_id", u.id)
          .order("joined_at", { ascending: false })
          .limit(12);
        if (me) throw me;
        if (alive) {
          setRooms(data ?? []);
          setVisited(
            (data ?? []).filter((r) =>
              membership?.some((m) => m.room_id === r.id),
            ),
          );
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setFetching(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [user, loading, guest]);
  if (!configured) return <SetupNotice />;
  const mine = rooms.filter((r) => r.owner_id === user?.id);
  return (
    <main className="container">
      <div className="section-head">
        <div>
          <p className="eyebrow">FIND YOUR FREQUENCY</p>
          <h1 className="page-title">The room directory.</h1>
          <p className="muted">Every door opens to a different soundtrack.</p>
        </div>
        <Button asChild>
          <Link href="/create">
            <Plus size={18} />
            New room
          </Link>
        </Button>
      </div>
      <form
        className="flex gap-3 mb-10"
        onSubmit={(e) => {
          e.preventDefault();
          const raw = String(new FormData(e.currentTarget).get("room")).trim();
          try {
            const path = raw.startsWith("http")
              ? new URL(raw).pathname + new URL(raw).search
              : "/room/" + raw;
            if (!path.startsWith("/room/")) throw new Error();
            location.assign(path);
          } catch {
            toast.error("Paste a room slug or JAMROOM invite URL.");
          }
        }}
      >
        <input
          name="room"
          placeholder="Have an invite? Paste the room link or slug"
          required
          aria-label="Room invite"
        />
        <Button variant="outline">Join room ↗</Button>
      </form>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {fetching ? (
        <div className="feature-grid">
          {[1, 2, 3].map((i) => (
            <div className="skeleton" key={i} />
          ))}
        </div>
      ) : (
        <>
          <h2 className="text-2xl">
            My rooms <span className="small">({mine.length})</span>
          </h2>
          {mine.length ? (
            <Cards rooms={mine} />
          ) : (
            <div className="panel empty my-5">
              <Headphones size={32} />
              <p>Your personal corner of the internet starts here.</p>
              <Button asChild>
                <Link href="/create">Create your first room</Link>
              </Button>
            </div>
          )}
          {visited.length > 0 && (
            <>
              <h2 className="text-2xl">Recently joined</h2>
              <Cards rooms={visited} />
            </>
          )}
          <h2 className="text-2xl">
            Open doors <span className="small">PUBLIC ROOMS</span>
          </h2>
          {rooms.some((r) => r.visibility === "public") ? (
            <Cards rooms={rooms.filter((r) => r.visibility === "public")} />
          ) : (
            <div className="panel empty my-5">
              <Disc3 size={34} />
              <h3>A quiet moment before the music.</h3>
              <p className="muted">No public rooms yet. Make the first one.</p>
            </div>
          )}
        </>
      )}
    </main>
  );
}
