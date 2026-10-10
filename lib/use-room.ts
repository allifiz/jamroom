"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { toast } from "sonner";
import { db } from "./supabase";
import {
  acceptState,
  presenceSchema,
  type Room,
  type Track,
  type Playback,
  type Member,
  type Message,
} from "./domain";
export type Person = { user_id: string; name: string; avatar: string | null };
export function useRoom(
  slug: string,
  userId: string | null,
  invite: string | null,
) {
  const [room, setRoom] = useState<Room | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [state, setState] = useState<Playback | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [history, setHistory] = useState<{ id: string; title: string }[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [connection, setConnection] = useState("connecting");
  const [error, setError] = useState("");
  const [reaction, setReaction] = useState("");
  const [votes, setVotes] = useState<{
    votes: number;
    required: number;
    eligible: number;
    has_voted: boolean;
  } | null>(null);
  const [listening, setListening] = useState(false);
  const offset = useRef(0);
  const current = useRef<Playback | null>(null);
  const channel = useRef<RealtimeChannel | null>(null);
  const tab = useRef<string>("");
  const busy = useRef(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const refreshSequence = useRef(0);
  const localReaction = useRef<ReturnType<typeof setTimeout> | null>(null);
  const adopt = useCallback(
    (snapshot: { state: Playback; server_time: string }) => {
      if (!mounted.current) return;
      offset.current = Date.parse(snapshot.server_time) - Date.now();
      if (snapshot.state && acceptState(current.current, snapshot.state)) {
        current.current = snapshot.state;
        setState(snapshot.state);
      }
    },
    [],
  );
  const refresh = useCallback(
    async (rid: string) => {
      const revision = generation.current;
      const sequence = ++refreshSequence.current;
      const results = await Promise.all([
        db()
          .from("playlist_items")
          .select("*")
          .eq("room_id", rid)
          .order("position"),
        db()
          .from("room_members")
          .select(
            "user_id,can_manage,can_control,profiles(display_name,avatar_url)",
          )
          .eq("room_id", rid),
        db()
          .from("room_messages")
          .select("*,profiles(display_name)")
          .eq("room_id", rid)
          .order("created_at", { ascending: false })
          .limit(100),
        db()
          .from("playback_history")
          .select("id,title")
          .eq("room_id", rid)
          .order("played_at", { ascending: false })
          .limit(12),
        db().rpc("playback_snapshot", { p_room: rid }),
        db().from("rooms").select("*").eq("id", rid).single(),
        ...(process.env.NEXT_PUBLIC_ROOM_ENHANCEMENTS === "true"
          ? [db().rpc("skip_vote_status", { p_room: rid })]
          : []),
      ]);
      if (
        !mounted.current ||
        revision !== generation.current ||
        sequence !== refreshSequence.current
      )
        return;
      if (results[5].error?.code === "PGRST116") {
        setError("This room was deleted or your access has changed.");
        setListening(false);
        if (channel.current) {
          void db().removeChannel(channel.current);
          channel.current = null;
        }
        return;
      }
      const fail = results.find((r) => r.error);
      if (fail?.error) throw fail.error;
      if (!mounted.current) return;
      setTracks(results[0].data ?? []);
      setMembers(results[1].data as unknown as Member[]);
      setMessages((results[2].data as unknown as Message[]).reverse());
      setHistory(results[3].data ?? []);
      adopt(results[4].data);
      setRoom(results[5].data);
      if (results[6]) setVotes(results[6].data);
    },
    [adopt],
  );
  useEffect(() => {
    if (!userId) return;
    mounted.current = true;
    generation.current += 1;
    current.current = null;
    setState(null);
    setRoom(null);
    setTracks([]);
    setPeople([]);
    setListening(false);
    tab.current = crypto.randomUUID();
    let alive = true;
    let ch: RealtimeChannel | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let accessTimer: ReturnType<typeof setInterval> | null = null;
    let reactionTimer: ReturnType<typeof setTimeout> | null = null;
    setError("");
    (async () => {
      try {
        const { data: r, error } = await db().rpc("join_room", {
          p_slug: slug,
          p_invite: invite,
        });
        if (error) throw error;
        if (!alive) return;
        setRoom(r);
        await refresh(r.id);
        if (!alive) return;
        accessTimer = setInterval(() => {
          void refresh(r.id).catch((e) => {
            if (alive) toast.error(e.message);
          });
        }, 15000);
        const { data: profile } = await db()
          .from("profiles")
          .select("display_name,avatar_url")
          .eq("id", userId)
          .single();
        await db().realtime.setAuth();
        if (!alive) return;
        const schedule = () => {
          if (refreshTimer) clearTimeout(refreshTimer);
          refreshTimer = setTimeout(() => {
            refresh(r.id).catch((e) => {
              if (alive) toast.error(e.message);
            });
          }, 120);
        };
        ch = db().channel(`room:${r.id}`, {
          config: { private: true, presence: { key: tab.current } },
        });
        channel.current = ch;
        ch.on("broadcast", { event: "refresh" }, schedule)
          .on("broadcast", { event: "reaction" }, ({ payload }) => {
            if (
              alive &&
              ["🔥", "💖", "✨", "🙌", "🎶"].includes(payload?.emoji)
            ) {
              setReaction(payload.emoji);
              if (reactionTimer) clearTimeout(reactionTimer);
              reactionTimer = setTimeout(() => setReaction(""), 2200);
            }
          })
          .on("presence", { event: "sync" }, () => {
            if (!alive || !ch) return;
            const all = Object.values(ch.presenceState())
              .flat()
              .flatMap((raw) => {
                const parsed = presenceSchema.safeParse(raw);
                return parsed.success ? [parsed.data] : [];
              });
            const unique = new Map(all.map((p) => [p.user_id, p]));
            setPeople([...unique.values()]);
          })
          .subscribe(async (status) => {
            if (!alive) return;
            setConnection(
              status === "SUBSCRIBED"
                ? "online"
                : status === "CHANNEL_ERROR" || status === "TIMED_OUT"
                  ? "reconnecting"
                  : "connecting",
            );
            if (status === "SUBSCRIBED") {
              await ch?.track({
                user_id: userId,
                name: profile?.display_name ?? "Music friend",
                avatar: profile?.avatar_url ?? null,
              });
              refresh(r.id).catch((e) => toast.error(e.message));
            }
          });
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
      mounted.current = false;
      if (accessTimer) clearInterval(accessTimer);
      if (refreshTimer) clearTimeout(refreshTimer);
      if (reactionTimer) clearTimeout(reactionTimer);
      if (localReaction.current) clearTimeout(localReaction.current);
      if (ch) void db().removeChannel(ch);
      channel.current = null;
    };
  }, [slug, userId, invite, refresh]);
  const roomId = room?.id;
  useEffect(() => {
    if (!listening || !roomId) return;
    const rid = roomId;
    const leaseTab = tab.current;
    const heartbeat = async () => {
      const { data, error } = await db().rpc("listener_heartbeat", {
        p_room: rid,
        p_tab: leaseTab,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      adopt(data);
    };
    void heartbeat();
    const timer = setInterval(heartbeat, 20000);
    const resume = () => {
      if (document.visibilityState === "visible") void heartbeat();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      void db().rpc("listener_heartbeat", {
        p_room: rid,
        p_tab: leaseTab,
        p_leave: true,
      });
    };
  }, [listening, roomId, adopt]);
  const notify = useCallback(async () => {
    if (room) {
      await channel.current?.send({
        type: "broadcast",
        event: "refresh",
        payload: {},
      });
      await refresh(room.id);
    }
  }, [room, refresh]);
  const command = useCallback(
    async (
      action: string,
      extra: Record<string, unknown> = {},
      expectedVersion?: number,
    ) => {
      if (!room || !current.current || busy.current) return;
      busy.current = true;
      try {
        const { data, error } = await db().rpc("playback_command", {
          p_room: room.id,
          p_version: expectedVersion ?? current.current.state_version,
          p_action: action,
          ...extra,
        });
        if (error) throw error;
        adopt(data);
        if (data.conflict && action !== "ended")
          toast.info("Another DJ got there first. State refreshed.");
        await channel.current?.send({
          type: "broadcast",
          event: "refresh",
          payload: {},
        });
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        busy.current = false;
      }
    },
    [room, adopt],
  );
  const startListening = async () => {
    if (!room) return;
    const { data, error } = await db().rpc("listener_heartbeat", {
      p_room: room.id,
      p_tab: tab.current,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    adopt(data);
    setListening(true);
  };
  return {
    room,
    votes,
    voteSkip: async () => {
      if (!room || !current.current) return;
      const { data, error } = await db().rpc("vote_skip", {
        p_room: room.id,
        p_version: current.current.state_version,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      adopt(data);
      toast.info(
        data.conflict
          ? "The track changed. Vote again for the current track."
          : data.skipped
            ? "Majority reached. Next track!"
            : "Your skip vote is counted.",
      );
      await refresh(room.id);
    },
    tracks,
    state,
    members,
    messages,
    history,
    people,
    connection,
    error,
    reaction,
    listening,
    setListening,
    startListening,
    command,
    notify,
    serverNow: () => Date.now() + offset.current,
    react: (emoji: string) => {
      setReaction(emoji);
      if (localReaction.current) clearTimeout(localReaction.current);
      localReaction.current = setTimeout(() => setReaction(""), 2200);
      void channel.current?.send({
        type: "broadcast",
        event: "reaction",
        payload: { emoji },
      });
    },
  };
}
