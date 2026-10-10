"use client";
import Link from "next/link";
import { Disc3, ArrowUpRight, UserRound, Radio } from "lucide-react";
import { useAuth } from "./providers";
import { Button } from "./ui/button";
export function Header() {
  const { user } = useAuth();
  return (
    <header className="header">
      <Link className="brand" href="/">
        <span className="brand-icon">
          <Disc3 size={27} />
        </span>
        jamroom<span className="brand-dot">✳</span>
      </Link>
      <nav>
        <Link href="/dashboard" className="nav-link">
          <Radio size={17} />
          The rooms
        </Link>
        <Button asChild variant="outline" size="sm">
          <Link
            aria-label={user ? "My profile" : "Sign in"}
            href={user ? "/profile" : "/auth"}
          >
            <UserRound size={17} />
            <span>{user ? "My profile" : "Sign in"}</span>
          </Link>
        </Button>
        <Button asChild size="sm">
          <Link href="/create">
            Create room <ArrowUpRight size={18} />
          </Link>
        </Button>
      </nav>
    </header>
  );
}
export function SetupNotice() {
  return (
    <div className="panel setup">
      <h2>Plug in your backstage.</h2>
      <p>
        This app needs Supabase to save rooms, authenticate friends, and sync
        music. No pretend rooms here.
      </p>
      <p>
        Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then
        apply the SQL migration. Full instructions are in README.md.
      </p>
      <Button asChild>
        <Link href="/">Back to the good vibes</Link>
      </Button>
    </div>
  );
}
export function Footer() {
  return (
    <footer>
      <span>© JAMROOM · Good music. Better company.</span>
      <span>Made for your internet friends. ✳</span>
    </footer>
  );
}
