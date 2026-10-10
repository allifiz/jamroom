import { RealtimeClient, type RealtimeChannel } from "@supabase/supabase-js";
import { db } from "./supabase";
import { presenceSchema } from "./domain";

type Entry = {
  listeners: Set<(count: number) => void>;
  count: number | null;
  channel?: RealtimeChannel;
  cleanup?: ReturnType<typeof setTimeout>;
};
const entries = new Map<string, Entry>();
let client: RealtimeClient | undefined;
let pendingRemoval: Promise<unknown> = Promise.resolve();

// Directory cards share subscriptions, separate from the room's tracked channel.
function directoryClient() {
  return (client ??= new RealtimeClient(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/realtime/v1`,
    {
      params: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
      accessToken: async () => {
        const { data } = await db().auth.getSession();
        return data.session?.access_token ?? null;
      },
    },
  ));
}

export function watchRoomCount(roomId: string, listener: (count: number) => void) {
  let entry = entries.get(roomId);
  if (!entry) {
    entry = { listeners: new Set(), count: null };
    entries.set(roomId, entry);
    const current = entry;
    void pendingRemoval.then(() => {
      if (entries.get(roomId) !== current || !current.listeners.size) return;
      const channel = directoryClient().channel(`room:${roomId}`, {
        config: { private: true },
      });
      current.channel = channel;
      channel.on("presence", { event: "sync" }, () => {
        const ids = new Set(
          Object.values(channel.presenceState()).flat().flatMap((raw) => {
            const parsed = presenceSchema.safeParse(raw);
            return parsed.success ? [parsed.data.user_id] : [];
          }),
        );
        current.count = ids.size;
        current.listeners.forEach((notify) => notify(ids.size));
      }).subscribe();
    });
  }
  clearTimeout(entry.cleanup);
  entry.listeners.add(listener);
  if (entry.count !== null) listener(entry.count);
  const current = entry;
  return () => {
    current.listeners.delete(listener);
    if (current.listeners.size) return;
    current.cleanup = setTimeout(() => {
      if (current.listeners.size) return;
      entries.delete(roomId);
      if (current.channel) {
        const removal = directoryClient().removeChannel(current.channel);
        pendingRemoval = Promise.allSettled([pendingRemoval, removal]);
      }
    }, 0);
  };
}
