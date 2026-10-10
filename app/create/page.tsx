"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { db, configured } from "@/lib/supabase";
import { roomSchema } from "@/lib/domain";
import { useAuth } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { SetupNotice } from "@/components/shell";
export default function Create() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!configured) return <SetupNotice />;
  if (loading)
    return (
      <main className="container">
        <div className="skeleton" />
      </main>
    );
  if (!user || user.is_anonymous)
    return (
      <main className="container">
        <div className="panel form">
          <h1>A room needs a forever owner.</h1>
          <p>
            Sign in or upgrade your guest account to keep control of your rooms
            after you log off.
          </p>
          <Button asChild>
            <Link href="/auth">Get your backstage pass</Link>
          </Button>
        </div>
      </main>
    );
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const f = new FormData(e.currentTarget);
      const v = roomSchema.parse(Object.fromEntries(f));
      const { data, error } = await db().rpc("create_room", {
        p_name: v.name,
        p_description: v.description,
        p_visibility: v.visibility,
        p_cover: v.cover,
      });
      if (error) throw error;
      toast.success("Your little music universe is open!");
      router.push(`/room/${data.slug}?created=1`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="container">
      <form className="panel form bg-yellow" onSubmit={submit}>
        <span className="eyebrow">A NEW FREQUENCY</span>
        <h1>Make room for your people.</h1>
        <label>
          Room name
          <input
            name="name"
            placeholder="The late night listening club"
            maxLength={80}
            required
          />
        </label>
        <label>
          Description
          <textarea
            name="description"
            placeholder="What’s the vibe?"
            maxLength={500}
            rows={3}
          />
        </label>
        <label>
          Who can drop in?
          <select name="visibility">
            <option value="public">Public · discoverable by everyone</option>
            <option value="private">Private · invitation required</option>
          </select>
        </label>
        <label>
          Pick your room’s color
          <select name="cover">
            <option value="pink">Bubblegum pink</option>
            <option value="blue">Electric blue</option>
            <option value="mint">Mint green</option>
            <option value="yellow">Butter yellow</option>
            <option value="lavender">Lavender</option>
          </select>
        </label>
        <p className="small">
          By default, friends can add songs and control playback. Only you can
          remove or reorder. Change this in room settings.
        </p>
        <Button disabled={busy}>
          {busy ? "Building your hangout…" : "Open my room ↗"}
        </Button>
      </form>
    </main>
  );
}
