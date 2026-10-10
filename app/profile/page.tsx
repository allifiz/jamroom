"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { db, configured } from "@/lib/supabase";
import { useAuth } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { SetupNotice } from "@/components/shell";
export default function Profile() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("");
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  useEffect(() => {
    if (user && configured)
      db()
        .from("profiles")
        .select("display_name,avatar_url")
        .eq("id", user.id)
        .single()
        .then(({ data, error }) => {
          if (error) toast.error(error.message);
          if (data) {
            setName(data.display_name);
            setAvatar(data.avatar_url ?? "");
          }
        });
  }, [user]);
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
        <Button asChild>
          <Link href="/auth">Sign in to edit your profile</Link>
        </Button>
      </main>
    );
  return (
    <main className="container">
      <form
        className="panel form bg-mint"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const { error } = await db()
            .from("profiles")
            .update({
              display_name: name,
              avatar_url: avatar || null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", user.id);
          setBusy(false);
          if (error) toast.error(error.message);
          else toast.success("Looking good!");
        }}
      >
        <span className="eyebrow">YOUR BACKSTAGE</span>
        <h1>A face for the frequency.</h1>
        <span className="avatar w-16 h-16 text-2xl">
          {name.slice(0, 1).toUpperCase() || "☺"}
        </span>
        <label>
          Display name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={40}
          />
        </label>
        <label>
          Avatar URL
          <input
            value={avatar}
            onChange={(e) => setAvatar(e.target.value)}
            type="url"
            placeholder="https://…"
          />
        </label>
        <Button disabled={busy}>Save profile</Button>
        {user.is_anonymous && (
          <Button asChild variant="outline">
            <Link href="/auth">Make your guest account permanent</Link>
          </Button>
        )}
        {!user.is_anonymous && (
          <details className="settings">
            <summary>Change password</summary>
            <label className="mt-3">
              New password
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
              />
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || password.length < 8}
              onClick={async () => {
                setBusy(true);
                const { error } = await db().auth.updateUser({ password });
                setBusy(false);
                if (error) toast.error(error.message);
                else {
                  setPassword("");
                  toast.success("Password updated.");
                }
              }}
            >
              Update password
            </Button>
          </details>
        )}
        <Button asChild variant="outline">
          <Link href="/dashboard">My rooms ↗</Link>
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={async () => {
            await db().auth.signOut();
            router.push("/");
          }}
        >
          Sign out
        </Button>
      </form>
    </main>
  );
}
