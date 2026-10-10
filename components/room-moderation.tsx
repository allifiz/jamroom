"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { db } from "@/lib/supabase";
import type { Member, Room } from "@/lib/domain";
import { Button } from "./ui/button";
type Restriction = {
  user_id: string;
  action: string;
  expires_at: string | null;
  profiles: { display_name: string } | null;
};

export function RoomModeration({
  room,
  members,
  notify,
}: {
  room: Room;
  members: Member[];
  notify: () => Promise<void>;
}) {
  const [restrictions, setRestrictions] = useState<Restriction[]>([]);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    void db()
      .from("room_restrictions")
      .select("user_id,action,expires_at,profiles(display_name)")
      .eq("room_id", room.id)
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) toast.error(error.message);
        else
          setRestrictions(
            (data as unknown as Restriction[]).filter(
              (b) => !b.expires_at || Date.parse(b.expires_at) > Date.now(),
            ),
          );
      });
    return () => {
      alive = false;
    };
  }, [room.id, revision]);
  async function act(action: string, user?: string) {
    setBusy(true);
    try {
      const { error } = await db().rpc("moderate_room", {
        p_room: room.id,
        p_action: action,
        p_user: user ?? null,
      });
      if (error) throw error;
      await notify();
      setRevision((v) => v + 1);
      toast.success(
        action === "rotate_invite"
          ? "New invitation ready. Old links no longer admit new participants."
          : "Moderation saved.",
      );
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings" aria-label="Room moderation">
      <h3>Room moderation</h3>
      <p className="small muted">
        Kick removes access for 5 minutes. Ban blocks this account until you
        restore access. Guests can create a new identity, so bans are account
        based.
      </p>
      {members
        .filter((m) => m.user_id !== room.owner_id)
        .map((m) => (
          <div className="settings small" key={m.user_id}>
            <strong>{m.profiles?.display_name ?? "Friend"}</strong>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (confirm("Remove this participant for 5 minutes?"))
                    void act("kick", m.user_id);
                }}
              >
                Kick
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (confirm("Ban this account from the room?"))
                    void act("ban", m.user_id);
                }}
              >
                Ban
              </Button>
            </div>
          </div>
        ))}
      {restrictions.map((b) => (
        <div className="flex items-center gap-2 small" key={b.user_id}>
          <span>
            {b.profiles?.display_name ?? "Friend"} ·{" "}
            {b.action === "ban" ? "Banned" : "Kicked for 5 minutes"}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void act("unban", b.user_id)}
          >
            Restore access
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => {
          if (
            confirm(
              "Replace the invitation link? Existing members keep access; old links cannot admit new members.",
            )
          )
            void act("rotate_invite");
        }}
      >
        Reset invite link
      </Button>
    </section>
  );
}
