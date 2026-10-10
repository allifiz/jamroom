"use client";
import { useEffect, useRef, useState } from "react";
import { Users } from "lucide-react";
import { watchRoomCount } from "@/lib/room-count";
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
    return watchRoomCount(roomId, setCount);
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
