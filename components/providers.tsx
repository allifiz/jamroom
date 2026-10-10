"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import type { User } from "@supabase/supabase-js";
import { db, configured } from "@/lib/supabase";
import { Toaster } from "sonner";
import { MotionConfig } from "motion/react";
const Context = createContext<{
  user: User | null;
  loading: boolean;
  guest: (name: string) => Promise<User>;
}>({
  user: null,
  loading: true,
  guest: async () => {
    throw new Error("Unavailable");
  },
});
export function Providers({ children }: { children: React.ReactNode }) {
  const guestFlight = useRef<Promise<User> | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(configured);
  useEffect(() => {
    if (!configured) return;
    let alive = true;
    db()
      .auth.getSession()
      .then(({ data }) => {
        if (alive) {
          setUser(data.session?.user ?? null);
          setLoading(false);
        }
      });
    const {
      data: { subscription },
    } = db().auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });
    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);
  const guest = useCallback(
    async (name: string) => {
      if (user) return user;
      if (guestFlight.current) return guestFlight.current;
      guestFlight.current = (async () => {
        const { data: existing } = await db().auth.getSession();
        if (existing.session?.user) return existing.session.user;
        const { data, error } = await db().auth.signInAnonymously({
          options: { data: { display_name: name.trim() || "Music friend" } },
        });
        if (error || !data.user)
          throw error ?? new Error("Guest sign-in failed");
        setUser(data.user);
        return data.user;
      })();
      try {
        return await guestFlight.current;
      } finally {
        guestFlight.current = null;
      }
    },
    [user],
  );
  return (
    <MotionConfig reducedMotion="user">
      <Context.Provider value={{ user, loading, guest }}>
        {children}
        <Toaster richColors position="bottom-center" />
      </Context.Provider>
    </MotionConfig>
  );
}
export const useAuth = () => useContext(Context);
