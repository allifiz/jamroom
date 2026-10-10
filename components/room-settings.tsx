"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { db } from "@/lib/supabase";
import type { Room, Member } from "@/lib/domain";
import { Button } from "./ui/button";
import { RoomModeration } from "./room-moderation";
export function RoomSettings({
  room,
  members,
  notify,
}: {
  room: Room;
  members: Member[];
  notify: () => Promise<void>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <details className="panel settings">
      <summary>Room settings ⚙</summary>
      <form
        className="settings mt-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const f = new FormData(e.currentTarget);
          const { error } = await db()
            .from("rooms")
            .update({
              name: String(f.get("name")),
              description: String(f.get("description")),
              visibility: String(f.get("visibility")),
              cover: String(f.get("cover")),
              allow_add: f.has("allow_add"),
              allow_manage: f.has("allow_manage"),
              allow_control: f.has("allow_control"),
              ...(process.env.NEXT_PUBLIC_ROOM_ENHANCEMENTS === "true"
                ? { enhancements_enabled: f.has("enhancements_enabled") }
                : {}),
              updated_at: new Date().toISOString(),
            })
            .eq("id", room.id);
          setBusy(false);
          if (error) toast.error(error.message);
          else {
            await notify();
            toast.success("Room settings saved.");
          }
        }}
      >
        <label>
          Name
          <input name="name" defaultValue={room.name} maxLength={80} required />
        </label>
        <label>
          Description
          <textarea
            name="description"
            defaultValue={room.description}
            maxLength={500}
          />
        </label>
        <label>
          Visibility
          <select name="visibility" defaultValue={room.visibility}>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </label>
        <label>
          Cover
          <select name="cover" defaultValue={room.cover}>
            {["pink", "yellow", "blue", "mint", "lavender"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        {[
          ["allow_add", "Friends can add songs"],
          ["allow_manage", "Friends can reorder/remove"],
          ["allow_control", "Friends can control playback"],
        ].map(([key, label]) => (
          <label className="check-label" key={key}>
            <input
              type="checkbox"
              name={key}
              defaultChecked={room[key as "allow_add"]}
            />
            {label}
          </label>
        ))}
        {process.env.NEXT_PUBLIC_ROOM_ENHANCEMENTS === "true" && (
          <label className="check-label">
            <input
              type="checkbox"
              name="enhancements_enabled"
              defaultChecked={room.enhancements_enabled}
            />
            Enable moderation and majority skip voting
          </label>
        )}
        <Button size="sm" disabled={busy}>
          Save settings
        </Button>
      </form>
      {process.env.NEXT_PUBLIC_ROOM_ENHANCEMENTS === "true" &&
        room.enhancements_enabled && (
          <RoomModeration room={room} members={members} notify={notify} />
        )}
      <p className="small font-bold">Individual DJ permissions</p>
      {members
        .filter((m) => m.user_id !== room.owner_id)
        .map((m) => (
          <div className="settings small" key={m.user_id}>
            <strong>{m.profiles?.display_name ?? "Friend"}</strong>
            {(["can_control", "can_manage"] as const).map((key) => (
              <label className="check-label" key={key}>
                <input
                  type="checkbox"
                  checked={m[key]}
                  onChange={async (e) => {
                    const { error } = await db()
                      .from("room_members")
                      .update({ [key]: e.target.checked })
                      .eq("room_id", room.id)
                      .eq("user_id", m.user_id);
                    if (error) toast.error(error.message);
                    else await notify();
                  }}
                />
                {key === "can_control" ? "DJ controls" : "Manage queue"}
              </label>
            ))}
          </div>
        ))}
      <Button
        size="sm"
        variant="outline"
        className="text-red-700"
        onClick={async () => {
          if (
            !confirm(
              `Permanently delete “${room.name}” and its playlist? This cannot be undone.`,
            )
          )
            return;
          const { error } = await db().from("rooms").delete().eq("id", room.id);
          if (error) toast.error(error.message);
          else {
            await notify();
            toast.success("Room deleted.");
            router.push("/dashboard");
          }
        }}
      >
        Delete this room
      </Button>
    </details>
  );
}
