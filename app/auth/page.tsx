"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { db, configured } from "@/lib/supabase";
import { SetupNotice } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/providers";
export default function Auth() {
  const router = useRouter();
  const { user } = useAuth();
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!configured) return <SetupNotice />;
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email"));
    const password = String(f.get("password"));
    try {
      if (register) {
        const options = {
          data: { display_name: String(f.get("name")) },
          emailRedirectTo: location.origin + "/dashboard",
        };
        const result = user?.is_anonymous
          ? await db().auth.updateUser(
              { email, password, data: options.data },
              { emailRedirectTo: options.emailRedirectTo },
            )
          : await db().auth.signUp({ email, password, options });
        if (result.error) throw result.error;
        if (user?.is_anonymous) {
          const { error: profileError } = await db()
            .from("profiles")
            .update({ display_name: String(f.get("name")).trim() })
            .eq("id", user.id);
          if (profileError) toast.error(profileError.message);
        }
        toast.success(
          "Account saved! Check your email if confirmation is enabled.",
        );
        if ("session" in result.data && result.data.session)
          router.push("/dashboard");
      } else {
        const { error } = await db().auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        router.push("/dashboard");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="container">
      <form onSubmit={submit} className="panel form bg-lavender">
        <span className="eyebrow">BACKSTAGE PASS</span>
        <h1>{register ? "Make yourself at home." : "Hey, welcome back."}</h1>
        <p>Your rooms, your friends, your very specific music taste.</p>
        <div className="auth-tabs">
          <Button
            type="button"
            variant={!register ? "default" : "outline"}
            onClick={() => setRegister(false)}
          >
            Sign in
          </Button>
          <Button
            type="button"
            variant={register ? "default" : "outline"}
            onClick={() => setRegister(true)}
          >
            Register
          </Button>
        </div>
        {register && (
          <label>
            Display name
            <input
              name="name"
              required
              maxLength={40}
              autoComplete="nickname"
            />
          </label>
        )}
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete={register ? "new-password" : "current-password"}
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <Button disabled={busy}>
          {busy
            ? "Getting your pass…"
            : register
              ? "Create account"
              : "Let me in"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={async () => {
            const email = prompt("Email for your password reset link");
            if (!email) return;
            const { error } = await db().auth.resetPasswordForEmail(email, {
              redirectTo: location.origin + "/profile",
            });
            if (error) toast.error(error.message);
            else toast.success("Check your email for the reset link.");
          }}
        >
          Forgot password?
        </Button>
      </form>
    </main>
  );
}
