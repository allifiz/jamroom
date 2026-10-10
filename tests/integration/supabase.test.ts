import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const enabled = process.env.JAMROOM_LIVE_TESTS === "1" && !!url && !!key;
const videos = [
  "dQw4w9WgXcQ",
  "jNQXAC9IVRw",
  "M7lc1UVf-VE",
  "aqz-KE-bpKQ",
  "ScMzIvxBSi4",
];
describe.skipIf(!enabled)(
  "Real Supabase persistence, authority, and security",
  () => {
    let a: SupabaseClient, b: SupabaseClient, guest: SupabaseClient;
    let room: { id: string; slug: string; owner_id: string };
    let privateRoom: { id: string; slug: string; invite_code: string };
    let uidB: string;
    let ownerEmail: string, ownerPassword: string;
    const owned: string[] = [];
    beforeAll(async () => {
      const make = () =>
        createClient(url!, key!, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
      a = make();
      b = make();
      guest = make();
      ownerEmail =
        process.env.E2E_USER_A_EMAIL ?? `jamroom-a-${randomUUID()}@example.com`;
      ownerPassword = process.env.E2E_USER_A_PASSWORD ?? randomUUID() + "A!";
      const emailB =
        process.env.E2E_USER_B_EMAIL ?? `jamroom-b-${randomUUID()}@example.com`;
      const passwordB = process.env.E2E_USER_B_PASSWORD ?? randomUUID() + "B!";
      for (const [c, email, password] of [
        [a, ownerEmail, ownerPassword],
        [b, emailB, passwordB],
      ] as const) {
        const result = process.env.E2E_USER_A_EMAIL
          ? await c.auth.signInWithPassword({ email, password })
          : await c.auth.signUp({
              email,
              password,
              options: {
                data: { display_name: c === a ? "Allif test" : "Sinta test" },
              },
            });
        if (result.error) throw result.error;
        if (!result.data.session)
          throw new Error(
            "Test accounts require email confirmation. Provide confirmed E2E accounts.",
          );
      }
      uidB = (await b.auth.getUser()).data.user!.id;
      const g = await guest.auth.signInAnonymously({
        options: { data: { display_name: "Guest test" } },
      });
      if (g.error) throw g.error;
    });
    afterAll(async () => {
      for (const id of owned) await a.from("rooms").delete().eq("id", id);
      await Promise.all([
        a?.auth.signOut(),
        b?.auth.signOut(),
        guest?.auth.signOut(),
      ]);
    });
    it("creates a permanent room and rejects anonymous ownership", async () => {
      const result = await a.rpc("create_room", {
        p_name: "Persistence test",
        p_description: "Automated real DB check",
        p_visibility: "public",
        p_cover: "mint",
      });
      expect(result.error).toBeNull();
      room = result.data;
      owned.push(room.id);
      expect(room.owner_id).toBe((await a.auth.getUser()).data.user?.id);
      const g = await guest.rpc("create_room", {
        p_name: "Cannot own",
        p_description: "",
        p_visibility: "public",
        p_cover: "pink",
      });
      expect(g.error).not.toBeNull();
    });
    it("private realtime channels deliver broadcast, presence, and database changes", async () => {
      await b.rpc("join_room", { p_slug: room.slug });
      await a.realtime.setAuth();
      await b.realtime.setAuth();
      const ca = a.channel(`room:${room.id}`, {
        config: { private: true, presence: { key: "a-test" } },
      });
      const cb = b.channel(`room:${room.id}`, {
        config: { private: true, presence: { key: "b-test" } },
      });
      let broadcast = false,
        changed = false,
        present = false;
      cb.on("broadcast", { event: "reaction" }, ({ payload }) => {
        broadcast = payload.emoji === "🔥";
      });
      cb.on("broadcast", { event: "refresh" }, ({ payload }) => {
        if (payload.table === "rooms") changed = true;
      });
      cb.on("presence", { event: "sync" }, () => {
        present = Object.keys(cb.presenceState()).length > 0;
      });
      const subscribe = (c: typeof ca) =>
        new Promise<void>((resolve, reject) => {
          const t = setTimeout(
            () => reject(new Error("Realtime subscription timed out")),
            12000,
          );
          c.subscribe((status) => {
            if (status === "SUBSCRIBED") {
              clearTimeout(t);
              resolve();
            } else if (status === "CHANNEL_ERROR") {
              clearTimeout(t);
              reject(new Error("Realtime channel rejected"));
            }
          });
        });
      try {
        await Promise.all([subscribe(ca), subscribe(cb)]);
        await ca.track({
          user_id: (await a.auth.getUser()).data.user!.id,
          name: "Owner test",
        });
        await ca.send({
          type: "broadcast",
          event: "reaction",
          payload: { emoji: "🔥" },
        });
        const update = await a
          .from("rooms")
          .update({ description: "Realtime checked" })
          .eq("id", room.id);
        expect(update.error).toBeNull();
        await expect
          .poll(() => ({ broadcast, changed, present }), { timeout: 10000 })
          .toEqual({ broadcast: true, changed: true, present: true });
      } finally {
        await a.removeChannel(ca);
        await b.removeChannel(cb);
      }
    });
    it("atomically adds five tracks including concurrent additions", async () => {
      const add = (id: string) =>
        a.rpc("playlist_mutation", {
          p_room: room.id,
          p_action: "add",
          p_video: id,
          p_title: "Test " + id,
          p_thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        });
      const result = await Promise.all(videos.map(add));
      expect(result.every((r) => !r.error)).toBe(true);
      const q = await a
        .from("playlist_items")
        .select("*")
        .eq("room_id", room.id)
        .order("position");
      expect(q.data).toHaveLength(5);
      expect(new Set(q.data?.map((t) => t.position)).size).toBe(5);
      const duplicate = await add(videos[0]);
      expect(duplicate.error?.code).toBe("23505");
    });
    it("persists across client destruction and owner offline; B can play", async () => {
      await a.auth.signOut();
      const joined = await b.rpc("join_room", { p_slug: room.slug });
      expect(joined.error).toBeNull();
      const queue = await b
        .from("playlist_items")
        .select("*")
        .eq("room_id", room.id);
      expect(queue.data).toHaveLength(5);
      const tab = randomUUID();
      expect(
        (await b.rpc("listener_heartbeat", { p_room: room.id, p_tab: tab }))
          .error,
      ).toBeNull();
      const snapshot = await b.rpc("playback_snapshot", { p_room: room.id });
      const played = await b.rpc("playback_command", {
        p_room: room.id,
        p_version: snapshot.data.state.state_version,
        p_action: "play",
      });
      expect(played.error).toBeNull();
      expect(played.data.state.status).toBe("playing");
      expect(played.data.state.current_track_id).toBeTruthy();
      const auth = await a.auth.signInWithPassword({
        email: ownerEmail,
        password: ownerPassword,
      });
      expect(auth.error).toBeNull();
      expect(
        (await a.from("playlist_items").select("*").eq("room_id", room.id))
          .data,
      ).toHaveLength(5);
    });
    it("two simultaneous skips perform exactly one transition", async () => {
      const s = await a.rpc("playback_snapshot", { p_room: room.id });
      const args = {
        p_room: room.id,
        p_version: s.data.state.state_version,
        p_action: "next",
      };
      const calls = await Promise.all([
        a.rpc("playback_command", args),
        b.rpc("playback_command", args),
      ]);
      expect(calls.every((r) => !r.error)).toBe(true);
      expect(calls.filter((r) => r.data.conflict)).toHaveLength(1);
      const final = await b.rpc("playback_snapshot", { p_room: room.id });
      expect(final.data.state.state_version).toBe(
        s.data.state.state_version + 1,
      );
    });
    it("unauthorized member cannot reorder, remove, mutate state directly or escalate permissions", async () => {
      const q = await b
        .from("playlist_items")
        .select("*")
        .eq("room_id", room.id);
      const denied = await b.rpc("playlist_mutation", {
        p_room: room.id,
        p_action: "remove",
        p_item: q.data![0].id,
      });
      expect(denied.error).not.toBeNull();
      expect(
        (
          await b
            .from("room_playback_states")
            .update({ status: "stopped" })
            .eq("room_id", room.id)
        ).error,
      ).not.toBeNull();
      expect(
        (
          await b
            .from("room_members")
            .update({ can_manage: true })
            .eq("room_id", room.id)
            .eq("user_id", uidB)
            .select()
        ).data,
      ).toEqual([]);
      expect(
        (await b.from("rooms").update({ owner_id: uidB }).eq("id", room.id))
          .error,
      ).not.toBeNull();
    });
    it("simultaneous playback-end callbacks advance once", async () => {
      const q = await a
        .from("playlist_items")
        .select("id")
        .eq("room_id", room.id)
        .order("position")
        .limit(1);
      const s = await a.rpc("playback_snapshot", { p_room: room.id });
      const selected = await a.rpc("playback_command", {
        p_room: room.id,
        p_version: s.data.state.state_version,
        p_action: "select",
        p_track: q.data![0].id,
      });
      expect(selected.error).toBeNull();
      const args = {
        p_room: room.id,
        p_version: selected.data.state.state_version,
        p_action: "ended",
      };
      const events = await Promise.all([
        a.rpc("playback_command", args),
        b.rpc("playback_command", args),
      ]);
      expect(events.every((r) => !r.error)).toBe(true);
      expect(events.filter((r) => r.data.conflict)).toHaveLength(1);
      const final = await a.rpc("playback_snapshot", { p_room: room.id });
      expect(final.data.state.state_version).toBe(
        selected.data.state.state_version + 1,
      );
    });
    it("owner grants persist and safe reorder/remove updates DB", async () => {
      expect(
        (
          await a
            .from("room_members")
            .update({ can_manage: true })
            .eq("room_id", room.id)
            .eq("user_id", uidB)
        ).error,
      ).toBeNull();
      const q = await b
        .from("playlist_items")
        .select("*")
        .eq("room_id", room.id)
        .order("position");
      const reversed = q.data!.map((t) => t.id).reverse();
      expect(
        (
          await b.rpc("playlist_mutation", {
            p_room: room.id,
            p_action: "reorder",
            p_order: reversed,
          })
        ).error,
      ).toBeNull();
      const order = await a
        .from("playlist_items")
        .select("id")
        .eq("room_id", room.id)
        .order("position");
      expect(order.data?.map((t) => t.id)).toEqual(reversed);
      const current = await b.rpc("playback_snapshot", { p_room: room.id });
      expect(
        (
          await b.rpc("playlist_mutation", {
            p_room: room.id,
            p_action: "remove",
            p_item: current.data.state.current_track_id,
          })
        ).error,
      ).toBeNull();
      const stopped = await a.rpc("playback_snapshot", { p_room: room.id });
      expect(stopped.data.state.status).toBe("stopped");
      expect(stopped.data.state.current_track_id).toBeNull();
    });
    it("private rooms and their playlists are protected until invited", async () => {
      const r = await a.rpc("create_room", {
        p_name: "Private test",
        p_description: "",
        p_visibility: "private",
        p_cover: "pink",
      });
      expect(r.error).toBeNull();
      privateRoom = r.data;
      owned.push(privateRoom.id);
      expect(
        (await b.from("rooms").select("*").eq("id", privateRoom.id)).data,
      ).toEqual([]);
      expect(
        (await b.rpc("join_room", { p_slug: privateRoom.slug })).error,
      ).not.toBeNull();
      expect(
        (await b.rpc("playback_snapshot", { p_room: privateRoom.id })).error,
      ).not.toBeNull();
      expect(
        (
          await b.rpc("join_room", {
            p_slug: privateRoom.slug,
            p_invite: privateRoom.invite_code,
          })
        ).error,
      ).toBeNull();
      expect(
        (await b.from("rooms").select("*").eq("id", privateRoom.id)).data,
      ).toHaveLength(1);
    });
    it("participant changes remain available to returning owner", async () => {
      expect(
        (
          await b.rpc("playlist_mutation", {
            p_room: room.id,
            p_action: "add",
            p_video: "9bZkp7q19f0",
            p_title: "Owner offline addition",
            p_thumbnail: "https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg",
          })
        ).error,
      ).toBeNull();
      const q = await a
        .from("playlist_items")
        .select("title")
        .eq("room_id", room.id)
        .eq("youtube_video_id", "9bZkp7q19f0");
      expect(q.data?.[0].title).toBe("Owner offline addition");
      expect(
        (await b.from("rooms").delete().eq("id", room.id).select()).data,
      ).toEqual([]);
      expect(
        (await a.from("rooms").select("id").eq("id", room.id)).data,
      ).toHaveLength(1);
    });
  },
);
