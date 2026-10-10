import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (
  process.env.JAMROOM_LIVE_TESTS !== "1" ||
  !url ||
  url.includes("lyvmjirmondcolhystjp") ||
  new URL(url).hostname !== process.env.JAMROOM_TEST_HOST
) {
  throw new Error(
    "Explicit isolated test host required; production tests are prohibited.",
  );
}
const fixtures = JSON.parse(process.env.QA_FIXTURES);
const clients = fixtures.users.map(() =>
  createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
);
const [owner, a, b, c, outside] = clients;
const rooms = [];
let passed = 0;
const ok = (r) => {
  assert.equal(r.error, null, r.error?.message);
  return r.data;
};
const denied = (r, pattern) => {
  assert.ok(r.error, "Request should fail");
  if (pattern) assert.match(r.error.message, pattern);
  passed++;
};
const check = (condition, message) => {
  assert.ok(condition, message);
  passed++;
};
const call = async (client, name, args) => ok(await client.rpc(name, args));
const state = async (rid) =>
  (await call(owner, "playback_snapshot", { p_room: rid })).state;
const moderate = (action, user, rid) =>
  call(owner, "moderate_room", { p_room: rid, p_action: action, p_user: user });
async function makeRoom(visibility = "public") {
  const room = await call(owner, "create_room", {
    p_name: `QA ${fixtures.run.slice(0, 8)} ${rooms.length}`,
    p_description: "Isolated staging test",
    p_visibility: visibility,
    p_cover: "mint",
  });
  rooms.push(room.id);
  return room;
}
async function join(client, room, invite = null) {
  return client.rpc("join_room", { p_slug: room.slug, p_invite: invite });
}
async function enable(room) {
  ok(
    await owner
      .from("rooms")
      .update({ enhancements_enabled: true, allow_control: false })
      .eq("id", room.id),
  );
}
try {
  for (let i = 0; i < clients.length; i++)
    ok(
      await clients[i].auth.signInWithPassword({
        email: fixtures.users[i].email,
        password: fixtures.users[i].password,
      }),
    );
  const room = await makeRoom();
  check(
    !room.enhancements_enabled,
    "Existing/default rooms must remain opted out",
  );
  denied(
    await owner.rpc("moderate_room", {
      p_room: room.id,
      p_action: "rotate_invite",
    }),
    /disabled/,
  );
  await enable(room);
  for (const client of [a, b, c]) ok(await join(client, room));
  denied(
    await a.rpc("moderate_room", {
      p_room: room.id,
      p_action: "ban",
      p_user: fixtures.users[2].id,
    }),
    /Owner/,
  );
  denied(
    await a.rpc("moderate_room", {
      p_room: room.id,
      p_action: "rotate_invite",
    }),
    /Owner/,
  );
  denied(
    await owner.rpc("moderate_room", {
      p_room: room.id,
      p_action: "ban",
      p_user: fixtures.users[0].id,
    }),
    /owner/,
  );
  denied(
    await owner.rpc("moderate_room", {
      p_room: room.id,
      p_action: "unknown",
      p_user: fixtures.users[1].id,
    }),
    /Unknown/,
  );
  denied(
    await a
      .from("room_restrictions")
      .insert({
        room_id: room.id,
        user_id: fixtures.users[0].id,
        action: "ban",
      }),
  );
  check(
    ok(await a.from("room_restrictions").select("*")).length === 0,
    "Restrictions visible only to owner",
  );
  await moderate("kick", fixtures.users[1].id, room.id);
  denied(await join(a, room), /restricted/);
  check(
    ok(await a.from("rooms").select("id").eq("id", room.id)).length === 0,
    "Kicked participant cannot read public room",
  );
  denied(
    await a.rpc("listener_heartbeat", { p_room: room.id, p_tab: randomUUID() }),
    /Permission/,
  );
  denied(
    await a.rpc("send_message", { p_room: room.id, p_body: "blocked" }),
    /Permission/,
  );
  await moderate("unban", fixtures.users[1].id, room.id);
  ok(await join(a, room));
  passed++;
  await moderate("ban", fixtures.users[1].id, room.id);
  denied(await join(a, room, room.invite_code), /restricted/);
  denied(
    await a.rpc("playlist_mutation", {
      p_room: room.id,
      p_action: "add",
      p_video: "dQw4w9WgXcQ",
      p_title: "blocked",
      p_thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    }),
    /Permission/,
  );
  await moderate("unban", fixtures.users[1].id, room.id);
  ok(await join(a, room));

  const privateRoom = await makeRoom("private");
  await enable(privateRoom);
  ok(await join(a, privateRoom, privateRoom.invite_code));
  await moderate("rotate_invite", null, privateRoom.id);
  denied(
    await join(outside, privateRoom, privateRoom.invite_code),
    /invitation/,
  );
  ok(await join(a, privateRoom));
  passed++; // Existing membership is preserved.
  const rotated = ok(
    await owner
      .from("rooms")
      .select("invite_code")
      .eq("id", privateRoom.id)
      .single(),
  );
  check(rotated.invite_code !== privateRoom.invite_code, "Invite must rotate");
  ok(await join(outside, privateRoom, rotated.invite_code));
  passed++;
  await moderate("ban", fixtures.users[1].id, privateRoom.id);
  denied(await join(a, privateRoom, rotated.invite_code), /restricted/);
  await moderate("unban", fixtures.users[1].id, privateRoom.id);
  denied(await join(a, privateRoom, privateRoom.invite_code), /invitation/);
  ok(await join(a, privateRoom, rotated.invite_code));

  for (const [id, title] of [
    ["dQw4w9WgXcQ", "One"],
    ["jNQXAC9IVRw", "Two"],
    ["M7lc1UVf-VE", "Three"],
  ])
    await call(owner, "playlist_mutation", {
      p_room: room.id,
      p_action: "add",
      p_video: id,
      p_title: title,
      p_thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    });
  for (const client of [a, b, c])
    await call(client, "listener_heartbeat", {
      p_room: room.id,
      p_tab: randomUUID(),
    });
  const tab = randomUUID();
  await call(a, "listener_heartbeat", { p_room: room.id, p_tab: tab });
  let s = await state(room.id);
  s = (
    await call(owner, "playback_command", {
      p_room: room.id,
      p_version: s.state_version,
      p_action: "play",
    })
  ).state;
  check(
    !(await call(a, "room_permission", { rid: room.id, action: "control" })),
    "Non-DJ voter must not gain direct playback permission",
  );
  denied(
    await a.rpc("playback_command", {
      p_room: room.id,
      p_version: s.state_version,
      p_action: "next",
    }),
    /Permission/,
  );
  denied(
    await outside.rpc("vote_skip", {
      p_room: room.id,
      p_version: s.state_version,
    }),
    /listen/,
  );
  denied(
    await a
      .from("room_skip_votes")
      .insert({
        room_id: room.id,
        state_version: s.state_version,
        user_id: fixtures.users[1].id,
      }),
  );
  const tally = await call(a, "skip_vote_status", { p_room: room.id });
  check(
    tally.eligible === 3 && tally.required === 2,
    "Tabs must count as one account; majority of 3 is 2",
  );
  const first = await call(a, "vote_skip", {
    p_room: room.id,
    p_version: s.state_version,
  });
  check(first.votes === 1 && !first.skipped, "First vote must not skip");
  const repeated = await call(a, "vote_skip", {
    p_room: room.id,
    p_version: s.state_version,
  });
  check(
    repeated.votes === 1 && repeated.has_voted,
    "Duplicate vote must be idempotent",
  );
  const racing = await Promise.all(
    [b, c].map((client) =>
      call(client, "vote_skip", {
        p_room: room.id,
        p_version: s.state_version,
      }),
    ),
  );
  check(
    racing.filter((v) => v.skipped).length === 1 &&
      racing.filter((v) => v.conflict).length === 1,
    "Concurrent votes must advance only once",
  );
  const next = await state(room.id);
  check(
    next.state_version === s.state_version + 1 &&
      next.current_track_id !== s.current_track_id,
    "Exactly one track change",
  );
  check(
    (await call(a, "skip_vote_status", { p_room: room.id })).votes === 0,
    "Votes reset after skip",
  );
  await call(a, "vote_skip", {
    p_room: room.id,
    p_version: next.state_version,
  });
  s = (
    await call(owner, "playback_command", {
      p_room: room.id,
      p_version: next.state_version,
      p_action: "seek",
      p_position: 5,
    })
  ).state;
  check(
    (await call(a, "skip_vote_status", { p_room: room.id })).votes === 0,
    "Seek resets the voting state",
  );
  await moderate("ban", fixtures.users[1].id, room.id);
  denied(
    await a.rpc("vote_skip", { p_room: room.id, p_version: s.state_version }),
    /Permission/,
  );
  check(
    (await call(b, "skip_vote_status", { p_room: room.id })).eligible === 2,
    "Banned listener removed from tally",
  );
  s = (
    await call(owner, "playback_command", {
      p_room: room.id,
      p_version: s.state_version,
      p_action: "pause",
    })
  ).state;
  denied(
    await b.rpc("vote_skip", { p_room: room.id, p_version: s.state_version }),
    /playing/,
  );
  await call(b, "send_message", {
    p_room: room.id,
    p_body: "Regression chat works",
  });
  check(
    ok(
      await c.from("room_messages").select("body").eq("room_id", room.id),
    ).some((m) => m.body === "Regression chat works"),
    "Chat persists across independent clients",
  );
  check(
    ok(await owner.from("playlist_items").select("id").eq("room_id", room.id))
      .length === 3,
    "Moderation preserves playlist",
  );
  const anonymous = createClient(
    url,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } },
  );
  denied(
    await anonymous.rpc("moderate_room", {
      p_room: room.id,
      p_action: "rotate_invite",
    }),
  );
  denied(
    await anonymous.rpc("vote_skip", {
      p_room: room.id,
      p_version: s.state_version,
    }),
  );
  console.log(
    JSON.stringify({
      status: "passed",
      assertions: passed,
      cases: [
        "feature opt-in",
        "owner-only moderation",
        "kick",
        "ban",
        "restore access",
        "private invites",
        "RLS/direct write denial",
        "listener eligibility",
        "duplicate tabs/votes",
        "concurrent majority/CAS",
        "stale vote reset",
        "chat/playlist persistence",
        "anonymous denial",
      ],
    }),
  );
} finally {
  for (const rid of rooms) ok(await owner.from("rooms").delete().eq("id", rid));
  await Promise.all(clients.map((client) => client.auth.signOut()));
}
