import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
const live =
  process.env.JAMROOM_LIVE_TESTS === "1" &&
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const youtube = process.env.JAMROOM_YOUTUBE_TESTS === "1";
const ids = [
  "M7lc1UVf-VE",
  "jNQXAC9IVRw",
  "dQw4w9WgXcQ",
  "aqz-KE-bpKQ",
  "ScMzIvxBSi4",
];
test.describe("Live Supabase room lifecycle", () => {
  test.skip(
    !live,
    "Requires explicit live-test opt-in and real Supabase configuration.",
  );
  let a: SupabaseClient, b: SupabaseClient;
  let emailA: string, passwordA: string, emailB: string, passwordB: string;
  let rid: string | undefined;
  test.beforeAll(async () => {
    const make = () =>
      createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false } },
      );
    a = make();
    b = make();
    emailA =
      process.env.E2E_USER_A_EMAIL ?? `browser-a-${randomUUID()}@example.com`;
    passwordA = process.env.E2E_USER_A_PASSWORD ?? randomUUID() + "A!";
    emailB =
      process.env.E2E_USER_B_EMAIL ?? `browser-b-${randomUUID()}@example.com`;
    passwordB = process.env.E2E_USER_B_PASSWORD ?? randomUUID() + "B!";
    for (const [client, email, password] of [
      [a, emailA, passwordA],
      [b, emailB, passwordB],
    ] as const) {
      const r = process.env.E2E_USER_A_EMAIL
        ? await client.auth.signInWithPassword({ email, password })
        : await client.auth.signUp({
            email,
            password,
            options: {
              data: {
                display_name: client === a ? "Allif browser" : "Sinta browser",
              },
            },
          });
      if (r.error) throw r.error;
      if (!r.data.session)
        throw new Error(
          "Provide confirmed E2E accounts or use local Supabase with confirmations disabled.",
        );
    }
  });
  test.afterAll(async () => {
    if (rid) await a.from("rooms").delete().eq("id", rid);
    await a?.auth.signOut();
    await b?.auth.signOut();
  });
  async function login(page: Page, email: string, password: string) {
    await page.goto("/auth");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Let me in" }).click();
    await expect(page).toHaveURL(/dashboard/);
  }
  test("A/B/D: create, five persistent tracks, refresh, reopen, owner offline, realtime queue and chat", async ({
    browser,
  }) => {
    const owner = await browser.newContext();
    let listener: BrowserContext | undefined;
    let reopened: BrowserContext | undefined;
    try {
      const p = await owner.newPage();
      await login(p, emailA, passwordA);
      await p.goto("/create");
      const name = "Browser persistence " + randomUUID().slice(0, 8);
      await p.getByLabel("Room name").fill(name);
      await p.getByRole("button", { name: "Open my room" }).click();
      await expect(p).toHaveURL(/\/room\//);
      const path = new URL(p.url()).pathname;
      const slug = path.split("/").pop();
      const room = await a.from("rooms").select("id").eq("slug", slug).single();
      expect(room.error).toBeNull();
      rid = room.data!.id;
      for (const id of ids) {
        await p
          .getByRole("textbox", { name: "YouTube URL" })
          .fill(`https://youtu.be/${id}`);
        await p.getByRole("button", { name: "Add song", exact: true }).click();
        await expect(p.locator(".track")).toHaveCount(ids.indexOf(id) + 1);
      }
      expect(
        (await a.from("playlist_items").select("id").eq("room_id", rid)).data,
      ).toHaveLength(5);
      await p.reload();
      await expect(p.locator(".track")).toHaveCount(5);
      await owner.close();
      reopened = await browser.newContext();
      const again = await reopened.newPage();
      await login(again, emailA, passwordA);
      await again.goto(path);
      await expect(again.locator(".track")).toHaveCount(5);
      await reopened.close();
      reopened = undefined;
      listener = await browser.newContext();
      const q = await listener.newPage();
      await login(q, emailB, passwordB);
      await q.goto(path);
      await expect(q.locator(".track")).toHaveCount(5);
      await expect(q.getByText("You are the DJ!")).toBeVisible();
      await q
        .getByRole("button", { name: "Start the room’s soundtrack" })
        .click();
      await expect
        .poll(async () => {
          const s = await b.rpc("playback_snapshot", { p_room: rid });
          return s.data?.state.status;
        })
        .toBe("playing");
      await expect(q.getByTestId("youtube-player")).toHaveAttribute(
        "data-shared-status",
        "playing",
      );
      await q
        .getByRole("textbox", { name: "Chat message" })
        .fill("Owner offline, room still alive!");
      await q.getByRole("button", { name: "Send message" }).click();
      await expect(q.getByRole("log")).toContainText(
        "Owner offline, room still alive!",
      );
      const row = await b
        .from("playlist_items")
        .select("id")
        .eq("room_id", rid);
      expect(row.data).toHaveLength(5);
      // A distinct authenticated API client changes the queue; B must recover via realtime.
      const extra = await a.rpc("playlist_mutation", {
        p_room: rid,
        p_action: "add",
        p_video: "9bZkp7q19f0",
        p_title: "Realtime addition",
        p_thumbnail: "https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg",
      });
      expect(extra.error).toBeNull();
      await expect(q.locator(".track")).toHaveCount(6);
      await q.screenshot({
        path: test.info().outputPath("room-desktop.png"),
        fullPage: true,
      });
      await q.setViewportSize({ width: 390, height: 844 });
      expect(
        await q.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await q.screenshot({
        path: test.info().outputPath("room-mobile.png"),
        fullPage: true,
      });
      await q.reload();
      await expect(q.locator(".track")).toHaveCount(6);
    } finally {
      await owner.close().catch(() => {});
      await listener?.close();
      await reopened?.close();
    }
  });
  test("C: two real YouTube players synchronize, pause, and skip", async ({
    browser,
  }) => {
    test.skip(
      !youtube,
      "YouTube iframe access and autoplay permission are required; database state alone is insufficient.",
    );
    const r = await a.rpc("create_room", {
      p_name: "Live sync " + randomUUID().slice(0, 8),
      p_description: "",
      p_visibility: "public",
      p_cover: "blue",
    });
    if (r.error) throw r.error;
    const syncRoom = r.data;
    const contexts = [await browser.newContext(), await browser.newContext()];
    try {
      for (const id of ids.slice(0, 2)) {
        const add = await a.rpc("playlist_mutation", {
          p_room: syncRoom.id,
          p_action: "add",
          p_video: id,
          p_title: "Sync " + id,
          p_thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        });
        expect(add.error).toBeNull();
      }
      const [p, q] = await Promise.all(contexts.map((c) => c.newPage()));
      await login(p, emailA, passwordA);
      await login(q, emailB, passwordB);
      await p.goto("/room/" + syncRoom.slug);
      await q.goto("/room/" + syncRoom.slug);
      await p
        .getByRole("button", { name: "Start the room’s soundtrack" })
        .click();
      await q.getByRole("button", { name: "Join & Listen" }).click();
      for (const page of [p, q]) {
        const enable = page.getByRole("button", {
          name: "Enable audio · Start listening",
        });
        if (await enable.isVisible()) await enable.click();
        await expect(page.getByTestId("youtube-player")).toHaveAttribute(
          "data-player-status",
          "1",
          { timeout: 20000 },
        );
      }
      await expect
        .poll(async () => {
          const x = Number(
            await p
              .getByTestId("youtube-player")
              .getAttribute("data-player-time"),
          );
          const y = Number(
            await q
              .getByTestId("youtube-player")
              .getAttribute("data-player-time"),
          );
          return x > 0 && y > 0 && Math.abs(x - y) < 3;
        })
        .toBe(true);
      await p.getByRole("button", { name: "Pause", exact: true }).click();
      await expect(q.getByTestId("youtube-player")).toHaveAttribute(
        "data-player-status",
        "2",
      );
      const old = await p
        .getByTestId("youtube-player")
        .getAttribute("data-current-track");
      await q.getByRole("button", { name: "Next track", exact: true }).click();
      await expect
        .poll(() =>
          p.getByTestId("youtube-player").getAttribute("data-current-track"),
        )
        .not.toBe(old);
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
      await a.from("rooms").delete().eq("id", syncRoom.id);
    }
  });
});
