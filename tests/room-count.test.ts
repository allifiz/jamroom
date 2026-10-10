import { afterEach, expect, it, vi } from "vitest";
import { RealtimeClient, RealtimeChannel } from "@supabase/supabase-js";
import { watchRoomCount } from "../lib/room-count";

vi.mock("../lib/supabase", () => ({
  db: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}));
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it("shares one presence subscription for duplicate room cards and cleans up after the last card", async () => {
  vi.useFakeTimers();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-test-key";
  vi.spyOn(RealtimeClient.prototype, "connect").mockImplementation(() => {});
  const subscribe = vi.spyOn(RealtimeChannel.prototype, "subscribe");
  const remove = vi.spyOn(RealtimeClient.prototype, "removeChannel").mockImplementation(async (channel) => {
    channel.teardown();
    return "ok";
  });
  const first = watchRoomCount("duplicate-room", vi.fn());
  await Promise.resolve();
  // The SDK now considers this channel subscribed; adding .on again would throw.
  const second = watchRoomCount("duplicate-room", vi.fn());
  await Promise.resolve();
  expect(subscribe).toHaveBeenCalledTimes(1);
  first();
  await vi.advanceTimersByTimeAsync(0);
  expect(remove).not.toHaveBeenCalled();
  second();
  await vi.advanceTimersByTimeAsync(0);
  expect(remove).toHaveBeenCalledTimes(1);
});
