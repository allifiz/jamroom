import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium, expect as baseExpect } from "@playwright/test";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (
  process.env.JAMROOM_LIVE_TESTS !== "1" ||
  !url ||
  url.includes("lyvmjirmondcolhystjp") ||
  new URL(url).hostname !== process.env.JAMROOM_TEST_HOST
)
  throw new Error("Isolated staging host required; production tests forbidden");
const fixtures = JSON.parse(process.env.QA_FIXTURES);
const make = () =>
  createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const clients = fixtures.users.slice(0, 3).map(make);
const [owner, member, otherOwner] = clients;
const rooms = [];
let browser;
let checks = 0;
const expect = baseExpect.configure({ timeout: 15000 });
const ok = (r) => {
  assert.equal(r.error, null, r.error?.message);
  return r.data;
};
const denied = (r) => {
  assert.ok(r.error, "Unauthorized request must fail");
  checks++;
};
const same = (actual, wanted) => {
  assert.deepEqual(actual, wanted);
  checks++;
};
const rpc = async (c, name, args) => ok(await c.rpc(name, args));
const count = async (c, rid) =>
  ok(await c.from("room_messages").select("id").eq("room_id", rid)).length;
async function room(c, visibility) {
  const r = await rpc(c, "create_room", {
    p_name: `Clear Chat QA ${randomUUID().slice(0, 8)}`,
    p_description: "Artificial staging fixtures",
    p_visibility: visibility,
    p_cover: "mint",
  });
  rooms.push([c, r.id]);
  return r;
}
try {
  for (let i = 0; i < clients.length; i++)
    ok(
      await clients[i].auth.signInWithPassword({
        email: fixtures.users[i].email,
        password: fixtures.users[i].password,
      }),
    );
  const r = await room(owner, "public");
  const other = await room(otherOwner, "private");
  await rpc(member, "join_room", { p_slug: r.slug });
  await rpc(owner, "send_message", {
    p_room: r.id,
    p_body: "Owner QA message",
  });
  await rpc(member, "send_message", {
    p_room: r.id,
    p_body: "Member QA message",
  });
  await rpc(otherOwner, "send_message", {
    p_room: other.id,
    p_body: "Other room stays",
  });
  await rpc(owner, "playlist_mutation", {
    p_room: r.id,
    p_action: "add",
    p_video: "jNQXAC9IVRw",
    p_title: "Unchanged QA track",
    p_thumbnail: "",
  });
  const state = ok(
    await owner
      .from("room_playback_states")
      .select("*")
      .eq("room_id", r.id)
      .single(),
  );
  denied(await member.rpc("clear_room_chat", { p_room: r.id }));
  denied(await otherOwner.rpc("clear_room_chat", { p_room: r.id }));
  denied(await owner.rpc("clear_room_chat", { p_room: other.id }));
  denied(await owner.rpc("clear_room_chat", { p_room: randomUUID() }));
  denied(await owner.rpc("clear_room_chat", { p_room: null }));
  denied(await make().rpc("clear_room_chat", { p_room: r.id }));
  denied(await member.from("room_messages").delete().eq("room_id", r.id));
  denied(await owner.from("room_messages").delete().eq("room_id", r.id));
  same(await count(owner, r.id), 2);

  browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  });
  const pages = [];
  const errors = [];
  for (let i = 0; i < 2; i++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(30000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(process.env.QA_PREVIEW_ACCESS_URL);
    const origin = new URL(page.url()).origin;
    await page.goto(origin + "/auth");
    await page
      .getByLabel("Email", { exact: true })
      .fill(fixtures.users[i].email);
    await page
      .getByLabel("Password", { exact: true })
      .fill(fixtures.users[i].password);
    await page.getByRole("button", { name: "Let me in" }).click();
    await expect(page).toHaveURL(/dashboard/);
    await page.goto(origin + "/room/" + r.slug);
    await expect(
      page.getByRole("heading", { name: r.name, exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("log", { name: "Room chat" })
        .getByText("Member QA message", { exact: true }),
    ).toBeVisible();
    pages.push(page);
  }
  const [op, mp] = pages;
  const clear = op.getByRole("button", {
    name: "Clear chat history",
    exact: true,
  });
  await expect(clear).toBeEnabled();
  await expect(
    mp.getByRole("button", { name: "Clear chat history", exact: true }),
  ).toHaveCount(0);
  op.once("dialog", async (d) => {
    assert.match(d.message(), /cannot be undone/);
    await d.dismiss();
  });
  await clear.click();
  same(await count(owner, r.id), 2);
  await expect(
    op
      .getByRole("log", { name: "Room chat" })
      .getByText("Owner QA message", { exact: true }),
  ).toBeVisible();

  // A failed RPC must preserve messages and restore the button for retry.
  const route = "**/rest/v1/rpc/clear_room_chat";
  await op.route(route, (r) =>
    r.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ code: "42501", message: "QA deletion rejected" }),
    }),
  );
  op.once("dialog", (d) => d.accept());
  await clear.click();
  await expect(
    op.getByText("QA deletion rejected", { exact: true }),
  ).toBeVisible();
  await expect(clear).toBeEnabled();
  same(await count(owner, r.id), 2);
  await op.unroute(route);

  op.once("dialog", (d) => d.accept());
  await clear.click();
  for (const p of pages)
    await expect(
      p.getByRole("log", { name: "Room chat" }).locator(".chat-message"),
    ).toHaveCount(0);
  await expect(clear).toBeDisabled();
  same(await count(owner, r.id), 0);
  await mp.reload();
  await expect(
    mp.getByRole("log", { name: "Room chat" }).locator(".chat-message"),
  ).toHaveCount(0);
  same(await rpc(owner, "clear_room_chat", { p_room: r.id }), 0);
  same(await count(otherOwner, other.id), 1);
  same(
    ok(await owner.from("playlist_items").select("id").eq("room_id", r.id))
      .length,
    1,
  );
  same(
    ok(await owner.from("room_members").select("user_id").eq("room_id", r.id))
      .length,
    2,
  );
  same(
    ok(
      await owner
        .from("room_playback_states")
        .select("*")
        .eq("room_id", r.id)
        .single(),
    ),
    state,
  );
  await rpc(member, "send_message", {
    p_room: r.id,
    p_body: "Chat still works after clearing",
  });
  await expect(
    op
      .getByRole("log", { name: "Room chat" })
      .getByText("Chat still works after clearing", { exact: true }),
  ).toBeVisible();
  const cleared = await Promise.all([
    rpc(owner, "clear_room_chat", { p_room: r.id }),
    rpc(owner, "clear_room_chat", { p_room: r.id }),
  ]);
  same(cleared.sort(), [0, 1]);
  same(await count(owner, r.id), 0);
  same(errors, []);
  console.log(
    JSON.stringify({
      status: "passed",
      apiAssertions: checks,
      browserCases: [
        "owner-only button",
        "confirmation cancel preserves messages",
        "RPC failure preserves messages and retry",
        "confirmed deletion",
        "realtime removal on member browser",
        "empty button disabled",
        "reload persistence",
        "new chat after clearing",
      ],
      concurrency: "two owner requests clear exactly one batch",
      isolation: "other-room chat, playlist, membership and playback unchanged",
    }),
  );
} finally {
  await browser?.close();
  for (const [c, id] of rooms) ok(await c.from("rooms").delete().eq("id", id));
  await Promise.all(clients.map((c) => c.auth.signOut()));
}
