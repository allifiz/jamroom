import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (
  process.env.JAMROOM_LIVE_TESTS !== "1" ||
  !url ||
  url.includes("lyvmjirmondcolhystjp") ||
  new URL(url).hostname !== process.env.JAMROOM_TEST_HOST
)
  throw new Error("Isolated staging host required");
const f = JSON.parse(process.env.QA_FIXTURES);
const api = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const ok = (r) => {
  assert.equal(r.error, null, r.error?.message);
  return r.data;
};
ok(
  await api.auth.signInWithPassword({
    email: f.users[0].email,
    password: f.users[0].password,
  }),
);
const room = ok(
  await api.rpc("create_room", {
    p_name: `Browser QA ${randomUUID().slice(0, 8)}`,
    p_description: "Staging browser scenarios",
    p_visibility: "public",
    p_cover: "mint",
  }),
);
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const errors = [];
const contexts = [];
try {
  const pages = [];
  for (const user of f.users.slice(0, 3)) {
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    pages.push(page);
    page.on("pageerror", (error) => errors.push(error.message));
    // These checks exercise application controls, not YouTube audio/availability.
    await page.route(
      /https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com)\/.*/,
      (route) => route.abort(),
    );
    await page.goto(process.env.QA_PREVIEW_ACCESS_URL);
    const origin = new URL(page.url()).origin;
    await page.goto(origin + "/auth");
    await page.getByLabel("Email", { exact: true }).fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "Let me in" }).click();
    await expect(page).toHaveURL(/dashboard/);
    await page.goto(origin + `/room/${room.slug}`);
    await expect(
      page.getByRole("heading", { name: room.name, exact: true }),
    ).toBeVisible();
  }
  const [owner, a, b] = pages;
  await owner.getByText("Room settings ⚙", { exact: true }).click();
  await expect(a.getByText("Room settings ⚙", { exact: true })).toHaveCount(0);
  await owner.getByLabel("Enable moderation and majority skip voting").check();
  await owner.getByLabel("Friends can control playback").uncheck();
  await owner
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(
    owner.getByRole("heading", { name: "Room moderation", exact: true }),
  ).toBeVisible();
  for (const [video, title] of [
    ["dQw4w9WgXcQ", "QA First"],
    ["jNQXAC9IVRw", "QA Second"],
  ])
    ok(
      await api.rpc("playlist_mutation", {
        p_room: room.id,
        p_action: "add",
        p_video: video,
        p_title: title,
        p_thumbnail: `https://i.ytimg.com/vi/${video}/hqdefault.jpg`,
      }),
    );
  await expect(a.getByText("QA First", { exact: true }).first()).toBeVisible();
  for (const page of pages)
    await page.getByRole("button", { name: /Join.*Listen/i }).click();
  let snapshot = ok(await api.rpc("playback_snapshot", { p_room: room.id }));
  ok(
    await api.rpc("playback_command", {
      p_room: room.id,
      p_version: snapshot.state.state_version,
      p_action: "play",
    }),
  );
  await expect(
    a.getByRole("button", { name: "Vote to skip", exact: true }),
  ).toBeEnabled();
  await a.getByRole("button", { name: "Vote to skip", exact: true }).click();
  await expect(
    a.getByRole("button", { name: "Vote counted", exact: true }),
  ).toBeDisabled();
  await b.getByRole("button", { name: "Vote to skip", exact: true }).click();
  await expect
    .poll(
      async () =>
        ok(await api.rpc("playback_snapshot", { p_room: room.id })).state
          .state_version,
    )
    .toBe(snapshot.state.state_version + 2);
  await expect(
    a.getByRole("button", { name: "Vote to skip", exact: true }),
  ).toBeEnabled();
  const first = owner
    .getByRole("region", { name: "Room moderation" })
    .getByText(f.users[1].name, { exact: true });
  await expect(first).toBeVisible();
  owner.once("dialog", (dialog) => dialog.accept());
  await first
    .locator("..")
    .getByRole("button", { name: "Ban", exact: true })
    .click();
  await expect(a.getByRole("alert")).toContainText(
    /access.*changed|restricted/i,
    { timeout: 25000 },
  );
  await expect(
    a.getByRole("button", { name: "Vote to skip", exact: true }),
  ).toHaveCount(0);
  await owner
    .getByRole("button", { name: "Restore access", exact: true })
    .click();
  await a.reload();
  await expect(
    a.getByRole("heading", { name: room.name, exact: true }),
  ).toBeVisible();
  owner.once("dialog", (dialog) => dialog.accept());
  await owner
    .getByRole("button", { name: "Reset invite link", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        ok(
          await api
            .from("rooms")
            .select("invite_code")
            .eq("id", room.id)
            .single(),
        ).invite_code,
    )
    .not.toBe(room.invite_code);
  await a.reload();
  await expect(
    a.getByRole("heading", { name: room.name, exact: true }),
  ).toBeVisible();
  assert.deepEqual(errors, [], "No uncaught client exceptions");
  console.log(
    JSON.stringify({
      status: "passed",
      cases: [
        "3 browser accounts login",
        "owner-only settings",
        "feature opt-in",
        "realtime queue",
        "majority voting UI",
        "vote button idempotence",
        "ban stops access/player",
        "restore/reload persistence",
        "rotate invite",
        "no uncaught JS errors",
      ],
      youtubePlayback: "not tested; embeds blocked intentionally",
    }),
  );
} finally {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  ok(await api.from("rooms").delete().eq("id", room.id));
  await api.auth.signOut();
}
