import { createClient } from "@libsql/client";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const dir = mkdtempSync(join(tmpdir(), "synora-api-"));
process.env.TURSO_DATABASE_URL = "file:" + join(dir, "test.db");
const origin = "http://localhost:3000";
let cookie = "";

function request(path: string, method: string, body?: unknown, requestOrigin = origin) {
  return new NextRequest(origin + path, {
    method,
    headers: {
      ...(method !== "GET" ? { Origin: requestOrigin } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeAll(async () => {
  const db = createClient({ url: process.env.TURSO_DATABASE_URL! });
  await db.executeMultiple(readFileSync("synora/migrations/0001_initial.sql", "utf8"));
  db.close();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("Synora HTTP boundary backed by real libSQL", () => {
  it("rejects cross-site bootstrap and creates a durable anonymous session", async () => {
    const { POST } = await import("../app/api/synora/session/route");
    expect((await POST(request("/api/synora/session", "POST", undefined, "https://evil.example"))).status).toBe(403);
    const created = await POST(request("/api/synora/session", "POST"));
    expect(created.status).toBe(200);
    expect((await created.json()).created).toBe(true);
    expect(created.headers.get("set-cookie")).toContain("HttpOnly");
    cookie = created.headers.get("set-cookie")!.split(";")[0];
    const restored = await POST(request("/api/synora/session", "POST"));
    expect((await restored.json()).created).toBe(false);
  });

  it("creates a room and enforces session and Origin for mutations", async () => {
    const { POST, GET } = await import("../app/api/synora/rooms/route");
    const data = { name: "Test Room", visibility: "private" };
    const forbidden = await POST(request("/api/synora/rooms", "POST", data, "https://evil.example"));
    expect(forbidden.status).toBe(403);
    const created = await POST(request("/api/synora/rooms", "POST", data));
    expect(created.status).toBe(201);
    const result = await created.json();
    expect(result.recoveryKey).toMatch(/^[\w-]{43}$/);
    expect(JSON.stringify(result.room)).not.toContain("recovery_hash");
    expect((await (await GET(request("/api/synora/rooms", "GET"))).json()).owned).toHaveLength(1);
    expect((await GET(new NextRequest(origin + "/api/synora/rooms"))).status).toBe(401);
  });
});
