"use client";
import { useEffect, useRef, useState } from "react";
import { Users } from "lucide-react";
import { presenceSchema } from "@/lib/domain";
import { db } from "@/lib/supabase";
// Subscribe only while a card is visible; never announce directory visitors as room participants.
export function LiveCount({ roomId }: { roomId: string }) {
  const el = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!el.current) return;
    const observer = new IntersectionObserver(
      ([e]) => setVisible(e.isIntersecting),
      { rootMargin: "50px" },
    );
    observer.observe(el.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    const ch = db()
      .channel(`room:${roomId}`, { config: { private: true } })
      .on("presence", { event: "sync" }, () => {
        if (!alive) return;
        const ids = new Set(
          Object.values(ch.presenceState())
            .flat()
            .flatMap((p) => {
              const parsed = presenceSchema.safeParse(p);
              return parsed.success ? [parsed.data.user_id] : [];
            }),
        );
        setCount(ids.size);
      })
      .subscribe();
    return () => {
      alive = false;
      void db().removeChannel(ch);
    };
  }, [roomId, visible]);
  return (
    <span ref={el} className="flex items-center gap-1 text-xs">
      <Users size={13} />
      {count === null
        ? "Drop in & tune in"
        : `${count} ${count === 1 ? "friend" : "friends"} online`}
    </span>
  );
}
